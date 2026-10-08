import { describe, expect, it } from 'vitest';
import { buildDrillLesson, buildReviewLesson, buildRuleLesson, buildUnitTest, buildWordsLesson, exFromKey, itemKey, type Ex } from '../src/exercises';
import { lessonsOf } from '../src/lessons';
import { course } from './course';

const o = { typingOnly: false, hasVoice: true, diff: 'normal' as const };

describe.each(['es-en', 'fr-ru'])('mistake keys in %s', (id) => {
  const c = course(id);
  const known = new Set(c.units.flatMap((u) => u.words));

  it('every question has a key that rebuilds the same question', () => {
    let n = 0;
    for (const u of c.units.filter((_, i) => i % 10 === 0)) {
      const exs: Ex[] = [];
      for (const l of lessonsOf(c, u)) {
        if (l.kind === 'words') exs.push(...buildWordsLesson(c, l.words.map((w) => c.wordById.get(w)!), [], known, o));
        else if (l.kind === 'rule') exs.push(...buildRuleLesson(c, l.topic!));
        else if (l.kind === 'drill') exs.push(...buildDrillLesson(c, l.topic!, known, o));
        else if (l.kind === 'review') exs.push(...buildReviewLesson(c, u, known, o));
        else if (l.kind === 'test') exs.push(...buildUnitTest(c, u, o));
      }
      for (const ex of exs) {
        const key = itemKey(ex);
        if (ex.k === 'intro' || ex.k === 'teach') {
          expect(key).toBeNull();
          continue;
        }
        expect(key, ex.k).toBeTruthy();
        const again = exFromKey(c, key!, o, known);
        expect(again, key!).toBeTruthy();
        expect(itemKey(again!)).toBe(key);
        n++;
      }
    }
    expect(n).toBeGreaterThan(200);
  });
});
