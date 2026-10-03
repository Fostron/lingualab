/**
 * Account and sync.
 *
 * Login: the official Telegram login (oauth.telegram.org) returns signed user data; the sync server
 * checks the signature and returns a session token.
 * Sync: each course is one compressed blob on the server. Syncing = download, merge with the local
 * data, write the merge locally, upload it (with the revision we started from; on a conflict the
 * merge is redone). The merge never loses work: union of logs, the newer state of each card, the best
 * result of each lesson, and so on — so two devices used offline both keep their progress.
 */
import { dumpCourse, getSettings, localCourses, replaceCourse, type CardRec, type CourseDump, type CourseProgress, type LessonRec, type Settings, type UnitRec } from './db';
import { bump, getState, updateSettings } from './store';

export const BOT_ID = '8757682316'; // public id of @lingualibauth_bot (not the token)
const API = (() => {
  try {
    return localStorage.getItem('lingualab.api') || 'https://lk.frdsecure.co.uk/lingua';
  } catch {
    return 'https://lk.frdsecure.co.uk/lingua';
  }
})();

export interface TgUser {
  id: number;
  name: string;
  username?: string;
  photo?: string;
}

interface Session {
  token: string;
  user: TgUser;
}

export type SyncState = 'off' | 'idle' | 'syncing' | 'ok' | 'error' | 'offline';

export const sync = {
  state: 'off' as SyncState,
  last: 0,
  error: '',
  busy: 0, // exercise sessions running: don't rewrite local data under them
};

const subs = new Set<() => void>();
export function onSync(f: () => void) {
  subs.add(f);
  return () => subs.delete(f);
}
function emit() {
  for (const f of subs) f();
}

// ---------- session ----------

export function session(): Session | null {
  try {
    const s = localStorage.getItem('lingualab.session');
    return s ? (JSON.parse(s) as Session) : null;
  } catch {
    return null;
  }
}

function setSession(s: Session | null) {
  try {
    if (s) localStorage.setItem('lingualab.session', JSON.stringify(s));
    else localStorage.removeItem('lingualab.session');
  } catch {
    /* ignore */
  }
  sync.state = s ? 'idle' : 'off';
  emit();
}

export function loginSkipped() {
  try {
    return localStorage.getItem('lingualab.loginSkipped') === '1';
  } catch {
    return true;
  }
}

export function skipLogin() {
  try {
    localStorage.setItem('lingualab.loginSkipped', '1');
  } catch {
    /* ignore */
  }
  emit();
}

async function api(path: string, init: RequestInit = {}) {
  const s = session();
  const headers = new Headers(init.headers);
  if (s) headers.set('Authorization', `Bearer ${s.token}`);
  const r = await fetch(API + path, { ...init, headers });
  if (r.status === 401 && s) {
    setSession(null);
    throw new Error('session expired');
  }
  return r;
}

/** Signed data from Telegram → our session. */
export async function finishTelegramLogin(data: Record<string, unknown>) {
  const r = await fetch(API + '/auth/telegram', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
  setSession({ token: j.token, user: j.user });
  void syncAll();
  return j.user as TgUser;
}

function isStandalone() {
  return window.matchMedia?.('(display-mode: standalone)').matches || (navigator as any).standalone === true;
}

function authUrl() {
  const lang = document.documentElement.lang || 'en';
  return `https://oauth.telegram.org/auth?bot_id=${BOT_ID}&origin=${encodeURIComponent(location.origin)}&request_access=write&lang=${lang}&return_to=${encodeURIComponent(location.origin + location.pathname)}`;
}

/**
 * Open the Telegram login. In a browser tab: a popup that posts the result back. In the installed app
 * (or if popups are blocked): the page itself goes to Telegram and comes back with #tgAuthResult=….
 */
export function startTelegramLogin(): Promise<TgUser> {
  return new Promise((resolve, reject) => {
    if (isStandalone()) {
      location.href = authUrl();
      return;
    }
    const w = 550;
    const h = 520;
    const popup = window.open(authUrl(), 'telegram_oauth', `width=${w},height=${h},left=${Math.max(0, (screen.width - w) / 2)},top=${Math.max(0, (screen.height - h) / 2)}`);
    if (!popup) {
      location.href = authUrl();
      return;
    }
    let done = false;
    const onMsg = (e: MessageEvent) => {
      if (e.source !== popup) return;
      let d: any = {};
      try {
        d = typeof e.data === 'string' ? JSON.parse(e.data) : e.data;
      } catch {
        /* not ours */
      }
      if (d && d.event === 'auth_result') {
        done = true;
        window.removeEventListener('message', onMsg);
        if (d.result) finishTelegramLogin(d.result).then(resolve, reject);
        else reject(new Error('cancelled'));
      }
    };
    window.addEventListener('message', onMsg);
    const check = setInterval(async () => {
      if (!popup.closed) return;
      clearInterval(check);
      if (done) return;
      window.removeEventListener('message', onMsg);
      // closed without a message: ask Telegram whether the login went through (same as the official widget)
      try {
        const r = await fetch('https://oauth.telegram.org/auth/get', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest' },
          body: `bot_id=${BOT_ID}`,
        });
        const j = await r.json();
        if (j && j.user) finishTelegramLogin(j.user).then(resolve, reject);
        else reject(new Error('cancelled'));
      } catch {
        reject(new Error('cancelled'));
      }
    }, 400);
  });
}

/** After a redirect login the result is in the URL: #tgAuthResult=<base64 JSON>. */
export function takeRedirectResult(): Record<string, unknown> | null {
  const m = location.hash.match(/[#?&]tgAuthResult=([A-Za-z0-9\-_=]*)$/);
  if (!m) return null;
  history.replaceState(null, '', location.pathname + '#/');
  try {
    let d = m[1].replace(/-/g, '+').replace(/_/g, '/');
    while (d.length % 4) d += '=';
    const bin = atob(d);
    const bytes = Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
}

export async function logout() {
  try {
    await api('/auth/logout', { method: 'POST' });
  } catch {
    /* offline: forget locally anyway */
  }
  setSession(null);
}

// ---------- compression ----------

async function pack(obj: unknown): Promise<Blob> {
  const json = new Blob([JSON.stringify(obj)], { type: 'application/json' });
  if (typeof CompressionStream === 'undefined') return json;
  return new Response(json.stream().pipeThrough(new CompressionStream('gzip'))).blob();
}

async function unpack<T>(buf: ArrayBuffer): Promise<T> {
  const b = new Uint8Array(buf);
  if (b[0] === 0x1f && b[1] === 0x8b) {
    const s = new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'));
    return JSON.parse(await new Response(s).text());
  }
  return JSON.parse(new TextDecoder().decode(b));
}

// ---------- merge ----------

const UNIT_ORDER: Record<string, number> = { new: 0, learning: 1, known: 2, done: 3 };

function mergeLesson(a?: LessonRec, b?: LessonRec): LessonRec | undefined {
  if (!a || !b) return a || b;
  return { best: Math.max(a.best, b.best), passed: a.passed || b.passed, tries: Math.max(a.tries, b.tries), ts: Math.max(a.ts, b.ts) };
}

function mergeUnit(a: UnitRec, b: UnitRec): UnitRec {
  const lessons: Record<string, LessonRec> = {};
  if (a.lessons || b.lessons) for (const k of new Set([...Object.keys(a.lessons || {}), ...Object.keys(b.lessons || {})])) lessons[k] = mergeLesson(a.lessons?.[k], b.lessons?.[k])!;
  const test = !a.test || !b.test ? a.test || b.test : a.test.score >= b.test.score ? a.test : b.test;
  return {
    ...a,
    status: UNIT_ORDER[a.status] >= UNIT_ORDER[b.status] ? a.status : b.status,
    learned: [...new Set([...a.learned, ...b.learned])],
    topicsRead: [...new Set([...a.topicsRead, ...b.topicsRead])],
    lessons: a.lessons || b.lessons ? lessons : undefined,
    test,
    updated: Math.max(a.updated, b.updated),
  };
}

const cardTime = (c: CardRec) => c.last_review ?? c.added;

function maxRec(a: Record<string, number> = {}, b: Record<string, number> = {}) {
  const out: Record<string, number> = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = Math.max(out[k] || 0, v);
  return out;
}

function mergeProgress(a: CourseProgress | null, b: CourseProgress | null): CourseProgress | null {
  if (!a || !b) return a || b;
  const placement = !a.placement || !b.placement ? a.placement || b.placement : a.placement.ts >= b.placement.ts ? a.placement : b.placement;
  const newToday = !a.newToday || !b.newToday ? a.newToday || b.newToday : a.newToday.day === b.newToday.day ? { day: a.newToday.day, n: Math.max(a.newToday.n, b.newToday.n) } : a.newToday.day > b.newToday.day ? a.newToday : b.newToday;
  return {
    course: a.course,
    started: Math.min(a.started, b.started),
    days: [...new Set([...a.days, ...b.days])].sort(),
    placement,
    newToday,
    time: maxRec(a.time, b.time),
    lessonsDone: maxRec(a.lessonsDone, b.lessonsDone),
    resetAt: Math.max(a.resetAt || 0, b.resetAt || 0) || undefined,
  };
}

/** Combine two copies of a course; the result does not depend on the order of arguments. */
export function mergeDumps(a: CourseDump, b: CourseDump): CourseDump {
  const progress = mergeProgress(a.progress, b.progress);
  const resetAt = progress?.resetAt || 0;
  if (progress && resetAt) progress.days = progress.days.filter((d) => new Date(d + 'T23:59:59').getTime() >= resetAt);
  const cards = new Map<string, CardRec>();
  for (const c of [...a.cards, ...b.cards]) {
    if (cardTime(c) < resetAt) continue;
    const o = cards.get(c.key);
    if (!o || cardTime(c) > cardTime(o) || (cardTime(c) === cardTime(o) && c.reps > o.reps)) cards.set(c.key, c);
  }
  // the same answer can be logged twice in one millisecond: number the repeats within each copy
  const logs = new Map<string, CourseDump['logs'][number]>();
  for (const side of [a.logs, b.logs]) {
    const seen = new Map<string, number>();
    for (const l of side) {
      if (l.ts < resetAt) continue;
      const k = `${l.ts}|${l.cid}|${l.ex}|${l.ok ? 1 : 0}|${l.rating}`;
      const i = seen.get(k) || 0;
      seen.set(k, i + 1);
      logs.set(`${k}#${i}`, l);
    }
  }
  const units = new Map<string, UnitRec>();
  for (const u of [...a.units, ...b.units]) {
    if (u.updated < resetAt) continue;
    const o = units.get(u.key);
    units.set(u.key, o ? mergeUnit(o, u) : u);
  }
  const assess = new Map<number, unknown>();
  for (const r of [...a.assess, ...b.assess] as { ts: number }[]) assess.set(r.ts, r);
  return {
    v: 1,
    course: a.course,
    cards: [...cards.values()].sort((x, y) => (x.key < y.key ? -1 : 1)),
    logs: [...logs.values()].sort((x, y) => x.ts - y.ts || (x.cid < y.cid ? -1 : 1)),
    units: [...units.values()].sort((x, y) => (x.key < y.key ? -1 : 1)),
    progress,
    assess: [...assess.values()].sort((x: any, y: any) => x.ts - y.ts).slice(-20),
  };
}

/** Cheap fingerprint to tell whether a merge changed anything. */
function fingerprint(d: CourseDump) {
  let h = 0;
  const s = JSON.stringify([
    d.cards.map((c) => [c.key, c.reps, c.due, c.lapses]).sort(),
    d.logs.length,
    d.logs.length ? d.logs[d.logs.length - 1].ts : 0,
    d.units.map((u) => [u.key, u.status, u.learned.length, u.topicsRead.length, Object.entries(u.lessons || {}).sort().map(([k, v]) => [k, v.passed, v.best, v.tries])]).sort(),
    d.progress && [d.progress.days.length, d.progress.placement?.ts, d.progress.resetAt, Object.values(d.progress.time || {}).reduce((a, b) => a + b, 0), d.progress.newToday],
    d.assess.length,
  ]);
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return `${s.length}:${h}`;
}

// ---------- sync ----------

const SYNC_SETTINGS: (keyof Settings)[] = ['newPerDay', 'wordsPerLesson', 'difficulty', 'dailyGoal', 'hints', 'autoplay', 'rate', 'typingOnly', 'strictAccents', 'retention', 'theme'];

async function syncSettings() {
  const r = await api('/data/settings');
  const rev = r.ok ? Number(r.headers.get('X-Rev')) || 0 : 0;
  const remote = r.ok ? await unpack<Partial<Settings>>(await r.arrayBuffer()) : null;
  const local = await getSettings();
  if (remote && (remote.updatedAt || 0) > (local.updatedAt || 0)) {
    const patch: Partial<Settings> = { updatedAt: remote.updatedAt };
    for (const k of SYNC_SETTINGS) if (k in remote) (patch as any)[k] = (remote as any)[k];
    await updateSettings(patch, true);
    return;
  }
  if (!remote || (local.updatedAt || 0) > (remote.updatedAt || 0)) {
    const out: Partial<Settings> = { updatedAt: local.updatedAt || Date.now() };
    for (const k of SYNC_SETTINGS) (out as any)[k] = (local as any)[k];
    await api(`/data/settings?base=${rev}`, { method: 'PUT', body: await pack(out) });
  }
}

async function syncCourse(course: string) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const r = await api(`/data/c:${course}`);
    if (!r.ok && r.status !== 404) throw new Error(`HTTP ${r.status}`);
    const rev = r.ok ? Number(r.headers.get('X-Rev')) || 0 : 0;
    const remote = r.ok ? await unpack<CourseDump>(await r.arrayBuffer()) : null;
    const local = await dumpCourse(course);
    const merged = remote ? mergeDumps(local, remote) : local;
    const fm = fingerprint(merged);
    if (fm !== fingerprint(local)) await replaceCourse(merged);
    if (remote && fm === fingerprint(remote)) return;
    const put = await api(`/data/c:${course}?base=${rev}`, { method: 'PUT', body: await pack(merged) });
    if (put.ok) return;
    if (put.status !== 409) throw new Error(`HTTP ${put.status}`);
    // someone else uploaded in between: merge again
  }
}

let running: Promise<void> | null = null;

/** Sync settings and every course that exists here or on the server. */
export function syncAll(): Promise<void> {
  if (!session()) return Promise.resolve();
  if (sync.busy > 0) {
    scheduleSync(15000);
    return Promise.resolve();
  }
  if (running) return running;
  running = (async () => {
    if (!navigator.onLine) {
      sync.state = 'offline';
      emit();
      return;
    }
    sync.state = 'syncing';
    emit();
    try {
      await syncSettings();
      const list = await api('/data');
      const remoteKeys: { key: string }[] = list.ok ? await list.json() : [];
      const courses = new Set([...(await localCourses()), ...remoteKeys.filter((k) => k.key.startsWith('c:')).map((k) => k.key.slice(2))]);
      const cur = getState().course?.meta.id;
      // the open course first
      for (const c of [...courses].sort((a, b) => (a === cur ? -1 : b === cur ? 1 : 0))) await syncCourse(c);
      sync.state = 'ok';
      sync.last = Date.now();
      sync.error = '';
      bump();
    } catch (e) {
      sync.state = navigator.onLine ? 'error' : 'offline';
      sync.error = String((e as Error).message || e);
    } finally {
      emit();
      running = null;
    }
  })();
  return running;
}

let timer: ReturnType<typeof setTimeout> | null = null;

/** Sync a few seconds after progress changes (debounced). */
export function scheduleSync(delay = 4000) {
  if (!session()) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void syncAll();
  }, delay);
}

/** On start: finish a redirect login, sync, and keep syncing in the background. */
export function initSync() {
  const redirect = takeRedirectResult();
  if (redirect) void finishTelegramLogin(redirect).catch((e) => ((sync.state = 'error'), (sync.error = String(e.message || e)), emit()));
  if (session()) {
    sync.state = 'idle';
    void syncAll();
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void syncAll();
    else if (Date.now() - sync.last > 60_000) void syncAll();
  });
  window.addEventListener('online', () => void syncAll());
  setInterval(() => {
    if (document.visibilityState === 'visible') void syncAll();
  }, 5 * 60_000);
}
