import { useEffect, useMemo, useState } from 'preact/hooks';
import { exFromKey, retryFor, type Ex } from '../exercises';
import { fmt, t } from '../i18n';
import { dismissMistake, flush, getMistakes, isFixed, lastSeen, shown, type Mistake } from '../mistakes';
import { loadLogs, loadProgress, resolveDiff } from '../progress';
import { go } from '../router';
import { Rating, review } from '../srs';
import { getState } from '../store';
import type { LoadedCourse } from '../types';
import { ExplainBlock } from '../ui/ExerciseView';
import { Loading, tl } from '../ui/common';
import { SessionDone, SessionRunner, type SessionItem, type SessionSummary } from './Session';
import { exLabel } from './Study';

const PRACTICE_SIZE = 15;

function kindLabel(c: LoadedCourse, m: Mistake) {
  const T = t();
  const topic = m.topic ? c.topicById.get(m.topic)?.title : undefined;
  const base = m.kind === 'word' ? T.mkWord : m.kind === 'verb' ? T.mkVerb : m.kind === 'sentence' ? T.mkSentence : T.mkGrammar;
  return topic && m.kind !== 'word' ? `${base} · ${topic}` : base;
}

/** The questions to practise first: missed most often, then most recently. */
function practiceOrder(list: Mistake[]) {
  return list.filter((m) => shown(m) && !isFixed(m)).sort((a, b) => b.n - a.n || b.last - a.last);
}

export function MistakesPage({ c, tick }: { c: LoadedCourse; tick: number }) {
  const [list, setList] = useState<Mistake[] | null>(null);
  const [tab, setTab] = useState<'open' | 'fixed'>('open');
  const [why, setWhy] = useState<string | null>(null);
  const reload = () => void flush().then(() => getMistakes(c.meta.id).then((l) => setList(l.filter(shown))));
  useEffect(reload, [c, tick]);
  const ex = useMemo(() => {
    const m = why && list?.find((x) => x.id === why);
    return m ? exFromKey(c, m.id, { typingOnly: false, hasVoice: true }) : null;
  }, [why, list]);
  if (!list) return <Loading />;
  const open = list.filter((m) => !isFixed(m));
  const fixed = list.filter(isFixed);
  const rows = tab === 'open' ? open : fixed;
  const T = t();
  return (
    <div class="page notebook">
      <a href="#/practice" class="muted">
        ← {T.practice}
      </a>
      <h2>📒 {T.mkTitle}</h2>
      <p class="muted">{T.mkLead}</p>
      {open.length > 0 && (
        <div class="ex-actions">
          <a class="btn primary big" href="#/mistakes/practice">
            {fmt(T.mkPractice, { n: Math.min(open.length, PRACTICE_SIZE) })}
          </a>
        </div>
      )}
      <div class="tabs">
        <button class={tab === 'open' ? 'on' : ''} onClick={() => setTab('open')}>
          {T.mkOpen} · {open.length}
        </button>
        <button class={tab === 'fixed' ? 'on' : ''} onClick={() => setTab('fixed')}>
          {T.mkFixed} · {fixed.length}
        </button>
      </div>
      {!rows.length && <p class="muted">{tab === 'open' ? (list.length ? T.mkAllFixed : T.mkEmpty) : T.mkNoneFixed}</p>}
      {rows.map((m) => (
        <div class="card mk">
          <div class="row-between">
            <span class="pill">{kindLabel(c, m)}</span>
            <small class="muted">
              {m.n > 1 && `×${m.n} · `}
              {lastSeen(m.last)}
            </small>
          </div>
          <div class="mk-q">{m.q}</div>
          {m.given && (
            <div class="mk-line bad">
              ✗ <s {...tl()}>{m.given}</s>
            </div>
          )}
          <div class="mk-line ok">
            ✓ <b {...tl()}>{m.right}</b>
          </div>
          {!isFixed(m) && m.streak > 0 && <small class="muted">{fmt(T.mkStreak, { n: m.streak })}</small>}
          <div class="ex-actions wrap">
            <button class="btn small" onClick={() => setWhy(why === m.id ? null : m.id)}>
              {T.why}
            </button>
            {!isFixed(m) && (
              <button class="btn small ghost" onClick={() => void dismissMistake(c.meta.id, m.id).then(reload)}>
                {T.mkDismiss}
              </button>
            )}
          </div>
          {why === m.id && (ex ? <Why ex={ex} given={m.given} /> : <p class="muted small">{T.mkGone}</p>)}
        </div>
      ))}
    </div>
  );
}

function Why({ ex, given }: { ex: Ex; given: string }) {
  return <ExplainBlock ex={ex} given={given} ok={false} fallback={t().mkNoWhy} />;
}

/** A session made of the notebook's open mistakes; right answers count towards fixing them. */
export function MistakesPractice({ c }: { c: LoadedCourse }) {
  const [items, setItems] = useState<SessionItem[] | null>(null);
  const [summary, setSummary] = useState<SessionSummary | null>(null);
  useEffect(() => {
    void (async () => {
      await flush();
      const [list, info, logs] = await Promise.all([getMistakes(c.meta.id), loadProgress(c), loadLogs(c)]);
      const o = { typingOnly: getState().settings.typingOnly, hasVoice: true, diff: resolveDiff(getState().settings.difficulty, logs) };
      const out: SessionItem[] = [];
      for (const m of practiceOrder(list)) {
        const ex = exFromKey(c, m.id, o, info.known);
        if (!ex) continue;
        out.push({
          ex,
          // words and grammar points it belongs to are graded as in "weak spots"
          onResult: (r, override) => {
            const cid = 'cid' in ex ? ex.cid : undefined;
            if (cid) void review(c.meta.id, cid, override || r.ok ? (r.hinted ? Rating.Hard : Rating.Good) : Rating.Again, r.ok || override, exLabel(ex));
          },
        });
        if (out.length >= PRACTICE_SIZE) break;
      }
      setItems(out);
    })();
  }, [c]);
  if (!items) return <Loading />;
  if (summary)
    return (
      <SessionDone
        title={t().mkTitle}
        summary={summary}
        actions={
          <button class="btn primary" onClick={() => go('/mistakes')}>
            {t().continue}
          </button>
        }
      />
    );
  if (!items.length)
    return (
      <div class="page center">
        <p>{t().mkAllFixed}</p>
        <div class="ex-actions center">
          <button class="btn" onClick={() => go('/mistakes')}>
            {t().back}
          </button>
        </div>
      </div>
    );
  return <SessionRunner items={items} retry={(ex, a) => retryFor(c, ex, a)} quit="practice" exitTo="/mistakes" onComplete={setSummary} />;
}

export function mistakesRoute(c: LoadedCourse, sub: string | undefined, tick: number) {
  return sub === 'practice' ? <MistakesPractice c={c} /> : <MistakesPage c={c} tick={tick} />;
}
