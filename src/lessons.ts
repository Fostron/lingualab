import type { LessonRec, UnitRec } from './db';
import type { Level, LoadedCourse, Topic, Unit } from './types';

/**
 * Every unit is split into small lessons that open one after another:
 *   words  — 5–8 new words (introduce, recognise, recall, use in sentences)
 *   rule   — the grammar explanation step by step, with a check after each part
 *   drill  — practice of that grammar point
 *   review — the unit's words and grammar together in sentences (listening, reading, writing)
 *   test   — unit test, 80 % to complete the unit (can also be taken early to test out)
 *   exam   — at the end of each level: a test across the whole level
 */
export type LessonKind = 'words' | 'rule' | 'drill' | 'review' | 'test' | 'exam';

export interface Lesson {
  slug: string; // unique inside the unit
  unit: Unit;
  idx: number; // position inside the unit
  kind: LessonKind;
  words: number[]; // new words (words lessons)
  topic?: Topic;
}

export const PASS: Record<LessonKind, number> = { words: 0.7, rule: 0.6, drill: 0.7, review: 0.7, test: 0.8, exam: 0.8 };

const CHUNK: Record<Level, number> = { A1: 5, A2: 6, B1: 7, B2: 8, C1: 8 };

/** Split into chunks of at most `size`, as even as possible (22 by 5 → 5,5,4,4,4). */
function split<T>(xs: T[], size: number): T[][] {
  if (!xs.length) return [];
  const n = Math.ceil(xs.length / size);
  const base = Math.floor(xs.length / n);
  const extra = xs.length % n;
  const out: T[][] = [];
  let i = 0;
  for (let k = 0; k < n; k++) {
    const len = base + (k < extra ? 1 : 0);
    out.push(xs.slice(i, i + len));
    i += len;
  }
  return out;
}

const cache = new WeakMap<Unit, Lesson[]>();

export function lessonsOf(c: LoadedCourse, unit: Unit): Lesson[] {
  const hit = cache.get(unit);
  if (hit) return hit;
  const words = split(unit.words, CHUNK[unit.level]).map((ws, i) => ({ slug: `w${i + 1}`, kind: 'words' as const, words: ws }));
  const grammar: { slug: string; kind: LessonKind; topic: Topic }[] = [];
  for (const tid of unit.topics) {
    const topic = c.topicById.get(tid);
    if (!topic) continue;
    grammar.push({ slug: `r:${tid}`, kind: 'rule', topic });
    if (topic.drills.length + topic.auto.length >= 4) grammar.push({ slug: `d:${tid}`, kind: 'drill', topic });
  }
  const seq: { slug: string; kind: LessonKind; words?: number[]; topic?: Topic }[] = [];
  // the very first unit starts with how the language sounds
  if (unit.n === 1 && grammar.length) seq.push(grammar.shift()!);
  while (words.length || grammar.length) {
    if (words.length) seq.push(words.shift()!);
    if (grammar.length) seq.push(grammar.shift()!);
  }
  if (unit.sents.length >= 4) seq.push({ slug: 'rv', kind: 'review' });
  seq.push({ slug: 't', kind: 'test' });
  const i = c.units.indexOf(unit);
  const next = c.units[i + 1];
  if (!next || next.level !== unit.level) seq.push({ slug: 'x', kind: 'exam' });
  const out = seq.map((x, idx) => ({ slug: x.slug, unit, idx, kind: x.kind, words: x.words || [], topic: x.topic }));
  cache.set(unit, out);
  return out;
}

export function lessonBySlug(c: LoadedCourse, unit: Unit, slug: string) {
  return lessonsOf(c, unit).find((l) => l.slug === slug);
}

/** Passed lessons, including progress made before lessons existed (learned words, read rules, unit tests). */
export function lessonPassed(l: Lesson, rec: UnitRec | undefined): boolean {
  if (!rec) return false;
  if (rec.status === 'known') return true;
  const r: LessonRec | undefined = rec.lessons?.[l.slug];
  if (r?.passed) return true;
  if (rec.lessons) return false;
  // legacy records
  if (rec.status === 'done') return true;
  if (l.kind === 'words') return l.words.every((w) => rec.learned.includes(w));
  if (l.kind === 'rule') return !!l.topic && rec.topicsRead.includes(l.topic.id);
  return false;
}

export function unitComplete(c: LoadedCourse, unit: Unit, rec: UnitRec | undefined) {
  if (!rec) return false;
  if (rec.status === 'known' || rec.status === 'done') return true;
  return lessonsOf(c, unit).every((l) => lessonPassed(l, rec));
}

export function unitUnlocked(c: LoadedCourse, idx: number, units: Map<string, UnitRec>) {
  if (idx === 0) return true;
  const rec = units.get(c.units[idx].id);
  if (rec && rec.status !== 'new') return true;
  const prev = c.units[idx - 1];
  return unitComplete(c, prev, units.get(prev.id));
}

/** A lesson opens when the previous one in the unit is passed. The unit test can always be taken to test out. */
export function lessonUnlocked(c: LoadedCourse, l: Lesson, unitOpen: boolean, rec: UnitRec | undefined) {
  if (!unitOpen) return false;
  if (l.idx === 0 || l.kind === 'test') return true;
  if (rec && (rec.status === 'done' || rec.status === 'known')) return true;
  const prev = lessonsOf(c, l.unit)[l.idx - 1];
  return lessonPassed(prev, rec);
}

/** Next lesson to do: first unpassed lesson of the first unlocked, unfinished unit. */
export function nextLesson(c: LoadedCourse, units: Map<string, UnitRec>): Lesson | null {
  for (let i = 0; i < c.units.length; i++) {
    const u = c.units[i];
    const rec = units.get(u.id);
    if (unitComplete(c, u, rec)) continue;
    if (!unitUnlocked(c, i, units)) return null;
    return lessonsOf(c, u).find((l) => !lessonPassed(l, rec)) || null;
  }
  return null;
}

export function lessonCount(c: LoadedCourse) {
  return c.units.reduce((n, u) => n + lessonsOf(c, u).length, 0);
}
