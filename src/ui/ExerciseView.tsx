import { useEffect, useRef, useState } from 'preact/hooks';
import { check, diff, normalize, stripAccents, type Verdict } from '../answer';
import { displayWord, genderTag, sentText } from '../content';
import { sectionFor, sectionForDrill, sectionsOf, type Ex } from '../exercises';
import { fmt, t } from '../i18n';
import { getState } from '../store';
import { say, sayWord, speak } from '../tts';
import type { Sentence, Topic } from '../types';
import { Markdown, SentenceView, SpeakBtn, TargetInput, tl } from './common';

export interface ExResult {
  ok: boolean;
  verdict: Verdict | 'choice' | 'self';
  given?: string;
  hinted?: boolean; // answered right after revealing part of the answer
}

interface Props {
  ex: Ex;
  onResult: (r: ExResult, override?: boolean) => void;
  onNext: () => void;
  /** show the hint button (off in tests) */
  hints?: boolean;
  /** test mode: no right/wrong after answering, go straight on */
  exam?: boolean;
  /** shown when coming back to a question already answered */
  prevAnswer?: string;
}

let hintsOn = true;

export function ExerciseView({ ex, onResult, onNext, hints = true, exam = false, prevAnswer }: Props) {
  const [res, setRes] = useState<ExResult | null>(null);
  const [overridden, setOverridden] = useState(false);
  const [why, setWhy] = useState(false);
  hintsOn = hints;
  if (import.meta.env.DEV) (window as any).__ex = ex; // lets automated checks see the current exercise
  const c = getState().course!;
  const st = getState().settings;
  const lang = c.meta.tts;

  const answer = (r: ExResult) => {
    if (res) return;
    setRes(r);
    onResult(r);
    if (exam) onNext();
  };

  // global Enter -> next when answered
  useEffect(() => {
    if ((!res || exam) && ex.k !== 'intro' && ex.k !== 'teach') return;
    const f = (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        onNext();
      }
    };
    const id = setTimeout(() => window.addEventListener('keydown', f), 50);
    return () => {
      clearTimeout(id);
      window.removeEventListener('keydown', f);
    };
  }, [res, ex]);

  // in a test the options must not light up green/red
  const body = renderBody(ex, exam ? null : res, answer);
  const correctText = correctTextOf(ex);
  const sentOf = 'sent' in ex && ex.sent ? (ex.sent as Sentence) : undefined;

  // after answering, speak the target answer
  useEffect(() => {
    if (!res || !st.autoplay || exam) return;
    if (ex.k === 'mcq' && (ex.mode === 't2n' || ex.mode === 'listen' || ex.mode === 'sent')) return;
    const word = (ex.k === 'mcq' || ex.k === 'type') && !sentOf ? ex.word : undefined;
    if (word) {
      void sayWord(word.w, lang, word.wa);
      return;
    }
    const text = sentOf ? sentText(sentOf) : ex.k === 'drill' ? ex.drill.q.replace(/_{2,}/, ex.drill.a[0]) : correctText;
    if (text) void say(text, lang, sentOf?.au);
  }, [res]);

  if (ex.k === 'intro' || ex.k === 'teach')
    return (
      <div class="ex">
        {body}
        <div class="ex-actions">
          <button class="btn primary" onClick={onNext}>
            {ex.k === 'teach' && ex.step && ex.step[0] < ex.step[1] ? t().next : t().gotIt}
          </button>
        </div>
      </div>
    );
  const rule = ruleOf(ex);

  return (
    <div class="ex">
      {prevAnswer !== undefined && <div class="prev-answer">{fmt(t().yourPrevAnswer, { a: prevAnswer || t().noAnswer })}</div>}
      {body}
      {res && !exam && (
        <div class={`feedback ${res.ok || overridden ? 'ok' : 'bad'}`}>
          <div class="fb-title">
            {overridden
              ? t().correct
              : res.ok
                ? res.hinted
                  ? t().correctWithHint
                  : res.verdict === 'typo'
                    ? t().almost
                    : res.verdict === 'accent'
                      ? `${t().correct} ${t().accentNote}`
                      : t().correct
                : res.verdict === 'partial'
                  ? t().partialArticle
                  : res.verdict === 'accent'
                    ? `${t().wrong}. ${t().accentNote}`
                    : t().wrong}
          </div>
          {(!res.ok || res.verdict === 'typo' || res.verdict === 'accent' || res.verdict === 'partial') && correctText && (
            <div class="fb-answer">
              <span class="label">{t().correctAnswer}:</span> <b>{correctText}</b> <SpeakBtn text={correctText} small />
              {res.given && res.verdict !== 'choice' && (
                <div class="diff">
                  {diff(res.given, correctText).map((p) => (
                    <span class={`d-${p.kind}`}>{p.text}</span>
                  ))}
                </div>
              )}
            </div>
          )}
          {sentOf && (
            <div class="fb-sent">
              <div>
                <SentenceView s={sentOf} /> <SpeakBtn text={sentText(sentOf)} audio={sentOf.au} small />
              </div>
              <div class="tr">{sentOf.tr}</div>
            </div>
          )}
          {(ex.k === 'mcq' || ex.k === 'type') && <WordMini w={ex.word} />}
          {why && rule && <RuleSheet {...rule} />}
          <div class="ex-actions">
            {rule && !why && (!res.ok || res.hinted) && (
              <button class="btn ghost" onClick={() => setWhy(true)}>
                {t().why}
              </button>
            )}
            {!res.ok && !overridden && res.given && res.verdict !== 'choice' && (
              <button
                class="btn ghost"
                onClick={() => {
                  setOverridden(true);
                  onResult({ ok: true, verdict: 'self', given: res.given }, true);
                }}
              >
                {t().iWasRight}
              </button>
            )}
            <button class="btn primary" onClick={onNext} autoFocus>
              {t().next}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function WordMini({ w }: { w: Extract<Ex, { k: 'mcq' }>['word'] }) {
  const c = getState().course!;
  return (
    <div class="word-mini">
      <b>{displayWord(w, c.meta.target)}</b> {genderTag(w)} — {w.tr}
      {w.ipa && <span class="ipa"> {w.ipa}</span>}
      {w.note && <div class="muted small">{w.note}</div>}
    </div>
  );
}

/** The grammar behind an exercise: the matching part of the topic's explanation, or the verb table. */
function ruleOf(ex: Ex): { topic?: Topic; answer: string; verb?: string; tense?: string; sec?: number } | null {
  const c = getState().course!;
  if (ex.k === 'drill') return { topic: ex.topic, answer: ex.drill.a[0], sec: sectionForDrill(ex.topic, ex.drill) };
  if (ex.k === 'cloze' && !ex.word) {
    const tp = ex.topic || (ex.cid?.startsWith('g:') ? c.topicById.get(ex.cid.slice(2)) : undefined);
    return tp ? { topic: tp, answer: ex.answers[0] } : null;
  }
  if (ex.k === 'conj') return { topic: ex.topic, answer: ex.answers[0], verb: ex.verb, tense: ex.tense };
  return null;
}

function RuleSheet({ topic, answer, verb, tense, sec: secIdx }: { topic?: Topic; answer: string; verb?: string; tense?: string; sec?: number }) {
  const c = getState().course!;
  const forms = verb && tense ? c.conj[verb]?.[tense] : undefined;
  const secs = topic ? sectionsOf(topic) : [];
  const i = secIdx !== undefined && secIdx >= 0 ? secIdx : topic ? sectionFor(topic, answer) : -1;
  const sec = secs[i >= 0 ? i : 0];
  return (
    <div class="rule-sheet">
      {forms && (
        <table class="conj-mini">
          {forms.map((f, k) =>
            f ? (
              <tr>
                <td class="muted">{c.meta.persons[k]}</td>
                <td>
                  <b>{f.replace(/\//g, ' / ')}</b>
                </td>
              </tr>
            ) : null,
          )}
        </table>
      )}
      {topic && sec && (
        <>
          <b>{sec.title || topic.title}</b>
          <Markdown md={sec.md} />
          <a href={`#/topic/${topic.id}`} target="_blank" rel="noopener">
            {t().fullRule}: {topic.title} ↗
          </a>
        </>
      )}
    </div>
  );
}

function correctTextOf(ex: Ex): string {
  const c = getState().course!;
  switch (ex.k) {
    case 'mcq':
      return ex.mode === 'n2t' ? displayWord(ex.word, c.meta.target) : ex.options[ex.answer];
    case 'type':
      return ex.answers[0];
    case 'cloze':
      return ex.answers[0];
    case 'build':
    case 'translate':
    case 'dictation':
      return sentText(ex.sent);
    case 'read':
      return ex.options[ex.answer];
    case 'drill':
      return ex.drill.t === 'choice' ? ex.drill.a[0] : ex.drill.a[0];
    case 'conj':
      return ex.answers[0];
    default:
      return '';
  }
}

function useAutoSayWord(w: { w: string; wa?: string } | undefined, deps: unknown[] = []) {
  const c = getState().course!;
  const st = getState().settings;
  useEffect(() => {
    if (w && st.autoplay) {
      const id = setTimeout(() => void sayWord(w.w, c.meta.tts, w.wa), 150);
      return () => clearTimeout(id);
    }
  }, deps);
}

function useAutoSay(text: string | undefined, audio?: number, deps: unknown[] = []) {
  const c = getState().course!;
  const st = getState().settings;
  useEffect(() => {
    if (text && st.autoplay) {
      const id = setTimeout(() => void say(text, c.meta.tts, audio), 150);
      return () => clearTimeout(id);
    }
  }, deps);
}

function renderBody(ex: Ex, res: ExResult | null, answer: (r: ExResult) => void) {
  switch (ex.k) {
    case 'intro':
      return <Intro ex={ex} />;
    case 'teach':
      return <Teach ex={ex} />;
    case 'mcq':
      return <Mcq ex={ex} res={res} answer={answer} />;
    case 'type':
      return <TypeWord ex={ex} res={res} answer={answer} />;
    case 'cloze':
      return <Cloze ex={ex} res={res} answer={answer} />;
    case 'build':
      return <Build ex={ex} res={res} answer={answer} />;
    case 'translate':
      return <Translate ex={ex} res={res} answer={answer} />;
    case 'dictation':
      return <Dictation ex={ex} res={res} answer={answer} />;
    case 'read':
      return <Read ex={ex} res={res} answer={answer} />;
    case 'drill':
      return <DrillView ex={ex} res={res} answer={answer} />;
    case 'conj':
      return <Conj ex={ex} res={res} answer={answer} />;
  }
}

type P<K extends Ex['k']> = { ex: Extract<Ex, { k: K }>; res: ExResult | null; answer: (r: ExResult) => void };

function Intro({ ex }: { ex: Extract<Ex, { k: 'intro' }> }) {
  const c = getState().course!;
  const w = ex.word;
  const target = c.meta.target;
  useAutoSayWord(w, [w.id]);
  const exs = (w.ex || []).map((id) => c.sents.get(id)).filter(Boolean).slice(0, 2) as Sentence[];
  return (
    <div class="intro">
      <div class="ex-kicker">{t().newWord}</div>
      <div class="intro-word">
        <span class="big-word" {...tl()}>{displayWord(w, target)}</span>
        <SpeakBtn text={w.w} wa={w.wa} />
        <SpeakBtn text={w.w} slow />
      </div>
      <div class="intro-meta">
        {t().pos[w.pos] || w.pos}
        {w.g && ` · ${t().gender[w.g]}`}
        {w.ipa && <span class="ipa"> · {w.ipa}</span>}
      </div>
      <div class="intro-tr">{w.tr}</div>
      {(w.pl || w.fem) && (
        <div class="intro-forms">
          {w.fem && (
            <span>
              {t().feminine}: <b>{w.fem}</b>{' '}
            </span>
          )}
          {w.pl && (
            <span>
              {t().plural}: <b>{w.pl}</b>
            </span>
          )}
        </div>
      )}
      {w.note && <div class="intro-note">{w.note}</div>}
      {exs.length > 0 && (
        <div class="intro-ex">
          {exs.map((s) => (
            <div class="ex-sent">
              <SpeakBtn text={sentText(s)} audio={s.au} small /> <SentenceView s={s} highlight={s.tk.findIndex(([, id]) => id === w.id)} />
              <div class="tr">{s.tr}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Teach({ ex }: { ex: Extract<Ex, { k: 'teach' }> }) {
  return (
    <div class="teach">
      <div class="ex-kicker">
        {ex.sents ? t().examples : ex.topic ? t().rule : t().remember}
        {ex.step && (
          <span class="muted">
            {' '}
            · {ex.step[0]}/{ex.step[1]}
          </span>
        )}
        {ex.topic && <span class="topic-tag">{ex.topic.title}</span>}
      </div>
      {ex.title && <h3 class="teach-title">{ex.title}</h3>}
      {ex.md && <Markdown md={ex.md} />}
      {ex.sents && (
        <div class="sent-list">
          {ex.sents.map((s) => (
            <div class="ex-sent">
              <SpeakBtn text={sentText(s)} audio={s.au} small /> <SentenceView s={s} />
              <div class="tr">{s.tr}</div>
            </div>
          ))}
        </div>
      )}
      {ex.md && ex.topic && <p class="muted small">{t().tapToHear}</p>}
    </div>
  );
}

function Options({
  options,
  answerIdx,
  res,
  onPick,
  target,
  speakAs,
}: {
  options: string[];
  answerIdx: number;
  res: ExResult | null;
  onPick: (i: number) => void;
  target?: boolean;
  /** after answering, a speaker next to each option says this text (e.g. the sentence with that option) */
  speakAs?: (o: string) => string;
}) {
  const [picked, setPicked] = useState<number | null>(null);
  useEffect(() => {
    const f = (e: KeyboardEvent) => {
      if (res) return;
      const n = Number(e.key);
      if (n >= 1 && n <= options.length) {
        setPicked(n - 1);
        onPick(n - 1);
      }
    };
    window.addEventListener('keydown', f);
    return () => window.removeEventListener('keydown', f);
  }, [res, options]);
  return (
    <div class="options">
      {options.map((o, i) => (
        <div class="opt-row">
          <button
            class={`opt ${res ? (i === answerIdx ? 'right' : i === picked ? 'wrong' : 'dim') : ''} ${target ? 'tl-text' : ''}`}
            disabled={!!res}
            onClick={() => {
              setPicked(i);
              onPick(i);
            }}
          >
            <span class="opt-n">{i + 1}</span>
            {o}
          </button>
          {res && speakAs && <SpeakBtn text={speakAs(o)} small />}
        </div>
      ))}
    </div>
  );
}

function Mcq({ ex, res, answer }: P<'mcq'>) {
  const c = getState().course!;
  const target = c.meta.target;
  const w = ex.word;
  useAutoSay(ex.mode === 'sent' && ex.sent ? sentText(ex.sent) : undefined, ex.sent?.au, [ex]);
  useAutoSayWord(ex.mode === 't2n' || ex.mode === 'listen' ? w : undefined, [ex]);
  const onPick = (i: number) => answer({ ok: i === ex.answer, verdict: 'choice', given: ex.options[i] });
  return (
    <div>
      <div class="ex-kicker">
        {ex.mode === 'listen' ? t().listenChoose : ex.mode === 'n2t' ? fmt(t().chooseWord, { lang: t().langTo[target] }) : t().chooseTranslation}
      </div>
      <div class="prompt">
        {ex.mode === 't2n' && (
          <>
            <span class="big-word" {...tl()}>{displayWord(w, target)}</span> <SpeakBtn text={w.w} wa={w.wa} />
          </>
        )}
        {ex.mode === 'listen' && (
          <div class="listen-big">
            <SpeakBtn text={w.w} wa={w.wa} /> <SpeakBtn text={w.w} slow />
          </div>
        )}
        {ex.mode === 'n2t' && (
          <>
            <span class="big-native">{w.tr}</span>
            <div class="sub">{t().pos[w.pos]}</div>
          </>
        )}
        {ex.mode === 'sent' && ex.sent && (
          <div>
            <SentenceView s={ex.sent} highlight={ex.sent.tk.findIndex(([, id]) => id === w.id)} big /> <SpeakBtn text={sentText(ex.sent)} audio={ex.sent.au} small />
            <div class="sub">
              <b>{w.w}</b> = ?
            </div>
          </div>
        )}
      </div>
      <Options options={ex.options} answerIdx={ex.answer} res={res} onPick={onPick} target={ex.mode === 'n2t'} speakAs={ex.mode === 'n2t' ? (o) => o : undefined} />
    </div>
  );
}

/** Reveal the answer gradually: letter by letter for a word, word by word for a sentence. */
function hintPrefix(answer: string, step: number) {
  if (/\s/.test(answer.trim())) {
    const ws = answer.trim().split(/\s+/);
    return ws.slice(0, Math.min(step, ws.length - 1)).join(' ') + ' ';
  }
  return answer.slice(0, Math.min(step, Math.max(1, answer.length - 1)));
}

function TypeBox({
  res,
  onSubmit,
  placeholder,
  lang,
  dontKnow = true,
  hint,
  onChange,
}: {
  res: ExResult | null;
  onSubmit: (v: string, hinted: boolean) => void;
  placeholder: string;
  lang?: string;
  dontKnow?: boolean;
  hint?: string;
  onChange?: (v: string) => void;
}) {
  const [v, setValue] = useState('');
  const setV = (x: string) => {
    setValue(x);
    onChange?.(x);
  };
  const [hints, setHints] = useState(0);
  const submitted = useRef(false);
  const submit = () => {
    if (res || submitted.current || !v.trim()) return;
    submitted.current = true;
    onSubmit(v, hints > 0);
  };
  const canHint = !!hint && hintsOn && getState().settings.hints && !res;
  return (
    <div class="type-box">
      <TargetInput value={v} onInput={setV} onEnter={submit} placeholder={placeholder} disabled={!!res} lang={lang} />
      {!res && (
        <div class="ex-actions">
          {canHint && (
            <button
              class="btn ghost"
              title={t().hintTitle}
              onClick={() => {
                const n = hints + 1;
                setHints(n);
                setV(hintPrefix(hint!, n));
              }}
            >
              {t().hint}
            </button>
          )}
          {dontKnow && (
            <button
              class="btn ghost"
              onClick={() => {
                if (submitted.current) return;
                submitted.current = true;
                onSubmit('', false);
              }}
            >
              {t().dontKnow}
            </button>
          )}
          <button class="btn primary" disabled={!v.trim()} onClick={submit}>
            {t().check}
          </button>
        </div>
      )}
    </div>
  );
}

function TypeWord({ ex, res, answer }: P<'type'>) {
  const c = getState().course!;
  const st = getState().settings;
  const target = c.meta.target;
  const w = ex.word;
  useAutoSayWord(ex.mode === 'listen' ? w : undefined, [ex]);
  return (
    <div>
      <div class="ex-kicker">{ex.mode === 'listen' ? t().listenWrite : fmt(t().writeWord, { lang: t().langName[target] })}</div>
      <div class="prompt">
        {ex.mode === 'n2t' ? (
          <>
            <span class="big-native">{w.tr}</span>
            <div class="sub">
              {t().pos[w.pos]}
              {w.pos === 'noun' ? ` · ${target === 'es' ? 'el/la …' : 'le/la/l’ …'}` : ''}
            </div>
          </>
        ) : (
          <div class="listen-big">
            <SpeakBtn text={w.w} wa={w.wa} /> <SpeakBtn text={w.w} slow />
          </div>
        )}
      </div>
      <TypeBox
        res={res}
        lang={target}
        placeholder={fmt(t().typeHere, { lang: t().langName[target] })}
        hint={ex.answers[0]}
        onSubmit={(v, hinted) => {
          const answers = ex.mode === 'listen' ? [w.w, ...ex.answers] : ex.answers;
          const r = check(v, answers, { strictAccents: st.strictAccents, partial: ex.partial });
          answer({ ok: r.ok, verdict: r.verdict, given: v, hinted });
        }}
      />
    </div>
  );
}

/** The sentence with `word` in the gap (a pause when empty). */
function clozeText(ex: Extract<Ex, { k: 'cloze' }>, word: string) {
  return ex.sent.tk
    .map(([w, , sp], i) => (i === ex.i ? word || '…' : i > ex.i && i < ex.i + ex.n ? '' : w) + (sp ? ' ' : ''))
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
}

function Cloze({ ex, res, answer }: P<'cloze'>) {
  const c = getState().course!;
  const st = getState().settings;
  const done = useRef(false);
  const [typed, setTyped] = useState('');
  const submit = (val: string, hinted = false) => {
    if (done.current || res) return;
    done.current = true;
    if (ex.options) {
      // a picked option is either the right one or not: no typo/accent tolerance (había vs habría, el vs él)
      answer({ ok: ex.answers.some((a) => normalize(a) === normalize(val)), verdict: 'choice', given: val });
      return;
    }
    const r = check(val, ex.answers, { strictAccents: st.strictAccents, strictForm: !ex.word });
    answer({ ok: r.ok, verdict: r.verdict, given: val, hinted });
  };
  const blankContent = res ? <b class={res.ok ? 'ok' : 'bad'}>{ex.answers[0]}</b> : ex.options ? '_____' : <span class="blank-hint">{ex.hint ? `(${ex.hint})` : '_____'}</span>;
  return (
    <div>
      <div class="ex-kicker">{ex.options ? t().chooseGap : t().fillGap}</div>
      <div class="prompt left">
        <SentenceView s={ex.sent} blank={[ex.i, ex.n]} blankContent={blankContent} big />{' '}
        {res ? <SpeakBtn text={sentText(ex.sent)} audio={ex.sent.au} small /> : <SpeakBtn text={clozeText(ex, typed.trim())} small />}
        <div class="tr">{ex.sent.tr}</div>
        {ex.hint && !res && <div class="sub">({ex.hint})</div>}
      </div>
      {ex.options ? (
        <Options
          options={ex.options}
          answerIdx={ex.options.findIndex((o) => ex.answers.some((a) => normalize(o) === normalize(a)))}
          res={res}
          onPick={(i) => submit(ex.options![i])}
          target
          speakAs={(o) => clozeText(ex, o)}
        />
      ) : (
        <TypeBox res={res} lang={c.meta.target} placeholder="…" hint={ex.answers[0]} onChange={setTyped} onSubmit={(val, hinted) => submit(val, hinted)} />
      )}
    </div>
  );
}

function Build({ ex, res, answer }: P<'build'>) {
  const [picked, setPicked] = useState<number[]>([]);
  const built = picked.map((i) => ex.tiles[i]).join(' ');
  const submit = () => {
    const ok = stripAccents(normalize(built)) === stripAccents(normalize(ex.answer));
    answer({ ok, verdict: ok ? 'exact' : 'wrong', given: built });
  };
  return (
    <div>
      <div class="ex-kicker">{t().buildSentence}</div>
      <div class="prompt">
        <span class="big-native">{ex.sent.tr}</span>
      </div>
      <div class="build-line">
        {picked.map((i, j) => (
          <button class="tile" disabled={!!res} onClick={() => setPicked(picked.filter((_, k) => k !== j))}>
            {ex.tiles[i]}
          </button>
        ))}
      </div>
      <div class="tiles">
        {ex.tiles.map((w, i) => (
          <button class={`tile ${picked.includes(i) ? 'used' : ''}`} disabled={!!res || picked.includes(i)} onClick={() => setPicked([...picked, i])}>
            {w}
          </button>
        ))}
      </div>
      {!res && (
        <div class="ex-actions">
          <button class="btn primary" disabled={picked.length !== ex.tiles.length} onClick={submit}>
            {t().check}
          </button>
        </div>
      )}
    </div>
  );
}

function Translate({ ex, res, answer }: P<'translate'>) {
  const c = getState().course!;
  const st = getState().settings;
  const target = c.meta.target;
  const ref = sentText(ex.sent);
  return (
    <div>
      <div class="ex-kicker">{fmt(t().translateTo, { lang: t().langTo[target] })}</div>
      <div class="prompt">
        <span class="big-native">{ex.sent.tr}</span>
      </div>
      <TypeBox
        res={res}
        lang={target}
        placeholder={fmt(t().typeHere, { lang: t().langName[target] })}
        hint={ref}
        onSubmit={(v, hinted) => {
          const r = check(v, [ref], { strictAccents: st.strictAccents });
          answer({ ok: r.ok, verdict: r.verdict, given: v, hinted });
        }}
      />
    </div>
  );
}

function Dictation({ ex, res, answer }: P<'dictation'>) {
  const c = getState().course!;
  const st = getState().settings;
  const ref = sentText(ex.sent);
  useAutoSay(ref, ex.sent.au, [ex]);
  return (
    <div>
      <div class="ex-kicker">{t().listenWrite}</div>
      <div class="prompt">
        <div class="listen-big">
          <SpeakBtn text={ref} audio={ex.sent.au} /> <SpeakBtn text={ref} slow />
        </div>
      </div>
      <TypeBox
        res={res}
        lang={c.meta.target}
        placeholder={fmt(t().typeHere, { lang: t().langName[c.meta.target] })}
        hint={ref}
        onSubmit={(v, hinted) => {
          const r = check(v, [ref], { strictAccents: st.strictAccents });
          answer({ ok: r.ok, verdict: r.verdict, given: v, hinted });
        }}
      />
    </div>
  );
}

function Read({ ex, res, answer }: P<'read'>) {
  useAutoSay(sentText(ex.sent), ex.sent.au, [ex]);
  return (
    <div>
      <div class="ex-kicker">{t().translateFrom}</div>
      <div class="prompt left">
        <SentenceView s={ex.sent} big /> <SpeakBtn text={sentText(ex.sent)} audio={ex.sent.au} small />
        <div class="sub">{t().tapWord}</div>
      </div>
      <Options options={ex.options} answerIdx={ex.answer} res={res} onPick={(i) => answer({ ok: i === ex.answer, verdict: 'choice', given: ex.options[i] })} />
    </div>
  );
}

function DrillView({ ex, res, answer }: P<'drill'>) {
  const c = getState().course!;
  const st = getState().settings;
  const d = ex.drill;
  const [opts] = useState(() => (d.o ? [...d.o].sort(() => Math.random() - 0.5) : []));
  const parts = d.q.split(/_{2,}/);
  const kicker = d.t === 'choice' ? t().chooseGap : d.t === 'transform' ? t().transform : t().fillGap;
  const filled = res ? d.a[0] : null;
  const [typed, setTyped] = useState('');
  const gap = parts.length > 1;
  const fill = (w: string) => (gap ? d.q.replace(/_{2,}/, w) : w);
  // before answering: the sentence with what's typed (or a pause); after: with the right answer
  const speakText = res ? fill(d.a[0]) : typed.trim() ? fill(typed.trim()) : gap ? d.q.replace(/_{2,}/, '…') : d.q;
  return (
    <div>
      <div class="ex-kicker">
        {kicker} <span class="topic-tag">{ex.topic.title}</span>
      </div>
      <div class="prompt left">
        {d.h && <div class="sub hint">{d.h}</div>}
        <div class="sentence big" {...tl()}>
          {parts.length > 1 ? (
            <>
              {parts[0]}
              <span class="blank">{filled ? <b class={res!.ok ? 'ok' : 'bad'}>{filled}</b> : '_____'}</span>
              {parts.slice(1).join('_____')}
            </>
          ) : (
            d.q
          )}{' '}
          {/\p{L}/u.test(speakText) && <SpeakBtn text={speakText} small />}
        </div>
      </div>
      {d.t === 'choice' ? (
        <Options
          options={opts}
          answerIdx={opts.findIndex((o) => normalize(o) === normalize(d.a[0]))}
          res={res}
          onPick={(i) => answer({ ok: d.a.some((a) => normalize(a) === normalize(opts[i])), verdict: 'choice', given: opts[i] })}
          target
          speakAs={fill}
        />
      ) : (
        <TypeBox
          res={res}
          lang={c.meta.target}
          placeholder="…"
          hint={d.a[0]}
          onChange={setTyped}
          onSubmit={(v, hinted) => {
            const r = check(v, d.a, { strictAccents: st.strictAccents, strictForm: true });
            answer({ ok: r.ok, verdict: r.verdict, given: v, hinted });
          }}
        />
      )}
    </div>
  );
}

function Conj({ ex, res, answer }: P<'conj'>) {
  const c = getState().course!;
  const st = getState().settings;
  return (
    <div>
      <div class="ex-kicker">{t().conjugate}</div>
      <div class="prompt">
        <span class="big-word" {...tl()}>{ex.verb}</span> <SpeakBtn text={ex.verb} small />
        <div class="conj-prompt">
          <span class="pill">{c.meta.tenseNames[ex.tense] || ex.tense}</span>
          <span class="pill strong">{c.meta.persons[ex.person]}</span>
        </div>
      </div>
      <TypeBox
        res={res}
        lang={c.meta.target}
        placeholder="…"
        hint={ex.answers[0]}
        onSubmit={(v, hinted) => {
          const r = check(v, ex.answers, { strictAccents: st.strictAccents, strictForm: true });
          answer({ ok: r.ok, verdict: r.verdict, given: v, hinted });
        }}
      />
    </div>
  );
}

export function sayTarget(text: string) {
  const c = getState().course;
  if (c) void speak(text, c.meta.tts);
}
