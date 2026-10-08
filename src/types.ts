export type Lang = 'es' | 'fr';
export type UiLang = 'en' | 'ru';
export type Level = 'A1' | 'A2' | 'B1' | 'B2' | 'C1';
export const LEVELS: Level[] = ['A1', 'A2', 'B1', 'B2', 'C1'];

/** A dictionary entry (lemma) in the course lexicon. */
export interface Word {
  id: number;
  w: string; // lemma, e.g. "casa"
  pos: string; // noun | verb | adj | adv | pron | det | prep | conj | num | intj | phrase
  g?: 'm' | 'f' | 'mf'; // grammatical gender (nouns)
  ipa?: string;
  pl?: string; // plural
  fem?: string; // feminine form (adjectives / nouns of people)
  tr: string; // main gloss in the learner's language
  alt?: string[]; // other accepted glosses
  note?: string; // usage note in the learner's language
  r: number; // frequency rank (1 = most frequent)
  u?: number; // unit index where the word is taught (undefined = extra vocabulary)
  ex?: number[]; // example sentence ids
  wa?: string; // native recording on Wikimedia Commons ("a/ab/File.wav")
}

/** Token: [surface text, word id or 0, trailing whitespace?] */
export type Token = [string, number, 0 | 1];

export interface Sentence {
  id: number;
  tk: Token[];
  tr: string; // translation in the learner's language
  alt?: string[]; // alternative translations
  au?: number; // Tatoeba audio id (native recording)
}

export type DrillType = 'gap' | 'choice' | 'order' | 'transform';

export interface Drill {
  t: DrillType;
  q: string; // prompt, "___" marks the gap
  a: string[]; // accepted answers (first = canonical)
  o?: string[]; // options (choice) – include the right one
  h?: string; // hint (shown in the learner's language or target)
  w?: string; // hand-written: why the right answer is right
  wo?: Record<string, string>; // hand-written: why a wrong option is wrong
}

/** Auto-generated cloze over a corpus sentence: blank token i. */
export interface AutoCloze {
  s: number; // sentence id
  i: number; // token index to blank
  n?: number; // number of tokens to blank (default 1)
  h?: string; // hint, e.g. infinitive
  o?: string[]; // fixed choice set (e.g. ["por","para"])
  x?: string; // option equivalent of an elided answer (qu' → que)
}

export interface Topic {
  id: string;
  level: Level;
  title: string;
  md: string; // explanation (markdown, learner's language)
  drills: Drill[];
  auto: AutoCloze[];
  ex: number[]; // example sentences from the corpus
  tenses?: string[]; // conjugation tenses this topic unlocks for drills
}

export interface Unit {
  id: string;
  n: number; // 1-based order
  level: Level;
  title: string;
  topics: string[];
  words: number[];
  sents: number[]; // practice sentences that only use known vocabulary
}

export interface PlacementItem {
  lvl: Level;
  q: string;
  o: string[];
  a: number; // index of the right option
  topic?: string;
}

export interface CourseMeta {
  id: string;
  target: Lang;
  ui: UiLang;
  title: string;
  subtitle: string;
  tts: string; // BCP-47 for speech synthesis
  chars: string[]; // special characters keyboard
  persons: string[]; // conjugation persons, 6 items
  tenseNames: Record<string, string>;
  version: string;
  stats: { words: number; sentences: number; topics: number; units: number };
}

export interface CourseData {
  meta: CourseMeta;
  units: Unit[];
  topics: Topic[];
  placement: PlacementItem[];
}

export type ConjTable = Record<string, Record<string, string[]>>; // verb -> tense -> forms

export interface LoadedCourse extends CourseData {
  words: Word[];
  wordById: Map<number, Word>;
  sents: Map<number, Sentence>;
  topicById: Map<string, Topic>;
  unitById: Map<string, Unit>;
  conj: ConjTable;
}
