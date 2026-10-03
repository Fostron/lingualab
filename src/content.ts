import type { ConjTable, CourseData, LoadedCourse, Sentence, Token, Word } from './types';

export interface CourseInfo {
  id: string;
  target: 'es' | 'fr';
  ui: 'en' | 'ru';
  title: string;
  subtitle: string;
  flag: string;
}

export const COURSES: CourseInfo[] = [
  { id: 'es-en', target: 'es', ui: 'en', title: 'Spanish', subtitle: 'for English speakers · A1 → C1', flag: 'ES' },
  { id: 'fr-en', target: 'fr', ui: 'en', title: 'French', subtitle: 'for English speakers · A1 → C1', flag: 'FR' },
  { id: 'fr-ru', target: 'fr', ui: 'ru', title: 'Французский', subtitle: 'для русскоговорящих · A1 → C1', flag: 'FR' },
];

const cache = new Map<string, Promise<LoadedCourse>>();

declare const __BUILD__: string;

async function getJson<T>(url: string): Promise<T> {
  const r = await fetch(`${url}?v=${__BUILD__}`);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.json();
}

const PACK_FILES = ['course', 'lexicon', 'sentences', 'conj'];

/** Re-request the packs of loaded courses once the service worker controls the page, so the first visit
 *  also works offline later (the files come from the HTTP cache, no second download). */
export function warmOfflineCache() {
  for (const id of cache.keys())
    for (const f of PACK_FILES) void fetch(`${import.meta.env.BASE_URL}content/${id}/${f}.json?v=${__BUILD__}`).catch(() => {});
}

/** Reference dictionary entry beyond the course vocabulary: [word, part of speech, translation]. */
export type RefEntry = [string, string, string];

const refCache = new Map<string, Promise<RefEntry[]>>();

/** The big look-up dictionary (~70–100k entries) is only fetched when someone searches. */
export function loadRefDict(id: string): Promise<RefEntry[]> {
  let p = refCache.get(id);
  if (!p) {
    p = getJson<RefEntry[]>(`${import.meta.env.BASE_URL}content/${id}/dict.json`).catch(() => {
      refCache.delete(id);
      return [];
    });
    refCache.set(id, p);
  }
  return p;
}

export function loadCourse(id: string): Promise<LoadedCourse> {
  let p = cache.get(id);
  if (!p) {
    const base = `${import.meta.env.BASE_URL}content/${id}/`;
    p = Promise.all([
      getJson<CourseData>(base + 'course.json'),
      getJson<Word[]>(base + 'lexicon.json'),
      getJson<Sentence[]>(base + 'sentences.json'),
      getJson<ConjTable>(base + 'conj.json'),
    ]).then(([course, words, sents, conj]) => ({
      ...course,
      words,
      wordById: new Map(words.map((w) => [w.id, w])),
      sents: new Map(sents.map((s) => [s.id, s])),
      topicById: new Map(course.topics.map((t) => [t.id, t])),
      unitById: new Map(course.units.map((u) => [u.id, u])),
      conj,
    }));
    p.catch(() => cache.delete(id));
    cache.set(id, p);
  }
  return p;
}

export function sentText(s: Sentence | { tk: Token[] }) {
  return s.tk.map(([w, , sp]) => w + (sp ? ' ' : '')).join('').trim();
}

const ES_VOWEL_A = /^[ˈ]?h?[aá]/;

/** Definite article for a noun ("la casa", "l'arbre", "el agua"). */
export function article(w: Word, target: string): string {
  if (w.pos !== 'noun' || !w.g) return '';
  if (target === 'es') {
    if (w.g === 'f') {
      const ipa = (w.ipa || '').replace(/^\//, '');
      if (ipa.startsWith('ˈa') && ES_VOWEL_A.test(w.w)) return 'el';
      return 'la';
    }
    if (w.g === 'm') return 'el';
    return 'el/la';
  }
  if (/^[aeiouyàâäéèêëîïôöùûüœæ]/i.test(w.w) || (/^h/i.test(w.w) && !H_ASPIRE.has(w.w.toLowerCase()))) return "l'";
  if (w.g === 'f') return 'la';
  if (w.g === 'm') return 'le';
  return 'le/la';
}

export const H_ASPIRE = new Set(
  'hache haie haine hall halte hamac hamburger hameau hanche handicap hangar hanter harceler hardi hareng haricot harpe hasard hâte hausse haut hauteur héros hérisson hernie héron hêtre hibou hiérarchie hisser hocher hockey hollandais homard honte honteux hoquet hors housse houx hublot huer huit huitième hurler hurlement hutte hongrois haïr hors-d’œuvre hamster hareng hargne haleter hanche hachis halle'.split(
    ' ',
  ),
);

/** Display form of a word with article/gender, e.g. "la casa", "l'arbre (m)". */
export function displayWord(w: Word, target: string): string {
  const a = article(w, target);
  if (!a) return w.w;
  if (a === "l'") return `l'${w.w}`;
  if (a.includes('/')) return `${a} ${w.w}`;
  return `${a} ${w.w}`;
}

/** Accepted production answers for a word (with article for nouns), and "partial" ones (missing article). */
export function productionAnswers(w: Word, target: string): { answers: string[]; partial: string[] } {
  if (w.pos !== 'noun' || !w.g) {
    const answers = [w.w];
    if (w.fem && w.pos === 'adj') answers.push(w.fem);
    return { answers, partial: [] };
  }
  const a = article(w, target);
  const answers: string[] = [];
  if (a === "l'") {
    answers.push(`l'${w.w}`);
    if (target === 'fr') answers.push(`${w.g === 'f' ? 'une' : 'un'} ${w.w}`);
  } else if (a.includes('/')) {
    for (const x of a.split('/')) answers.push(`${x} ${w.w}`);
  } else {
    answers.push(`${a} ${w.w}`);
    if (target === 'es') answers.push(`${w.g === 'f' ? 'una' : 'un'} ${w.w}`);
    else answers.push(`${w.g === 'f' ? 'une' : 'un'} ${w.w}`);
  }
  if (w.fem) {
    const fa = target === 'es' ? 'la' : /^[aeiouyhéè]/i.test(w.fem) ? "l'" : 'la';
    answers.push(fa === "l'" ? `l'${w.fem}` : `${fa} ${w.fem}`);
  }
  return { answers, partial: [w.w] };
}

export function genderTag(w: Word): string {
  return w.g ? `(${w.g === 'mf' ? 'm/f' : w.g})` : '';
}
