import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Ex } from '../exercises';
import { t } from '../i18n';
import { go } from '../router';
import { stopSpeech } from '../tts';
import { ExerciseView, type ExResult } from '../ui/ExerciseView';
import { Icon, Progress } from '../ui/common';

export interface SessionItem {
  ex: Ex;
  /** Called once with the first-attempt result (and again if the user overrides a wrong verdict). */
  onResult?: (r: ExResult, override: boolean) => void;
}

export interface SessionSummary {
  total: number;
  correct: number;
  results: { ex: Ex; ok: boolean }[];
}

/** Runs a queue of exercises. Wrong answers are re-queued once (except in tests). */
export function SessionRunner({
  items,
  requeue = true,
  onComplete,
  exitTo,
}: {
  items: SessionItem[];
  requeue?: boolean;
  onComplete: (s: SessionSummary) => void;
  exitTo: string;
}) {
  const [queue, setQueue] = useState<{ item: SessionItem; retry: boolean; key: number }[]>(() => items.map((item, i) => ({ item, retry: false, key: i })));
  const [pos, setPos] = useState(0);
  const results = useRef<{ ex: Ex; ok: boolean }[]>([]);
  const lastOk = useRef<boolean | null>(null);
  const graded = useMemo(() => items.filter((i) => i.ex.k !== 'intro').length, [items]);
  const done = results.current.length;

  useEffect(() => () => stopSpeech(), []);

  const cur = queue[pos];
  if (!cur) return null;

  const onResult = (r: ExResult, override = false) => {
    if (!cur.retry) {
      if (override) {
        const last = results.current[results.current.length - 1];
        if (last) last.ok = true;
      } else results.current.push({ ex: cur.item.ex, ok: r.ok });
      cur.item.onResult?.(r, override);
    }
    lastOk.current = r.ok;
  };

  const onNext = () => {
    stopSpeech();
    let q = queue;
    if (requeue && lastOk.current === false && !cur.retry && cur.item.ex.k !== 'intro') {
      q = [...queue, { item: cur.item, retry: true, key: queue.length + 1000 }];
      setQueue(q);
    }
    lastOk.current = null;
    if (pos + 1 >= q.length) {
      const res = results.current;
      onComplete({ total: res.length, correct: res.filter((x) => x.ok).length, results: res });
    } else setPos(pos + 1);
  };

  return (
    <div class="session">
      <div class="session-top">
        <button class="icon-btn" title={t().quit} onClick={() => go(exitTo)}>
          <Icon name="close" />
        </button>
        <Progress value={Math.min(done, graded)} max={graded || 1} />
        <span class="session-count">
          {Math.min(done, graded)}/{graded}
        </span>
      </div>
      <ExerciseView key={cur.key} ex={cur.item.ex} onResult={onResult} onNext={onNext} />
    </div>
  );
}

export function SessionDone({ title, summary, extra, actions }: { title: string; summary: SessionSummary; extra?: preact.ComponentChildren; actions?: preact.ComponentChildren }) {
  const pct = summary.total ? Math.round((100 * summary.correct) / summary.total) : 100;
  const wrong = summary.results.filter((r) => !r.ok);
  return (
    <div class="done-screen">
      <h2>{title}</h2>
      <div class="big-stat">
        <span>{pct}%</span>
        <small>{t().accuracy}</small>
      </div>
      {extra}
      {wrong.length > 0 && (
        <div class="card">
          <h4>{t().wrong}</h4>
          <ul class="mistakes">
            {wrong.slice(0, 12).map((r) => (
              <li>{describe(r.ex)}</li>
            ))}
          </ul>
        </div>
      )}
      <div class="ex-actions center">{actions}</div>
    </div>
  );
}

function describe(ex: Ex): string {
  switch (ex.k) {
    case 'mcq':
    case 'type':
      return `${ex.word.w} — ${ex.word.tr}`;
    case 'cloze':
      return `${ex.answers[0]} · ${ex.sent.tr}`;
    case 'drill':
      return ex.drill.q.replace(/_{2,}/, `[${ex.drill.a[0]}]`);
    case 'conj':
      return `${ex.verb} → ${ex.answers[0]}`;
    case 'build':
    case 'translate':
    case 'dictation':
    case 'read':
      return ex.sent.tr;
    default:
      return '';
  }
}
