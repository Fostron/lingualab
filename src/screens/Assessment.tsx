import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { check, shuffle } from '../answer';
import {
  avgSelf,
  buildReport,
  buildYesNo,
  COUNTS,
  damage,
  dictationScore,
  estimate,
  grammarPool,
  LEVEL_NAMES,
  levelOf,
  loadState,
  LV,
  newState,
  pickItem,
  pickVerify,
  saveState,
  scoreGap,
  selfPrior,
  targetLevel,
  topicTitle,
  writingPool,
  BANDS,
  type AReport,
  type AssessBank,
  type AState,
  type CGap,
  type CPart,
  type GrammarItem,
  type PartId,
  type Resp,
  type Skill,
  type WritingItem,
} from '../assessment';
import { loadAssessBank } from '../content';
import { addAssessment, getAssessments } from '../db';
import { fmt, t, ui } from '../i18n';
import { ta } from '../i18n-assess';
import { applyPlacement } from '../progress';
import { go } from '../router';
import { bump, getState } from '../store';
import { say, stopSpeech } from '../tts';
import type { LoadedCourse } from '../types';
import { Icon, Loading, Progress, TargetInput } from '../ui/common';

/** Examples shown in the part introductions, per target language. */
const EX: Record<string, { real: [string, string]; fake: string; grammar: [string, string]; writing: [string, string]; ctest: [string, string] }> = {
  es: { real: ['casa', 'house'], fake: 'tromante', grammar: ['Yo ___ estudiante.', 'soy'], writing: ['Ella ___ (hablar) francés.', 'habla'], ctest: ['Me gus__ mucho el ci__.', 'gusta, cine'] },
  fr: { real: ['maison', 'house'], fake: 'chorviette', grammar: ['Je ___ étudiante.', 'suis'], writing: ['Elle ___ (parler) français.', 'parle'], ctest: ['J’ai fa__ et je vais man___.', 'faim, manger'] },
};

const PART_NO: Record<PartId, number> = { self: 1, vocab: 2, verify: 2, grammar: 3, reading: 4, listening: 5, writing: 6, done: 6 };
const NEXT: Record<PartId, PartId> = { self: 'vocab', vocab: 'verify', verify: 'grammar', grammar: 'reading', reading: 'listening', listening: 'writing', writing: 'done', done: 'done' };

interface RItem {
  lvl: number;
  key: string;
  t: string;
  tr: string;
  d: string[];
  au?: number;
}

type Cur =
  | { kind: 'verify'; id: number; w: string; options: string[]; answer: string }
  | { kind: 'grammar'; item: GrammarItem; options: string[] }
  | { kind: 'reading' | 'listening'; item: RItem; options: string[] }
  | { kind: 'dictation'; item: RItem }
  | { kind: 'writing'; item: WritingItem }
  | { kind: 'ctest'; lvl: number; text: string; tr: string; parts: CPart[] };

type St = AState & { cur?: Cur };

function langVars(c: LoadedCourse) {
  const tg = c.meta.target;
  return { lang: ui() === 'ru' ? t().langTo[tg] : t().langName[tg], langIn: t().langName[tg] };
}

export function Assessment({ c }: { c: LoadedCourse }) {
  const id = c.meta.id;
  const [st, setSt] = useState<St | null>(() => loadState(id) as St | null);
  const [entered, setEntered] = useState(false);
  const [bank, setBank] = useState<AssessBank | null>(null);
  const [reports, setReports] = useState<AReport[] | null>(null);
  const [report, setReport] = useState<AReport | null>(null);
  const mark = useRef(Date.now());

  useEffect(() => {
    void loadAssessBank<AssessBank>(id).then(setBank);
    void getAssessments<AReport>(id).then(setReports);
    return () => stopSpeech();
  }, [id]);

  const gpool = useMemo(() => grammarPool(c), [c]);
  const wpool = useMemo(() => writingPool(c), [c]);
  const pools = useMemo(() => {
    if (!bank) return null;
    const flat = (src: Record<string, { t: string; tr: string; d: string[]; au?: number }[]>, pre: string): RItem[] =>
      LV.flatMap((L, lvl) => (src[L] || []).map((x) => ({ ...x, lvl, key: `${pre}${x.t}` })));
    return { reading: flat(bank.reading, 'R:'), listening: flat(bank.listening, 'L:') };
  }, [bank]);

  /** Make sure the current part has its current question (adaptive choice happens here). */
  const prepare = (s: St) => {
    for (let guard = 0; guard < 10; guard++) {
      if (s.intro || s.cur || s.part === 'done' || s.part === 'self' || s.part === 'vocab') return;
      const used = new Set([...s.grammar, ...s.reading, ...s.listening, ...s.writing].map((r) => r.key));
      if (s.part === 'verify') {
        const v = s.verify.find((x) => x.ok === null);
        if (!v) {
          move(s, 'grammar');
          continue;
        }
        const w = c.wordById.get(v.id)!;
        const band = BANDS.findIndex(([lo, hi]) => w.r >= lo && w.r < hi);
        const [lo, hi] = BANDS[Math.max(0, band)];
        const others = shuffle(c.words.filter((x) => x.id !== w.id && x.pos === w.pos && x.r >= lo && x.r < hi && x.tr !== w.tr));
        const wrong: string[] = [];
        for (const o of others) {
          if (!wrong.includes(o.tr)) wrong.push(o.tr);
          if (wrong.length === 3) break;
        }
        s.cur = { kind: 'verify', id: w.id, w: w.w, options: shuffle([w.tr, ...wrong]), answer: w.tr };
        return;
      }
      if (s.part === 'grammar') {
        if (s.grammar.length >= COUNTS.grammar) {
          move(s, NEXT.grammar);
          continue;
        }
        const th = estimate(s.grammar, selfPrior(avgSelf(s.self))).theta;
        const seen = new Map<string, number>();
        for (const r of s.grammar) if (r.topic) seen.set(r.topic, (seen.get(r.topic) || 0) + 1);
        const item = pickItem(gpool, targetLevel(th), used, seen);
        if (!item) {
          move(s, NEXT.grammar);
          continue;
        }
        s.cur = { kind: 'grammar', item, options: shuffle(item.options) };
        return;
      }
      if (s.part === 'reading' || s.part === 'listening') {
        const part = s.part;
        const done = s[part].filter((r) => r.key.startsWith(part === 'reading' ? 'R:' : 'L:')).length;
        const dict = s.listening.filter((r) => r.key.startsWith('D:')).length;
        const pool = pools![part];
        const th = estimate(s[part], selfPrior(s.self[part])).theta;
        if (done < COUNTS[part]) {
          const item = pickItem(pool, targetLevel(th), used);
          if (item) {
            s.cur = { kind: part, item, options: shuffle([item.tr, ...item.d]) };
            return;
          }
        }
        if (part === 'listening' && dict < COUNTS.dictation) {
          // dictation: a short phrase at (or just below) the estimated level
          const tl = Math.max(0, targetLevel(th) - 1);
          const cands = pool.filter((x) => !used.has(`D:${x.t}`) && !used.has(x.key) && x.lvl === tl).sort((a, b) => a.t.length - b.t.length);
          const item = cands[Math.floor(Math.random() * Math.min(8, cands.length))];
          if (item) {
            s.cur = { kind: 'dictation', item };
            return;
          }
        }
        move(s, NEXT[part]);
        continue;
      }
      if (s.part === 'writing') {
        const gaps = s.writing.filter((r) => r.key.startsWith('w:')).length;
        const ctests = new Set(s.writing.filter((r) => r.key.startsWith('C:')).map((r) => r.key.split('#')[0])).size;
        const th = estimate(s.writing, selfPrior(s.self.writing)).theta;
        if (gaps < COUNTS.writing) {
          const item = pickItem(wpool, targetLevel(th), used);
          if (item) {
            s.cur = { kind: 'writing', item };
            return;
          }
        }
        if (ctests < COUNTS.ctest && bank) {
          // C-tests at the estimated level, one below, one above
          const order = [0, -1, 1];
          const lvl = Math.max(0, Math.min(4, targetLevel(th) + order[ctests % 3]));
          const xs = (bank.ctest[LV[lvl]] || []).filter((x) => !used.has(`C:${x.t}#0`));
          const x = xs[Math.floor(Math.random() * xs.length)];
          if (x) {
            s.cur = { kind: 'ctest', lvl, text: x.t, tr: x.tr, parts: damage(x.t) };
            return;
          }
        }
        move(s, 'done');
        continue;
      }
      return;
    }
  };

  const move = (s: St, part: PartId) => {
    s.part = part;
    s.intro = part !== 'verify' && part !== 'done';
    s.cur = undefined;
  };

  const update = (f: (s: St) => void) => {
    setSt((prev) => {
      const s = JSON.parse(JSON.stringify(prev)) as St;
      const now = Date.now();
      s.active += Math.min(now - mark.current, 60_000);
      mark.current = now;
      f(s);
      prepare(s);
      saveState(s, id);
      return s;
    });
  };

  // finished: build and keep the report
  useEffect(() => {
    if (!st || st.part !== 'done' || report) return;
    const r = buildReport(c, st);
    void addAssessment(id, r).then(() => {
      saveState(null, id);
      setReport(r);
      setSt(null);
    });
  }, [st?.part]);

  if (!bank || !reports || !pools) return <Loading />;
  if (report)
    return (
      <ReportView
        c={c}
        r={report}
        fresh
        onRetake={() => {
          setReport(null);
          void getAssessments<AReport>(id).then(setReports);
        }}
      />
    );

  if (!st || !entered)
    return (
      <AssessHome
        c={c}
        st={st}
        reports={reports}
        onStart={() => {
          const s = newState(id) as St;
          saveState(s, id);
          mark.current = Date.now();
          setSt(s);
          setEntered(true);
        }}
        onResume={() => {
          mark.current = Date.now();
          setEntered(true);
        }}
      />
    );

  if (st.part === 'done') return <Loading />;
  const n = PART_NO[st.part];
  const head = (progress: number, max: number) => (
    <div class="as-head">
      <button
        class="icon-btn"
        title={t().quit}
        onClick={() => {
          stopSpeech();
          setEntered(false);
        }}
      >
        <Icon name="close" />
      </button>
      <div class="as-steps">
        {[1, 2, 3, 4, 5, 6].map((k) => (
          <span class={k < n ? 'on' : k === n ? 'cur' : ''} />
        ))}
      </div>
      <small class="muted">
        {fmt(ta().partOf, { n })} · {ta().parts[st.part === 'verify' ? 'vocab' : st.part]?.[0]}
      </small>
      {max > 0 && <Progress value={progress} max={max} />}
    </div>
  );

  if (st.intro)
    return (
      <div class="page assess">
        {head(0, 0)}
        <PartIntro
          c={c}
          part={st.part}
          onStart={() =>
            update((s) => {
              s.intro = false;
              if (s.part === 'vocab' && !s.yesno.length) {
                s.yesno = buildYesNo(c, bank);
                s.yesnoPos = 0;
              }
            })
          }
          onSkip={
            st.part === 'reading' || st.part === 'listening' || st.part === 'writing'
              ? () =>
                  update((s) => {
                    s.skipped.push(s.part);
                    move(s, NEXT[s.part]);
                  })
              : undefined
          }
        />
      </div>
    );

  // ---- part screens ----
  if (st.part === 'self')
    return (
      <div class="page assess">
        {head(0, 0)}
        <SelfAssess c={c} onDone={(self) => update((s) => ((s.self = self), move(s, 'vocab')))} />
      </div>
    );

  if (st.part === 'vocab') {
    const it = st.yesno[st.yesnoPos];
    if (!it) return <Loading />;
    return (
      <div class="page assess">
        {head(st.yesnoPos, st.yesno.length)}
        <YesNoView
          word={it.w}
          onAnswer={(k) =>
            update((s) => {
              s.yesno[s.yesnoPos].known = k;
              s.yesnoPos++;
              if (s.yesnoPos >= s.yesno.length) {
                s.verify = pickVerify(s).map((x) => ({ id: x, ok: null }));
                move(s, s.verify.length ? 'verify' : 'grammar');
              }
            })
          }
        />
      </div>
    );
  }

  const cur = st.cur;
  if (!cur) return <Loading />;
  const answer = (part: 'grammar' | 'reading' | 'listening' | 'writing', resps: Resp[]) =>
    update((s) => {
      s[part].push(...resps);
      s.cur = undefined;
    });

  if (cur.kind === 'verify') {
    const done = st.verify.filter((v) => v.ok !== null).length;
    return (
      <div class="page assess">
        {head(done, st.verify.length)}
        <div class="ex-kicker">{ta().verifyTitle}</div>
        <p class="muted small">{ta().verifyIntro}</p>
        <div class="prompt">
          <span class="big-word">{cur.w}</span>
          <div class="sub">{ta().verifyQ}</div>
        </div>
        <Choices
          key={cur.id}
          options={cur.options}
          onPick={(o) =>
            update((s) => {
              const v = s.verify.find((x) => x.id === cur.id)!;
              v.ok = o === cur.answer;
              v.dk = o === null;
              s.cur = undefined;
            })
          }
        />
      </div>
    );
  }

  if (cur.kind === 'grammar') {
    const it = cur.item;
    const parts = it.q.split(/_{2,}/);
    return (
      <div class="page assess">
        {head(st.grammar.length, COUNTS.grammar)}
        <div class="ex-kicker">{ta().grammarQ}</div>
        <div class="prompt left">
          <div class="sentence big">
            {parts[0]}
            <span class="blank">_____</span>
            {parts.slice(1).join('_____')}
          </div>
        </div>
        <Choices
          key={it.key}
          options={cur.options}
          target
          onPick={(o) =>
            answer('grammar', [
              { lvl: it.lvl, ok: o === it.answer, dk: o === null, g: 1 / it.options.length, q: it.q, a: it.answer, u: o ?? undefined, topic: it.topic, key: it.key },
            ])
          }
        />
      </div>
    );
  }

  if (cur.kind === 'reading' || cur.kind === 'listening') {
    const it = cur.item;
    const part = cur.kind;
    const done = st[part].filter((r) => r.key.startsWith(part === 'reading' ? 'R:' : 'L:')).length;
    return (
      <div class="page assess">
        {head(part === 'listening' ? done + st.listening.filter((r) => r.key.startsWith('D:')).length : done, part === 'listening' ? COUNTS.listening + COUNTS.dictation : COUNTS.reading)}
        <div class="ex-kicker">{part === 'reading' ? ta().readingQ : ta().listeningQ}</div>
        <div class="prompt left">
          {part === 'reading' ? <div class="sentence big tl-text">{it.t}</div> : <Listen key={it.key} text={it.t} au={it.au} lang={c.meta.tts} />}
        </div>
        <Choices
          key={it.key}
          options={cur.options}
          onPick={(o) => answer(part, [{ lvl: it.lvl, ok: o === it.tr, dk: o === null, g: 0.25, q: it.t, a: it.tr, u: o ?? undefined, key: it.key }])}
        />
      </div>
    );
  }

  if (cur.kind === 'dictation') {
    const it = cur.item;
    const done = st.listening.length;
    return (
      <div class="page assess">
        {head(done, COUNTS.listening + COUNTS.dictation)}
        <div class="ex-kicker">{ta().dictationQ}</div>
        <div class="prompt">
          <Listen key={'D' + it.key} text={it.t} au={it.au} lang={c.meta.tts} />
        </div>
        <TypedAnswer
          key={'D' + it.key}
          lang={c.meta.target}
          multiline
          onSubmit={(v) => {
            const sc = dictationScore(it.t, v);
            answer('listening', [{ lvl: it.lvl, ok: sc >= 0.8, score: sc, g: 0, q: it.t, a: it.t, u: v, key: `D:${it.t}` }]);
          }}
        />
      </div>
    );
  }

  if (cur.kind === 'writing') {
    const it = cur.item;
    const gaps = st.writing.filter((r) => r.key.startsWith('w:')).length;
    return (
      <div class="page assess">
        {head(gaps, COUNTS.writing + COUNTS.ctest)}
        <div class="ex-kicker">{ta().writingQ}</div>
        <div class="prompt left">
          <div class="sentence big">
            {it.before}
            <span class="blank">_____</span>
            {it.after}
          </div>
          {it.hint && <div class="sub">({it.hint})</div>}
          <div class="tr">{it.tr}</div>
        </div>
        <TypedAnswer
          key={it.key}
          lang={c.meta.target}
          onSubmit={(v) => {
            const ok = !!v.trim() && check(v, it.answers, { strictForm: true, strictAccents: getState().settings.strictAccents }).ok;
            answer('writing', [
              { lvl: it.lvl, ok, dk: !v.trim(), g: 0, q: `${it.before}___${it.after}${it.hint ? ` (${it.hint})` : ''}`, a: it.answers[0], u: v || undefined, topic: it.topic, key: it.key },
            ]);
          }}
        />
      </div>
    );
  }

  if (cur.kind === 'ctest') {
    const gaps = st.writing.filter((r) => r.key.startsWith('w:')).length;
    const cts = new Set(st.writing.filter((r) => r.key.startsWith('C:')).map((r) => r.key.split('#')[0])).size;
    return (
      <div class="page assess">
        {head(gaps + cts, COUNTS.writing + COUNTS.ctest)}
        <div class="ex-kicker">{ta().ctestQ}</div>
        <CTest
          key={cur.text}
          parts={cur.parts}
          tr={cur.tr}
          onSubmit={(typed) => {
            const resps: Resp[] = [];
            let k = 0;
            cur.parts.forEach((p) => {
              if (typeof p === 'string') return;
              const v = typed[k] || '';
              const ok = scoreGap(p, v);
              resps.push({ lvl: cur.lvl, ok, dk: !v, g: 0, q: cur.text, a: p.prefix + p.rest, u: p.prefix + v, key: `C:${cur.text}#${k}` });
              k++;
            });
            answer('writing', resps);
          }}
        />
      </div>
    );
  }
  return null;
}

// ---------- pieces ----------

function AssessHome({ c, st, reports, onStart, onResume }: { c: LoadedCourse; st: AState | null; reports: AReport[]; onStart: () => void; onResume: () => void }) {
  const T = ta();
  return (
    <div class="page assess-home">
      <h2>{T.title}</h2>
      <p>{T.lead}</p>
      {st && st.part !== 'done' && (
        <div class="card resume">
          <p>{fmt(T.resumeNote, { n: PART_NO[st.part] })}</p>
          <div class="ex-actions">
            <button class="btn" onClick={onStart}>
              {T.restart}
            </button>
            <button class="btn primary" onClick={onResume}>
              {T.resume}
            </button>
          </div>
        </div>
      )}
      <div class="card">
        <h4>{T.partsTitle}</h4>
        <ol class="parts-list">
          {(['self', 'vocab', 'grammar', 'reading', 'listening', 'writing'] as const).map((p) => (
            <li>
              <b>{T.parts[p][0]}</b> <span class="muted">· {T.parts[p][1]}</span>
              <div class="muted small">{T.parts[p][2]}</div>
            </li>
          ))}
        </ol>
      </div>
      <div class="card">
        <h4>{T.rulesTitle}</h4>
        <ul class="rules">
          {T.rules.map((r) => (
            <li>{r}</li>
          ))}
        </ul>
      </div>
      <div class="ex-actions">
        {!(st && st.part !== 'done') && (
          <button class="btn primary big" onClick={onStart}>
            {T.start}
          </button>
        )}
      </div>
      <p>
        <button
          class="btn ghost"
          onClick={async () => {
            await applyPlacement(c, 0, 'A0', 0, {});
            bump();
            go('/');
          }}
        >
          {T.fromZero}
        </button>
      </p>
      {reports.length > 0 && <History c={c} reports={reports} />}
    </div>
  );
}

function History({ c, reports }: { c: LoadedCourse; reports: AReport[] }) {
  const T = ta();
  return (
    <div class="card">
      <h4>{T.historyTitle}</h4>
      <table class="topic-table">
        {[...reports]
          .map((r, i) => ({ r, i }))
          .reverse()
          .map(({ r, i }) => (
            <tr onClick={() => go(`/assessment/${i}`)}>
              <td>{new Date(r.ts).toLocaleDateString()}</td>
              <td>
                <b>{LEVEL_NAMES[r.overall.level]}</b>
              </td>
              <td class="muted">{r.vocab ? `≈ ${r.vocab.estimate}` : ''}</td>
              <td class="muted">{fmt(T.duration, { m: Math.max(1, Math.round(r.seconds / 60)) })}</td>
            </tr>
          ))}
      </table>
      <small class="muted">{c.meta.title}</small>
    </div>
  );
}

function PartIntro({ c, part, onStart, onSkip }: { c: LoadedCourse; part: PartId; onStart: () => void; onSkip?: () => void }) {
  const T = ta();
  const ex = EX[c.meta.target];
  const info = T.parts[part];
  if (!info) return null;
  return (
    <div class="part-intro">
      <h2>{info[0]}</h2>
      <p>{info[2]}</p>
      {part === 'vocab' && (
        <div class="card example">
          <small class="muted">{T.example}</small>
          <div>
            <b class="tl-text">{ex.real[0]}</b> → {T.know}
          </div>
          <div>
            <b class="tl-text">{ex.fake}</b> → {T.dontKnow} <span class="muted">({T.fakeWord})</span>
          </div>
          <p class="muted small">{T.vocabHelp}</p>
        </div>
      )}
      {part === 'grammar' && (
        <div class="card example">
          <small class="muted">{T.example}</small>
          <div class="tl-text">
            {ex.grammar[0]} → <b>{ex.grammar[1]}</b>
          </div>
        </div>
      )}
      {part === 'reading' && <p class="muted">{T.readingTip}</p>}
      {part === 'listening' && <p class="note">🔊 {T.listeningNote}</p>}
      {part === 'writing' && (
        <div class="card example">
          <small class="muted">{T.example}</small>
          <div class="tl-text">
            {ex.writing[0]} → <b>{ex.writing[1]}</b>
          </div>
          <div class="tl-text">
            {ex.ctest[0]} → <b>{ex.ctest[1]}</b>
          </div>
        </div>
      )}
      <div class="ex-actions">
        {onSkip && (
          <button class="btn ghost" onClick={onSkip}>
            {T.skipPart}
          </button>
        )}
        <button class="btn primary big" onClick={onStart} autoFocus>
          {T.startPart}
        </button>
      </div>
    </div>
  );
}

function SelfAssess({ c, onDone }: { c: LoadedCourse; onDone: (s: AState['self']) => void }) {
  const T = ta();
  const [v, setV] = useState<AState['self']>({});
  const vars = langVars(c);
  const keys = ['listening', 'reading', 'writing'] as const;
  return (
    <div class="self-assess">
      <h2>{T.parts.self[0]}</h2>
      <p class="muted">{T.parts.self[2]}</p>
      {keys.map((k) => (
        <div class="card">
          <h4>{T.selfQ[k]}</h4>
          <div class="radio-list">
            {T.selfA[k].map((txt, i) => (
              <label class={`radio ${v[k] === i ? 'on' : ''}`}>
                <input type="radio" name={k} checked={v[k] === i} onChange={() => setV({ ...v, [k]: i })} />
                <span class="pill">{LEVEL_NAMES[i]}</span> {fmt(txt, vars)}
              </label>
            ))}
          </div>
        </div>
      ))}
      <div class="ex-actions">
        <button class="btn primary big" disabled={keys.some((k) => v[k] === undefined)} onClick={() => onDone(v)}>
          {T.next}
        </button>
      </div>
    </div>
  );
}

function YesNoView({ word, onAnswer }: { word: string; onAnswer: (k: boolean) => void }) {
  const T = ta();
  const busy = useRef(false);
  useEffect(() => {
    busy.current = false;
    const f = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft' || e.key === '1') answer(true);
      else if (e.key === 'ArrowRight' || e.key === '2') answer(false);
    };
    window.addEventListener('keydown', f);
    return () => window.removeEventListener('keydown', f);
  }, [word]);
  const answer = (k: boolean) => {
    if (busy.current) return;
    busy.current = true;
    onAnswer(k);
  };
  return (
    <div class="yesno">
      <div class="ex-kicker">{T.vocabQ}</div>
      <div class="yesno-word tl-text">{word}</div>
      <div class="yesno-btns">
        <button class="btn primary big" onClick={() => answer(true)}>
          {T.know}
        </button>
        <button class="btn big" onClick={() => answer(false)}>
          {T.dontKnow}
        </button>
      </div>
      <p class="muted small center">{T.vocabHelp}</p>
    </div>
  );
}

/** Options without feedback; null = "I don't know". */
function Choices({ options, onPick, target }: { options: string[]; onPick: (o: string | null) => void; target?: boolean }) {
  const T = ta();
  const done = useRef(false);
  const pick = (o: string | null) => {
    if (done.current) return;
    done.current = true;
    onPick(o);
  };
  useEffect(() => {
    const f = (e: KeyboardEvent) => {
      const n = Number(e.key);
      if (n >= 1 && n <= options.length) pick(options[n - 1]);
    };
    window.addEventListener('keydown', f);
    return () => window.removeEventListener('keydown', f);
  }, [options]);
  return (
    <div class="options">
      {options.map((o, i) => (
        <button class={`opt ${target ? 'tl-text' : ''}`} onClick={() => pick(o)}>
          <span class="opt-n">{i + 1}</span>
          {o}
        </button>
      ))}
      <button class="opt dk" onClick={() => pick(null)}>
        {T.dk}
      </button>
    </div>
  );
}

/** Native recording, played automatically, at most three times. */
function Listen({ text, au, lang }: { text: string; au?: number; lang: string }) {
  const T = ta();
  const [left, setLeft] = useState(3);
  const play = () => {
    if (left <= 0) return;
    setLeft((x) => x - 1);
    void say(text, lang, au);
  };
  useEffect(() => {
    const id = setTimeout(play, 300);
    return () => {
      clearTimeout(id);
      stopSpeech();
    };
  }, []);
  return (
    <div class="listen-big center">
      <button class="btn big" disabled={left <= 0} onClick={play}>
        <Icon name="speaker" /> {T.play}
      </button>
      <div class="muted small">{fmt(T.playsLeft, { n: left })}</div>
    </div>
  );
}

function TypedAnswer({ onSubmit, lang, multiline }: { onSubmit: (v: string) => void; lang: string; multiline?: boolean }) {
  const T = ta();
  const [v, setV] = useState('');
  const done = useRef(false);
  const submit = (val: string) => {
    if (done.current) return;
    done.current = true;
    onSubmit(val);
  };
  return (
    <div class="type-box">
      <TargetInput value={v} onInput={setV} onEnter={() => v.trim() && submit(v)} lang={lang} multiline={multiline} placeholder="…" />
      <div class="ex-actions">
        <button class="btn ghost" onClick={() => submit('')}>
          {T.dk}
        </button>
        <button class="btn primary" disabled={!v.trim()} onClick={() => submit(v)}>
          {T.check}
        </button>
      </div>
    </div>
  );
}

function CTest({ parts, tr, onSubmit }: { parts: CPart[]; tr: string; onSubmit: (typed: string[]) => void }) {
  const T = ta();
  const nGaps = parts.filter((p) => typeof p !== 'string').length;
  const [vals, setVals] = useState<string[]>(() => new Array(nGaps).fill(''));
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const done = useRef(false);
  const submit = () => {
    if (done.current) return;
    done.current = true;
    onSubmit(vals);
  };
  let k = -1;
  return (
    <div class="ctest">
      <div class="sentence big tl-text ctest-line">
        {parts.map((p) => {
          if (typeof p === 'string') return <span>{p}</span>;
          k++;
          const i = k;
          const g = p as CGap;
          return (
            <span class="cgap">
              {g.prefix}
              <input
                ref={(el) => {
                  refs.current[i] = el;
                }}
                value={vals[i]}
                size={Math.max(2, g.rest.length + 1)}
                autoComplete="off"
                autoCapitalize="off"
                spellcheck={false}
                autoFocus={i === 0}
                onInput={(e) => {
                  const nv = [...vals];
                  nv[i] = (e.target as HTMLInputElement).value;
                  setVals(nv);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    if (i + 1 < nGaps) refs.current[i + 1]?.focus();
                    else submit();
                  }
                }}
              />
            </span>
          );
        })}
      </div>
      <div class="tr">{tr}</div>
      <div class="ex-actions">
        <button class="btn primary" onClick={submit}>
          {T.check}
        </button>
      </div>
    </div>
  );
}

// ---------- report ----------

export function ReportView({ c, r, fresh, onRetake }: { c: LoadedCourse; r: AReport; fresh?: boolean; onRetake?: () => void }) {
  const T = ta();
  const startUnit = c.units[r.start];
  const lvl = r.overall.level;
  const skills: Skill[] = ['vocab', 'grammar', 'reading', 'listening', 'writing'];
  const [showAll, setShowAll] = useState(false);
  const levelStartIdx = lvl > 0 ? c.units.findIndex((u) => u.level === LV[lvl - 1]) : 0;
  const apply = async (idx: number) => {
    await applyPlacement(c, idx, LEVEL_NAMES[lvl], r.vocab?.estimate || 0, Object.fromEntries(skills.filter((s) => r.skills[s]).map((s) => [s, Math.round(r.skills[s]!.theta * 100) / 100])));
    bump();
    go('/');
  };
  // each level takes an equal sixth of the bar (A0 … C1)
  const pos = (theta: number) => {
    const { idx, frac } = levelOf(theta);
    return Math.max(0, Math.min(100, ((idx + frac) / 6) * 100));
  };
  return (
    <div class="page report">
      {!fresh && (
        <a href="#/placement" class="muted">
          ← {T.title}
        </a>
      )}
      <h2>{T.reportTitle}</h2>
      <p class="muted small">
        {new Date(r.ts).toLocaleString()} · {fmt(T.duration, { m: Math.max(1, Math.round(r.seconds / 60)) })}
      </p>

      <div class="card overall">
        <small class="muted">{T.overall}</small>
        <div class="big-level">{LEVEL_NAMES[lvl]}</div>
        {lvl > 0 && lvl < 5 && <small class="muted">{fmt(T.ofLevel, { p: Math.round(r.overall.frac * 100), level: LEVEL_NAMES[lvl] })}</small>}
        <p>{T.levelDesc[lvl]}</p>
      </div>

      <div class="card">
        <h4>{T.skillsTitle}</h4>
        <div class="scale-head">
          {LEVEL_NAMES.map((L) => (
            <span>{L}</span>
          ))}
        </div>
        {skills.map((k) => {
          const s = r.skills[k];
          return (
            <div class="skill-row">
              <span class="skill-name">{T.skillNames[k]}</span>
              {s ? (
                <div class="scale">
                  <div class="scale-fill" style={{ width: `${pos(s.theta)}%` }} />
                  {s.self !== undefined && <i class="self-mark" style={{ left: `${((s.self + 0.5) / 6) * 100}%` }} title={T.selfMark} />}
                </div>
              ) : (
                <div class="scale empty">
                  <small class="muted">{T.notTested}</small>
                </div>
              )}
              <b class="skill-level">{s ? LEVEL_NAMES[s.level] : '—'}</b>
            </div>
          );
        })}
        <small class="muted">
          <i class="self-mark inline" /> — {T.selfMark}
        </small>
      </div>

      {r.vocab && (
        <div class="card">
          <h4>{T.vocabTitle}</h4>
          <div class="big-num">{fmt(T.vocabSize, { n: r.vocab.estimate.toLocaleString() })}</div>
          <p class="muted small">{fmt(T.vocabRange, { a: r.vocab.low.toLocaleString(), b: r.vocab.high.toLocaleString() })}</p>
          {r.vocab.bands.map((b) => (
            <div class="level-row wide">
              <span>{fmt(T.bandRow, { a: b.from, b: b.to })}</span>
              <div class="progress">
                <div style={{ width: `${b.known * 100}%` }} />
              </div>
              <span>{Math.round(b.known * 100)}%</span>
            </div>
          ))}
          <p class="small">
            {fmt(T.fakeWords, { a: r.vocab.falseAlarms, b: r.vocab.pseudoN })} {r.vocab.pseudoN && r.vocab.falseAlarms / r.vocab.pseudoN > 0.2 ? T.fakeWarn : ''}
            {r.vocab.verify.asked > 0 && <> {fmt(T.verifyRes, { a: r.vocab.verify.ok, b: r.vocab.verify.asked })}</>}
          </p>
        </div>
      )}

      <div class="card">
        <h4>{T.byLevelTitle}</h4>
        <table class="level-table">
          <tr>
            <th />
            {LV.map((L) => (
              <th>{L}</th>
            ))}
          </tr>
          {(['grammar', 'reading', 'listening', 'writing'] as Skill[])
            .filter((k) => r.skills[k])
            .map((k) => (
              <tr>
                <td>{T.skillNames[k]}</td>
                {r.skills[k]!.byLevel.map((x) => {
                  const p = x.n ? x.right / x.n : null;
                  return <td class={p === null ? 'muted' : p >= 0.7 ? 'ok' : p >= 0.4 ? 'mid' : 'bad'}>{x.n ? `${Math.round(x.right * 10) / 10}/${x.n}` : '·'}</td>;
                })}
              </tr>
            ))}
        </table>
      </div>

      {(r.weakTopics.length > 0 || r.strongTopics.length > 0) && (
        <div class="card">
          <h4>{T.grammarTitle}</h4>
          {r.weakTopics.length > 0 && (
            <>
              <b class="small">{T.weakTitle}</b>
              <div class="topic-list">
                {r.weakTopics.slice(0, 10).map((x) => (
                  <a class="topic-link" href={`#/topic/${x.id}`}>
                    {topicTitle(c, x.id)} <span class="muted">
                      {x.n - x.wrong}/{x.n}
                    </span>
                  </a>
                ))}
              </div>
            </>
          )}
          {r.strongTopics.length > 0 && (
            <>
              <b class="small">{T.strongTitle}</b>
              <div class="chips">
                {r.strongTopics.slice(0, 16).map((id) => (
                  <span class="chip">✓ {topicTitle(c, id)}</span>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {r.mistakes.length > 0 && (
        <div class="card">
          <h4>
            {T.mistakesTitle} ({r.mistakes.length})
          </h4>
          <ul class="mistakes">
            {(showAll ? r.mistakes : r.mistakes.slice(0, 8)).map((m) => (
              <li>
                <span class="pill">{LV[m.lvl]}</span> <span class="tl-text">{m.part === 'reading' || m.part === 'listening' ? m.q : m.q.replace(/_{2,}/, '___')}</span>
                <div class="small">
                  <span class="ok">
                    {T.rightAnswer}: <b>{m.a}</b>
                  </span>
                  {m.u && (
                    <span class="bad">
                      {' '}
                      · {T.yourAnswer}: {m.u}
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
          {r.mistakes.length > 8 && !showAll && (
            <button class="btn small" onClick={() => setShowAll(true)}>
              {t().showMore}
            </button>
          )}
        </div>
      )}

      {startUnit && (
        <div class="card start">
          <h4>{T.startTitle}</h4>
          <h3>
            <span class="pill">{startUnit.level}</span> {fmt(T.startAt, { n: startUnit.n, title: startUnit.title })}
          </h3>
          <p class="muted small">{T.startNote}</p>
          <div class="ex-actions wrap">
            {levelStartIdx >= 0 && levelStartIdx < r.start && (
              <button class="btn" onClick={() => void apply(levelStartIdx)}>
                {T.applyLevelStart}
              </button>
            )}
            <button class="btn primary" onClick={() => void apply(r.start)}>
              {T.apply}
            </button>
          </div>
        </div>
      )}

      <div class="card method">
        <h4>{T.methodTitle}</h4>
        {T.method.map((p) => (
          <p class="small">{p}</p>
        ))}
      </div>

      <div class="ex-actions">
        {onRetake && (
          <button class="btn" onClick={onRetake}>
            {T.retake}
          </button>
        )}
        <button class="btn" onClick={() => go('/')}>
          {T.later}
        </button>
      </div>
    </div>
  );
}

export function AssessmentReportPage({ c, index }: { c: LoadedCourse; index: number }) {
  const [list, setList] = useState<AReport[] | null>(null);
  useEffect(() => {
    void getAssessments<AReport>(c.meta.id).then(setList);
  }, [c]);
  if (!list) return <Loading />;
  const r = list[index] || list[list.length - 1];
  if (!r) return <div class="page">—</div>;
  return <ReportView c={c} r={r} onRetake={() => go('/placement')} />;
}

export { levelOf };
