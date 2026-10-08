/**
 * Short explanations shown right after an answer: why the right answer is right and, after a
 * mistake, what the chosen answer actually is. Built from the course data:
 * - articles: gender and number of the noun that follows (from the lexicon)
 * - verb forms: which verb, tense and person a form belongs to (from the conjugation tables)
 * - words: whose translation a wrongly chosen option is
 * - otherwise: the line of the rule that mentions the answer
 */
import { displayWord } from './content';
import { sectionFor, sectionForDrill, sectionsOf, type Ex } from './exercises';
import { fmt, t } from './i18n';
import type { LoadedCourse, Sentence, Topic, Word } from './types';

export interface Explanation {
  why?: string; // markdown-ish text with [[target]] marks
  yours?: string;
  rule?: { topic: Topic; md: string };
}

const norm = (s: string) => s.toLowerCase().replace(/[’]/g, "'").replace(/[¿¡.,!?;:«»"]/g, '').trim();

// ---------- verb forms ----------

type Analysis = { verb: string; tense: string; person: number };
const formIndex = new WeakMap<object, Map<string, Analysis[]>>();

function analyses(c: LoadedCourse, form: string): Analysis[] {
  let idx = formIndex.get(c.conj);
  if (!idx) {
    idx = new Map();
    for (const [verb, table] of Object.entries(c.conj))
      for (const [tense, forms] of Object.entries(table))
        forms.forEach((f, person) => {
          if (!f) return;
          for (const alt of f.split('/')) {
            const k = norm(alt);
            if (!idx!.has(k)) idx!.set(k, []);
            idx!.get(k)!.push({ verb, tense, person });
          }
        });
    formIndex.set(c.conj, idx);
  }
  return idx.get(norm(form)) || [];
}

function describeForm(c: LoadedCourse, form: string, a: Analysis) {
  const tense = c.meta.tenseNames[a.tense] || a.tense;
  const single = (c.conj[a.verb]?.[a.tense] || []).length === 1;
  return fmt(t().exVerb, { form, verb: a.verb, tense, person: single ? '' : `, ${c.meta.persons[a.person]}` });
}

function pick(list: Analysis[], prefer: { verb?: string; tenses?: string[]; person?: number }): Analysis | undefined {
  const score = (a: Analysis) => (a.verb === prefer.verb ? 4 : 0) + (prefer.tenses?.includes(a.tense) ? 2 : 0) + (a.person === prefer.person ? 1 : 0);
  return [...list].sort((x, y) => score(y) - score(x))[0];
}

function verbReason(c: LoadedCourse, right: string, given: string | undefined, hint: string | undefined, topic: Topic | undefined): Explanation | null {
  const ra = analyses(c, right);
  if (!ra.length) return null;
  const a = pick(ra, { verb: hint, tenses: topic?.tenses });
  if (!a) return null;
  const out: Explanation = { why: describeForm(c, right, a) };
  if (given && norm(given) !== norm(right)) {
    const ga = analyses(c, given);
    const g = pick(ga, { verb: a.verb, tenses: [a.tense], person: a.person });
    if (g) out.yours = describeForm(c, given, g);
  }
  return out;
}

// ---------- articles ----------

type Art = { g?: 'm' | 'f'; n: 'sg' | 'pl'; kind: 'def' | 'indef' | 'part' | 'contr'; elision?: boolean };

const ARTICLES: Record<string, Record<string, Art>> = {
  es: {
    el: { g: 'm', n: 'sg', kind: 'def' },
    la: { g: 'f', n: 'sg', kind: 'def' },
    los: { g: 'm', n: 'pl', kind: 'def' },
    las: { g: 'f', n: 'pl', kind: 'def' },
    un: { g: 'm', n: 'sg', kind: 'indef' },
    una: { g: 'f', n: 'sg', kind: 'indef' },
    unos: { g: 'm', n: 'pl', kind: 'indef' },
    unas: { g: 'f', n: 'pl', kind: 'indef' },
    al: { g: 'm', n: 'sg', kind: 'contr' },
    del: { g: 'm', n: 'sg', kind: 'contr' },
  },
  fr: {
    le: { g: 'm', n: 'sg', kind: 'def' },
    la: { g: 'f', n: 'sg', kind: 'def' },
    "l'": { n: 'sg', kind: 'def', elision: true },
    les: { n: 'pl', kind: 'def' },
    un: { g: 'm', n: 'sg', kind: 'indef' },
    une: { g: 'f', n: 'sg', kind: 'indef' },
    des: { n: 'pl', kind: 'indef' },
    du: { g: 'm', n: 'sg', kind: 'part' },
    'de la': { g: 'f', n: 'sg', kind: 'part' },
    "de l'": { n: 'sg', kind: 'part', elision: true },
    au: { g: 'm', n: 'sg', kind: 'contr' },
    aux: { n: 'pl', kind: 'contr' },
  },
};

function articleDesc(art: string, a: Art) {
  const T = t();
  const parts = [T.exArtKind[a.kind]];
  if (a.elision) return fmt(T.exArtElision, { art });
  const who = [a.g ? T.exGender[a.g] : '', T.exNumber[a.n]].filter(Boolean).join(', ');
  return fmt(T.exArtFor, { art, kind: parts[0], who });
}

const nounIndex = new WeakMap<object, Map<string, { w: Word; n: 'sg' | 'pl' }>>();

function nounOf(c: LoadedCourse, surface: string): { w: Word; n: 'sg' | 'pl' } | undefined {
  let idx = nounIndex.get(c.words);
  if (!idx) {
    idx = new Map();
    for (const w of c.words) {
      if (w.pos !== 'noun') continue;
      if (!idx.has(w.w.toLowerCase())) idx.set(w.w.toLowerCase(), { w, n: 'sg' });
      if (w.pl && !idx.has(w.pl.toLowerCase())) idx.set(w.pl.toLowerCase(), { w, n: 'pl' });
    }
    nounIndex.set(c.words, idx);
  }
  return idx.get(norm(surface));
}

/** The noun right after the gap (skipping one adjective at most). */
function nounAfter(c: LoadedCourse, words: string[]) {
  for (const w of words.slice(0, 3)) {
    const n = nounOf(c, w);
    if (n) return n;
  }
  return undefined;
}

function articleReason(c: LoadedCourse, right: string, given: string | undefined, after: string[]): Explanation | null {
  const table = ARTICLES[c.meta.target];
  const a = table?.[norm(right)];
  if (!a) return null;
  const noun = nounAfter(c, after);
  const T = t();
  const out: Explanation = {};
  if (noun) {
    const g = noun.w.g === 'm' || noun.w.g === 'f' ? T.exGender[noun.w.g] : '';
    const vowel = /^[aeiouyhéèêàâîïôûœ]/i.test(noun.w.w);
    if (a.elision && vowel) out.why = fmt(T.exArtNounVowel, { noun: noun.w.w, art: right });
    else if (c.meta.target === 'es' && a.g === 'm' && noun.w.g === 'f' && /^h?[aá]/i.test(noun.w.w)) out.why = fmt(T.exArtElAgua, { noun: noun.w.w, art: right });
    else out.why = fmt(T.exArtNoun, { noun: noun.w.w, who: [g, T.exNumber[noun.n]].filter(Boolean).join(', '), art: right });
  } else out.why = articleDesc(right, a);
  if (given && norm(given) !== norm(right)) {
    const ga = table[norm(given)];
    if (ga) out.yours = articleDesc(given, ga);
  }
  return out;
}

// ---------- the rule line ----------

/**
 * The line of the rule step that best explains the answer: a table row or highlighted line with the
 * answer (and the word it goes with, if known), otherwise the step's title.
 */
function ruleLine(topic: Topic, answer: string, sec?: number, also?: string): Explanation['rule'] {
  const secs = sectionsOf(topic);
  const i = sec !== undefined && sec >= 0 ? sec : sectionFor(topic, answer);
  const s = secs[i >= 0 ? i : 0];
  if (!s) return undefined;
  const a = norm(answer);
  const lines = s.md.split('\n').map((l) => l.trim()).filter((l) => l && !/^\|?[-| ]+\|?$/.test(l));
  const re = a && a.length <= 40 ? new RegExp(`(^|[^\\p{L}])${a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\p{L}])`, 'iu') : null;
  const alsoRe = also ? new RegExp(`(^|[^\\p{L}])${norm(also).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'iu') : null;
  let hit: string | undefined;
  let best = 0;
  if (re)
    for (const l of lines) {
      const n = norm(l);
      if (!re.test(n)) continue;
      const score = 1 + (alsoRe && alsoRe.test(n) ? 4 : 0) + (l.startsWith('|') ? 2 : 0) + (/\*\*|\[\[/.test(l) ? 1 : 0);
      if (score > best) {
        best = score;
        hit = l;
      }
    }
  const md = (hit || (s.title ? `**${s.title}**` : lines[0] || '')).replace(/^[-*>]\s+/, '').replace(/^\|(.*)\|$/, (_, x) => x.split('|').map((y: string) => y.trim()).filter(Boolean).join(' · '));
  return md ? { topic, md: md.length > 260 ? md.slice(0, 257) + '…' : md } : undefined;
}

/** A step whose table has a row with this form (a conjugation table explains a form best). */
function tableSection(topic: Topic, form: string): number {
  const f = norm(form);
  return sectionsOf(topic).findIndex((s) =>
    s.md
      .split('\n')
      .some((l) => l.trim().startsWith('|') && norm(l).split(/[|*\s]+/).includes(f)),
  );
}

// ---------- words ----------

function wordByGloss(c: LoadedCourse, gloss: string, not: Word) {
  return c.words.find((w) => w.tr === gloss && w.id !== not.id);
}

function wordByForm(c: LoadedCourse, shown: string, not: Word) {
  const s = norm(shown);
  return c.words.find((w) => w.id !== not.id && (norm(displayWord(w, c.meta.target)) === s || norm(w.w) === s));
}

// ---------- entry point ----------

function after(text: string): string[] {
  return (text.split(/_{2,}/)[1] || '').split(/\s+/).map(norm).filter(Boolean);
}

function afterTokens(s: Sentence, i: number, n: number): string[] {
  return s.tk.slice(i + n).map(([w]) => norm(w)).filter((w) => /\p{L}/u.test(w));
}

export function explain(c: LoadedCourse, ex: Ex, given: string | undefined): Explanation {
  const g = given?.trim() || undefined;
  if (ex.k === 'mcq') {
    const shown = g;
    if (!shown || norm(shown) === norm(ex.options[ex.answer])) return {};
    if (ex.mode === 'n2t') {
      const w = wordByForm(c, shown, ex.word);
      return w ? { yours: fmt(t().exWordMeans, { w: displayWord(w, c.meta.target), tr: w.tr }) } : {};
    }
    const w = wordByGloss(c, shown, ex.word);
    return w ? { yours: fmt(t().exGlossOf, { tr: shown, w: displayWord(w, c.meta.target) }) } : {};
  }
  if (ex.k === 'type') {
    if (!g) return {};
    const w = c.words.find((x) => x.id !== ex.word.id && norm(x.w) === norm(g.replace(/^(el|la|los|las|un|una|le|les|l'|une)\s+/i, '')));
    return w ? { yours: fmt(t().exWordMeans, { w: displayWord(w, c.meta.target), tr: w.tr }) } : {};
  }
  if (ex.k === 'drill') {
    const d = ex.drill;
    const right = d.a[0];
    const sec = sectionForDrill(ex.topic, d);
    const hint = /\(([^)]+)\)/.exec(d.q)?.[1];
    const next = after(d.q);
    const art = articleReason(c, right, g, next);
    const verb = art ? null : verbReason(c, right, g, hint, ex.topic);
    const tsec = verb ? tableSection(ex.topic, right) : -1;
    const out: Explanation = { ...(art || verb || {}), rule: ruleLine(ex.topic, right, tsec >= 0 ? tsec : sec, nounAfter(c, next)?.w.w) };
    // hand-written explanations in the drill file come first
    if (d.w) out.why = d.w;
    const mine = g && d.wo && Object.entries(d.wo).find(([o]) => norm(o) === norm(g))?.[1];
    if (mine) out.yours = mine;
    // a wrong pick that is a real word of its own (pero / perro): say what it means
    if (!out.yours && g && norm(g) !== norm(right) && !/\s/.test(g)) {
      const w = c.words.find((x) => norm(x.w) === norm(g) || norm(displayWord(x, c.meta.target)) === norm(g));
      if (w) out.yours = fmt(t().exWordMeans, { w: displayWord(w, c.meta.target), tr: w.tr });
    }
    return out;
  }
  if (ex.k === 'cloze' && !ex.word) {
    const right = ex.answers[0];
    const topic = ex.topic || (ex.cid?.startsWith('g:') ? c.topicById.get(ex.cid.slice(2)) : undefined);
    const next = afterTokens(ex.sent, ex.i, ex.n);
    const base = articleReason(c, right, g, next) || verbReason(c, right, g, ex.hint, topic) || {};
    return { ...base, rule: topic ? ruleLine(topic, right, undefined, nounAfter(c, next)?.w.w) : undefined };
  }
  if (ex.k === 'cloze' && ex.word) {
    const right = ex.answers[0];
    const v = verbReason(c, right, g, ex.word.w, undefined);
    return v || {};
  }
  if (ex.k === 'conj') {
    const right = ex.answers[0];
    const v = verbReason(c, right, g, ex.verb, undefined) || {};
    return { ...v, rule: ex.topic ? ruleLine(ex.topic, right) : undefined };
  }
  return {};
}
