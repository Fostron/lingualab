/**
 * Essays: free writing on a topic (or your own), checked by LanguageTool (spelling, grammar,
 * punctuation) plus our own statistics (length, vocabulary level, words from your lessons).
 * Stored per course and synced with the rest of the progress.
 */
import { db } from './db';
import { scheduleSync } from './sync';
import { LEVELS, type Level, type LoadedCourse, type Word } from './types';

export interface LTMatch {
  o: number; // offset in the text
  l: number; // length
  msg: string;
  rep: string[];
  cat: string; // LanguageTool category id
  type: string; // issue type
  rule: string;
}

export interface EssayStats {
  words: number;
  sentences: number;
  avgSentence: number;
  unique: number;
  levels: Record<string, number>; // A1…C1, '?' = not in the course dictionary
  fromLessons: number; // tokens whose word was learned in the course
}

export interface Essay {
  id: string;
  ts: number;
  updated: number;
  course: string;
  level: Level;
  topic: { id?: string; title: string };
  text: string;
  check?: { ts: number; matches: LTMatch[] };
  stats?: EssayStats;
  deleted?: boolean; // kept as a tombstone so another device doesn't bring it back
}

/** Topics per level: [id, title en, title ru, guidance en, guidance ru]. */
export const TOPICS: Record<Level, [string, string, string, string, string][]> = {
  A1: [
    ['me', 'About me', 'О себе', 'Name, age, where you live, what you do, what you like.', 'Имя, возраст, где живёте, чем занимаетесь, что любите.'],
    ['family', 'My family', 'Моя семья', 'Who is in your family, what they are like, what they do.', 'Кто в вашей семье, какие они, чем занимаются.'],
    ['home', 'My home', 'Мой дом', 'Your flat or house: rooms, what there is, what you like.', 'Ваша квартира или дом: комнаты, что там есть, что нравится.'],
    ['food', 'Food I like', 'Еда, которую я люблю', 'What you eat and drink, what you like and don’t like.', 'Что вы едите и пьёте, что нравится и что нет.'],
    ['day', 'My day', 'Мой день', 'What you do in the morning, afternoon and evening.', 'Что вы делаете утром, днём и вечером.'],
    ['city', 'My city', 'Мой город', 'Where it is, what there is, what you like there.', 'Где он, что там есть, что вам там нравится.'],
  ],
  A2: [
    ['weekend', 'Last weekend', 'Прошлые выходные', 'Where you went, what you did, how it was (past tense).', 'Куда ходили, что делали, как прошло (прошедшее время).'],
    ['friend', 'My best friend', 'Мой лучший друг', 'How you met, what they are like, what you do together.', 'Как познакомились, какой он, что делаете вместе.'],
    ['holiday', 'A holiday I remember', 'Отпуск, который я помню', 'Where, with whom, what you saw and did.', 'Где, с кем, что видели и делали.'],
    ['plans', 'Plans for next year', 'Планы на следующий год', 'What you are going to do and why.', 'Что собираетесь делать и почему.'],
    ['shopping', 'Shopping', 'Покупки', 'Where you buy things, what you like to buy, online or in shops.', 'Где покупаете, что любите покупать, онлайн или в магазине.'],
    ['letter', 'A letter to a friend', 'Письмо другу', 'Tell a friend your news and invite them to visit.', 'Расскажите другу новости и пригласите в гости.'],
  ],
  B1: [
    ['travel', 'The best trip of my life', 'Лучшее путешествие в моей жизни', 'Describe it, what happened, why it was special.', 'Опишите его, что случилось, почему оно было особенным.'],
    ['work', 'My dream job', 'Работа моей мечты', 'What it is, why, what you would need to get it.', 'Какая, почему, что нужно, чтобы её получить.'],
    ['learning', 'Why I learn this language', 'Почему я учу этот язык', 'Reasons, difficulties, how you learn.', 'Причины, трудности, как вы учите.'],
    ['film', 'A book or film I recommend', 'Книга или фильм, которые я советую', 'What it is about, what you liked, who should see it.', 'О чём, что понравилось, кому стоит посмотреть.'],
    ['city-country', 'City or countryside?', 'Город или деревня?', 'Advantages and disadvantages; what you prefer.', 'Плюсы и минусы; что вы предпочитаете.'],
    ['habit', 'A habit I want to change', 'Привычка, которую я хочу изменить', 'What it is, why, how you will do it.', 'Какая, почему, как вы это сделаете.'],
  ],
  B2: [
    ['remote', 'Working from home: pros and cons', 'Удалённая работа: за и против', 'Give arguments for and against, then your opinion.', 'Приведите аргументы за и против, затем своё мнение.'],
    ['tech', 'Technology and our lives', 'Технологии и наша жизнь', 'How smartphones and the internet changed us.', 'Как смартфоны и интернет изменили нас.'],
    ['travel-env', 'Tourism and the environment', 'Туризм и экология', 'Is mass tourism a problem? What can be done?', 'Массовый туризм — это проблема? Что можно сделать?'],
    ['education', 'What school should teach', 'Чему должна учить школа', 'What is missing in education today and why.', 'Чего не хватает в образовании сегодня и почему.'],
    ['success', 'What success means to me', 'Что для меня успех', 'Define it, give examples, compare views.', 'Определите, приведите примеры, сравните взгляды.'],
    ['letter-formal', 'A formal complaint', 'Официальная жалоба', 'Complain about a product or service and ask for a solution.', 'Пожалуйтесь на товар или услугу и попросите решение.'],
  ],
  C1: [
    ['ai', 'Artificial intelligence: opportunity or threat?', 'Искусственный интеллект: возможность или угроза?', 'A balanced essay with a clear conclusion.', 'Взвешенное эссе с чётким выводом.'],
    ['languages', 'Will we still learn languages in 20 years?', 'Будем ли мы учить языки через 20 лет?', 'Argue with examples and counter-arguments.', 'Аргументы, примеры и контраргументы.'],
    ['cities', 'The city of the future', 'Город будущего', 'Describe and justify your vision.', 'Опишите и обоснуйте своё видение.'],
    ['media', 'Social media and democracy', 'Соцсети и демократия', 'Effects on public debate; what should be regulated.', 'Влияние на общественные дискуссии; что стоит регулировать.'],
    ['culture', 'Is culture becoming the same everywhere?', 'Становится ли культура везде одинаковой?', 'Globalisation and local identity.', 'Глобализация и местная идентичность.'],
    ['own', 'A review of something you love', 'Рецензия на то, что вы любите', 'A book, album, place or idea — analyse, don’t just describe.', 'Книга, альбом, место или идея — анализируйте, а не только описывайте.'],
  ],
};

/** Recommended length (words) per level. */
export const LENGTH: Record<Level, [number, number]> = { A1: [40, 70], A2: [70, 120], B1: [120, 180], B2: [180, 260], C1: [250, 350] };

// ---------- checking ----------

const LT_LANG: Record<string, string> = { es: 'es', fr: 'fr', en: 'en-US' };

/** Spelling, grammar and punctuation check by LanguageTool (public API, called from the browser). */
export async function languageTool(text: string, target: string, mother: string): Promise<LTMatch[]> {
  const body = new URLSearchParams({ text, language: LT_LANG[target] || target, motherTongue: mother });
  const r = await fetch('https://api.languagetool.org/v2/check', { method: 'POST', body });
  if (r.status === 429) throw new Error('rate');
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const j = await r.json();
  return (j.matches || []).map((m: any) => ({
    o: m.offset,
    l: m.length,
    msg: m.message,
    rep: (m.replacements || []).slice(0, 4).map((x: any) => x.value),
    cat: m.rule?.category?.id || 'MISC',
    type: m.rule?.issueType || '',
    rule: m.rule?.id || '',
  }));
}

/** The text with the first suggestion applied to every error. */
export function corrected(text: string, matches: LTMatch[]) {
  let out = text;
  for (const m of [...matches].sort((a, b) => b.o - a.o)) if (m.rep[0] !== undefined) out = out.slice(0, m.o) + m.rep[0] + out.slice(m.o + m.l);
  return out;
}

// ---------- statistics ----------

const formIndex = new WeakMap<object, Map<string, Word>>();

/** Word form → dictionary word (lemmas, plurals, feminines, verb forms). */
function lookup(c: LoadedCourse): Map<string, Word> {
  let idx = formIndex.get(c.words);
  if (idx) return idx;
  idx = new Map();
  const add = (k: string | undefined, w: Word) => {
    if (!k) return;
    const key = k.toLowerCase();
    const o = idx!.get(key);
    if (!o || w.r < o.r) idx!.set(key, w);
  };
  const byLemma = new Map<string, Word>();
  for (const w of c.words) {
    add(w.w, w);
    add(w.pl, w);
    add(w.fem, w);
    if (w.pos === 'verb') byLemma.set(w.w, w);
  }
  for (const [verb, table] of Object.entries(c.conj)) {
    const w = byLemma.get(verb);
    if (!w) continue;
    for (const forms of Object.values(table)) for (const f of forms) for (const alt of (f || '').split('/')) if (alt && !alt.includes(' ')) add(alt, w);
  }
  formIndex.set(c.words, idx);
  return idx;
}

function levelOfWord(c: LoadedCourse, w: Word): string {
  if (w.u !== undefined && c.units[w.u]) return c.units[w.u].level;
  return w.r <= 1000 ? 'A2' : w.r <= 2500 ? 'B1' : w.r <= 5000 ? 'B2' : 'C1';
}

export function essayStats(c: LoadedCourse, text: string, learned: Set<number>): EssayStats {
  const tokens = text.match(/[\p{L}'’-]+/gu) || [];
  const sentences = text.split(/[.!?…]+/).filter((s) => /\p{L}/u.test(s)).length;
  const idx = lookup(c);
  const levels: Record<string, number> = Object.fromEntries([...LEVELS, '?'].map((L) => [L, 0]));
  let fromLessons = 0;
  for (const t of tokens) {
    const key = t.toLowerCase().replace(/^(l|d|j|m|t|s|n|qu|c)['’]/, '');
    const w = idx.get(key);
    if (!w) {
      levels['?']++;
      continue;
    }
    levels[levelOfWord(c, w)]++;
    if (learned.has(w.id)) fromLessons++;
  }
  return {
    words: tokens.length,
    sentences,
    avgSentence: sentences ? Math.round((10 * tokens.length) / sentences) / 10 : tokens.length,
    unique: new Set(tokens.map((x) => x.toLowerCase())).size,
    levels,
    fromLessons,
  };
}

// ---------- storage ----------

export async function getEssays(course: string): Promise<Essay[]> {
  return (((await (await db()).get('kv', `essays|${course}`)) as Essay[] | undefined) || []).filter((e) => !e.deleted).sort((a, b) => b.ts - a.ts);
}

export async function saveEssay(e: Essay) {
  const d = await db();
  const list = ((await d.get('kv', `essays|${e.course}`)) as Essay[] | undefined) || [];
  const i = list.findIndex((x) => x.id === e.id);
  e.updated = Date.now();
  if (i >= 0) list[i] = e;
  else list.push(e);
  await d.put('kv', list.slice(-200), `essays|${e.course}`);
  scheduleSync(2000);
}

export async function deleteEssay(course: string, id: string) {
  const d = await db();
  const list = ((await d.get('kv', `essays|${course}`)) as Essay[] | undefined) || [];
  // keep a tombstone so that sync doesn't bring it back from another device
  const i = list.findIndex((x) => x.id === id);
  if (i >= 0) list[i] = { ...list[i], text: '', check: undefined, stats: undefined, updated: Date.now(), topic: { title: '' }, deleted: true };
  await d.put('kv', list, `essays|${course}`);
  scheduleSync(2000);
}

export function newEssayId() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}
