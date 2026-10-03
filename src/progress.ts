import { allCards, getProgress, getUnit, getUnits, putCards, saveProgress, saveUnit, today, type CardRec, type UnitRec } from './db';
import { knownCardRec, review, Rating } from './srs';
import type { LoadedCourse, Unit } from './types';

export interface ProgressInfo {
  units: Map<string, UnitRec>;
  learned: Set<number>; // words introduced in lessons
  known: Set<number>; // learned + words of units marked known
  tenses: string[];
  current: Unit;
  currentIndex: number;
  cards: CardRec[];
  due: CardRec[];
  newToday: number;
}

export async function loadProgress(c: LoadedCourse): Promise<ProgressInfo> {
  const [units, cards, prog] = await Promise.all([getUnits(c.meta.id), allCards(c.meta.id), getProgress(c.meta.id)]);
  const learned = new Set<number>();
  const known = new Set<number>();
  const tenses = new Set<string>();
  let currentIndex = -1;
  c.units.forEach((u, i) => {
    const r = units.get(u.id);
    if (r) {
      for (const w of r.learned) {
        learned.add(w);
        known.add(w);
      }
      if (r.status === 'known' || r.status === 'done') for (const w of u.words) known.add(w);
      if (r.status !== 'new') for (const tid of u.topics) for (const ts of c.topicById.get(tid)?.tenses || []) tenses.add(ts);
    }
    if (currentIndex < 0 && (!r || (r.status !== 'done' && r.status !== 'known'))) currentIndex = i;
  });
  if (currentIndex < 0) currentIndex = c.units.length - 1;
  const now = Date.now();
  const due = cards.filter((x) => x.due <= now).sort((a, b) => a.due - b.due);
  const newToday = prog.newToday && prog.newToday.day === today() ? prog.newToday.n : 0;
  return { units, learned, known, tenses: [...tenses], current: c.units[currentIndex], currentIndex, cards, due, newToday };
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

/** Persist lesson results: first-attempt correctness per card id, plus words introduced. */
export async function finishLesson(c: LoadedCourse, unit: Unit, introduced: number[], results: Map<string, boolean>) {
  const id = c.meta.id;
  for (const [cid, ok] of results) await review(id, cid, ok ? Rating.Good : Rating.Again, ok, 'lesson');
  // words introduced but never exercised still get cards
  for (const w of introduced) {
    for (const k of ['wr', 'wp']) {
      const cid = `${k}:${w}`;
      if (!results.has(cid)) await review(id, cid, Rating.Good, true, 'lesson');
    }
  }
  const u = await getUnit(id, unit.id);
  u.learned = [...new Set([...u.learned, ...introduced])];
  if (u.status === 'new') u.status = 'learning';
  await saveUnit(u);
  if (introduced.length) await addNewToday(id, introduced.length);
}

export async function markTopicRead(c: LoadedCourse, unit: Unit, topicId: string) {
  const u = await getUnit(c.meta.id, unit.id);
  if (!u.topicsRead.includes(topicId)) u.topicsRead.push(topicId);
  if (u.status === 'new') u.status = 'learning';
  await saveUnit(u);
}

export async function finishUnitTest(c: LoadedCourse, unit: Unit, score: number) {
  const u = await getUnit(c.meta.id, unit.id);
  u.test = { score, ts: Date.now() };
  if (score >= 0.8) {
    // passing a test without having learned the words = testing out
    const wasNew = u.learned.length < unit.words.length;
    u.status = 'done';
    if (wasNew) {
      const missing = unit.words.filter((w) => !u.learned.includes(w));
      const recs: CardRec[] = [];
      for (const w of missing) {
        recs.push(knownCardRec(c.meta.id, `wr:${w}`));
        recs.push(knownCardRec(c.meta.id, `wp:${w}`));
      }
      for (const tid of unit.topics) recs.push(knownCardRec(c.meta.id, `g:${tid}`));
      await putCards(recs);
      u.learned = [...unit.words];
    }
  }
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
}
