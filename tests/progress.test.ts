import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CardRec, LogRec } from '../src/db';
import { profileLevel, streakInfo } from '../src/gamify';
import { weakWords } from '../src/progress';

const DAY = 86400000;
const NOW = new Date('2026-10-08T12:00:00').getTime(); // a Thursday

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

function card(cid: string, lapses: number, lastDaysAgo = 1, stability = 30): CardRec {
  const last = NOW - lastDaysAgo * DAY;
  return { key: `es-en|${cid}`, course: 'es-en', cid, kind: cid.slice(0, 2) as CardRec['kind'], ref: cid.slice(3), due: last + stability * DAY, stability, difficulty: 5, elapsed_days: 0, scheduled_days: stability, learning_steps: 0, reps: 5, lapses, state: 2, last_review: last, added: last - 30 * DAY };
}
const answers = (cid: string, oks: boolean[]): LogRec[] => oks.map((ok, i) => ({ course: 'es-en', cid, rating: ok ? 3 : 1, ts: NOW - (oks.length - i) * 3600000, ok, ex: 'type' }));
const weak = (cards: CardRec[], logs: LogRec[]) => weakWords(cards, logs).map((c) => c.cid);

describe('weak words', () => {
  it('a word answered wrong last time is weak', () => {
    expect(weak([card('wp:7', 0)], answers('wp:7', [true, false]))).toEqual(['wp:7']);
  });

  it('two right answers in a row take it off the list, however often it was missed before', () => {
    const c = card('wp:7', 6);
    expect(weak([c], answers('wp:7', [false, false, false, true]))).toEqual(['wp:7']); // 2 of the last 3 wrong
    expect(weak([c], answers('wp:7', [false, false, false, true, true]))).toEqual([]);
  });

  it('a lapsed word not seen lately counts only while it is likely forgotten', () => {
    expect(weak([card('wp:7', 2, 60, 5)], [])).toEqual(['wp:7']); // low recall probability
    expect(weak([card('wp:7', 2, 1, 60)], [])).toEqual([]); // reviewed yesterday, stable
  });

  it('one entry per word, the writing card preferred', () => {
    const logs = [...answers('wr:7', [false]), ...answers('wp:7', [false])];
    expect(weak([card('wr:7', 1), card('wp:7', 1)], logs)).toEqual(['wp:7']);
  });

  it('grammar and verb cards are not words', () => {
    expect(weak([card('g:es-ser', 3, 60, 1)], answers('g:es-ser', [false]))).toEqual([]);
  });
});

describe('profile level', () => {
  it('needs 100 XP first, then 25% more for each level', () => {
    expect(profileLevel(0)).toEqual({ level: 1, into: 0, need: 100 });
    expect(profileLevel(99).level).toBe(1);
    expect(profileLevel(100)).toEqual({ level: 2, into: 0, need: 125 });
    expect(profileLevel(225)).toEqual({ level: 3, into: 0, need: 156 });
  });
});

describe('streak', () => {
  const day = (ago: number) => {
    const d = new Date(NOW - ago * DAY);
    const z = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
  };

  it('counts days in a row; today not studied yet does not break it', () => {
    expect(streakInfo([day(0), day(1), day(2)]).current).toBe(3);
    expect(streakInfo([day(1), day(2)]).current).toBe(2);
    expect(streakInfo([day(3)]).current).toBe(0);
  });

  it('one missed day a week is covered by the freeze, a second one is not', () => {
    // Thu 8, Tue 6 studied, Wed 7 missed (same week): frozen
    const s = streakInfo([day(0), day(2), day(3)]);
    expect(s.current).toBe(3);
    expect(s.frozen).toEqual([day(1)]);
    expect(s.freezeLeft).toBe(false);
    // a second gap in the same week breaks it
    expect(streakInfo([day(0), day(2), day(4)]).current).toBe(2);
  });

  it('remembers the best run', () => {
    expect(streakInfo([day(0), day(10), day(11), day(12), day(13)]).best).toBe(4);
  });
});
