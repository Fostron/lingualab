import { pick, sample, shuffle } from './answer';
import { displayWord, productionAnswers, sentText } from './content';
import type { CardRec } from './db';
import type { Drill, LoadedCourse, Sentence, Topic, Unit, Word } from './types';

export type Ex =
  | { k: 'intro'; word: Word }
  | { k: 'mcq'; mode: 't2n' | 'n2t' | 'listen' | 'sent'; word: Word; sent?: Sentence; options: string[]; answer: number; cid: string }
  | { k: 'type'; mode: 'n2t' | 'listen'; word: Word; answers: string[]; partial: string[]; cid: string }
  | { k: 'cloze'; sent: Sentence; i: number; n: number; answers: string[]; options?: string[]; hint?: string; cid?: string; word?: Word }
  | { k: 'build'; sent: Sentence; tiles: string[]; answer: string; cid?: string }
  | { k: 'translate'; sent: Sentence; cid?: string }
  | { k: 'dictation'; sent: Sentence; cid?: string }
  | { k: 'read'; sent: Sentence; options: string[]; answer: number; cid?: string }
  | { k: 'drill'; topic: Topic; drill: Drill; cid?: string }
  | { k: 'conj'; verb: string; tense: string; person: number; answers: string[]; cid?: string };

export interface ExOpts {
  typingOnly: boolean;
  hasVoice: boolean;
}

/** Distractor glosses: same POS, similar frequency, different meaning. */
function glossOptions(c: LoadedCourse, w: Word, n = 3): string[] {
  const near = c.words.filter(
    (x) => x.id !== w.id && x.pos === w.pos && Math.abs(x.r - w.r) < 600 && x.tr && x.tr !== w.tr && !shareGloss(x, w),
  );
  const pool = near.length >= n ? near : c.words.filter((x) => x.id !== w.id && x.tr !== w.tr && !shareGloss(x, w));
  const out: string[] = [];
  for (const x of shuffle(pool)) {
    if (!out.includes(x.tr)) out.push(x.tr);
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

/** Exercise for a word card. stage = number of successful reps so far (0 = brand new). */
export function wordExercise(c: LoadedCourse, w: Word, kind: 'wr' | 'wp', stage: number, o: ExOpts, known?: Set<number>): Ex {
  const cid = `${kind}:${w.id}`;
  const target = c.meta.target;
  if (kind === 'wr') {
    const r = Math.random();
    const sents = stage >= 2 ? sentencesWith(c, w, known) : [];
    if (sents.length && r < 0.35) {
      const s = pick(sents);
      return { k: 'mcq', mode: 'sent', word: w, sent: s, ...mcq(w.tr, glossOptions(c, w)), cid };
    }
    if (o.hasVoice && stage >= 1 && r < 0.6) return { k: 'mcq', mode: 'listen', word: w, ...mcq(w.tr, glossOptions(c, w)), cid };
    return { k: 'mcq', mode: 't2n', word: w, ...mcq(w.tr, glossOptions(c, w)), cid };
  }
  // production
  const { answers, partial } = productionAnswers(w, target);
  if (stage === 0 && !o.typingOnly) {
    const ws = wordOptions(c, w).map((x) => displayWord(x, target));
    return { k: 'mcq', mode: 'n2t', word: w, ...mcq(displayWord(w, target), ws), cid };
  }
  const r = Math.random();
  if (stage >= 2) {
    const sents = sentencesWith(c, w, known);
    if (sents.length && r < 0.4) {
      const s = pick(sents);
      const i = tokenIndexOf(s, w);
      if (i >= 0) {
        const surface = s.tk[i][0];
        return {
          k: 'cloze', sent: s, i, n: 1, answers: [surface], word: w, cid,
          hint: surface.toLowerCase() !== w.w.toLowerCase() ? w.w : undefined,
        };
      }
    }
    if (o.hasVoice && r < 0.6) return { k: 'type', mode: 'listen', word: w, answers, partial, cid };
  }
  return { k: 'type', mode: 'n2t', word: w, answers, partial, cid };
}

export function topicExercise(c: LoadedCourse, topic: Topic, known?: Set<number>): Ex | null {
  const autos = topic.auto.filter((a) => {
    const s = c.sents.get(a.s);
    if (!s) return false;
    if (!known) return true;
    const unknown = s.tk.filter(([, wid]) => wid && !known.has(wid)).length;
    return unknown <= 2;
  });
  const useAuto = autos.length > 0 && (topic.drills.length === 0 || Math.random() < 0.4);
  if (useAuto) {
    const a = pick(autos);
    const s = c.sents.get(a.s)!;
    const n = a.n || 1;
    const ans = s.tk.slice(a.i, a.i + n).map(([w, , sp], j) => w + (sp && j < n - 1 ? ' ' : '')).join('');
    return { k: 'cloze', sent: s, i: a.i, n, answers: [ans], options: a.o ? shuffle(a.o) : undefined, hint: a.h, cid: `g:${topic.id}` };
  }
  if (!topic.drills.length) return null;
  return { k: 'drill', topic, drill: pick(topic.drills), cid: `g:${topic.id}` };
}

export function conjExercise(c: LoadedCourse, verb: string, tenses: string[]): Ex | null {
  const table = c.conj[verb];
  if (!table) return null;
  const avail = tenses.filter((t) => table[t] && table[t].some(Boolean));
  if (!avail.length) return null;
  const tense = pick(avail);
  const forms = table[tense];
  const persons = forms.map((f, i) => (f ? i : -1)).filter((i) => i >= 0);
  const person = pick(persons);
  return { k: 'conj', verb, tense, person, answers: forms[person].split('/'), cid: `c:${verb}` };
}

export function sentenceExercise(c: LoadedCourse, s: Sentence, o: ExOpts, known?: Set<number>): Ex {
  const words = s.tk.filter(([w]) => /\p{L}/u.test(w)).length;
  const r = Math.random();
  if (o.hasVoice && r < 0.25 && words <= 9) return { k: 'dictation', sent: s };
  if (r < 0.5 && words <= 10) {
    const tiles = s.tk.filter(([w]) => /\p{L}|\d/u.test(w)).map(([w]) => w);
    return { k: 'build', sent: s, tiles: shuffle(tiles), answer: tiles.join(' ') };
  }
  if (r < 0.75) {
    const others = [...c.sents.values()];
    const wrong: string[] = [];
    for (let i = 0; i < 40 && wrong.length < 3; i++) {
      const x = others[Math.floor(Math.random() * others.length)];
      if (x.id !== s.id && x.tr !== s.tr && !wrong.includes(x.tr)) wrong.push(x.tr);
    }
    return { k: 'read', sent: s, ...mcq(s.tr, wrong) };
  }
  void known;
  return { k: 'translate', sent: s };
}

/** Build a learning lesson: introduce new words, practise them, add grammar and sentence work. */
export function buildLesson(c: LoadedCourse, unit: Unit, newWords: Word[], known: Set<number>, o: ExOpts): Ex[] {
  const out: Ex[] = [];
  const groups: Word[][] = [];
  for (let i = 0; i < newWords.length; i += 4) groups.push(newWords.slice(i, i + 4));
  const knownPlus = new Set([...known, ...newWords.map((w) => w.id)]);
  for (const g of groups) {
    for (const w of g) out.push({ k: 'intro', word: w });
    for (const w of shuffle(g)) out.push(wordExercise(c, w, 'wr', 0, o));
    for (const w of shuffle(g)) out.push(wordExercise(c, w, 'wp', 0, o));
  }
  for (const w of shuffle(newWords).slice(0, 4)) out.push(wordExercise(c, w, 'wp', 1, o));
  // grammar of the unit
  for (const tid of unit.topics) {
    const topic = c.topicById.get(tid);
    if (!topic) continue;
    for (let i = 0; i < 3; i++) {
      const e = topicExercise(c, topic, knownPlus);
      if (e) out.push(e);
    }
  }
  // sentences with known words
  const newIds = new Set(newWords.map((w) => w.id));
  const sents = unit.sents
    .map((id) => c.sents.get(id)!)
    .filter((s) => s && s.tk.every(([, wid]) => !wid || knownPlus.has(wid)))
    .sort((a, b) => Number(b.tk.some(([, w]) => newIds.has(w))) - Number(a.tk.some(([, w]) => newIds.has(w))));
  for (const s of sents.slice(0, 4)) out.push(sentenceExercise(c, s, o, knownPlus));
  return out;
}

/** Unit test: production of unit words, grammar, sentences. */
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
  const sents = sample(unit.sents.map((id) => c.sents.get(id)!).filter(Boolean), 3);
  for (const s of sents) out.push(sentenceExercise(c, s, o));
  return out.map((e) => ({ ...e, cid: undefined }) as Ex);
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

export function sentenceShown(s: Sentence) {
  return sentText(s);
}
