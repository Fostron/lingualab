import { describe, expect, it } from 'vitest';
import type { CardRec, CourseDump, UnitRec } from '../src/db';
import { mergeDumps } from '../src/sync';

const C = 'es-en';

function card(cid: string, last: number, reps: number): CardRec {
  return { key: `${C}|${cid}`, course: C, cid, kind: cid.slice(0, 2) as CardRec['kind'], ref: cid.slice(3), due: last + 86400000, stability: reps, difficulty: 5, elapsed_days: 0, scheduled_days: 1, learning_steps: 0, reps, lapses: 0, state: 2, last_review: last, added: 1 };
}

function unit(id: string, updated: number, extra: Partial<UnitRec> = {}): UnitRec {
  return { key: `${C}|${id}`, course: C, unit: id, status: 'learning', learned: [], topicsRead: [], updated, ...extra };
}

const log = (ts: number, cid: string, ok = true) => ({ course: C, cid, rating: ok ? 3 : 1, ts, ok, ex: 'mcq' });

function dump(p: Partial<CourseDump>): CourseDump {
  return { v: 1, course: C, cards: [], logs: [], units: [], progress: null, assess: [], essays: [], ...p };
}

const phone = dump({
  cards: [card('wr:1', 1000, 2), card('wp:2', 5000, 1)],
  logs: [log(1000, 'wr:1'), log(1000, 'wr:1'), log(5000, 'wp:2', false)],
  units: [unit('u001', 5000, { learned: [1], lessons: { w1: { best: 0.8, passed: true, tries: 1, ts: 5000 } } })],
  progress: { course: C, started: 900, days: ['2026-10-01'], time: { '2026-10-01': 300 }, lessonsDone: { '2026-10-01': 2 } },
  essays: [{ id: 'e1', updated: 10 }],
});
const laptop = dump({
  cards: [card('wr:1', 3000, 3)],
  logs: [log(1000, 'wr:1'), log(3000, 'wr:1')],
  units: [unit('u001', 3000, { learned: [2], lessons: { w1: { best: 0.9, passed: false, tries: 2, ts: 3000 }, w2: { best: 1, passed: true, tries: 1, ts: 3000 } } })],
  progress: { course: C, started: 800, days: ['2026-10-02'], time: { '2026-10-01': 500 } },
  essays: [{ id: 'e1', updated: 20, deleted: true } as { id: string; updated: number }],
});

describe('mergeDumps', () => {
  const m = mergeDumps(phone, laptop);

  it('does not depend on the order and changes nothing when merged again', () => {
    expect(mergeDumps(laptop, phone)).toEqual(m);
    expect(mergeDumps(m, phone)).toEqual(m);
    expect(mergeDumps(m, laptop)).toEqual(m);
  });

  it('keeps the latest review of each card', () => {
    expect(m.cards.map((c) => [c.cid, c.reps])).toEqual([
      ['wp:2', 1],
      ['wr:1', 3],
    ]);
  });

  it('keeps every answer once, including two equal answers on one device', () => {
    expect(m.logs.map((l) => l.ts)).toEqual([1000, 1000, 3000, 5000]);
  });

  it('combines lesson results: passed anywhere, best score, most tries', () => {
    const u = m.units[0];
    expect(u.learned.sort()).toEqual([1, 2]);
    expect(u.lessons).toEqual({ w1: { best: 0.9, passed: true, tries: 2, ts: 5000 }, w2: { best: 1, passed: true, tries: 1, ts: 3000 } });
  });

  it('combines days and study time', () => {
    expect(m.progress).toMatchObject({ started: 800, days: ['2026-10-01', '2026-10-02'], time: { '2026-10-01': 500 }, lessonsDone: { '2026-10-01': 2 } });
  });

  it('the later edit of an essay wins, a deletion too', () => {
    expect(m.essays).toEqual([{ id: 'e1', updated: 20, deleted: true }]);
  });

  it('the later state of each notebook mistake wins', () => {
    const m1 = { id: 'd:es-ser:abc', updated: 10, streak: 0 };
    const m2 = { id: 'd:es-ser:abc', updated: 30, streak: 2 };
    const x = dump({ mistakes: [m1, { id: 'w:5:wp', updated: 5 }] });
    const y = dump({ mistakes: [m2] });
    expect(mergeDumps(x, y).mistakes).toEqual([m2, { id: 'w:5:wp', updated: 5 }]);
    expect(mergeDumps(y, x)).toEqual(mergeDumps(x, y));
  });

  it('a course reset on one device drops older records everywhere', () => {
    const reset = dump({ progress: { course: C, started: 4000, days: [], resetAt: 4000 } });
    const r = mergeDumps(m, reset);
    expect(r.cards.map((c) => c.cid)).toEqual(['wp:2']);
    expect(r.logs.map((l) => l.ts)).toEqual([5000]);
    expect(r.units.map((u) => u.unit)).toEqual(['u001']); // updated at 5000, after the reset
    expect(mergeDumps(reset, m)).toEqual(r);
  });
});
