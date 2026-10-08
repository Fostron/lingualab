import { pick, sample, shuffle } from './answer';
import { displayWord, productionAnswers, sentText } from './content';
import type { CardRec } from './db';
import type { Drill, LoadedCourse, Sentence, Topic, Unit, Word } from './types';

export type Ex =
  | { k: 'intro'; word: Word; again?: boolean } // again: shown once more after a mistake
  | { k: 'teach'; title: string; md: string; topic?: Topic; step?: [number, number]; sents?: Sentence[] }
  | { k: 'mcq'; mode: 't2n' | 'n2t' | 'listen' | 'sent'; word: Word; sent?: Sentence; options: string[]; answer: number; cid: string }
  | { k: 'type'; mode: 'n2t' | 'listen'; word: Word; answers: string[]; partial: string[]; cid: string }
  | { k: 'cloze'; sent: Sentence; i: number; n: number; answers: string[]; options?: string[]; hint?: string; cid?: string; word?: Word; topic?: Topic }
  | { k: 'build'; sent: Sentence; tiles: string[]; answer: string; cid?: string }
  | { k: 'translate'; sent: Sentence; cid?: string }
  | { k: 'dictation'; sent: Sentence; cid?: string }
  | { k: 'read'; sent: Sentence; options: string[]; answer: number; cid?: string }
  | { k: 'drill'; topic: Topic; drill: Drill; cid?: string }
  | { k: 'conj'; verb: string; tense: string; person: number; answers: string[]; cid?: string; topic?: Topic };

/** easy = more choice and recognition, hard = typing from the start. */
export type Diff = 'easy' | 'normal' | 'hard';

export interface ExOpts {
  typingOnly: boolean;
  hasVoice: boolean;
  diff?: Diff;
}

/** Exercises that are shown, not graded. */
export function isGraded(ex: Ex) {
  return ex.k !== 'intro' && ex.k !== 'teach';
}

/** Distractor glosses: same POS, similar frequency, different meaning. */
function glossOptions(c: LoadedCourse, w: Word, n = 3): string[] {
  const near = c.words.filter(
    (x) => x.id !== w.id && x.pos === w.pos && Math.abs(x.r - w.r) < 600 && x.tr && x.tr !== w.tr && !shareGloss(x, w),
  );
  const pool = near.length >= n ? near : c.words.filter((x) => x.id !== w.id && x.tr !== w.tr && !shareGloss(x, w));
  // no two options that read the same (case, punctuation and accents aside), none equal to the right one
  const key = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const seen = new Set([key(w.tr)]);
  const out: string[] = [];
  for (const x of shuffle(pool)) {
    if (seen.has(key(x.tr))) continue;
    seen.add(key(x.tr));
    out.push(x.tr);
    if (out.length >= n) break;
  }
  return out;
}

function shareGloss(a: Word, b: Word) {
  const ga = a.tr.toLowerCase().split(/[;,]\s*/);
  const gb = new Set(b.tr.toLowerCase().split(/[;,]\s*/));
  return ga.some((g) => gb.has(g));
}

function wordOptions(c: LoadedCourse, w: Word, n = 3): Word[] {
  const near = c.words.filter((x) => x.id !== w.id && x.pos === w.pos && Math.abs(x.r - w.r) < 600 && !shareGloss(x, w) && x.w !== w.w);
  return sample(near.length >= n ? near : c.words.filter((x) => x.id !== w.id && x.w !== w.w), n);
}

function mcq<T>(right: T, wrong: T[]): { options: T[]; answer: number } {
  const options = shuffle([right, ...wrong]);
  return { options, answer: options.indexOf(right) };
}

/** Sentences containing a word that use only known vocabulary (best-effort). */
export function sentencesWith(c: LoadedCourse, w: Word, known?: Set<number>): Sentence[] {
  const out: Sentence[] = [];
  for (const id of w.ex || []) {
    const s = c.sents.get(id);
    if (!s) continue;
    if (known && !s.tk.every(([, wid]) => !wid || known.has(wid) || wid === w.id)) continue;
    out.push(s);
  }
  return out;
}

export function tokenIndexOf(s: Sentence, w: Word) {
  return s.tk.findIndex(([, wid]) => wid === w.id);
}

// ---- single word exercises ----

const recog = (c: LoadedCourse, w: Word): Ex => ({ k: 'mcq', mode: 't2n', word: w, ...mcq(w.tr, glossOptions(c, w)), cid: `wr:${w.id}` });
const listenChoice = (c: LoadedCourse, w: Word): Ex => ({ k: 'mcq', mode: 'listen', word: w, ...mcq(w.tr, glossOptions(c, w)), cid: `wr:${w.id}` });
function prodChoice(c: LoadedCourse, w: Word): Ex {
  const t = c.meta.target;
  return { k: 'mcq', mode: 'n2t', word: w, ...mcq(displayWord(w, t), wordOptions(c, w).map((x) => displayWord(x, t))), cid: `wp:${w.id}` };
}
function prodType(c: LoadedCourse, w: Word, mode: 'n2t' | 'listen' = 'n2t'): Ex {
  const { answers, partial } = productionAnswers(w, c.meta.target);
  return { k: 'type', mode, word: w, answers, partial, cid: `wp:${w.id}` };
}
function wordCloze(w: Word, s: Sentence): Ex | null {
  const i = tokenIndexOf(s, w);
  if (i < 0) return null;
  const surface = s.tk[i][0];
  return { k: 'cloze', sent: s, i, n: 1, answers: [surface], word: w, cid: `wp:${w.id}`, hint: surface.toLowerCase() !== w.w.toLowerCase() ? w.w : undefined };
}

/** Exercise for a word card. stage = number of successful reps so far (0 = brand new). */
export function wordExercise(c: LoadedCourse, w: Word, kind: 'wr' | 'wp', stage: number, o: ExOpts, known?: Set<number>): Ex {
  if (kind === 'wr') {
    const r = Math.random();
    const sents = stage >= 2 ? sentencesWith(c, w, known) : [];
    if (sents.length && r < 0.35) {
      const s = pick(sents);
      return { k: 'mcq', mode: 'sent', word: w, sent: s, ...mcq(w.tr, glossOptions(c, w)), cid: `wr:${w.id}` };
    }
    if (canHearWord(o, w) && stage >= 1 && r < 0.6) return listenChoice(c, w);
    return recog(c, w);
  }
  if (stage === 0 && !o.typingOnly && o.diff !== 'hard') return prodChoice(c, w);
  const r = Math.random();
  if (stage >= 2) {
    const sents = sentencesWith(c, w, known);
    if (sents.length && r < 0.4) {
      const e = wordCloze(w, pick(sents));
      if (e) return e;
    }
    if (canHearWord(o, w) && r < 0.6) return prodType(c, w, 'listen');
  }
  return prodType(c, w);
}

// ---- grammar ----

export interface Section {
  title: string;
  md: string;
}

const secCache = new WeakMap<Topic, Section[]>();

/** Split an explanation into steps at its "## " headings (a short preface joins the first step). */
export function sectionsOf(topic: Topic): Section[] {
  const hit = secCache.get(topic);
  if (hit) return hit;
  const out: Section[] = [];
  let cur: Section = { title: '', md: '' };
  for (const line of topic.md.split('\n')) {
    const m = /^##\s+(.*)$/.exec(line);
    if (m) {
      if (cur.md.trim() || cur.title) out.push(cur);
      cur = { title: m[1].trim(), md: '' };
    } else cur.md += line + '\n';
  }
  if (cur.md.trim() || cur.title) out.push(cur);
  if (out.length > 1 && !out[0].title && out[0].md.trim().length < 260) {
    out[1] = { title: out[1].title, md: out[0].md.trim() + '\n\n' + out[1].md };
    out.shift();
  }
  secCache.set(topic, out);
  return out;
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Index of the first step whose text contains the answer as a whole word (-1 if none). */
export function sectionFor(topic: Topic, answer: string): number {
  const a = answer.toLowerCase().trim();
  if (!a || a.length > 40) return -1;
  const re = new RegExp(`(^|[^\\p{L}])${esc(a)}($|[^\\p{L}])`, 'iu');
  return sectionsOf(topic).findIndex((s) => re.test(s.md));
}

const wordsOf = (s: string) => new Set((s.toLowerCase().match(/\p{L}{2,}/gu) || []).filter((w) => w.length > 2 || /[^a-z]/.test(w)));
const secWords = new WeakMap<Section, Set<string>>();

/**
 * The step a drill is about: the one sharing most words with the question, its answer and hint
 * (the answer counts double); ties go to the later step, so a question never comes before what it needs.
 */
export function sectionForDrill(topic: Topic, d: Drill): number {
  const secs = sectionsOf(topic);
  const qw = wordsOf(`${d.q} ${d.h || ''}`);
  const aw = wordsOf(d.a[0]);
  let best = -1;
  let bestScore = 1;
  secs.forEach((s, i) => {
    let ws = secWords.get(s);
    if (!ws) secWords.set(s, (ws = wordsOf(s.title + ' ' + s.md)));
    let score = 0;
    for (const w of qw) if (ws.has(w)) score++;
    for (const w of aw) if (ws.has(w)) score += 2;
    if (score >= bestScore) {
      bestScore = score;
      best = i;
    }
  });
  return best;
}

function teachOf(topic: Topic, i: number, total?: number): Ex {
  const s = sectionsOf(topic)[i];
  return { k: 'teach', title: s.title || topic.title, md: s.md, topic, step: total ? [i + 1, total] : undefined };
}

const drillEx = (topic: Topic, d: Drill): Ex => ({ k: 'drill', topic, drill: d, cid: `g:${topic.id}` });

function autoEx(c: LoadedCourse, topic: Topic, known?: Set<number>): Ex | null {
  const autos = topic.auto.filter((a) => {
    const s = c.sents.get(a.s);
    if (!s) return false;
    if (!known) return true;
    return s.tk.filter(([, wid]) => wid && !known.has(wid)).length <= 2;
  });
  if (!autos.length) return null;
  const a = pick(autos);
  const s = c.sents.get(a.s)!;
  const n = a.n || 1;
  const ans = s.tk.slice(a.i, a.i + n).map(([w, , sp], j) => w + (sp && j < n - 1 ? ' ' : '')).join('');
  const answers = a.x ? [ans, a.x] : [ans];
  return { k: 'cloze', sent: s, i: a.i, n, answers, options: a.o ? shuffle(a.o) : undefined, hint: a.h, cid: `g:${topic.id}`, topic };
}

export function topicExercise(c: LoadedCourse, topic: Topic, known?: Set<number>): Ex | null {
  const useAuto = topic.auto.length > 0 && (topic.drills.length === 0 || Math.random() < 0.4);
  if (useAuto) {
    const e = autoEx(c, topic, known);
    if (e) return e;
  }
  if (!topic.drills.length) return null;
  return drillEx(topic, pick(topic.drills));
}

export function conjExercise(c: LoadedCourse, verb: string, tenses: string[], topic?: Topic): Ex | null {
  const table = c.conj[verb];
  if (!table) return null;
  const avail = tenses.filter((t) => table[t] && table[t].some(Boolean));
  if (!avail.length) return null;
  const tense = pick(avail);
  const forms = table[tense];
  const persons = forms.map((f, i) => (f ? i : -1)).filter((i) => i >= 0);
  const person = pick(persons);
  return { k: 'conj', verb, tense, person, answers: forms[person].split('/'), cid: `c:${verb}`, topic };
}

const drillRank = (d: Drill) => (d.t === 'choice' ? 0 : d.t === 'gap' ? 1 : 2);

/** Rule lesson: the explanation step by step, each step followed by a question or two about it. */
export function buildRuleLesson(c: LoadedCourse, topic: Topic): Ex[] {
  const secs = sectionsOf(topic);
  const per: Drill[][] = secs.map(() => []);
  const rest: Drill[] = [];
  for (const d of [...topic.drills].sort((a, b) => drillRank(a) - drillRank(b))) {
    const i = sectionForDrill(topic, d);
    if (i >= 0 && per[i].length < 2) per[i].push(d);
    else rest.push(d);
  }
  const out: Ex[] = [];
  secs.forEach((_, i) => {
    out.push(teachOf(topic, i, secs.length));
    for (const d of per[i]) out.push(drillEx(topic, d));
  });
  const exs = topic.ex.map((id) => c.sents.get(id)).filter(Boolean).slice(0, 4) as Sentence[];
  if (exs.length) out.push({ k: 'teach', title: '', md: '', topic, sents: exs });
  const graded = out.filter(isGraded).length;
  for (const d of rest.slice(0, Math.max(0, 6 - graded))) out.push(drillEx(topic, d));
  return out;
}

/** Practice of one grammar point: hand-made drills, gaps in real sentences, conjugation. */
export function buildDrillLesson(c: LoadedCourse, topic: Topic, known: Set<number>, o: ExOpts, n = 12): Ex[] {
  const out: Ex[] = [];
  if (topic.tenses?.length) {
    const verbs = [...known].map((id) => c.wordById.get(id)).filter((w): w is Word => !!w && w.pos === 'verb' && !!c.conj[w.w]);
    for (const v of sample(verbs, 3)) {
      const e = conjExercise(c, v.w, topic.tenses, topic);
      if (e) out.push(e);
    }
  }
  const autos: Ex[] = [];
  const seen = new Set<number>();
  for (let i = 0; i < 12 && autos.length < 4; i++) {
    const e = autoEx(c, topic, known);
    if (e && e.k === 'cloze' && !seen.has(e.sent.id)) {
      seen.add(e.sent.id);
      autos.push(e);
    }
  }
  out.push(...autos);
  const drills = shuffle(topic.drills).slice(0, Math.max(0, n - out.length));
  out.push(...drills.map((d) => drillEx(topic, d)));
  // easier questions first; on "easy" choices dominate the first half
  const rank = (e: Ex) => (e.k === 'drill' ? drillRank(e.drill) : e.k === 'cloze' ? (e.options ? 0 : 1) : 1.5);
  const sorted = shuffle(out).sort((a, b) => rank(a) - rank(b));
  return o.diff === 'hard' ? shuffle(sorted) : sorted;
}

// ---- sentences ----

export function sentenceExercise(c: LoadedCourse, s: Sentence, o: ExOpts, _known?: Set<number>): Ex {
  const words = s.tk.filter(([w]) => /\p{L}/u.test(w)).length;
  const r = Math.random();
  if (canHearSent(o, s) && r < 0.25 && words <= 9) return { k: 'dictation', sent: s };
  if (r < 0.5 && words <= 10) return buildEx(s);
  if (r < 0.75 || o.diff === 'easy') return readEx(c, s);
  return { k: 'translate', sent: s };
}

function buildEx(s: Sentence): Ex {
  const tiles = s.tk.filter(([w]) => /\p{L}|\d/u.test(w)).map(([w]) => w);
  return { k: 'build', sent: s, tiles: shuffle(tiles), answer: tiles.join(' ') };
}

function readEx(c: LoadedCourse, s: Sentence): Ex {
  const others = [...c.sents.values()];
  const wrong: string[] = [];
  for (let i = 0; i < 40 && wrong.length < 3; i++) {
    const x = others[Math.floor(Math.random() * others.length)];
    if (x.id !== s.id && x.tr !== s.tr && !wrong.includes(x.tr)) wrong.push(x.tr);
  }
  return { k: 'read', sent: s, ...mcq(s.tr, wrong) };
}

/** Listening needs a native recording or a system voice. */
const canHearWord = (o: ExOpts, w: Word) => o.hasVoice || !!w.wa;
const canHearSent = (o: ExOpts, s: Sentence) => o.hasVoice || !!s.au;

const onlyKnown =(s: Sentence, known: Set<number>) => s.tk.every(([, wid]) => !wid || known.has(wid));

// ---- lessons ----

/**
 * New words: introduced three at a time (see, recognise, pick), then recalled by typing,
 * heard, used in sentences, plus a few earlier words so they come back.
 */
export function buildWordsLesson(c: LoadedCourse, words: Word[], earlier: Word[], known: Set<number>, o: ExOpts): Ex[] {
  const out: Ex[] = [];
  const diff = o.diff || 'normal';
  // first every new word with its translation, audio and examples — only then questions
  for (const w of words) out.push({ k: 'intro', word: w });
  for (const w of shuffle(words)) out.push(recog(c, w));
  for (const w of shuffle(words)) out.push(diff === 'hard' || o.typingOnly ? prodType(c, w) : prodChoice(c, w));
  const all = new Set([...known, ...words.map((w) => w.id)]);
  // recall round: every new word typed once (easy: half of them with choices)
  shuffle(words).forEach((w, i) => {
    if (diff === 'easy' && i % 2 === 1) out.push(canHearWord(o, w) ? listenChoice(c, w) : prodChoice(c, w));
    else if (canHearWord(o, w) && diff !== 'easy' && i % 3 === 2) out.push(prodType(c, w, 'listen'));
    else out.push(prodType(c, w));
  });
  // in context
  let ctx = 0;
  for (const w of shuffle(words)) {
    if (ctx >= 3) break;
    const s = sentencesWith(c, w, all)[0];
    const e = s && wordCloze(w, s);
    if (e) {
      out.push(diff === 'easy' ? { k: 'mcq', mode: 'sent', word: w, sent: s, ...mcq(w.tr, glossOptions(c, w)), cid: `wr:${w.id}` } : e);
      ctx++;
    }
  }
  const newIds = new Set(words.map((w) => w.id));
  const sents = [...new Set(words.flatMap((w) => w.ex || []))]
    .map((id) => c.sents.get(id)!)
    .filter((s) => s && onlyKnown(s, all) && s.tk.some(([, wid]) => newIds.has(wid)) && s.tk.length <= 12);
  for (const s of sample(sents, 2)) out.push(sentenceExercise(c, s, o, all));
  // spaced recall of earlier words
  for (const w of sample(earlier, 3)) out.push(diff === 'easy' ? prodChoice(c, w) : prodType(c, w));
  return out;
}

/** Unit review: the unit's sentences (listen, read, build, translate), its words and its grammar together. */
export function buildReviewLesson(c: LoadedCourse, unit: Unit, known: Set<number>, o: ExOpts): Ex[] {
  const out: Ex[] = [];
  const sents = unit.sents.map((id) => c.sents.get(id)!).filter((s) => s && onlyKnown(s, known));
  const pool = sample(sents.length >= 6 ? sents : unit.sents.map((id) => c.sents.get(id)!).filter(Boolean), 8);
  pool.forEach((s, i) => {
    const words = s.tk.filter(([w]) => /\p{L}/u.test(w)).length;
    if (i % 4 === 0 && canHearSent(o, s) && words <= 10) out.push({ k: 'dictation', sent: s });
    else if (i % 4 === 1 && words <= 10) out.push(buildEx(s));
    else if (i % 4 === 2 && o.diff !== 'easy') out.push({ k: 'translate', sent: s });
    else out.push(readEx(c, s));
  });
  const words = unit.words.map((id) => c.wordById.get(id)!).filter(Boolean);
  for (const w of sample(words, 4)) out.push(prodType(c, w));
  for (const tid of unit.topics) {
    const topic = c.topicById.get(tid);
    for (let i = 0; topic && i < 2; i++) {
      const e = topicExercise(c, topic, known);
      if (e) out.push(e);
    }
  }
  return shuffle(out);
}

/** Unit test: production of unit words, grammar, sentences. Typing only, no second chances. */
export function buildUnitTest(c: LoadedCourse, unit: Unit, o: ExOpts): Ex[] {
  const out: Ex[] = [];
  const words = unit.words.map((id) => c.wordById.get(id)!).filter(Boolean);
  const testO = { ...o, typingOnly: true };
  for (const w of sample(words, Math.min(10, words.length))) out.push(wordExercise(c, w, Math.random() < 0.7 ? 'wp' : 'wr', 1, testO));
  for (const tid of unit.topics) {
    const topic = c.topicById.get(tid);
    if (!topic) continue;
    const used = new Set<string>();
    for (let i = 0; i < 12 && used.size < Math.ceil(8 / unit.topics.length); i++) {
      const e = topicExercise(c, topic);
      if (!e) break;
      const key = JSON.stringify(e.k === 'drill' ? e.drill.q : e.k === 'cloze' ? e.sent.id : i);
      if (used.has(key)) continue;
      used.add(key);
      out.push(e);
    }
  }
  const sents = sample(unit.sents.map((id) => c.sents.get(id)!).filter(Boolean), unit.topics.length ? 3 : 6);
  for (const s of sents) out.push(sentenceExercise(c, s, o));
  return out.map((e) => ({ ...e, cid: undefined }) as Ex);
}

/** Level exam: words, grammar and sentences from every unit of the level. */
export function buildExam(c: LoadedCourse, units: Unit[], o: ExOpts): Ex[] {
  const out: Ex[] = [];
  const words = units.flatMap((u) => u.words).map((id) => c.wordById.get(id)!).filter(Boolean);
  for (const w of sample(words, 10)) out.push(wordExercise(c, w, 'wp', 1, { ...o, typingOnly: true }));
  const topics = units.flatMap((u) => u.topics).map((id) => c.topicById.get(id)!).filter(Boolean);
  for (const tp of sample(topics, 10)) {
    const e = topicExercise(c, tp);
    if (e) out.push(e);
  }
  const sents = sample(units.flatMap((u) => u.sents).map((id) => c.sents.get(id)!).filter(Boolean), 6);
  for (const s of sents) out.push(sentenceExercise(c, s, o));
  return shuffle(out).map((e) => ({ ...e, cid: undefined }) as Ex);
}

/**
 * What to show after a wrong answer, before trying again: the word card again and an easier
 * question for words; the relevant part of the rule for grammar; the table for conjugation.
 */
export function retryFor(c: LoadedCourse, ex: Ex, attempt: number): Ex[] {
  switch (ex.k) {
    case 'mcq':
      return attempt === 1 ? [{ k: 'intro', word: ex.word, again: true }, { ...ex, ...mcq(ex.options[ex.answer], ex.options.filter((_, i) => i !== ex.answer)) }] : [ex];
    case 'type':
      return attempt === 1 ? [{ k: 'intro', word: ex.word, again: true }, prodChoice(c, ex.word), ex] : [ex];
    case 'cloze': {
      if (ex.word) return attempt === 1 ? [{ k: 'intro', word: ex.word, again: true }, ex] : [ex];
      const tp = ex.topic || (ex.cid?.startsWith('g:') ? c.topicById.get(ex.cid.slice(2)) : undefined);
      return attempt === 1 && tp ? [ruleHint(tp, ex.answers[0]), ex] : [ex];
    }
    case 'drill': {
      const i = sectionForDrill(ex.topic, ex.drill);
      return attempt === 1 ? [teachOf(ex.topic, i >= 0 ? i : 0), ex] : [ex];
    }
    case 'conj': {
      const forms = c.conj[ex.verb]?.[ex.tense];
      if (attempt > 1 || !forms) return [ex];
      const rows = forms.map((f, i) => (f ? `| ${c.meta.persons[i]} | **${f.replace(/\//g, ' / ')}** |` : '')).filter(Boolean);
      const md = `| | |\n|---|---|\n${rows.join('\n')}\n`;
      return [{ k: 'teach', title: `${ex.verb} — ${c.meta.tenseNames[ex.tense] || ex.tense}`, md }, ex];
    }
    case 'translate':
      return attempt === 1 ? [buildEx(ex.sent)] : [];
    default:
      return attempt === 1 ? [ex] : [];
  }
}

function ruleHint(topic: Topic, answer: string): Ex {
  const i = sectionFor(topic, answer);
  return teachOf(topic, i >= 0 ? i : 0);
}

/** Turn due cards into exercises. */
export function buildReview(c: LoadedCourse, cards: CardRec[], o: ExOpts, known: Set<number>, tenses: string[]): { ex: Ex; card: CardRec }[] {
  const out: { ex: Ex; card: CardRec }[] = [];
  for (const card of cards) {
    let ex: Ex | null = null;
    if (card.kind === 'wr' || card.kind === 'wp') {
      const w = c.wordById.get(Number(card.ref));
      if (w) ex = wordExercise(c, w, card.kind, Math.min(card.reps, 3), o, known);
    } else if (card.kind === 'g') {
      const t = c.topicById.get(card.ref);
      if (t) ex = topicExercise(c, t, known);
    } else if (card.kind === 'c') {
      ex = conjExercise(c, card.ref, tenses);
    }
    if (ex) out.push({ ex, card });
  }
  // interleave kinds so the session doesn't feel monotonous
  return shuffle(out);
}

export { sentText };
