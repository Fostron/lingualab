import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { addActivity } from '../db';
import { isGraded, type Ex } from '../exercises';
import { t } from '../i18n';
import { go } from '../router';
import { getState } from '../store';
import { stopSpeech } from '../tts';
import { ExerciseView, type ExResult } from '../ui/ExerciseView';
import { Icon, Progress } from '../ui/common';

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
 */
export function SessionRunner({
  items,
  requeue = true,
  retry,
  hints = true,
  onComplete,
  exitTo,
}: {
  items: SessionItem[];
  requeue?: boolean;
  retry?: (ex: Ex, attempt: number) => Ex[];
  hints?: boolean;
  onComplete: (s: SessionSummary) => void;
  exitTo: string;
}) {
  const [queue, setQueue] = useState<Entry[]>(() => items.map((item, i) => ({ item, attempt: 0, key: i })));
  const [pos, setPos] = useState(0);
  const [, rerender] = useState(0);
  const results = useRef<SessionResult[]>([]);
  const last = useRef<ExResult | null>(null);
  const keySeq = useRef(10000);
  const time = useRef({ active: 0, mark: Date.now(), finished: false });
  const advanced = useRef(-1); // key of the entry we already moved past (Enter + click must not advance twice)
  const [closing, setClosing] = useState(false);
  const graded = useMemo(() => items.filter((i) => isGraded(i.ex)).length, [items]);
  const done = results.current.length;
  const course = getState().course?.meta.id;

  const tickTime = () => {
    const now = Date.now();
    time.current.active += Math.min(now - time.current.mark, MAX_GAP);
    time.current.mark = now;
  };

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

  const onResult = (r: ExResult, override = false) => {
    tickTime();
    if (cur.attempt === 0) {
      if (override) {
        const lastRes = results.current[results.current.length - 1];
        if (lastRes) {
          lastRes.ok = true;
          lastRes.score = 1;
        }
      } else results.current.push({ ex: cur.item.ex, ok: r.ok && !r.hinted, score: r.ok ? (r.hinted ? 0.5 : 1) : 0 });
      cur.item.onResult?.(r, override);
      rerender((x) => x + 1);
    }
    last.current = override ? { ...r, ok: true, hinted: false } : r;
  };

  const onNext = () => {
    if (advanced.current === cur.key || time.current.finished) return;
    advanced.current = cur.key;
    stopSpeech();
    tickTime();
    let q = queue;
    const r = last.current;
    if (requeue && r && isGraded(cur.item.ex) && (!r.ok || r.hinted) && cur.attempt < 2) {
      const again = !r.ok && retry ? retry(cur.item.ex, cur.attempt + 1) : [cur.item.ex];
      const add = again.map((ex) => ({ item: { ex }, attempt: cur.attempt + 1, key: keySeq.current++ }));
      // come back after a couple of other questions, not immediately
      const at = Math.min(pos + 3, q.length);
      q = [...q.slice(0, at), ...add, ...q.slice(at)];
      setQueue(q);
    }
    last.current = null;
    if (pos + 1 >= q.length) {
      time.current.finished = true;
      const res = results.current;
      const seconds = time.current.active / 1000;
      if (course) void addActivity(course, seconds);
      const score = res.length ? res.reduce((s, x) => s + x.score, 0) / res.length : 1;
      setClosing(true); // results are being saved
      onComplete({ total: res.length, correct: res.filter((x) => x.ok).length, score, results: res, seconds });
    } else setPos(pos + 1);
  };

  const left = queue.length - pos - 1;
  return (
    <div class="session">
      <div class="session-top">
        <button class="icon-btn" title={t().quit} onClick={() => go(exitTo)}>
          <Icon name="close" />
        </button>
        <Progress value={Math.min(done, graded)} max={graded || 1} />
        <span class="session-count" title={left > 0 ? `${left}` : ''}>
          {Math.min(done, graded)}/{graded}
        </span>
      </div>
      {cur.attempt > 0 && isGraded(cur.item.ex) && <div class="retry-tag">{t().onceMore}</div>}
      <ExerciseView key={cur.key} ex={cur.item.ex} onResult={onResult} onNext={onNext} hints={hints} />
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
  const wrong = summary.results.filter((r) => !r.ok);
  const passed = pass === undefined ? undefined : summary.score >= pass;
  const mins = Math.max(1, Math.round(summary.seconds / 60));
  return (
    <div class="done-screen">
      <h2>{title}</h2>
      <div class={`big-stat ${passed === false ? 'bad' : passed ? 'ok' : ''}`}>
        <span>{pct}%</span>
        <small>
          {t().accuracy} · {mins} {t().mins}
        </small>
      </div>
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
