import { useMemo, useRef, useState } from 'preact/hooks';
import { sample, shuffle } from '../answer';
import { displayWord } from '../content';
import { t } from '../i18n';
import { applyPlacement } from '../progress';
import { go } from '../router';
import { bump } from '../store';
import { LEVELS, type Level, type LoadedCourse, type PlacementItem, type Word } from '../types';
import { Progress, SpeakBtn } from '../ui/common';

const BANDS: [number, number][] = [
  [1, 300],
  [300, 700],
  [700, 1200],
  [1200, 2000],
  [2000, 3000],
  [3000, 4500],
  [4500, 6500],
  [6500, 9000],
  [9000, 12000],
];
const PER_BAND = 4;
const CONTENT_POS = new Set(['noun', 'verb', 'adj', 'adv']);

interface VQ {
  word: Word;
  options: string[];
  answer: number;
  band: number;
}

function vocabQuestion(c: LoadedCourse, band: number, used: Set<number>): VQ | null {
  const [lo, hi] = BANDS[band];
  const pool = c.words.filter((w) => w.r >= lo && w.r < hi && CONTENT_POS.has(w.pos) && w.tr && !used.has(w.id));
  if (!pool.length) return null;
  const word = pool[Math.floor(Math.random() * pool.length)];
  used.add(word.id);
  const others = shuffle(pool.filter((w) => w.id !== word.id && w.pos === word.pos && w.tr !== word.tr));
  const wrong: string[] = [];
  for (const o of others) {
    if (!wrong.includes(o.tr)) wrong.push(o.tr);
    if (wrong.length === 3) break;
  }
  const options = shuffle([word.tr, ...wrong]);
  return { word, options, answer: options.indexOf(word.tr), band };
}

const VOCAB_LEVEL: [number, Level | null][] = [
  [400, null],
  [900, 'A1'],
  [1800, 'A2'],
  [3200, 'B1'],
  [5500, 'B2'],
  [Infinity, 'C1'],
];

function levelIdx(l: Level | null) {
  return l ? LEVELS.indexOf(l) : -1;
}

export function Placement({ c }: { c: LoadedCourse }) {
  const [phase, setPhase] = useState<'intro' | 'vocab' | 'grammar' | 'result'>('intro');
  const used = useRef(new Set<number>());
  // vocab state
  const bandScores = useRef<Record<number, { n: number; ok: number; dk: number }>>({});
  const [band, setBand] = useState(2);
  const [vq, setVq] = useState<VQ | null>(null);
  const [vCount, setVCount] = useState(0);
  // grammar state
  const byLevel = useMemo(() => {
    const m: Record<string, PlacementItem[]> = {};
    for (const it of c.placement) (m[it.lvl] ||= []).push(it);
    for (const k in m) m[k] = shuffle(m[k]);
    return m;
  }, [c]);
  const [gLevel, setGLevel] = useState(0);
  const gScores = useRef<Record<string, { n: number; ok: number }>>({});
  const [gItem, setGItem] = useState<{ item: PlacementItem; options: string[]; answer: number } | null>(null);
  const [picked, setPicked] = useState<number | null>(null);
  const [result, setResult] = useState<{ level: Level | null; vocab: number; start: number; detail: Record<string, number> } | null>(null);

  const startVocab = () => {
    setPhase('vocab');
    setVq(vocabQuestion(c, 2, used.current));
  };

  const vocabAnswer = (i: number | 'dk') => {
    if (!vq) return;
    const s = (bandScores.current[vq.band] ||= { n: 0, ok: 0, dk: 0 });
    s.n++;
    if (i === 'dk') s.dk++;
    else if (i === vq.answer) s.ok++;
    setVCount(vCount + 1);
    let b = band;
    if (s.n >= PER_BAND) {
      const p = s.ok / s.n;
      const tested = (k: number) => (bandScores.current[k]?.n || 0) >= PER_BAND;
      if (p >= 0.75 && b + 1 < BANDS.length && !tested(b + 1)) b = b + 1;
      else if (p <= 0.5 && b > 0 && !tested(b - 1)) b = b - 1;
      else return finishVocab();
      setBand(b);
    }
    const q = vocabQuestion(c, b, used.current);
    if (!q) return finishVocab();
    setVq(q);
  };

  const vocabEstimate = () => {
    const sc = bandScores.current;
    const tested = Object.keys(sc).map(Number).sort((a, b) => a - b);
    const lo = tested[0];
    let total = 0;
    BANDS.forEach(([a, b], i) => {
      const size = b - a;
      let p: number;
      if (sc[i]) {
        const raw = sc[i].ok / sc[i].n;
        const answered = (sc[i].n - sc[i].dk) / sc[i].n;
        p = Math.max(0, (raw - 0.25 * answered) / 0.75);
      } else p = i < lo ? 1 : 0;
      total += size * Math.min(1, p);
    });
    return Math.round(total / 50) * 50;
  };

  const finishVocab = () => {
    setPhase('grammar');
    nextGrammar(0);
  };

  const nextGrammar = (lvl: number) => {
    const L = LEVELS[lvl];
    const used = gScores.current[L]?.n || 0;
    const pool = byLevel[L] || [];
    const item = pool[used];
    if (!item) return finishAll(lvl - 1);
    const opts = item.o.map((o, i) => ({ o, i }));
    const sh = shuffle(opts);
    setGItem({ item, options: sh.map((x) => x.o), answer: sh.findIndex((x) => x.i === item.a) });
    setPicked(null);
    setGLevel(lvl);
  };

  const grammarAnswer = (i: number | 'dk') => {
    if (!gItem) return;
    const L = LEVELS[gLevel];
    const s = (gScores.current[L] ||= { n: 0, ok: 0 });
    s.n++;
    if (i !== 'dk' && i === gItem.answer) s.ok++;
    const avail = (byLevel[L] || []).length;
    // decide after 4 items (or 6 if borderline)
    if (s.n >= 4) {
      const p = s.ok / s.n;
      const borderline = p >= 0.5 && p < 0.75 && s.n < 6 && avail > s.n;
      if (!borderline) {
        if (p >= 0.67) {
          if (gLevel + 1 < LEVELS.length && byLevel[LEVELS[gLevel + 1]]?.length) return nextGrammar(gLevel + 1);
          return finishAll(gLevel);
        }
        return finishAll(gLevel - 1);
      }
    }
    if (s.n >= avail) return finishAll(s.ok / s.n >= 0.67 ? gLevel : gLevel - 1);
    nextGrammar(gLevel);
  };

  const finishAll = (gPassed: number) => {
    const vocab = vocabEstimate();
    const vLevel = VOCAB_LEVEL.find(([n]) => vocab < n)![1];
    const lvl = Math.min(gPassed, levelIdx(vLevel));
    const level = lvl >= 0 ? LEVELS[lvl] : null;
    // start at the first unit of the next level
    let start = 0;
    if (level) {
      const nextLevel = LEVELS[lvl + 1];
      start = nextLevel ? c.units.findIndex((u) => u.level === nextLevel) : c.units.length - 1;
      if (start < 0) start = c.units.length - 1;
    }
    const detail: Record<string, number> = {};
    for (const [k, v] of Object.entries(gScores.current)) detail[k] = Math.round((100 * v.ok) / v.n);
    setResult({ level, vocab, start, detail });
    setPhase('result');
  };

  if (phase === 'intro')
    return (
      <div class="page">
        <h2>{t().placementTitle}</h2>
        <p>{t().placementIntro}</p>
        <div class="choice-cards">
          <button
            class="choice-card"
            onClick={async () => {
              await applyPlacement(c, 0, 'A0', 0, {});
              bump();
              go('/');
            }}
          >
            <b>{t().placementFromZero}</b>
          </button>
          <button class="choice-card primary" onClick={startVocab}>
            <b>{t().placementTake}</b>
          </button>
        </div>
      </div>
    );

  if (phase === 'vocab' && vq)
    return (
      <div class="page session">
        <div class="ex-kicker">
          {t().placementVocab} · {vCount + 1}
        </div>
        <Progress value={vCount} max={24} />
        <div class="prompt">
          <span class="big-word">{displayWord(vq.word, c.meta.target)}</span> <SpeakBtn text={vq.word.w} />
          <div class="sub">{t().placementWhatMeans}</div>
        </div>
        <div class="options">
          {vq.options.map((o, i) => (
            <button class="opt" onClick={() => vocabAnswer(i)}>
              <span class="opt-n">{i + 1}</span>
              {o}
            </button>
          ))}
          <button class="opt dk" onClick={() => vocabAnswer('dk')}>
            {t().dontKnow}
          </button>
        </div>
      </div>
    );

  if (phase === 'grammar' && gItem)
    return (
      <div class="page session">
        <div class="ex-kicker">
          {t().placementGrammar} · {LEVELS[gLevel]}
        </div>
        <Progress value={gLevel * 4 + (gScores.current[LEVELS[gLevel]]?.n || 0)} max={LEVELS.length * 4} />
        <div class="prompt left">
          <div class="sub">{t().placementChoose}</div>
          <div class="sentence big">{gItem.item.q.split(/_{2,}/).map((p, i, a) => (i < a.length - 1 ? [p, <span class="blank">_____</span>] : p))}</div>
        </div>
        <div class="options">
          {gItem.options.map((o, i) => (
            <button
              class={`opt tl-text ${picked === i ? 'sel' : ''}`}
              onClick={() => {
                setPicked(i);
                setTimeout(() => grammarAnswer(i), 120);
              }}
            >
              <span class="opt-n">{i + 1}</span>
              {o}
            </button>
          ))}
          <button class="opt dk" onClick={() => grammarAnswer('dk')}>
            {t().dontKnow}
          </button>
        </div>
      </div>
    );

  if (phase === 'result' && result) {
    const startUnit = c.units[result.start];
    return (
      <div class="page">
        <h2>{t().placementResult}</h2>
        <div class="result-grid">
          <div class="stat">
            <small>{t().placementLevel}</small>
            <b>{result.level || 'A0'}</b>
          </div>
          <div class="stat">
            <small>{t().placementVocabSize}</small>
            <b>~{result.vocab}</b>
          </div>
        </div>
        {Object.keys(result.detail).length > 0 && (
          <div class="card">
            {LEVELS.filter((l) => result.detail[l] !== undefined).map((l) => (
              <div class="level-row">
                <span>{l}</span>
                <Progress value={result.detail[l]} max={100} />
                <span>{result.detail[l]}%</span>
              </div>
            ))}
          </div>
        )}
        <div class="card">
          <small>{t().placementStartAt}</small>
          <h3>
            {t().unit} {startUnit.n}: {startUnit.title} <span class="pill">{startUnit.level}</span>
          </h3>
          <p class="muted">{t().placementApplyNote}</p>
        </div>
        <div class="ex-actions">
          <button
            class="btn"
            onClick={() => {
              bandScores.current = {};
              gScores.current = {};
              used.current = new Set();
              setVCount(0);
              setBand(2);
              setPhase('intro');
            }}
          >
            {t().placementRetake}
          </button>
          <button
            class="btn primary"
            onClick={async () => {
              await applyPlacement(c, result.start, result.level || 'A0', result.vocab, result.detail);
              bump();
              go('/');
            }}
          >
            {t().placementApply}
          </button>
        </div>
      </div>
    );
  }
  return null;
}

export { sample };
