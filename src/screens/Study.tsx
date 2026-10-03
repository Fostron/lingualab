import { useEffect, useState } from 'preact/hooks';
import { sample, shuffle } from '../answer';
import type { LogRec } from '../db';
import {
  buildDrillLesson,
  buildExam,
  buildReview,
  buildReviewLesson,
  buildRuleLesson,
  buildUnitTest,
  buildWordsLesson,
  conjExercise,
  retryFor,
  sentenceExercise,
  topicExercise,
  wordExercise,
  type Diff,
  type Ex,
  type ExOpts,
} from '../exercises';
import { fmt, t } from '../i18n';
import { lessonBySlug, lessonPassed, lessonsOf, lessonUnlocked, nextLesson, PASS, unitUnlocked, type Lesson } from '../lessons';
import { finishLessonRun, loadLogs, loadProgress, resolveDiff, weakTopics, weakWords, type Answer, type ProgressInfo } from '../progress';
import { go } from '../router';
import { Rating, review } from '../srs';
import { bump, getState } from '../store';
import { bestVoice } from '../tts';
import type { LoadedCourse } from '../types';
import { Loading } from '../ui/common';
import { SessionDone, SessionRunner, type SessionItem, type SessionSummary } from './Session';

function exOpts(diff: Diff = 'normal'): ExOpts {
  const s = getState();
  return { typingOnly: s.settings.typingOnly, hasVoice: !!bestVoice(s.course!.meta.tts), diff };
}

function useProgress(c: LoadedCourse) {
  const [data, setData] = useState<{ info: ProgressInfo; logs: LogRec[] } | null>(null);
  useEffect(() => {
    void Promise.all([loadProgress(c), loadLogs(c)]).then(([info, logs]) => setData({ info, logs }));
  }, [c]);
  return data;
}

/** Label of an exercise for statistics: "type-listen", "drill-gap", "dictation"… */
export function exLabel(ex: Ex) {
  if (ex.k === 'mcq' || ex.k === 'type') return `${ex.k}-${ex.mode}`;
  if (ex.k === 'drill') return `drill-${ex.drill.t}`;
  if (ex.k === 'cloze') return ex.word ? 'cloze-word' : 'cloze';
  return ex.k;
}

export function lessonTitle(c: LoadedCourse, l: Lesson): string {
  switch (l.kind) {
    case 'words': {
      const ws = l.words.map((id) => c.wordById.get(id)?.w).filter(Boolean) as string[];
      return `${t().lessonWords}: ${ws.slice(0, 3).join(', ')}${ws.length > 3 ? '…' : ''}`;
    }
    case 'rule':
      return `${t().lessonRule}: ${l.topic?.title}`;
    case 'drill':
      return `${t().lessonDrill}: ${l.topic?.title}`;
    case 'review':
      return t().lessonReview;
    case 'test':
      return t().unitTest;
    case 'exam':
      return fmt(t().levelExam, { level: l.unit.level });
  }
}

function lessonAbout(c: LoadedCourse, l: Lesson): string {
  switch (l.kind) {
    case 'words':
      return fmt(t().aboutWords, { n: l.words.length });
    case 'rule':
      return t().aboutRule;
    case 'drill':
      return t().aboutDrill;
    case 'review':
      return t().aboutReview;
    case 'test':
      return t().unitTestIntro;
    case 'exam':
      return fmt(t().aboutExam, { level: l.unit.level });
  }
}

/** One lesson of a unit: plan → exercises → result (passed opens the next lesson). */
export function LessonRun({ c, unitId, slug }: { c: LoadedCourse; unitId: string; slug: string }) {
  const data = useProgress(c);
  const unit = c.unitById.get(unitId);
  const lesson = unit ? lessonBySlug(c, unit, slug) : undefined;
  const [plan, setPlan] = useState<{ items: SessionItem[]; answers: Answer[]; diff: Diff } | null>(null);
  const [started, setStarted] = useState(false);
  const [summary, setSummary] = useState<SessionSummary | null>(null);
  const [outcome, setOutcome] = useState<{ passed: boolean; unitDone: boolean } | null>(null);
  const [after, setAfter] = useState<ProgressInfo | null>(null);

  useEffect(() => {
    if (!data || !unit || !lesson || plan) return;
    const { info, logs } = data;
    const diff = resolveDiff(getState().settings.difficulty, logs);
    const o = exOpts(diff);
    const unitKnown = new Set([...info.known]);
    let exs: Ex[] = [];
    if (lesson.kind === 'words') {
      const words = lesson.words.map((id) => c.wordById.get(id)!).filter(Boolean);
      const idx = c.units.indexOf(unit);
      const earlierIds = [...unit.words, ...(c.units[idx - 1]?.words || [])].filter((id) => info.learned.has(id) && !lesson.words.includes(id));
      const earlier = earlierIds.map((id) => c.wordById.get(id)!).filter(Boolean);
      exs = buildWordsLesson(c, words, earlier, info.known, o);
      if (info.tenses.length)
        for (const w of words.filter((x) => x.pos === 'verb')) {
          const e = conjExercise(c, w.w, info.tenses);
          if (e) exs.push(e);
        }
    } else if (lesson.kind === 'rule' && lesson.topic) exs = buildRuleLesson(c, lesson.topic);
    else if (lesson.kind === 'drill' && lesson.topic) {
      for (const id of unit.words) unitKnown.add(id);
      exs = buildDrillLesson(c, lesson.topic, unitKnown, o);
    } else if (lesson.kind === 'review') {
      for (const id of unit.words) unitKnown.add(id);
      exs = buildReviewLesson(c, unit, unitKnown, o);
    } else if (lesson.kind === 'test') exs = buildUnitTest(c, unit, o);
    else if (lesson.kind === 'exam') exs = buildExam(c, c.units.filter((u) => u.level === unit.level), o);
    const answers: Answer[] = [];
    const items: SessionItem[] = exs.map((ex) => ({
      ex,
      onResult: (r, override) => {
        const cid = 'cid' in ex ? ex.cid : undefined;
        if (override) {
          const a = answers[answers.length - 1];
          if (a) a.score = 1;
        } else answers.push({ cid, ex: exLabel(ex), score: r.ok ? (r.hinted ? 0.5 : 1) : 0 });
      },
    }));
    setPlan({ items, answers, diff });
  }, [data]);

  if (!unit || !lesson) return <div class="page">?</div>;
  if (!data || !plan) return <Loading />;
  const { info } = data;
  const rec = info.units.get(unit.id);
  const open = lessonUnlocked(c, lesson, unitUnlocked(c, c.units.indexOf(unit), info.units), rec);
  const strict = lesson.kind === 'test' || lesson.kind === 'exam';

  if (!open)
    return (
      <div class="page center">
        <p class="lock-note">🔒 {t().lessonLocked}</p>
        <div class="ex-actions center">
          <button class="btn" onClick={() => go(`/unit/${unit.id}`)}>
            {t().unit} {unit.n}
          </button>
          {info.next && (
            <button class="btn primary" onClick={() => go(`/lesson/${info.next!.unit.id}/${info.next!.slug}`)}>
              {t().continueWhere}
            </button>
          )}
        </div>
      </div>
    );

  if (summary && outcome) {
    const nl = after ? after.next : null;
    const passedBefore = lessonPassed(lesson, rec);
    return (
      <SessionDone
        title={outcome.unitDone ? t().unitTestPassed : outcome.passed ? t().lessonDone : t().notYet}
        summary={summary}
        pass={PASS[lesson.kind]}
        extra={
          <>
            {lesson.kind === 'words' && outcome.passed && (
              <div class="card">
                <b>
                  {t().learnedWords}: {lesson.words.length}
                </b>
                <div class="chips">
                  {lesson.words.map((id) => (
                    <span class="chip">{c.wordById.get(id)?.w}</span>
                  ))}
                </div>
              </div>
            )}
            {!outcome.passed && <p class="muted">{passedBefore ? t().alreadyPassed : t().repeatAdvice}</p>}
          </>
        }
        actions={
          <>
            <button class="btn" onClick={() => go(`/unit/${unit.id}`)}>
              {t().unit} {unit.n}
            </button>
            {!outcome.passed && (
              <button class="btn primary" onClick={() => go(`/lesson/${unit.id}/${lesson.slug}/again-${Date.now()}`)}>
                {t().repeatLesson}
              </button>
            )}
            {outcome.passed && nl && (
              <button class="btn primary" onClick={() => go(`/lesson/${nl.unit.id}/${nl.slug}`)}>
                {t().nextLesson}
              </button>
            )}
            {outcome.passed && !nl && (
              <button class="btn primary" onClick={() => go('/')}>
                {t().continue}
              </button>
            )}
          </>
        }
      />
    );
  }

  if (!started) {
    const lessons = lessonsOf(c, unit);
    return (
      <div class="page lesson-start">
        <a href={`#/unit/${unit.id}`} class="muted">
          ← {t().unit} {unit.n}: {unit.title}
        </a>
        <div class="ex-kicker">
          {t().lesson} {lesson.idx + 1}/{lessons.length}
        </div>
        <h2>{lessonTitle(c, lesson)}</h2>
        <p>{lessonAbout(c, lesson)}</p>
        {lesson.kind === 'words' && (
          <div class="chips">
            {lesson.words.map((id) => (
              <span class="chip">{c.wordById.get(id)?.w}</span>
            ))}
          </div>
        )}
        <p class="muted small">
          {plan.items.filter((i) => i.ex.k !== 'intro' && i.ex.k !== 'teach').length} {t().questions} · {fmt(t().passMark, { n: Math.round(PASS[lesson.kind] * 100) })}
          {!strict && plan.diff !== 'normal' && ` · ${t().diffNames[plan.diff]}`}
        </p>
        <div class="ex-actions">
          <button class="btn primary big" onClick={() => setStarted(true)} autoFocus>
            {t().start}
          </button>
        </div>
      </div>
    );
  }

  return (
    <SessionRunner
      items={plan.items}
      requeue={!strict}
      hints={!strict}
      retry={(ex, attempt) => retryFor(c, ex, attempt)}
      exitTo={`/unit/${unit.id}`}
      onComplete={async (s) => {
        const r = await finishLessonRun(c, lesson, plan.answers, 0);
        setAfter(await loadProgress(c));
        bump();
        setOutcome(r);
        setSummary(s);
      }}
    />
  );
}

/** Continue: jump to the next lesson. */
export function ContinueLesson({ c }: { c: LoadedCourse }) {
  useEffect(() => {
    void loadProgress(c).then((info) => {
      const n = nextLesson(c, info.units);
      go(n ? `/lesson/${n.unit.id}/${n.slug}` : '/path');
    });
  }, []);
  return <Loading />;
}

/** Review: due cards → exercises; each first answer is graded into FSRS immediately. */
export function Review({ c }: { c: LoadedCourse }) {
  const data = useProgress(c);
  const [items, setItems] = useState<SessionItem[] | null>(null);
  const [summary, setSummary] = useState<SessionSummary | null>(null);
  useEffect(() => {
    if (!data || items) return;
    const { info, logs } = data;
    const due = info.due.slice(0, 50);
    const planned = buildReview(c, due, exOpts(resolveDiff(getState().settings.difficulty, logs)), info.known, info.tenses.length ? info.tenses : ['pres']);
    setItems(
      planned.map(({ ex, card }) => ({
        ex,
        onResult: (r, override) => {
          const rating = r.ok ? (r.hinted ? Rating.Hard : r.verdict === 'typo' ? Rating.Hard : Rating.Good) : Rating.Again;
          // overriding a wrong verdict re-grades the card
          void review(c.meta.id, card.cid, override ? Rating.Good : rating, r.ok, exLabel(ex));
        },
      })),
    );
  }, [data]);
  if (!data || !items) return <Loading />;
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
  return <SessionRunner items={items} retry={(ex, a) => retryFor(c, ex, a)} exitTo="/" onComplete={(s) => setSummary(s)} />;
}

/** Free practice modes. "weak" grades the cards it asks about; the others leave the schedule alone. */
export function Practice({ c, kind }: { c: LoadedCourse; kind: string }) {
  const data = useProgress(c);
  const [items, setItems] = useState<SessionItem[] | null>(null);
  const [summary, setSummary] = useState<SessionSummary | null>(null);
  useEffect(() => {
    if (!data || items) return;
    const { info, logs } = data;
    const o = exOpts(resolveDiff(getState().settings.difficulty, logs));
    const known = info.known.size ? info.known : new Set(c.units[0].words);
    const reached = c.units.slice(0, info.currentIndex + 1);
    const sentPool = reached.flatMap((u) => u.sents).map((id) => c.sents.get(id)!).filter(Boolean);
    const studied = reached
      .filter((u) => {
        const r = info.units.get(u.id);
        return r && r.status !== 'new';
      })
      .flatMap((u) => u.topics.filter((tid) => ['known', 'done'].includes(info.units.get(u.id)!.status) || info.units.get(u.id)!.topicsRead.includes(tid)))
      .map((id) => c.topicById.get(id)!)
      .filter(Boolean);
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
    } else if (kind === 'grammar') {
      for (const tp of sample(studied, 12).concat(sample(studied, 12)).slice(0, 14)) {
        const e = topicExercise(c, tp, known);
        if (e) exs.push({ ...e, cid: undefined } as Ex);
      }
    } else if (kind === 'weak') {
      const weak = weakWords(info.cards, logs).slice(0, 12);
      const planned = buildReview(c, weak, o, known, info.tenses);
      const topicItems: SessionItem[] = [];
      for (const ts of weakTopics(logs).slice(0, 3)) {
        const tp = c.topicById.get(ts.id);
        for (let i = 0; tp && i < 3; i++) {
          const e = topicExercise(c, tp, known);
          if (e) topicItems.push({ ex: e, onResult: (r) => void review(c.meta.id, `g:${tp.id}`, r.ok ? Rating.Good : Rating.Again, r.ok, exLabel(e)) });
        }
      }
      setItems(
        shuffle([
          ...planned.map(({ ex, card }) => ({
            ex,
            onResult: (r: { ok: boolean }) => {
              void review(c.meta.id, card.cid, r.ok ? Rating.Good : Rating.Again, r.ok, 'practice');
            },
          })),
          ...topicItems,
        ]),
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
  }, [data]);
  if (!data || !items) return <Loading />;
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
        <p>{kind === 'weak' ? t().noWeak : t().noResults}</p>
        <button class="btn" onClick={() => go('/practice')}>
          {t().back}
        </button>
      </div>
    );
  return <SessionRunner items={items} retry={(ex, a) => retryFor(c, ex, a)} exitTo="/practice" onComplete={setSummary} />;
}
