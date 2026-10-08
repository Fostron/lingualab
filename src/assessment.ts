/**
 * In-depth level assessment.
 *
 * How it measures (shown to the learner in the report):
 * - Every question has a CEFR level. Grammar, reading, listening and writing are adaptive: the next
 *   question's level follows the current estimate (computerised adaptive testing).
 * - The estimate is an item-response (Rasch-type) model: an "ability" θ on a scale where a question of
 *   level A1..C1 has difficulty -2..+2; the chance of a right answer rises with θ − difficulty, plus the
 *   chance of guessing (1 in 4 for four options). θ is the posterior mean given all answers (EAP), with
 *   the self-assessment as a weak prior. "I don't know" counts as wrong but avoids guessing noise.
 * - Level boundaries on θ: A1 from −1.5, A2 −0.5, B1 0.5, B2 1.5, C1 2.5 — a level counts as reached
 *   when its questions are answered right about 70 % of the time.
 * - Vocabulary: a yes/no test (like LexTALE / X-Lex) with words from 7 frequency bands plus made-up
 *   words. Saying "I know" to made-up words reveals guessing and is subtracted (h − f)/(1 − f); a few
 *   "known" words are then checked for meaning. Size ≈ Σ band size × share known.
 */
import { check, shuffle } from './answer';
import type { LoadedCourse, Topic, Word } from './types';

export const LV = ['A1', 'A2', 'B1', 'B2', 'C1'] as const;
export const LEVEL_NAMES = ['A0', 'A1', 'A2', 'B1', 'B2', 'C1'] as const; // index = θ band
export type PartId = 'self' | 'vocab' | 'verify' | 'grammar' | 'reading' | 'listening' | 'writing' | 'finish' | 'done';
export const PARTS: PartId[] = ['self', 'vocab', 'verify', 'grammar', 'reading', 'listening', 'writing', 'finish', 'done'];
export type Skill = 'vocab' | 'grammar' | 'reading' | 'listening' | 'writing';

export const COUNTS = { grammar: 16, reading: 8, listening: 8, dictation: 2, writing: 7, ctest: 3, verify: 8 };

export interface BankItem {
  t: string;
  tr: string;
  d: string[];
  au?: number;
}
export interface AssessBank {
  reading: Record<string, BankItem[]>;
  listening: Record<string, BankItem[]>;
  ctest: Record<string, { t: string; tr: string }[]>;
  pseudo: string[];
}

/** One answered question. lvl 0..4 = A1..C1, g = chance of guessing it right. */
export interface Resp {
  lvl: number;
  ok: boolean;
  score?: number; // partial credit (dictation, C-test gaps), 0..1
  dk?: boolean;
  g: number;
  q: string; // what was asked (for the report)
  a: string; // right answer
  u?: string; // learner's answer
  topic?: string;
  key: string; // item identity, to avoid repeats
}

export interface YesNo {
  w: string;
  real: boolean;
  band?: number;
  id?: number;
  known?: boolean | null;
}

export interface AState {
  v: 1;
  course: string;
  started: number;
  active: number; // ms of active time
  part: PartId;
  intro: boolean; // showing the intro of `part`
  self: Partial<Record<'listening' | 'reading' | 'writing', number>>; // 0 = A0 … 5 = C1
  yesno: YesNo[];
  yesnoPos: number;
  verify: { id: number; ok: boolean | null; dk?: boolean }[];
  grammar: Resp[];
  reading: Resp[];
  listening: Resp[];
  writing: Resp[];
  skipped: PartId[];
  /** answers that "Back" can take back, newest last */
  undo?: Undo[];
  /** shown when the learner came back to a question */
  prevAnswer?: string;
}

/** What one answer changed, so it can be undone. cur = the question as it was shown. */
export type Undo =
  | { part: 'self' }
  | { part: 'vocab'; pos: number }
  | { part: 'verify'; id: number; cur: unknown; u: string }
  | { part: 'grammar' | 'reading' | 'listening' | 'writing'; n: number; cur: unknown; u: string };

// ---------- scoring ----------

const GRID: number[] = Array.from({ length: 81 }, (_, i) => -4 + i * 0.1);

function pCorrect(theta: number, b: number, g: number) {
  return g + (1 - g) / (1 + Math.exp(-1.7 * (theta - b)));
}

/** Posterior mean and sd of θ (EAP on a grid). */
export function estimate(resps: Resp[], prior = 0, priorSd = 1.25): { theta: number; se: number } {
  const post = GRID.map((th) => {
    let lp = -((th - prior) ** 2) / (2 * priorSd ** 2);
    for (const r of resps) {
      const p = pCorrect(th, r.lvl - 2, r.g);
      const s = r.score ?? (r.ok ? 1 : 0);
      lp += s * Math.log(p) + (1 - s) * Math.log(1 - p);
    }
    return lp;
  });
  const mx = Math.max(...post);
  const w = post.map((x) => Math.exp(x - mx));
  const z = w.reduce((a, b) => a + b, 0);
  const mean = GRID.reduce((a, th, i) => a + th * w[i], 0) / z;
  const varr = GRID.reduce((a, th, i) => a + (th - mean) ** 2 * w[i], 0) / z;
  return { theta: mean, se: Math.sqrt(varr) };
}

/** θ → level index (0 = A0 … 5 = C1) and progress through that level (0..1). */
export function levelOf(theta: number): { idx: number; frac: number } {
  const bounds = [-1.5, -0.5, 0.5, 1.5, 2.5];
  let idx = 0;
  while (idx < bounds.length && theta >= bounds[idx]) idx++;
  const lo = idx === 0 ? -3 : bounds[idx - 1];
  const hi = idx === bounds.length ? 3.5 : bounds[idx];
  return { idx, frac: Math.max(0, Math.min(1, (theta - lo) / (hi - lo))) };
}

/** Level to target next: the one whose questions are closest to the current estimate. */
export function targetLevel(theta: number) {
  return Math.max(0, Math.min(4, Math.round(theta + 2)));
}

/** Prior from the self-assessment (0 = A0 … 5 = C1). */
export function selfPrior(s: number | undefined) {
  if (s === undefined) return 0;
  return s === 0 ? -2.3 : s - 2;
}

// ---------- vocabulary ----------

export const BANDS: [number, number][] = [
  [1, 500],
  [500, 1000],
  [1000, 2000],
  [2000, 3000],
  [3000, 4500],
  [4500, 6500],
  [6500, 10001],
];
const PER_BAND = 6;
const N_PSEUDO = 16;
const CONTENT = new Set(['noun', 'verb', 'adj', 'adv']);
/** Vocabulary size where each level starts (approximate; in line with Milton's X-Lex studies). */
export const VOCAB_BOUNDS = [300, 800, 1500, 2500, 3800];

export function buildYesNo(c: LoadedCourse, bank: AssessBank): YesNo[] {
  // Spanish made-up words carry no accent marks, so accented real words would give them away
  const plain = (w: Word) => c.meta.target !== 'es' || !/[áéíóú]/.test(w.w);
  const items: YesNo[] = [];
  BANDS.forEach(([lo, hi], b) => {
    const pool = c.words.filter((w) => w.r >= lo && w.r < hi && CONTENT.has(w.pos) && w.w.length >= 3 && !/[\s'’-]/.test(w.w) && w.w === w.w.toLowerCase() && plain(w));
    for (const w of shuffle(pool).slice(0, PER_BAND)) items.push({ w: w.w, real: true, band: b, id: w.id, known: null });
  });
  for (const p of shuffle(bank.pseudo).slice(0, N_PSEUDO)) items.push({ w: p, real: false, known: null });
  return shuffle(items);
}

export interface VocabResult {
  estimate: number;
  low: number;
  high: number;
  falseAlarms: number;
  pseudoN: number;
  verify: { asked: number; ok: number };
  bands: { from: number; to: number; n: number; yes: number; known: number }[];
  theta: number;
}

export function vocabResult(st: AState): VocabResult {
  const pseudo = st.yesno.filter((x) => !x.real && x.known !== null);
  const fa = pseudo.filter((x) => x.known).length;
  const f = pseudo.length ? fa / pseudo.length : 0;
  const asked = st.verify.filter((x) => x.ok !== null).length;
  const okV = st.verify.filter((x) => x.ok).length;
  // a lucky pick among 4 options is not knowledge
  const v = asked >= 3 ? Math.max(0, Math.min(1, (okV / asked - 0.25) / 0.75)) : 1;
  let est = 0;
  let varr = 0;
  const bands = BANDS.map(([lo, hi], b) => {
    const xs = st.yesno.filter((x) => x.real && x.band === b && x.known !== null);
    const h = xs.length ? xs.filter((x) => x.known).length / xs.length : 0;
    const k = Math.max(0, Math.min(1, f < 1 ? (h - f) / (1 - f) : 0)) * v;
    const size = Math.min(hi, c_lexSize) - lo;
    est += size * k;
    if (xs.length) varr += (size * size * k * (1 - k)) / xs.length;
    return { from: lo, to: hi - 1, n: xs.length, yes: xs.filter((x) => x.known).length, known: k };
  });
  const se = Math.sqrt(varr);
  return {
    estimate: Math.round(est / 10) * 10,
    low: Math.max(0, Math.round((est - 1.5 * se) / 10) * 10),
    high: Math.round((est + 1.5 * se) / 10) * 10,
    falseAlarms: fa,
    pseudoN: pseudo.length,
    verify: { asked, ok: okV },
    bands,
    theta: vocabTheta(est),
  };
}

let c_lexSize = 10001;
export function setLexSize(n: number) {
  c_lexSize = n + 1;
}

/** Vocabulary size → θ (log-linear between the level boundaries). */
export function vocabTheta(n: number) {
  const pts: [number, number][] = [
    [30, -3.5],
    [VOCAB_BOUNDS[0], -1.5],
    [VOCAB_BOUNDS[1], -0.5],
    [VOCAB_BOUNDS[2], 0.5],
    [VOCAB_BOUNDS[3], 1.5],
    [VOCAB_BOUNDS[4], 2.5],
    [8000, 3.5],
  ];
  const x = Math.log(Math.max(30, n));
  for (let i = 1; i < pts.length; i++) {
    const [n0, t0] = pts[i - 1];
    const [n1, t1] = pts[i];
    if (n <= n1) return t0 + ((x - Math.log(n0)) / (Math.log(n1) - Math.log(n0))) * (t1 - t0);
  }
  return 3.5;
}

/** Meaning check for some of the words marked "I know", spread over the bands (higher bands first). */
export function pickVerify(st: AState): number[] {
  const yes = st.yesno.filter((x) => x.real && x.known);
  const byBand = new Map<number, YesNo[]>();
  for (const x of yes) byBand.set(x.band!, [...(byBand.get(x.band!) || []), x]);
  const out: number[] = [];
  const bands = [...byBand.keys()].sort((a, b) => b - a);
  for (let round = 0; out.length < COUNTS.verify && round < 6; round++)
    for (const b of bands) {
      const x = byBand.get(b)![round];
      if (x && out.length < COUNTS.verify) out.push(x.id!);
    }
  return out;
}

// ---------- item pools ----------

export interface GrammarItem {
  lvl: number;
  q: string;
  options: string[];
  answer: string;
  topic?: string;
  key: string;
}

export function grammarPool(c: LoadedCourse): GrammarItem[] {
  const out: GrammarItem[] = [];
  for (const p of c.placement) out.push({ lvl: LV.indexOf(p.lvl as any), q: p.q, options: p.o, answer: p.o[p.a], key: `p:${p.q}` });
  for (const tp of c.topics) {
    const lvl = LV.indexOf(tp.level as any);
    for (const d of tp.drills) {
      if (d.t !== 'choice' || !d.o || d.o.length < 3 || !/_{2,}/.test(d.q) || d.q.replace(/_{2,}/, '').trim().length < 6) continue;
      out.push({ lvl, q: d.q, options: d.o, answer: d.a[0], topic: tp.id, key: `d:${tp.id}:${d.q}` });
    }
  }
  return out.filter((x) => x.lvl >= 0);
}

export interface WritingItem {
  lvl: number;
  before: string;
  after: string;
  answers: string[];
  hint?: string;
  tr: string;
  topic: string;
  key: string;
}

/** Typed gaps from real sentences: the right form of a given word (hint = dictionary form). */
export function writingPool(c: LoadedCourse): WritingItem[] {
  const out: WritingItem[] = [];
  for (const tp of c.topics) {
    const lvl = LV.indexOf(tp.level as any);
    if (lvl < 0) continue;
    for (const a of tp.auto) {
      if (a.o || !a.h) continue;
      const s = c.sents.get(a.s);
      if (!s) continue;
      const n = a.n || 1;
      const join = (tk: typeof s.tk) => tk.map(([w, , sp]) => w + (sp ? ' ' : '')).join('');
      const ans = s.tk.slice(a.i, a.i + n).map(([w, , sp], j) => w + (sp && j < n - 1 ? ' ' : '')).join('');
      const last = s.tk[a.i + n - 1];
      out.push({
        lvl,
        before: join(s.tk.slice(0, a.i)),
        after: (last && last[2] ? ' ' : '') + join(s.tk.slice(a.i + n)),
        answers: a.x ? [ans, a.x] : [ans],
        hint: a.h,
        tr: s.tr,
        topic: tp.id,
        key: `w:${a.s}:${a.i}`,
      });
    }
  }
  return out;
}

/** Choose an unused item of the target level, or the nearest level that still has items. */
export function pickItem<T extends { lvl: number; key: string }>(pool: T[], target: number, used: Set<string>, topicSeen?: Map<string, number>): T | null {
  for (const d of [0, 1, -1, 2, -2, 3, -3, 4, -4]) {
    const L = target + d;
    if (L < 0 || L > 4) continue;
    let xs = pool.filter((x) => x.lvl === L && !used.has(x.key));
    if (topicSeen) {
      // prefer topics not asked yet
      const fresh = xs.filter((x) => !(x as any).topic || !topicSeen.get((x as any).topic));
      if (fresh.length) xs = fresh;
    }
    if (xs.length) return xs[Math.floor(Math.random() * xs.length)];
  }
  return null;
}

// ---------- C-test ----------

export interface CGap {
  prefix: string;
  rest: string; // the deleted part to type
}
export type CPart = string | CGap;

/** Remove the second half of every second word (standard C-test), starting with the second word. */
export function damage(text: string): CPart[] {
  const parts: CPart[] = [];
  const re = /\p{L}+/gu;
  let last = 0;
  let k = 0;
  for (const m of text.matchAll(re)) {
    const w = m[0];
    const i = m.index!;
    if (i > last) parts.push(text.slice(last, i));
    k++;
    if (k % 2 === 0 && w.length >= 2) {
      const keep = Math.floor(w.length / 2);
      parts.push({ prefix: w.slice(0, keep), rest: w.slice(keep) });
    } else parts.push(w);
    last = i + w.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

export function scoreGap(gap: CGap, typed: string) {
  // the missing part, or the whole word typed into the gap
  return check(typed, [gap.rest], {}).ok || check(gap.prefix + typed, [gap.prefix + gap.rest], {}).ok || check(typed, [gap.prefix + gap.rest], {}).ok;
}

/** Share of reference words reproduced (order-aware, accent- and punctuation-tolerant). */
export function dictationScore(ref: string, typed: string) {
  const norm = (s: string) =>
    s
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^\p{L}\p{N}\s']/gu, ' ')
      .split(/\s+/)
      .filter(Boolean);
  const a = norm(ref);
  const b = norm(typed);
  const dp = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
  return a.length ? dp[a.length][b.length] / a.length : 0;
}

// ---------- report ----------

export interface SkillResult {
  theta: number;
  se: number;
  level: number; // 0 = A0 … 5 = C1
  frac: number;
  n: number;
  right: number;
  byLevel: { n: number; right: number }[];
  self?: number;
}

export interface AReport {
  ts: number;
  seconds: number;
  overall: { theta: number; level: number; frac: number };
  skills: Partial<Record<Skill, SkillResult>>;
  vocab?: VocabResult;
  weakTopics: { id: string; wrong: number; n: number }[];
  strongTopics: string[];
  mistakes: { part: Skill; q: string; a: string; u?: string; lvl: number }[];
  start: number; // recommended unit index
  self: AState['self'];
  skipped: PartId[];
}

const WEIGHTS: Record<Skill, number> = { grammar: 0.3, vocab: 0.2, reading: 0.2, listening: 0.15, writing: 0.15 };

function skillOf(resps: Resp[], prior: number, self?: number): SkillResult {
  const { theta, se } = estimate(resps, prior);
  const { idx, frac } = levelOf(theta);
  const byLevel = LV.map((_, l) => {
    const xs = resps.filter((r) => r.lvl === l);
    return { n: xs.length, right: xs.reduce((s, r) => s + (r.score ?? (r.ok ? 1 : 0)), 0) };
  });
  return { theta, se, level: idx, frac, n: resps.length, right: resps.reduce((s, r) => s + (r.score ?? (r.ok ? 1 : 0)), 0), byLevel, self };
}

export function buildReport(c: LoadedCourse, st: AState): AReport {
  const selfAvg = avgSelf(st.self);
  const skills: AReport['skills'] = {};
  if (st.grammar.length) skills.grammar = skillOf(st.grammar, selfPrior(selfAvg), selfAvg);
  if (st.reading.length) skills.reading = skillOf(st.reading, selfPrior(st.self.reading), st.self.reading);
  if (st.listening.length) skills.listening = skillOf(st.listening, selfPrior(st.self.listening), st.self.listening);
  if (st.writing.length) skills.writing = skillOf(st.writing, selfPrior(st.self.writing), st.self.writing);
  let vocab: VocabResult | undefined;
  if (st.yesno.some((x) => x.known !== null)) {
    setLexSize(c.words.length);
    vocab = vocabResult(st);
    const { idx, frac } = levelOf(vocab.theta);
    const n = st.yesno.filter((x) => x.known !== null).length;
    skills.vocab = { theta: vocab.theta, se: 0.5, level: idx, frac, n, right: 0, byLevel: [] };
  }
  let wsum = 0;
  let tsum = 0;
  for (const [k, s] of Object.entries(skills) as [Skill, SkillResult][]) {
    wsum += WEIGHTS[k];
    tsum += WEIGHTS[k] * s.theta;
  }
  const theta = wsum ? tsum / wsum : -3;
  const { idx, frac } = levelOf(theta);
  // grammar topics behind mistakes / right answers
  const tstat = new Map<string, { wrong: number; n: number }>();
  for (const r of [...st.grammar, ...st.writing])
    if (r.topic) {
      const x = tstat.get(r.topic) || { wrong: 0, n: 0 };
      x.n++;
      if (!r.ok) x.wrong++;
      tstat.set(r.topic, x);
    }
  const weakTopics = [...tstat.entries()].filter(([, x]) => x.wrong > 0).map(([id, x]) => ({ id, ...x })).sort((a, b) => b.wrong - a.wrong);
  const strongTopics = [...tstat.entries()].filter(([, x]) => x.wrong === 0).map(([id]) => id);
  const mistakes: AReport['mistakes'] = [];
  for (const part of ['grammar', 'reading', 'listening', 'writing'] as Skill[])
    for (const r of (st as any)[part] as Resp[]) if (!r.ok) mistakes.push({ part, q: r.q, a: r.a, u: r.u, lvl: r.lvl });
  // start: first unit of the level after the one reached; never above the grammar level + 1
  let reached = idx; // 0 = A0
  if (skills.grammar) reached = Math.min(reached, skills.grammar.level + 1);
  let start = 0;
  if (reached > 0) {
    const nextLevel = LV[reached];
    start = nextLevel ? c.units.findIndex((u) => u.level === nextLevel) : c.units.length - 1;
    if (start < 0) start = c.units.length - 1;
  }
  return {
    ts: Date.now(),
    seconds: Math.round(st.active / 1000),
    overall: { theta, level: idx, frac },
    skills,
    vocab,
    weakTopics,
    strongTopics,
    mistakes,
    start,
    self: st.self,
    skipped: st.skipped,
  };
}

export function avgSelf(s: AState['self']) {
  const xs = Object.values(s).filter((x): x is number => typeof x === 'number');
  return xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : undefined;
}

export function topicTitle(c: LoadedCourse, id: string): string {
  return (c.topicById.get(id) as Topic | undefined)?.title || id;
}

export function newState(course: string): AState {
  return {
    v: 1,
    course,
    started: Date.now(),
    active: 0,
    part: 'self',
    intro: true,
    self: {},
    yesno: [],
    yesnoPos: 0,
    verify: [],
    grammar: [],
    reading: [],
    listening: [],
    writing: [],
    skipped: [],
  };
}

// ---------- persistence of an unfinished assessment ----------

const KEY = (course: string) => `lingualab.assess.${course}`;

export function loadState(course: string): AState | null {
  try {
    const s = localStorage.getItem(KEY(course));
    return s ? (JSON.parse(s) as AState) : null;
  } catch {
    return null;
  }
}

export function saveState(st: AState | null, course: string) {
  try {
    if (st) localStorage.setItem(KEY(course), JSON.stringify(st));
    else localStorage.removeItem(KEY(course));
  } catch {
    /* storage unavailable: the assessment just can't be resumed */
  }
}
