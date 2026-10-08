/**
 * Mistakes notebook: every question answered wrong, with the answer given and the right one.
 * A mistake counts as fixed after two right answers in a row to the same question (anywhere in
 * the app). Kept per course in kv `mistakes|<course>` and synced like essays (later edit wins).
 */
import { displayWord, sentText } from './content';
import { db } from './db';
import { itemKey, type Ex } from './exercises';
import { fmt, t } from './i18n';
import { scheduleSync } from './sync';
import type { LoadedCourse } from './types';

export interface Mistake {
  id: string; // itemKey of the question
  q: string; // what was asked, as shown
  right: string;
  given: string; // the latest wrong answer
  kind: 'word' | 'grammar' | 'verb' | 'sentence';
  topic?: string;
  void?: boolean; // the learner overrode the verdict: not a mistake after all
  n: number; // times answered wrong
  streak: number; // right answers in a row since the latest mistake
  first: number;
  last: number; // latest mistake
  updated: number;
}

const FIXED_AFTER = 2;
const KEEP = 400;
const KEY = (course: string) => `mistakes|${course}`;

export const isFixed = (m: Mistake) => m.streak >= FIXED_AFTER;
export const shown = (m: Mistake) => !m.void;

export async function getMistakes(course: string): Promise<Mistake[]> {
  return (((await (await db()).get('kv', KEY(course))) as Mistake[] | undefined) || []).sort((a, b) => b.last - a.last);
}

/** What the question was and what was expected, in the words the learner saw. */
export function mistakeText(c: LoadedCourse, ex: Ex): Pick<Mistake, 'q' | 'right' | 'kind' | 'topic'> | null {
  const tg = c.meta.target;
  switch (ex.k) {
    case 'mcq':
      return ex.mode === 'n2t'
        ? { q: ex.word.tr, right: displayWord(ex.word, tg), kind: 'word' }
        : { q: displayWord(ex.word, tg), right: ex.word.tr, kind: 'word' };
    case 'type':
      return { q: ex.mode === 'listen' ? `🔊 ${t().mkHeard}` : ex.word.tr, right: ex.answers[0], kind: 'word' };
    case 'cloze': {
      const gap = ex.sent.tk.map(([w, , sp], i) => (i === ex.i ? '___' : i > ex.i && i < ex.i + ex.n ? '' : w) + (sp ? ' ' : '')).join('').replace(/\s+/g, ' ').trim();
      return { q: gap, right: ex.answers[0], kind: ex.word ? 'word' : 'grammar', topic: ex.topic?.id };
    }
    case 'drill':
      return { q: [ex.drill.h, ex.drill.q.trim() === '___' ? '' : ex.drill.q].filter(Boolean).join(' · '), right: ex.drill.a[0], kind: 'grammar', topic: ex.topic.id };
    case 'conj':
      return { q: `${ex.verb} · ${c.meta.tenseNames[ex.tense] || ex.tense} · ${c.meta.persons[ex.person]}`, right: ex.answers[0], kind: 'verb', topic: ex.topic?.id };
    case 'translate':
    case 'build':
      return { q: ex.sent.tr, right: sentText(ex.sent), kind: 'sentence' };
    case 'read':
      return { q: sentText(ex.sent), right: ex.sent.tr, kind: 'sentence' };
    case 'dictation':
      return { q: `🔊 ${t().mkHeard}`, right: sentText(ex.sent), kind: 'sentence' };
    default:
      return null;
  }
}

// answers come one by one: keep the list in memory and write it shortly after
let pending: { course: string; list: Mistake[] } | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
let queue: Promise<unknown> = Promise.resolve();

async function load(course: string) {
  if (pending?.course === course) return pending.list;
  await flush();
  pending = { course, list: (((await (await db()).get('kv', KEY(course))) as Mistake[] | undefined) || []).slice() };
  return pending.list;
}

export async function flush() {
  clearTimeout(timer);
  if (!pending) return;
  const { course, list } = pending;
  // keep the newest; fixed ones go first when trimming
  const keep = list.length <= KEEP ? list : [...list].sort((a, b) => Number(isFixed(a)) - Number(isFixed(b)) || b.last - a.last).slice(0, KEEP);
  await (await db()).put('kv', keep, KEY(course));
  pending = null;
  scheduleSync();
}

/**
 * Record a first-attempt answer: a wrong one adds to the notebook, a right one counts towards
 * fixing it. 'override': the learner said a "wrong" answer was right — take that mistake back.
 */
export function noteAnswer(c: LoadedCourse, ex: Ex, ok: boolean | 'override', given?: string) {
  const id = itemKey(ex);
  if (!id) return;
  queue = queue.then(async () => {
    const list = await load(c.meta.id);
    const now = Date.now();
    const m = list.find((x) => x.id === id);
    if (ok === 'override') {
      if (!m) return;
      if (m.n <= 1) m.void = true;
      else m.n--;
      m.streak = Math.max(m.streak, 1);
      m.updated = now;
    } else if (ok) {
      if (!m || isFixed(m) || m.void) return;
      m.streak++;
      m.updated = now;
    } else {
      const txt = mistakeText(c, ex);
      if (!txt) return;
      if (m) Object.assign(m, txt, { given: given || '', n: m.void ? 1 : m.n + 1, void: undefined, streak: 0, last: now, updated: now });
      else list.push({ id, ...txt, given: given || '', n: 1, streak: 0, first: now, last: now, updated: now });
    }
    clearTimeout(timer);
    timer = setTimeout(() => void (queue = queue.then(flush)), 1500);
  });
}

/** Remove one mistake (the learner says it was a slip): kept as fixed so it syncs. */
export async function dismissMistake(course: string, id: string) {
  const list = await load(course);
  const m = list.find((x) => x.id === id);
  if (m) {
    m.streak = Math.max(m.streak, FIXED_AFTER);
    m.updated = Date.now();
  }
  await flush();
}

export function lastSeen(ts: number) {
  const d = Math.floor((Date.now() - ts) / 86400000);
  return d <= 0 ? t().today : d === 1 ? t().yesterday : fmt(t().daysAgo, { n: d });
}
