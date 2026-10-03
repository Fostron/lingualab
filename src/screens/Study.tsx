import { useEffect, useState } from 'preact/hooks';
import { sample, shuffle } from '../answer';
import { buildLesson, buildReview, buildUnitTest, conjExercise, sentenceExercise, wordExercise, type Ex, type ExOpts } from '../exercises';
import { fmt, t } from '../i18n';
import { finishLesson, finishUnitTest, loadProgress, wordsLeft, type ProgressInfo } from '../progress';
import { go } from '../router';
import { Rating, review } from '../srs';
import { bump, getState } from '../store';
import { bestVoice } from '../tts';
import type { LoadedCourse, Word } from '../types';
import { Loading } from '../ui/common';
import { SessionDone, SessionRunner, type SessionItem, type SessionSummary } from './Session';

function exOpts(): ExOpts {
  const s = getState();
  return { typingOnly: s.settings.typingOnly, hasVoice: !!bestVoice(s.course!.meta.tts) };
}

function useProgress(c: LoadedCourse) {
  const [info, setInfo] = useState<ProgressInfo | null>(null);
  useEffect(() => {
    void loadProgress(c).then(setInfo);
  }, [c]);
  return info;
}

/** Learn: introduce the next words of a unit with practice, grammar and sentences. */
export function Learn({ c, unitId, force }: { c: LoadedCourse; unitId: string; force?: boolean }) {
  const info = useProgress(c);
  const [plan, setPlan] = useState<{ items: SessionItem[]; words: Word[]; results: Map<string, boolean> } | null>(null);
  const [summary, setSummary] = useState<SessionSummary | null>(null);
  const unit = c.unitById.get(unitId);

  useEffect(() => {
    if (!info || !unit || plan) return;
    const st = getState().settings;
    const left = wordsLeft(c, unit, info);
    const budget = Math.max(0, st.newPerDay - info.newToday);
    const n = Math.min(st.wordsPerLesson, left.length, force ? Infinity : budget);
    const words = left.slice(0, n);
    const exs = buildLesson(c, unit, words, info.known, exOpts());
    // conjugation for new verbs once some tense is unlocked
    const tenses = [...new Set([...info.tenses, ...unit.topics.flatMap((id) => c.topicById.get(id)?.tenses || [])])];
    for (const w of words.filter((x) => x.pos === 'verb')) {
      const e = conjExercise(c, w.w, tenses);
      if (e) exs.push(e);
    }
    const results = new Map<string, boolean>();
    const items: SessionItem[] = exs.map((ex) => ({
      ex,
      onResult: (r, override) => {
        const cid = 'cid' in ex ? ex.cid : undefined;
        if (!cid) return;
        if (override) results.set(cid, true);
        else results.set(cid, (results.get(cid) ?? true) && r.ok);
      },
    }));
    setPlan({ items, words, results });
  }, [info]);

  if (!unit) return <div class="page">?</div>;
  if (!info || !plan) return <Loading />;
  if (summary)
    return (
      <SessionDone
        title={t().lessonDone}
        summary={summary}
        extra={
          plan.words.length > 0 && (
            <div class="card">
              <b>
                {t().learnedWords}: {plan.words.length}
              </b>
              <div class="chips">
                {plan.words.map((w) => (
                  <span class="chip">{w.w}</span>
                ))}
              </div>
            </div>
          )
        }
        actions={
          <>
            <button class="btn" onClick={() => go(`/unit/${unit.id}`)}>
              {t().unit} {unit.n}
            </button>
            <button class="btn primary" onClick={() => go('/')}>
              {t().continue}
            </button>
          </>
        }
      />
    );
  if (!plan.items.length)
    return (
      <div class="page">
        <p>{info.newToday >= getState().settings.newPerDay && wordsLeft(c, unit, info).length ? t().dailyGoalDone : t().allUnitWordsLearned}</p>
        <div class="ex-actions">
          {wordsLeft(c, unit, info).length > 0 && (
            <button class="btn" onClick={() => go(`/learn/${unit.id}/more`)}>
              {t().learnAnyway}
            </button>
          )}
          <button class="btn" onClick={() => go(`/unit/${unit.id}`)}>
            {t().back}
          </button>
          <button class="btn primary" onClick={() => go(`/test/${unit.id}`)}>
            {t().takeTest}
          </button>
        </div>
      </div>
    );
  return (
    <SessionRunner
      items={plan.items}
      exitTo={`/unit/${unit.id}`}
      onComplete={async (s) => {
        await finishLesson(
          c,
          unit,
          plan.words.map((w) => w.id),
          plan.results,
        );
        bump();
        setSummary(s);
      }}
    />
  );
}

/** Review: due cards → exercises; each first answer is graded into FSRS immediately. */
export function Review({ c }: { c: LoadedCourse }) {
  const info = useProgress(c);
  const [items, setItems] = useState<SessionItem[] | null>(null);
  const [summary, setSummary] = useState<SessionSummary | null>(null);
  useEffect(() => {
    if (!info || items) return;
    const due = info.due.slice(0, 60);
    const planned = buildReview(c, due, exOpts(), info.known, info.tenses.length ? info.tenses : ['pres']);
    setItems(
      planned.map(({ ex, card }) => ({
        ex,
        onResult: (r, override) => {
          const rating = r.ok ? (r.verdict === 'typo' ? Rating.Hard : Rating.Good) : Rating.Again;
          // overriding a wrong verdict re-grades the card
          void review(c.meta.id, card.cid, override ? Rating.Good : rating, r.ok, ex.k);
        },
      })),
    );
  }, [info]);
  if (!info || !items) return <Loading />;
  if (summary)
    return (
      <SessionDone
        title={t().reviewDone}
        summary={summary}
        actions={
          <button
            class="btn primary"
            onClick={() => {
              bump();
              go('/');
            }}
          >
            {t().continue}
          </button>
        }
      />
    );
  if (!items.length)
    return (
      <div class="page center">
        <p>{t().nothingDue}</p>
        <button class="btn primary" onClick={() => go('/')}>
          {t().home}
        </button>
      </div>
    );
  return <SessionRunner items={items} exitTo="/" onComplete={(s) => setSummary(s)} />;
}

export function UnitTest({ c, unitId }: { c: LoadedCourse; unitId: string }) {
  const unit = c.unitById.get(unitId);
  const [items] = useState<SessionItem[]>(() => (unit ? buildUnitTest(c, unit, exOpts()).map((ex) => ({ ex })) : []));
  const [started, setStarted] = useState(false);
  const [summary, setSummary] = useState<SessionSummary | null>(null);
  if (!unit) return null;
  if (!started)
    return (
      <div class="page">
        <h2>
          {t().unitTest}: {unit.title}
        </h2>
        <p>{t().unitTestIntro}</p>
        <p class="muted">
          {items.length} {t().questions}
        </p>
        <div class="ex-actions">
          <button class="btn" onClick={() => go(`/unit/${unit.id}`)}>
            {t().back}
          </button>
          <button class="btn primary" onClick={() => setStarted(true)}>
            {t().start}
          </button>
        </div>
      </div>
    );
  if (summary) {
    const pass = summary.correct / Math.max(1, summary.total) >= 0.8;
    return (
      <SessionDone
        title={pass ? t().unitTestPassed : t().unitTestFailed}
        summary={summary}
        actions={
          <>
            <button class="btn" onClick={() => go(`/unit/${unit.id}`)}>
              {t().unit} {unit.n}
            </button>
            <button class="btn primary" onClick={() => go('/')}>
              {t().continue}
            </button>
          </>
        }
      />
    );
  }
  return (
    <SessionRunner
      items={items}
      requeue={false}
      exitTo={`/unit/${unit.id}`}
      onComplete={async (s) => {
        await finishUnitTest(c, unit, s.correct / Math.max(1, s.total));
        bump();
        setSummary(s);
      }}
    />
  );
}

/** Free practice modes (do not touch the schedule, except "weak" which grades cards). */
export function Practice({ c, kind }: { c: LoadedCourse; kind: string }) {
  const info = useProgress(c);
  const [items, setItems] = useState<SessionItem[] | null>(null);
  const [summary, setSummary] = useState<SessionSummary | null>(null);
  useEffect(() => {
    if (!info || items) return;
    const o = exOpts();
    const known = info.known.size ? info.known : new Set(c.units[0].words);
    const reached = c.units.slice(0, info.currentIndex + 1);
    const sentPool = reached.flatMap((u) => u.sents).map((id) => c.sents.get(id)!).filter(Boolean);
    let exs: Ex[] = [];
    if (kind === 'listening') {
      const pool = sentPool.filter((s) => s.tk.every(([, w]) => !w || known.has(w)));
      exs = sample(pool.length ? pool : sentPool, 12).map((s) => ({ k: 'dictation', sent: s }) as Ex);
    } else if (kind === 'reading') {
      exs = sample(sentPool, 12).map((s) => sentenceExercise(c, s, { ...o, hasVoice: false }, known));
    } else if (kind === 'conj') {
      const verbs = [...known].map((id) => c.wordById.get(id)!).filter((w) => w && w.pos === 'verb' && c.conj[w.w]);
      const tenses = info.tenses.length ? info.tenses : ['pres'];
      for (const v of sample(verbs, 15)) {
        const e = conjExercise(c, v.w, tenses);
        if (e) exs.push({ ...e, cid: undefined } as Ex);
      }
    } else if (kind === 'weak') {
      const weak = info.cards
        .filter((x) => (x.kind === 'wp' || x.kind === 'wr') && x.lapses > 0)
        .sort((a, b) => b.lapses - a.lapses || a.stability - b.stability)
        .slice(0, 15);
      const planned = buildReview(c, weak, o, known, info.tenses);
      setItems(
        planned.map(({ ex, card }) => ({
          ex,
          onResult: (r) => {
            if (!r.ok) void review(c.meta.id, card.cid, Rating.Again, false, 'practice');
          },
        })),
      );
      return;
    } else {
      const words = [...info.learned].map((id) => c.wordById.get(id)!).filter(Boolean);
      exs = shuffle([
        ...sample(words, 8).map((w) => ({ ...wordExercise(c, w, 'wp', 2, o, known), cid: undefined }) as Ex),
        ...sample(sentPool, 6).map((s) => sentenceExercise(c, s, o, known)),
      ]);
    }
    setItems(exs.map((ex) => ({ ex })));
  }, [info]);
  if (!info || !items) return <Loading />;
  if (summary)
    return (
      <SessionDone
        title={t().practice}
        summary={summary}
        actions={
          <button class="btn primary" onClick={() => go('/practice')}>
            {t().continue}
          </button>
        }
      />
    );
  if (!items.length)
    return (
      <div class="page center">
        <p>{t().noResults}</p>
        <button class="btn" onClick={() => go('/practice')}>
          {t().back}
        </button>
      </div>
    );
  return <SessionRunner items={items} exitTo="/practice" onComplete={setSummary} />;
}

export function wordsLeftLabel(n: number) {
  return fmt(t().unitWordsLeft, { n });
}
