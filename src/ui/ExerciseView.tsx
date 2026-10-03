import { useEffect, useRef, useState } from 'preact/hooks';
import { check, diff, normalize, stripAccents, type Verdict } from '../answer';
import { displayWord, genderTag, sentText } from '../content';
import type { Ex } from '../exercises';
import { fmt, t } from '../i18n';
import { getState } from '../store';
import { say, speak } from '../tts';
import type { Sentence } from '../types';
import { SentenceView, SpeakBtn, TargetInput } from './common';

export interface ExResult {
  ok: boolean;
  verdict: Verdict | 'choice' | 'self';
  given?: string;
}

interface Props {
  ex: Ex;
  onResult: (r: ExResult, override?: boolean) => void;
  onNext: () => void;
}

export function ExerciseView({ ex, onResult, onNext }: Props) {
  const [res, setRes] = useState<ExResult | null>(null);
  const [overridden, setOverridden] = useState(false);
  const c = getState().course!;
  const st = getState().settings;
  const lang = c.meta.tts;

  const answer = (r: ExResult) => {
    if (res) return;
    setRes(r);
    onResult(r);
  };

  // global Enter -> next when answered
  useEffect(() => {
    if (!res && ex.k !== 'intro') return;
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

  const body = renderBody(ex, res, answer);
  const correctText = correctTextOf(ex);
  const sentOf = 'sent' in ex && ex.sent ? (ex.sent as Sentence) : undefined;

  // after answering, speak the target answer
  useEffect(() => {
    if (!res || !st.autoplay) return;
    if (ex.k === 'mcq' && (ex.mode === 't2n' || ex.mode === 'listen' || ex.mode === 'sent')) return;
    const text = sentOf ? sentText(sentOf) : ex.k === 'drill' ? ex.drill.q.replace(/_{2,}/, ex.drill.a[0]) : correctText;
    if (text) void say(text, lang, sentOf?.au);
  }, [res]);

  if (ex.k === 'intro') return <div class="ex">{body}<div class="ex-actions"><button class="btn primary" onClick={onNext}>{t().gotIt}</button></div></div>;

  return (
    <div class="ex">
      {body}
      {res && (
        <div class={`feedback ${res.ok || overridden ? 'ok' : 'bad'}`}>
          <div class="fb-title">
            {overridden ? t().correct : res.ok ? (res.verdict === 'typo' ? t().almost : res.verdict === 'accent' ? `${t().correct} ${t().accentNote}` : t().correct) : res.verdict === 'partial' ? t().partialArticle : t().wrong}
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
          {ex.k === 'mcq' && <WordMini ex={ex} />}
          <div class="ex-actions">
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

function WordMini({ ex }: { ex: Extract<Ex, { k: 'mcq' }> }) {
  const c = getState().course!;
  const w = ex.word;
  return (
    <div class="word-mini">
      <b>{displayWord(w, c.meta.target)}</b> {genderTag(w)} — {w.tr}
      {w.ipa && <span class="ipa"> {w.ipa}</span>}
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
  useAutoSay(w.w, undefined, [w.id]);
  const exs = (w.ex || []).map((id) => c.sents.get(id)).filter(Boolean).slice(0, 2) as Sentence[];
  return (
    <div class="intro">
      <div class="ex-kicker">{t().newWord}</div>
      <div class="intro-word">
        <span class="big-word">{displayWord(w, target)}</span>
        <SpeakBtn text={w.w} />
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

function Options({ options, answerIdx, res, onPick, target }: { options: string[]; answerIdx: number; res: ExResult | null; onPick: (i: number) => void; target?: boolean }) {
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
      ))}
    </div>
  );
}

function Mcq({ ex, res, answer }: P<'mcq'>) {
  const c = getState().course!;
  const target = c.meta.target;
  const w = ex.word;
  const sayText = ex.mode === 'sent' && ex.sent ? sentText(ex.sent) : w.w;
  useAutoSay(ex.mode === 'n2t' ? undefined : sayText, ex.sent?.au, [ex]);
  const onPick = (i: number) => answer({ ok: i === ex.answer, verdict: 'choice' });
  return (
    <div>
      <div class="ex-kicker">
        {ex.mode === 'listen' ? t().listenChoose : ex.mode === 'n2t' ? fmt(t().chooseWord, { lang: t().langTo[target] }) : t().chooseTranslation}
      </div>
      <div class="prompt">
        {ex.mode === 't2n' && (
          <>
            <span class="big-word">{displayWord(w, target)}</span> <SpeakBtn text={w.w} />
          </>
        )}
        {ex.mode === 'listen' && (
          <div class="listen-big">
            <SpeakBtn text={w.w} /> <SpeakBtn text={w.w} slow />
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
      <Options options={ex.options} answerIdx={ex.answer} res={res} onPick={onPick} target={ex.mode === 'n2t'} />
    </div>
  );
}

function TypeBox({ res, onSubmit, placeholder, lang, dontKnow = true }: { res: ExResult | null; onSubmit: (v: string) => void; placeholder: string; lang?: string; dontKnow?: boolean }) {
  const [v, setV] = useState('');
  const submitted = useRef(false);
  const submit = () => {
    if (res || submitted.current || !v.trim()) return;
    submitted.current = true;
    onSubmit(v);
  };
  return (
    <div class="type-box">
      <TargetInput value={v} onInput={setV} onEnter={submit} placeholder={placeholder} disabled={!!res} lang={lang} />
      {!res && (
        <div class="ex-actions">
          {dontKnow && (
            <button
              class="btn ghost"
              onClick={() => {
                if (submitted.current) return;
                submitted.current = true;
                onSubmit('');
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
  useAutoSay(ex.mode === 'listen' ? w.w : undefined, undefined, [ex]);
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
            <SpeakBtn text={w.w} /> <SpeakBtn text={w.w} slow />
          </div>
        )}
      </div>
      <TypeBox
        res={res}
        lang={target}
        placeholder={fmt(t().typeHere, { lang: t().langName[target] })}
        onSubmit={(v) => {
          const answers = ex.mode === 'listen' ? [w.w, ...ex.answers] : ex.answers;
          const r = check(v, answers, { strictAccents: st.strictAccents, partial: ex.partial });
          answer({ ok: r.ok, verdict: r.verdict, given: v });
        }}
      />
    </div>
  );
}

function Cloze({ ex, res, answer }: P<'cloze'>) {
  const c = getState().course!;
  const st = getState().settings;
  const [v, setV] = useState('');
  const done = useRef(false);
  const submit = (val: string) => {
    if (done.current || res) return;
    done.current = true;
    const r = check(val, ex.answers, { strictAccents: st.strictAccents });
    answer({ ok: r.ok, verdict: ex.options ? 'choice' : r.verdict, given: val });
  };
  const blankContent = res ? <b class={res.ok ? 'ok' : 'bad'}>{ex.answers[0]}</b> : ex.options ? '_____' : <span class="blank-hint">{ex.hint ? `(${ex.hint})` : '_____'}</span>;
  return (
    <div>
      <div class="ex-kicker">{ex.options ? t().chooseGap : t().fillGap}</div>
      <div class="prompt left">
        <SentenceView s={ex.sent} blank={[ex.i, ex.n]} blankContent={blankContent} big />
        <div class="tr">{ex.sent.tr}</div>
        {ex.hint && !res && <div class="sub">({ex.hint})</div>}
      </div>
      {ex.options ? (
        <Options
          options={ex.options}
          answerIdx={ex.options.findIndex((o) => normalize(o) === normalize(ex.answers[0]))}
          res={res}
          onPick={(i) => submit(ex.options![i])}
          target
        />
      ) : (
        <div class="type-box">
          <TargetInput value={v} onInput={setV} onEnter={() => v.trim() && submit(v)} disabled={!!res} lang={c.meta.target} placeholder="…" />
          {!res && (
            <div class="ex-actions">
              <button class="btn ghost" onClick={() => submit('')}>
                {t().dontKnow}
              </button>
              <button class="btn primary" disabled={!v.trim()} onClick={() => submit(v)}>
                {t().check}
              </button>
            </div>
          )}
        </div>
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
        onSubmit={(v) => {
          const r = check(v, [ref], { strictAccents: st.strictAccents });
          answer({ ok: r.ok, verdict: r.verdict, given: v });
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
        onSubmit={(v) => {
          const r = check(v, [ref], { strictAccents: st.strictAccents });
          answer({ ok: r.ok, verdict: r.verdict, given: v });
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
      <Options options={ex.options} answerIdx={ex.answer} res={res} onPick={(i) => answer({ ok: i === ex.answer, verdict: 'choice' })} />
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
  return (
    <div>
      <div class="ex-kicker">
        {kicker} <span class="topic-tag">{ex.topic.title}</span>
      </div>
      <div class="prompt left">
        {d.h && <div class="sub hint">{d.h}</div>}
        <div class="sentence big">
          {parts.length > 1 ? (
            <>
              {parts[0]}
              <span class="blank">{filled ? <b class={res!.ok ? 'ok' : 'bad'}>{filled}</b> : '_____'}</span>
              {parts.slice(1).join('_____')}
            </>
          ) : (
            d.q
          )}{' '}
          <SpeakBtn text={d.q.replace(/_{2,}/, '…')} small />
        </div>
      </div>
      {d.t === 'choice' ? (
        <Options
          options={opts}
          answerIdx={opts.findIndex((o) => normalize(o) === normalize(d.a[0]))}
          res={res}
          onPick={(i) => answer({ ok: d.a.some((a) => normalize(a) === normalize(opts[i])), verdict: 'choice' })}
          target
        />
      ) : (
        <TypeBox
          res={res}
          lang={c.meta.target}
          placeholder="…"
          onSubmit={(v) => {
            const r = check(v, d.a, { strictAccents: st.strictAccents });
            answer({ ok: r.ok, verdict: r.verdict, given: v });
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
        <span class="big-word">{ex.verb}</span> <SpeakBtn text={ex.verb} small />
        <div class="conj-prompt">
          <span class="pill">{c.meta.tenseNames[ex.tense] || ex.tense}</span>
          <span class="pill strong">{c.meta.persons[ex.person]}</span>
        </div>
      </div>
      <TypeBox
        res={res}
        lang={c.meta.target}
        placeholder="…"
        onSubmit={(v) => {
          const r = check(v, ex.answers, { strictAccents: st.strictAccents });
          answer({ ok: r.ok, verdict: r.verdict, given: v });
        }}
      />
    </div>
  );
}

export function sayTarget(text: string) {
  const c = getState().course;
  if (c) void speak(text, c.meta.tts);
}
