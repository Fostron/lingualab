import { describe, expect, it } from 'vitest';
import { dictationScore, estimate, levelOf, LEVEL_NAMES, scoreGap, type Resp } from '../src/assessment';

const r = (lvl: number, ok: boolean): Resp => ({ lvl, ok, g: 0.25, q: '', a: '', key: `${lvl}${ok}${Math.random()}` });
const level = (resps: Resp[]) => LEVEL_NAMES[levelOf(estimate(resps).theta).idx];

describe('level estimate', () => {
  it('with no answers stays at the prior and is unsure', () => {
    const e = estimate([]);
    expect(Math.abs(e.theta)).toBeLessThan(0.05);
    expect(e.se).toBeGreaterThan(1);
  });

  it('more right answers give a higher level, and more answers make it surer', () => {
    const weak = [r(0, true), r(1, false), r(2, false), r(1, false), r(0, false)];
    const strong = [r(2, true), r(3, true), r(4, true), r(3, true), r(4, false)];
    expect(estimate(strong).theta).toBeGreaterThan(estimate(weak).theta + 1);
    const many = [...strong, ...strong, ...strong];
    expect(estimate(many).se).toBeLessThan(estimate(strong).se);
  });

  it('places clear cases where expected', () => {
    const beginner = Array.from({ length: 12 }, (_, i) => r(i % 2, i % 4 === 0 && i < 4));
    const advanced = Array.from({ length: 16 }, (_, i) => r(3 + (i % 2), i !== 5)); // B2/C1 questions, one miss
    expect(['A0', 'A1']).toContain(level(beginner));
    expect(['B2', 'C1']).toContain(level(advanced));
  });

  it('levelOf maps the scale to A0…C1 with progress inside the level', () => {
    expect(levelOf(-3).idx).toBe(0);
    expect(levelOf(0)).toEqual({ idx: 2, frac: 0.5 });
    expect(LEVEL_NAMES[levelOf(3).idx]).toBe('C1');
  });
});

describe('C-test and dictation', () => {
  it('a gap accepts the missing part or the whole word', () => {
    const gap = { prefix: 'bibli', rest: 'oteca' };
    expect(scoreGap(gap, 'oteca')).toBe(true);
    expect(scoreGap(gap, 'biblioteca')).toBe(true);
    expect(scoreGap(gap, 'xyz')).toBe(false);
  });

  it('dictation scores the share of words, ignoring accents and punctuation', () => {
    expect(dictationScore('¿Dónde está el baño?', 'donde esta el bano')).toBe(1);
    expect(dictationScore('Je ne sais pas.', 'je sais pas')).toBe(0.75);
    expect(dictationScore('uno dos', '')).toBe(0);
  });
});
