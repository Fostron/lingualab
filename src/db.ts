import { openDB, type DBSchema, type IDBPDatabase } from 'idb';

/** Card kinds: wr = word recognition, wp = word production, g = grammar topic, c = verb conjugation. */
export type CardKind = 'wr' | 'wp' | 'g' | 'c';

export interface CardRec {
  key: string; // `${course}|${cid}`
  course: string;
  cid: string; // e.g. "wr:123", "g:es-ser-estar", "c:tener"
  kind: CardKind;
  ref: string;
  due: number;
  stability: number;
  difficulty: number;
  elapsed_days: number;
  scheduled_days: number;
  learning_steps: number;
  reps: number;
  lapses: number;
  state: number;
  last_review?: number;
  added: number;
}

export interface LogRec {
  id?: number;
  course: string;
  cid: string;
  rating: number;
  ts: number;
  ok: boolean;
  ex: string; // exercise type
}

export type UnitStatus = 'new' | 'learning' | 'done' | 'known';

export interface UnitRec {
  key: string; // `${course}|${unitId}`
  course: string;
  unit: string;
  status: UnitStatus;
  learned: number[]; // word ids introduced
  topicsRead: string[];
  test?: { score: number; ts: number };
  updated: number;
}

export interface CourseProgress {
  course: string;
  started: number;
  placement?: { level: string; vocab: number; ts: number; startUnit: number; detail: Record<string, number> };
  days: string[]; // YYYY-MM-DD days with activity
  newToday?: { day: string; n: number };
}

export interface Settings {
  newPerDay: number;
  wordsPerLesson: number;
  autoplay: boolean;
  rate: number;
  voice: Record<string, string>; // tts lang -> voice name
  typingOnly: boolean; // prefer typed answers over multiple choice
  strictAccents: boolean;
  retention: number;
  theme: 'auto' | 'light' | 'dark';
}

export const DEFAULT_SETTINGS: Settings = {
  newPerDay: 15,
  wordsPerLesson: 7,
  autoplay: true,
  rate: 0.9,
  voice: {},
  typingOnly: false,
  strictAccents: false,
  retention: 0.9,
  theme: 'auto',
};

interface Schema extends DBSchema {
  cards: { key: string; value: CardRec; indexes: { course: string; course_due: [string, number] } };
  logs: { key: number; value: LogRec; indexes: { course: string; ts: number } };
  units: { key: string; value: UnitRec; indexes: { course: string } };
  kv: { key: string; value: unknown };
}

let dbp: Promise<IDBPDatabase<Schema>> | null = null;

export function db() {
  if (!dbp) {
    dbp = openDB<Schema>('lingualab', 1, {
      upgrade(d) {
        const cards = d.createObjectStore('cards', { keyPath: 'key' });
        cards.createIndex('course', 'course');
        cards.createIndex('course_due', ['course', 'due']);
        const logs = d.createObjectStore('logs', { keyPath: 'id', autoIncrement: true });
        logs.createIndex('course', 'course');
        logs.createIndex('ts', 'ts');
        const units = d.createObjectStore('units', { keyPath: 'key' });
        units.createIndex('course', 'course');
        d.createObjectStore('kv');
      },
    });
  }
  return dbp;
}

export async function getSettings(): Promise<Settings> {
  const s = (await (await db()).get('kv', 'settings')) as Partial<Settings> | undefined;
  return { ...DEFAULT_SETTINGS, ...(s || {}) };
}

export async function saveSettings(s: Settings) {
  await (await db()).put('kv', s, 'settings');
}

export async function getProgress(course: string): Promise<CourseProgress> {
  const p = (await (await db()).get('kv', `progress|${course}`)) as CourseProgress | undefined;
  return p || { course, started: Date.now(), days: [] };
}

export async function saveProgress(p: CourseProgress) {
  await (await db()).put('kv', p, `progress|${p.course}`);
}

export async function getUnits(course: string): Promise<Map<string, UnitRec>> {
  const list = await (await db()).getAllFromIndex('units', 'course', course);
  return new Map(list.map((u) => [u.unit, u]));
}

export async function getUnit(course: string, unit: string): Promise<UnitRec> {
  const u = await (await db()).get('units', `${course}|${unit}`);
  return u || { key: `${course}|${unit}`, course, unit, status: 'new', learned: [], topicsRead: [], updated: Date.now() };
}

export async function saveUnit(u: UnitRec) {
  u.updated = Date.now();
  await (await db()).put('units', u);
}

export async function allCards(course: string): Promise<CardRec[]> {
  return (await db()).getAllFromIndex('cards', 'course', course);
}

export async function dueCards(course: string, now = Date.now()): Promise<CardRec[]> {
  return (await db()).getAllFromIndex('cards', 'course_due', IDBKeyRange.bound([course, 0], [course, now]));
}

export async function getCard(course: string, cid: string) {
  return (await db()).get('cards', `${course}|${cid}`);
}

export async function putCards(cards: CardRec[]) {
  const tx = (await db()).transaction('cards', 'readwrite');
  await Promise.all([...cards.map((c) => tx.store.put(c)), tx.done]);
}

export async function addLog(l: LogRec) {
  await (await db()).add('logs', l);
}

export async function logsFor(course: string): Promise<LogRec[]> {
  return (await db()).getAllFromIndex('logs', 'course', course);
}

export function today(d = new Date()) {
  const z = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
}

export async function markActive(course: string) {
  const p = await getProgress(course);
  const t = today();
  if (!p.days.includes(t)) {
    p.days.push(t);
    await saveProgress(p);
  }
}

/** Full export of everything stored locally (for backup / moving between devices). */
export async function exportAll() {
  const d = await db();
  const kvKeys = await d.getAllKeys('kv');
  const kv: Record<string, unknown> = {};
  for (const k of kvKeys) kv[String(k)] = await d.get('kv', k);
  return {
    app: 'lingualab',
    version: 1,
    exported: new Date().toISOString(),
    cards: await d.getAll('cards'),
    logs: await d.getAll('logs'),
    units: await d.getAll('units'),
    kv,
  };
}

export async function importAll(data: any) {
  if (!data || data.app !== 'lingualab') throw new Error('Not a LinguaLab backup');
  const d = await db();
  const tx = d.transaction(['cards', 'logs', 'units', 'kv'], 'readwrite');
  await tx.objectStore('cards').clear();
  await tx.objectStore('logs').clear();
  await tx.objectStore('units').clear();
  await tx.objectStore('kv').clear();
  for (const c of data.cards || []) await tx.objectStore('cards').put(c);
  for (const l of data.logs || []) await tx.objectStore('logs').put(l);
  for (const u of data.units || []) await tx.objectStore('units').put(u);
  for (const [k, v] of Object.entries(data.kv || {})) await tx.objectStore('kv').put(v, k);
  await tx.done;
}

export async function resetCourse(course: string) {
  const d = await db();
  const tx = d.transaction(['cards', 'logs', 'units', 'kv'], 'readwrite');
  for (const store of ['cards', 'logs', 'units'] as const) {
    const idx = tx.objectStore(store).index('course');
    let cur = await idx.openCursor(course);
    while (cur) {
      await cur.delete();
      cur = await cur.continue();
    }
  }
  await tx.objectStore('kv').delete(`progress|${course}`);
  await tx.done;
}
