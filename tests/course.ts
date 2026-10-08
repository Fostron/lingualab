/** Loads a built course from public/content the same way the app does, for tests. */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { LoadedCourse } from '../src/types';

const cache = new Map<string, LoadedCourse>();
const read = (id: string, f: string) => JSON.parse(readFileSync(fileURLToPath(new URL(`../public/content/${id}/${f}`, import.meta.url)), 'utf-8'));

export function course(id: string): LoadedCourse {
  let c = cache.get(id);
  if (!c) {
    const data = read(id, 'course.json');
    const words = read(id, 'lexicon.json');
    const sents = read(id, 'sentences.json');
    c = {
      ...data,
      words,
      wordById: new Map(words.map((w: { id: number }) => [w.id, w])),
      sents: new Map(sents.map((s: { id: number }) => [s.id, s])),
      topicById: new Map(data.topics.map((t: { id: string }) => [t.id, t])),
      unitById: new Map(data.units.map((u: { id: string }) => [u.id, u])),
      conj: read(id, 'conj.json'),
    } as LoadedCourse;
    cache.set(id, c);
  }
  return c;
}
