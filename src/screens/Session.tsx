import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { addActivity } from '../db';
import { isGraded, type Ex } from '../exercises';
import { fmt, t } from '../i18n';
import { go } from '../router';
import { getState } from '../store';
import { scheduleSync, sync } from '../sync';
import { stopSpeech } from '../tts';
import { ExerciseView, type ExResult } from '../ui/ExerciseView';
import { ConfirmDialog, Icon, Progress } from '../ui/common';
import { ReportDialog } from './Reports';
import { Confetti } from './Game';
import { XP } from '../gamify';

export interface SessionItem {
  ex: Ex;
  /** Called once with the first-attempt result (and again if the user overrides a wrong verdict). */
  onResult?: (r: ExResult, override: boolean) => void;
}

export interface SessionResult {
  ex: Ex;
  ok: boolean;
  score: number; // 1 right, 0.5 right with a hint, 0 wrong
}

export interface SessionSummary {
  total: number;
  correct: number;
  score: number; // average 0..1
  results: SessionResult[];
  seconds: number;
}

interface Entry {
  item: SessionItem;
  attempt: number; // 0 = first time (graded); retries are practice
  key: number;
}

const MAX_GAP = 90_000; // longer pauses don't count as study time

/**
 * Runs a queue of exercises. A wrong answer (or one that needed a hint) comes back a few
 * questions later — after `retry` has re-taught it (word card, part of the rule, verb table).
 * One can go back to the explanation / word card shown before the current question.
 *
 * exam: a test — no right/wrong while answering, any earlier question can be revisited and
 * changed, and a confirmation comes before the result.
 */
export function SessionRunner({
  items,
  requeue = true,
  retry,
  hints = true,
  exam = false,
  quit = 'lesson',
  onComplete,
  exitTo,
}: {
  items: SessionItem[];
  requeue?: boolean;
  retry?: (ex: Ex, attempt: number) => Ex[];
  hints?: boolean;
  exam?: boolean;
  quit?: 'lesson' | 'test' | 'review' | 'practice';
  onComplete: (s: SessionSummary) => void;
  exitTo: string;
}) {
  const [queue, setQueue] = useState<Entry[]>(() => items.map((item, i) => ({ item, attempt: 0, key: i })));
  const [pos, setPos] = useState(0);
  const [, rerender] = useState(0);
  const [askQuit, setAskQuit] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [finishing, setFinishing] = useState(false); // exam: "finish the test?" screen
  const results = useRef<SessionResult[]>([]);
  const answered = useRef(new Set<number>()); // entry keys already answered (skipped when moving forward again)
  const examAnswers = useRef(new Map<number, ExResult>());
  const last = useRef<ExResult | null>(null);
  const keySeq = useRef(10000);
  const time = useRef({ active: 0, mark: Date.now(), finished: false });
  const advanced = useRef(-1); // key of the entry we already moved past (Enter + click must not advance twice)
  const [closing, setClosing] = useState(false);
  const graded = useMemo(() => items.filter((i) => isGraded(i.ex)).length, [items]);
  const done = exam ? examAnswers.current.size : results.current.length;
  const course = getState().course?.meta.id;

  const tickTime = () => {
    const now = Date.now();
    time.current.active += Math.min(now - time.current.mark, MAX_GAP);
    time.current.mark = now;
  };

  useEffect(() => {
    sync.busy++;
    return () => {
      sync.busy--;
      scheduleSync(1500);
    };
  }, []);

  useEffect(
    () => () => {
      stopSpeech();
      // leaving midway still counts the time spent
      if (!time.current.finished && course) {
        tickTime();
        if (time.current.active > 5000) void addActivity(course, time.current.active / 1000);
      }
    },
    [],
  );

  const cur = queue[pos];
  if (!cur) return null;
  if (closing) return <div class="loading">…</div>;

  const complete = (res: SessionResult[]) => {
    time.current.finished = true;
    const seconds = time.current.active / 1000;
    if (course) void addActivity(course, seconds);
    const score = res.length ? res.reduce((s, x) => s + x.score, 0) / res.length : 1;
    setClosing(true); // results are being saved
    onComplete({ total: res.length, correct: res.filter((x) => x.ok).length, score, results: res, seconds });
  };

  const finishExam = () => {
    // answers are reported in question order, once, with the final choice for each question
    const res: SessionResult[] = [];
    for (const e of queue) {
      if (!isGraded(e.item.ex)) continue;
      const r: ExResult = examAnswers.current.get(e.key) || { ok: false, verdict: 'wrong', given: '' };
      e.item.onResult?.(r, false);
      res.push({ ex: e.item.ex, ok: r.ok, score: r.ok ? 1 : 0 });
    }
    complete(res);
  };

  const onResult = (r: ExResult, override = false) => {
    tickTime();
    if (exam) {
      examAnswers.current.set(cur.key, r);
      answered.current.add(cur.key);
      return;
    }
    if (cur.attempt === 0) {
      if (override) {
        const lastRes = results.current[results.current.length - 1];
        if (lastRes) {
          lastRes.ok = true;
          lastRes.score = 1;
        }
      } else results.current.push({ ex: cur.item.ex, ok: r.ok && !r.hinted, score: r.ok ? (r.hinted ? 0.5 : 1) : 0 });
      cur.item.onResult?.(r, override);
    }
    answered.current.add(cur.key);
    last.current = override ? { ...r, ok: true, hinted: false } : r;
    rerender((x) => x + 1);
  };

  /** Next position, skipping questions already answered (after going back). */
  const nextFrom = (q: Entry[], from: number) => {
    let i = from + 1;
    while (i < q.length && isGraded(q[i].item.ex) && answered.current.has(q[i].key)) i++;
    return i;
  };

  const onNext = () => {
    if (advanced.current === cur.key || time.current.finished) return;
    advanced.current = cur.key;
    stopSpeech();
    tickTime();
    let q = queue;
    const r = last.current;
    if (!exam && requeue && r && isGraded(cur.item.ex) && (!r.ok || r.hinted) && cur.attempt < 2) {
      const again = !r.ok && retry ? retry(cur.item.ex, cur.attempt + 1) : [cur.item.ex];
      const add = again.map((ex) => ({ item: { ex }, attempt: cur.attempt + 1, key: keySeq.current++ }));
      // come back after a couple of other questions, not immediately
      const at = Math.min(pos + 3, q.length);
      q = [...q.slice(0, at), ...add, ...q.slice(at)];
      setQueue(q);
    }
    last.current = null;
    // a test walks through questions in order; a lesson skips the ones answered before going back
    const n = exam ? pos + 1 : nextFrom(q, pos);
    if (n >= q.length) {
      if (exam) {
        setFinishing(true);
        rerender((x) => x + 1);
      } else complete(results.current);
    } else setPos(n);
  };

  const goTo = (i: number) => {
    stopSpeech();
    advanced.current = -1;
    last.current = null;
    setFinishing(false);
    setPos(i);
  };

  // where "back" leads: in a test, the previous question; in a lesson, the last explanation or word card
  let backTo = -1;
  if (exam) backTo = finishing ? pos : pos - 1;
  else if (!last.current)
    for (let i = pos - 1; i >= 0; i--)
      if (!isGraded(queue[i].item.ex)) {
        backTo = i;
        break;
      }
  const isRevisit = exam && examAnswers.current.has(cur.key) && !finishing;
  const prev = exam && !finishing ? examAnswers.current.get(cur.key) : undefined;
  const qt = {
    lesson: [t().quitLessonTitle, t().quitLessonText],
    test: [t().quitTestTitle, t().quitTestText],
    review: [t().quitReviewTitle, t().quitReviewText],
    practice: [t().quitPracticeTitle, t().quitPracticeText],
  }[quit];

  const dk = [...examAnswers.current.values()].filter((r) => !r.ok && !r.given).length;
  const left = queue.length - pos - 1;
  return (
    <div class="session">
      <div class="session-top">
        <button class="icon-btn" title={t().quit} onClick={() => setAskQuit(true)}>
          <Icon name="close" />
        </button>
        <Progress value={Math.min(done, graded)} max={graded || 1} />
        <span class="session-count" title={left > 0 ? `${left}` : ''}>
          {Math.min(done, graded)}/{graded}
        </span>
        <button class="icon-btn small" title={t().reportButton} onClick={() => setReporting(true)}>
          <Icon name="flag" size={16} />
        </button>
      </div>
      {(backTo >= 0 || isRevisit) && !finishing && (
        <div class="session-nav">
          {backTo >= 0 && (
            <button class="back-btn" onClick={() => goTo(backTo)}>
              ← {exam ? t().prevQuestion : t().backToExplanation}
            </button>
          )}
          {isRevisit && (
            <button class="back-btn" onClick={() => onNext()}>
              {t().keepAnswer} →
            </button>
          )}
        </div>
      )}
      {finishing ? (
        <div class="finish-screen">
          <h2>{t().finishTestTitle}</h2>
          <p>{fmt(t().finishTestText, { a: examAnswers.current.size, n: graded, d: dk })}</p>
          <div class="ex-actions center wrap">
            <button class="btn" onClick={() => goTo(pos)}>
              ← {t().backToQuestions}
            </button>
            <button class="btn primary big" onClick={finishExam}>
              {t().finishTestOk}
            </button>
          </div>
        </div>
      ) : (
        <>
          {cur.attempt > 0 && isGraded(cur.item.ex) && <div class="retry-tag">{t().onceMore}</div>}
          <ExerciseView
            key={`${cur.key}-${pos}-${prev ? 'again' : 'new'}`}
            ex={cur.item.ex}
            onResult={onResult}
            onNext={onNext}
            hints={hints}
            exam={exam}
            prevAnswer={prev ? prev.given || '' : undefined}
          />
        </>
      )}
      {reporting && <ReportDialog ex={cur.item.ex} result={exam ? examAnswers.current.get(cur.key) : last.current} onClose={() => setReporting(false)} />}
      {askQuit && (
        <ConfirmDialog
          title={qt[0]}
          text={qt[1]}
          ok={t().quitOk}
          cancel={t().keepGoing}
          danger={quit === 'lesson' || quit === 'test'}
          onOk={() => go(exitTo)}
          onCancel={() => setAskQuit(false)}
        />
      )}
    </div>
  );
}

export function SessionDone({
  title,
  summary,
  extra,
  actions,
  pass,
}: {
  title: string;
  summary: SessionSummary;
  extra?: preact.ComponentChildren;
  actions?: preact.ComponentChildren;
  pass?: number; // threshold to show passed / not passed
}) {
  const pct = Math.round(100 * summary.score);
  const seen = new Set<string>();
  const wrong = summary.results.filter((r) => {
    if (r.ok) return false;
    const e = r.ex;
    const key = 'word' in e && e.word ? `w${e.word.id}` : 'sent' in e && e.sent ? `s${e.sent.id}` : e.k === 'drill' ? `d${e.drill.q}` : e.k === 'conj' ? `c${e.verb}${e.tense}${e.person}` : String(seen.size);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const passed = pass === undefined ? undefined : summary.score >= pass;
  const mins = Math.max(1, Math.round(summary.seconds / 60));
  return (
    <div class="done-screen">
      <h2>{title}</h2>
      {passed && <Confetti />}
      <div class={`big-stat ${passed === false ? 'bad' : passed ? 'ok' : ''}`}>
        <span>{pct}%</span>
        <small>
          {t().accuracy} · {mins} {t().mins}
        </small>
      </div>
      <p class="xp-earned">⚡ +{summary.results.reduce((s, r) => s + (r.score >= 1 ? XP.answer : r.score > 0 ? XP.hinted : XP.tried), 0) + (passed ? XP.lesson + (summary.score >= 1 ? XP.perfect : 0) : 0)} XP</p>
      {passed !== undefined && <p class={`pass-note ${passed ? 'ok' : 'bad'}`}>{passed ? t().lessonPassed : fmtNeed(pass!)}</p>}
      {extra}
      {wrong.length > 0 && (
        <div class="card">
          <h4>{t().toRemember}</h4>
          <ul class="mistakes">
            {wrong.slice(0, 15).map((r) => (
              <li>{describe(r.ex)}</li>
            ))}
          </ul>
        </div>
      )}
      <div class="ex-actions center wrap">{actions}</div>
    </div>
  );
}

function fmtNeed(pass: number) {
  return t().lessonNotPassed.replace('{n}', String(Math.round(pass * 100)));
}

function describe(ex: Ex): preact.ComponentChildren {
  switch (ex.k) {
    case 'mcq':
    case 'type':
      return (
        <>
          <b>{ex.word.w}</b> — {ex.word.tr}
        </>
      );
    case 'cloze': {
      const s = ex.sent.tk.map(([w, , sp], i) => (i === ex.i ? `[${ex.answers[0]}]` : i > ex.i && i < ex.i + ex.n ? '' : w) + (sp ? ' ' : '')).join('');
      return (
        <>
          {s} <span class="muted">· {ex.sent.tr}</span>
        </>
      );
    }
    case 'drill':
      return (
        <>
          {ex.drill.h && <span class="muted">{ex.drill.h} </span>}
          {ex.drill.q.trim() === '___' ? <b>{ex.drill.a[0]}</b> : ex.drill.q.replace(/_{2,}/, `[${ex.drill.a[0]}]`)}
        </>
      );
    case 'conj':
      return (
        <>
          {ex.verb} → <b>{ex.answers[0]}</b>
        </>
      );
    case 'build':
    case 'translate':
    case 'dictation':
    case 'read':
      return (
        <>
          {ex.sent.tk.map(([w, , sp]) => w + (sp ? ' ' : '')).join('')} <span class="muted">· {ex.sent.tr}</span>
        </>
      );
    default:
      return '';
  }
}
