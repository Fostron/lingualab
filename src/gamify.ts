/**
 * XP, profile level, achievements, streak with a weekly freeze, and the leaderboard.
 * Everything is computed from data already stored (answers, lessons, essays, assessments),
 * so it is the same on every device after sync.
 */
import { today, type LogRec } from './db';
import type { Essay } from './essays';
import { lessonsOf } from './lessons';
import type { ProgressInfo } from './progress';
import { api, session } from './sync';
import type { LoadedCourse } from './types';

const DAY = 86400000;

export const XP = {
  answer: 10, // right answer
  hinted: 5, // right, but with a hint (rated Hard)
  tried: 1, // wrong answers still count a little: effort
  lesson: 20,
  perfect: 10, // extra for a lesson without mistakes
  unit: 50,
  exam: 100,
  goal: 20, // daily goal reached
  essay: 30,
  assessment: 50,
};

/** Monday 00:00 of the current week (local time). */
export function weekStart(now = new Date()) {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.getTime();
}

export interface XpEvent {
  ts: number;
  xp: number;
}

/** All XP-earning events of a course. */
export function xpEvents(c: LoadedCourse, info: ProgressInfo, logs: LogRec[], essays: Essay[], assessments: { ts: number }[], goal: number): XpEvent[] {
  const ev: XpEvent[] = [];
  for (const l of logs) ev.push({ ts: l.ts, xp: l.ok ? (l.rating === 2 ? XP.hinted : XP.answer) : XP.tried });
  for (const u of c.units) {
    const r = info.units.get(u.id);
    if (!r?.lessons) continue;
    for (const l of lessonsOf(c, u)) {
      const x = r.lessons[l.slug];
      if (!x?.passed || !x.ts || !x.tries) continue; // tested-out / placement lessons don't earn
      ev.push({ ts: x.ts, xp: XP.lesson + (x.best >= 1 ? XP.perfect : 0) + (l.kind === 'exam' ? XP.exam : 0) + (l.kind === 'test' ? XP.unit : 0) });
    }
  }
  for (const [day, n] of Object.entries(info.prog.lessonsDone || {})) if (n >= goal) ev.push({ ts: new Date(day + 'T20:00:00').getTime(), xp: XP.goal });
  for (const e of essays) if (e.check) ev.push({ ts: e.check.ts, xp: XP.essay });
  for (const a of assessments) ev.push({ ts: a.ts, xp: XP.assessment });
  return ev;
}

export function xpTotals(ev: XpEvent[]) {
  const ws = weekStart();
  const t0 = new Date();
  t0.setHours(0, 0, 0, 0);
  let total = 0;
  let week = 0;
  let todayXp = 0;
  for (const e of ev) {
    total += e.xp;
    if (e.ts >= ws) week += e.xp;
    if (e.ts >= t0.getTime()) todayXp += e.xp;
  }
  return { total, week, today: todayXp };
}

/** Profile level: each level needs a bit more XP than the previous one. */
export function profileLevel(xp: number) {
  let lvl = 1;
  let need = 100;
  let base = 0;
  while (xp >= base + need) {
    base += need;
    lvl++;
    need = Math.round(need * 1.25);
  }
  return { level: lvl, into: xp - base, need };
}

// ---------- streak with a freeze ----------

/**
 * Days in a row. One missed day per calendar week is covered by a "freeze" (it doesn't break the
 * streak); a second missed day in the same week does. Today not yet studied doesn't break it either.
 */
export function streakInfo(days: string[]) {
  const set = new Set(days);
  const d = new Date();
  if (!set.has(today(d))) d.setDate(d.getDate() - 1);
  let current = 0;
  const frozen: string[] = [];
  const usedWeeks = new Set<number>();
  for (let guard = 0; guard < 4000; guard++) {
    const key = today(d);
    if (set.has(key)) current++;
    else {
      const w = weekStart(d);
      // a freeze needs studied days on both sides of the gap
      const prev = new Date(d);
      prev.setDate(prev.getDate() - 1);
      if (current > 0 && !usedWeeks.has(w) && set.has(today(prev))) {
        usedWeeks.add(w);
        frozen.push(key);
      } else break;
    }
    d.setDate(d.getDate() - 1);
  }
  // best ever (with the same freeze rule, simplified: longest run allowing one gap per week)
  const sorted = [...set].sort();
  let best = 0;
  let run = 0;
  let prevTs = 0;
  let gapWeeks = new Set<number>();
  for (const k of sorted) {
    const ts = new Date(k + 'T12:00:00').getTime();
    const gap = prevTs ? Math.round((ts - prevTs) / DAY) : 1;
    if (gap === 1) run++;
    else if (gap === 2 && !gapWeeks.has(weekStart(new Date(ts - DAY)))) {
      gapWeeks.add(weekStart(new Date(ts - DAY)));
      run++;
    } else {
      run = 1;
      gapWeeks = new Set();
    }
    best = Math.max(best, run);
    prevTs = ts;
  }
  return { current, best: Math.max(best, current), frozen, freezeLeft: !usedWeeks.has(weekStart()) };
}

// ---------- achievements ----------

export interface Achievement {
  id: string;
  icon: string;
  done: boolean;
  value: number; // progress towards the goal
  goal: number;
}

export function achievements(c: LoadedCourse, info: ProgressInfo, logs: LogRec[], essays: Essay[], assessments: unknown[]): Achievement[] {
  const lessons: { kind: string; best: number; tries: number; level: string }[] = [];
  for (const u of c.units) {
    const r = info.units.get(u.id);
    if (!r?.lessons) continue;
    for (const l of lessonsOf(c, u)) {
      const x = r.lessons[l.slug];
      if (x?.passed) lessons.push({ kind: l.kind, best: x.best, tries: x.tries, level: u.level });
    }
  }
  const st = streakInfo(info.prog.days);
  const hours = logs.map((l) => new Date(l.ts).getHours());
  const maxDay = Math.max(0, ...Object.values(info.prog.time || {}));
  const checked = essays.filter((e) => e.check).length;
  const a = (id: string, icon: string, value: number, goal: number): Achievement => ({ id, icon, value: Math.min(value, goal), goal, done: value >= goal });
  const exams = ['A1', 'A2', 'B1', 'B2', 'C1'].map((L) => a(`exam-${L}`, '🎓', lessons.some((x) => x.kind === 'exam' && x.level === L && x.tries > 0) ? 1 : 0, 1));
  return [
    a('first', '🌱', lessons.filter((x) => x.tries > 0).length, 1),
    a('lessons-50', '📚', lessons.filter((x) => x.tries > 0).length, 50),
    a('perfect', '💯', lessons.filter((x) => x.tries > 0 && x.best >= 1).length, 1),
    a('perfect-20', '🏅', lessons.filter((x) => x.tries > 0 && x.best >= 1).length, 20),
    a('streak-3', '🔥', st.best, 3),
    a('streak-7', '🔥', st.best, 7),
    a('streak-30', '🌋', st.best, 30),
    a('words-100', '🧠', info.learned.size, 100),
    a('words-500', '🧠', info.learned.size, 500),
    a('words-1000', '👑', info.learned.size, 1000),
    a('reviews-100', '🔁', logs.length, 100),
    a('reviews-1000', '♾️', logs.length, 1000),
    a('hour', '⏱️', Math.round(maxDay / 60), 60),
    a('early', '🌅', hours.some((h) => h >= 5 && h < 7) ? 1 : 0, 1),
    a('night', '🦉', hours.some((h) => h >= 23 || h < 2) ? 1 : 0, 1),
    a('essay', '✍️', checked, 1),
    a('essay-10', '📝', checked, 10),
    a('assessment', '🧭', assessments.length, 1),
    ...exams,
  ];
}

// ---------- celebrations: remember what was already shown ----------

const SEEN = (course: string) => `lingualab.ach.${course}`;

export function newlyUnlocked(course: string, list: Achievement[]): Achievement[] {
  let seen: string[] = [];
  try {
    seen = JSON.parse(localStorage.getItem(SEEN(course)) || '[]');
  } catch {
    /* ignore */
  }
  const fresh = list.filter((x) => x.done && !seen.includes(x.id));
  try {
    localStorage.setItem(SEEN(course), JSON.stringify(list.filter((x) => x.done).map((x) => x.id)));
  } catch {
    /* ignore */
  }
  // the very first time, don't celebrate everything at once
  return seen.length || fresh.length <= 2 ? fresh : [];
}

// ---------- leaderboard ----------

export interface Board {
  id: number;
  name: string;
  username?: string;
  photo?: string;
  me: boolean;
  courses: Record<string, { xpWeek: number; xpTotal: number; week: number; streak: number; best: number; words: number; level: number; lessons: number; achievements: number; updated: number }>;
}

export async function pushStats(course: string, s: { xpWeek: number; xpTotal: number; streak: number; best: number; words: number; level: number; lessons: number; achievements: number }) {
  if (!session()) return;
  try {
    await api(`/stats/${course}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...s, week: weekStart() }) });
  } catch {
    /* offline: next time */
  }
}

export async function leaderboard(): Promise<Board[] | null> {
  if (!session()) return null;
  try {
    const r = await api('/leaderboard');
    return r.ok ? r.json() : null;
  } catch {
    return null;
  }
}

/** XP this week for a board entry (a stale week counts as 0). */
export function weekXp(b: Board) {
  const ws = weekStart();
  return Object.values(b.courses).reduce((s, x) => s + (x.week === ws ? x.xpWeek : 0), 0);
}
