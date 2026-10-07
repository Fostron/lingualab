import { useEffect, useState } from 'preact/hooks';
import type { Ex } from '../exercises';
import { fmt, t } from '../i18n';
import { describeEx, myReports, sendReport, type MyReport } from '../reports';
import { session } from '../sync';
import type { ExResult } from '../ui/ExerciseView';

/** "Report a problem": a short text; the exercise, the answer and the app version are attached. */
export function ReportDialog({ ex, result, extra, onClose }: { ex?: Ex; result?: ExResult | null; extra?: Record<string, unknown>; onClose: () => void }) {
  const [text, setText] = useState('');
  const [state, setState] = useState<'edit' | 'sending' | 'sent' | 'error'>('edit');
  const [msg, setMsg] = useState('');
  const logged = !!session();
  const send = async () => {
    if (!text.trim()) return;
    setState('sending');
    try {
      const id = await sendReport(text.trim(), {
        ...(ex ? { exercise: describeEx(ex) } : {}),
        ...(result ? { answer: { given: result.given, ok: result.ok, verdict: result.verdict } } : {}),
        ...(extra || {}),
      });
      setMsg(fmt(t().reportSent, { n: id }));
      setState('sent');
    } catch (e) {
      setMsg(String((e as Error).message) === 'login' ? t().reportLogin : `${t().reportFailed} (${(e as Error).message})`);
      setState('error');
    }
  };
  return (
    <div class="modal-back" onClick={onClose}>
      <div
        class="modal report-dialog"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Escape') onClose();
        }}
      >
        <h3>{t().reportTitle}</h3>
        {state === 'sent' ? (
          <>
            <p>{msg}</p>
            <div class="ex-actions">
              <button class="btn primary" onClick={onClose} autoFocus>
                {t().gotIt}
              </button>
            </div>
          </>
        ) : !logged ? (
          <>
            <p>{t().reportLogin}</p>
            <div class="ex-actions">
              <button class="btn" onClick={onClose}>
                {t().back}
              </button>
            </div>
          </>
        ) : (
          <>
            <div class="chips reasons">
              {t().reportReasons.map((r) => (
                <button class="chip" onClick={() => setText((x) => (x ? `${x}\n${r}` : r))}>
                  {r}
                </button>
              ))}
            </div>
            <textarea class="report-text" rows={4} placeholder={t().reportPlaceholder} value={text} onInput={(e) => setText((e.target as HTMLTextAreaElement).value)} autoFocus />
            <small class="muted">{ex ? t().reportAttachedEx : t().reportAttached}</small>
            {state === 'error' && <p class="warn">{msg}</p>}
            <div class="ex-actions">
              <button class="btn" onClick={onClose}>
                {t().back}
              </button>
              <button class="btn primary" disabled={!text.trim() || state === 'sending'} onClick={() => void send()}>
                {state === 'sending' ? '…' : t().reportSend}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** Settings: send a report, and see what happened to the ones already sent. */
export function MyReportsBlock() {
  const [list, setList] = useState<MyReport[] | null>(null);
  const [open, setOpen] = useState(false);
  const load = () => void myReports().then(setList, () => setList([]));
  useEffect(load, []);
  return (
    <div class="card my-reports">
      <div class="row-between">
        <h4>{t().myReports}</h4>
        <button class="btn small" onClick={() => setOpen(true)}>
          {t().reportButton}
        </button>
      </div>
      {!session() && <p class="muted small">{t().reportLogin}</p>}
      {list && list.length === 0 && session() && <p class="muted small">{t().noReports}</p>}
      {list && list.length > 0 && (
        <ul class="report-list">
          {list.map((r) => (
            <li>
              <div class="row-between">
                <span class={`pill st-${r.status}`}>{t().reportStatus[r.status]}</span>
                <small class="muted">
                  №{r.id} · {new Date(r.created * 1000).toLocaleDateString()}
                </small>
              </div>
              <div class="report-q">{r.text}</div>
              {r.note && <div class="report-note">💬 {r.note}</div>}
              {r.fixedIn && <small class="muted">{fmt(t().reportFixedIn, { v: r.fixedIn })}</small>}
            </li>
          ))}
        </ul>
      )}
      {open && (
        <ReportDialog
          onClose={() => {
            setOpen(false);
            load();
          }}
        />
      )}
    </div>
  );
}
