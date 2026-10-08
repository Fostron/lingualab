import { describe, expect, it } from 'vitest';
import type { UnitRec } from '../src/db';
import { lessonPassed, lessonsOf, lessonUnlocked, nextLesson, unitUnlocked } from '../src/lessons';
import { course } from './course';

describe.each(['es-en', 'fr-en', 'fr-ru'])('lessons of %s', (id) => {
  const c = course(id);

  it('every unit ends with its test, and the last unit of each level with the level exam', () => {
    c.units.forEach((u, i) => {
      const kinds = lessonsOf(c, u).map((l) => l.kind);
      const lastOfLevel = !c.units[i + 1] || c.units[i + 1].level !== u.level;
      expect(kinds.at(-1)).toBe(lastOfLevel ? 'exam' : 'test');
      expect(kinds.filter((k) => k === 'words').length).toBeGreaterThan(0);
    });
  });

  it('starts with the first lesson of the first unit, and only it is open', () => {
    const units = new Map<string, UnitRec>();
    const first = nextLesson(c, units)!;
    expect(first.unit).toBe(c.units[0]);
    expect(first.idx).toBe(0);
    const ls = lessonsOf(c, c.units[0]);
    expect(lessonUnlocked(c, ls[0], true, undefined)).toBe(true);
    expect(lessonUnlocked(c, ls[1], true, undefined)).toBe(false);
    // the unit test can always be taken to test out
    expect(lessonUnlocked(c, ls.find((l) => l.kind === 'test')!, true, undefined)).toBe(true);
    expect(unitUnlocked(c, 1, units)).toBe(false);
  });

  it('passing lessons in order opens the next one, then the next unit', () => {
    const u = c.units[0];
    const ls = lessonsOf(c, u);
    const rec: UnitRec = { key: `${id}|${u.id}`, course: id, unit: u.id, status: 'learning', learned: [], topicsRead: [], lessons: {}, updated: 1 };
    const units = new Map([[u.id, rec]]);
    for (let i = 0; i < ls.length; i++) {
      expect(nextLesson(c, units)).toBe(ls[i]);
      expect(lessonUnlocked(c, ls[i], true, rec)).toBe(true);
      if (i + 1 < ls.length && ls[i + 1].kind !== 'test') expect(lessonUnlocked(c, ls[i + 1], true, rec)).toBe(false);
      rec.lessons![ls[i].slug] = { best: 0.9, passed: true, tries: 1, ts: i };
    }
    expect(ls.every((l) => lessonPassed(l, rec))).toBe(true);
    expect(unitUnlocked(c, 1, units)).toBe(true);
    expect(nextLesson(c, units)).toBe(lessonsOf(c, c.units[1])[0]);
  });

  it('a failed lesson does not open the next one', () => {
    const u = c.units[0];
    const ls = lessonsOf(c, u);
    const rec: UnitRec = { key: `${id}|${u.id}`, course: id, unit: u.id, status: 'learning', learned: [], topicsRead: [], lessons: { [ls[0].slug]: { best: 0.3, passed: false, tries: 2, ts: 1 } }, updated: 1 };
    expect(lessonUnlocked(c, ls[1], true, rec)).toBe(false);
    expect(nextLesson(c, new Map([[u.id, rec]]))).toBe(ls[0]);
  });

  it('a unit marked known (placement) is complete and opens the next', () => {
    const u = c.units[0];
    const rec: UnitRec = { key: `${id}|${u.id}`, course: id, unit: u.id, status: 'known', learned: [], topicsRead: [], updated: 1 };
    expect(unitUnlocked(c, 1, new Map([[u.id, rec]]))).toBe(true);
  });
});
