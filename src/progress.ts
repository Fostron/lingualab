import {
  addActivity,
  addLog,
  allCards,
  getCard,
  getProgress,
  getUnit,
  getUnits,
  logsFor,
  putCards,
  saveProgress,
  saveUnit,
  today,
  type CardRec,
  type CourseProgress,
  type Difficulty,
  type LogRec,
  type UnitRec,
} from './db';
import type { Diff } from './exercises';
import { scheduleSync } from './sync';
import { lessonPassed, lessonsOf, nextLesson, PASS, unitComplete, type Lesson } from './lessons';
import { knownCardRec, retrievability, review, Rating } from './srs';
import type { LoadedCourse, Unit } from './types';

export interface ProgressInfo {
  units: Map<string, UnitRec>;
  learned: Set<number>; // words introduced in lessons
  known: Set<number>; // learned + words of units marked known
  tenses: string[];
  current: Unit;
  currentIndex: number;
  next: Lesson | null;
  cards: CardRec[];
  due: CardRec[];
  newToday: number;
  prog: CourseProgress;
}

export async function loadProgress(c: LoadedCourse): Promise<ProgressInfo> {
  const [units, cards, prog] = await Promise.all([getUnits(c.meta.id), allCards(c.meta.id), getProgress(c.meta.id)]);
  const learned = new Set<number>();
  const known = new Set<number>();
  const tenses = new Set<string>();
  c.units.forEach((u) => {
    const r = units.get(u.id);
    if (!r) return;
    for (const w of r.learned) {
      learned.add(w);
      known.add(w);
    }
    if (r.status === 'known' || r.status === 'done') for (const w of u.words) known.add(w);
    for (const tid of u.topics) {
      const tp = c.topicById.get(tid);
      if (tp && (r.status === 'known' || r.status === 'done' || r.topicsRead.includes(tid))) for (const ts of tp.tenses || []) tenses.add(ts);
    }
  });
  const next = nextLesson(c, units);
  let currentIndex = next ? c.units.indexOf(next.unit) : c.units.findIndex((u) => !unitComplete(c, u, units.get(u.id)));
  if (currentIndex < 0) currentIndex = c.units.length - 1;
  const now = Date.now();
  const due = cards.filter((x) => x.due <= now).sort((a, b) => a.due - b.due);
  const newToday = prog.newToday && prog.newToday.day === today() ? prog.newToday.n : 0;
  return { units, learned, known, tenses: [...tenses], current: c.units[currentIndex], currentIndex, next, cards, due, newToday, prog };
}

export function wordsLeft(c: LoadedCourse, unit: Unit, info: ProgressInfo) {
  return unit.words.filter((id) => !info.learned.has(id)).map((id) => c.wordById.get(id)!).filter(Boolean);
}

export async function addNewToday(course: string, n: number) {
  const p = await getProgress(course);
  const d = today();
  if (!p.newToday || p.newToday.day !== d) p.newToday = { day: d, n: 0 };
  p.newToday.n += n;
  if (!p.days.includes(d)) p.days.push(d);
  await saveProgress(p);
}

/** First-attempt result of a graded exercise inside a lesson. score: 1 right, 0.5 with a hint, 0 wrong. */
export interface Answer {
  cid?: string;
  ex: string; // exercise label for statistics, e.g. "type-listen"
  score: number;
}

/** Make the unit record carry explicit lesson results (older progress only had learned words / read rules). */
function withLessons(c: LoadedCourse, unit: Unit, u: UnitRec) {
  if (!u.lessons) {
    const legacy = { ...u };
    u.lessons = {};
    for (const l of lessonsOf(c, unit)) if (lessonPassed(l, legacy)) u.lessons[l.slug] = { best: 1, passed: true, tries: 0, ts: 0 };
  }
  return u.lessons;
}

/** Save a finished lesson: grade the cards, open the next lesson if passed, complete the unit when everything is passed. */
export async function finishLessonRun(c: LoadedCourse, lesson: Lesson, answers: Answer[], seconds: number) {
  const id = c.meta.id;
  const graded = answers.length;
  const score = graded ? answers.reduce((s, a) => s + a.score, 0) / graded : 1;
  const passed = score >= PASS[lesson.kind];
  // spaced repetition: one grade per card (its first attempt in this lesson)
  const seen = new Set<string>();
  for (const a of answers) {
    if (a.cid && !seen.has(a.cid)) {
      seen.add(a.cid);
      await review(id, a.cid, a.score >= 1 ? Rating.Good : a.score > 0 ? Rating.Hard : Rating.Again, a.score > 0, a.ex);
    } else await addLog({ course: id, cid: a.cid || `x:${a.ex}`, rating: 0, ts: Date.now(), ok: a.score >= 1, ex: a.ex });
  }
  const unit = lesson.unit;
  const u = await getUnit(id, unit.id);
  const lessons = withLessons(c, unit, u);
  const prev = lessons[lesson.slug];
  lessons[lesson.slug] = { best: Math.max(prev?.best || 0, score), passed: !!prev?.passed || passed, tries: (prev?.tries || 0) + 1, ts: Date.now() };
  if (passed) {
    if (lesson.kind === 'words') {
      const fresh = lesson.words.filter((w) => !u.learned.includes(w));
      u.learned = [...u.learned, ...fresh];
      // words that were introduced but never asked still get cards
      for (const w of lesson.words)
        for (const k of ['wr', 'wp']) if (!seen.has(`${k}:${w}`) && !(await getCard(id, `${k}:${w}`))) await review(id, `${k}:${w}`, Rating.Good, true, 'lesson');
      if (fresh.length) await addNewToday(id, fresh.length);
    }
    if ((lesson.kind === 'rule' || lesson.kind === 'drill') && lesson.topic && !u.topicsRead.includes(lesson.topic.id)) u.topicsRead.push(lesson.topic.id);
    if (lesson.kind === 'test') {
      u.test = { score, ts: Date.now() };
      // passing the test early = testing out of the unit's lessons
      for (const l of lessonsOf(c, unit)) if (l.kind !== 'exam' && !lessons[l.slug]?.passed) lessons[l.slug] = { best: score, passed: true, tries: 0, ts: Date.now() };
      const missing = unit.words.filter((w) => !u.learned.includes(w));
      const recs: CardRec[] = [];
      for (const w of missing) for (const k of ['wr', 'wp']) if (!(await getCard(id, `${k}:${w}`))) recs.push(knownCardRec(id, `${k}:${w}`));
      for (const tid of unit.topics) if (!(await getCard(id, `g:${tid}`))) recs.push(knownCardRec(id, `g:${tid}`));
      await putCards(recs);
      u.learned = [...unit.words];
      for (const tid of unit.topics) if (!u.topicsRead.includes(tid)) u.topicsRead.push(tid);
    }
  } else if (lesson.kind === 'test') u.test = { score: Math.max(score, u.test?.score || 0), ts: Date.now() };
  const unitDone = lessonsOf(c, unit).every((l) => lessons[l.slug]?.passed);
  if (unitDone) u.status = 'done';
  else if (u.status === 'new') u.status = 'learning';
  await saveUnit(u);
  await addActivity(id, seconds, passed ? 1 : 0);
  return { score, passed, unitDone };
}

export async function markTopicRead(c: LoadedCourse, unit: Unit, topicId: string) {
  const u = await getUnit(c.meta.id, unit.id);
  if (!u.topicsRead.includes(topicId)) u.topicsRead.push(topicId);
  if (u.status === 'new') u.status = 'learning';
  await saveUnit(u);
}

/** Placement: mark units before `startIndex` as known (no cards — they don't flood reviews). */
export async function applyPlacement(c: LoadedCourse, startIndex: number, level: string, vocab: number, detail: Record<string, number>) {
  for (let i = 0; i < c.units.length; i++) {
    const u = await getUnit(c.meta.id, c.units[i].id);
    if (i < startIndex) {
      if (u.status === 'new' || u.status === 'learning') u.status = 'known';
    } else if (u.status === 'known') {
      u.status = u.learned.length ? 'learning' : 'new';
    }
    await saveUnit(u);
  }
  const p = await getProgress(c.meta.id);
  p.placement = { level, vocab, ts: Date.now(), startUnit: startIndex, detail };
  await saveProgress(p);
  scheduleSync(500);
}

// ---- adaptivity and weak spots ----

/** Share of right first answers over the latest answers (null while there is too little data). */
export function recentAccuracy(logs: LogRec[], n = 60): number | null {
  const xs = logs.filter((l) => l.rating !== 0 || l.cid.startsWith('x:')).slice(-n);
  if (xs.length < 20) return null;
  return xs.filter((l) => l.ok).length / xs.length;
}

/** "auto" follows the learner: more choices while accuracy is low, more typing when it is high. */
export function resolveDiff(setting: Difficulty, logs: LogRec[]): Diff {
  if (setting !== 'auto') return setting;
  const a = recentAccuracy(logs);
  if (a === null) return 'normal';
  return a < 0.7 ? 'easy' : a > 0.92 ? 'hard' : 'normal';
}

export interface TopicStat {
  id: string;
  n: number;
  acc: number;
  last: number;
}

/** Accuracy per grammar topic over its latest 15 graded answers. */
export function topicStats(logs: LogRec[]): Map<string, TopicStat> {
  const by = new Map<string, LogRec[]>();
  for (const l of logs) {
    if (!l.cid.startsWith('g:')) continue;
    const k = l.cid.slice(2);
    if (!by.has(k)) by.set(k, []);
    by.get(k)!.push(l);
  }
  const out = new Map<string, TopicStat>();
  for (const [k, ls] of by) {
    const xs = ls.slice(-15);
    out.set(k, { id: k, n: xs.length, acc: xs.filter((l) => l.ok).length / xs.length, last: xs[xs.length - 1].ts });
  }
  return out;
}

export function weakTopics(logs: LogRec[]): TopicStat[] {
  return [...topicStats(logs).values()].filter((s) => s.n >= 4 && s.acc < 0.7).sort((a, b) => a.acc - b.acc);
}

/**
 * Words that keep slipping: forgotten after a long interval more than once, or missed
 * repeatedly in the last three weeks (two wrong answers, or the latest answer wrong).
 */
export function weakWords(cards: CardRec[], logs: LogRec[] = []): CardRec[] {
  const now = new Date();
  const since = Date.now() - 21 * 86400000;
  const misses = new Map<string, { wrong: number; lastOk: boolean }>();
  for (const l of logs) {
    if (l.ts < since || !(l.cid.startsWith('wp:') || l.cid.startsWith('wr:'))) continue;
    const m = misses.get(l.cid) || { wrong: 0, lastOk: true };
    if (!l.ok) m.wrong++;
    m.lastOk = l.ok;
    misses.set(l.cid, m);
  }
  const score = (x: CardRec) => x.lapses * 2 + (misses.get(x.cid)?.wrong || 0);
  return cards
    .filter((x) => {
      if (x.kind !== 'wp' && x.kind !== 'wr') return false;
      const m = misses.get(x.cid);
      return x.lapses >= 2 || (x.lapses >= 1 && retrievability(x, now) < 0.8) || (m && (m.wrong >= 2 || (m.wrong >= 1 && !m.lastOk)));
    })
    .sort((a, b) => score(b) - score(a) || a.stability - b.stability);
}

export async function loadLogs(c: LoadedCourse) {
  return logsFor(c.meta.id);
}

export { unitComplete };
