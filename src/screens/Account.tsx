import { useEffect, useState } from 'preact/hooks';
import { t } from '../i18n';
import { logout, onSync, session, skipLogin, startTelegramLogin, sync, syncAll } from '../sync';

function useSync() {
  const [, set] = useState(0);
  useEffect(() => {
    const off = onSync(() => set((x) => x + 1));
    return () => {
      off();
    };
  }, []);
  return sync;
}

function TgIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" d="M9.8 15.3 9.6 19c.4 0 .6-.2.8-.4l1.9-1.8 3.9 2.9c.7.4 1.2.2 1.4-.7l2.6-12.1c.2-1-.4-1.4-1.1-1.2L3.6 9.4c-1 .4-1 1-.2 1.2l3.9 1.2 9-5.7c.4-.3.8-.1.5.2z" />
    </svg>
  );
}

function errorText(e: unknown) {
  const m = String((e as Error)?.message || e);
  if (m === 'cancelled') return t().loginCancelled;
  if (/registration closed|not allowed/.test(m)) return t().loginClosed;
  if (/signature/.test(m)) return t().loginBadSig;
  return `${t().loginFailed} (${m})`;
}

/** First screen: sign in with Telegram so progress is kept on the server and shared between devices. */
export function LoginScreen() {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useSync();
  return (
    <div class="page login">
      <div class="brand">
        <span class="logo">L</span>
        <h1>LinguaLab</h1>
      </div>
      <h2>{t().loginTitle}</h2>
      <p>{t().loginLead}</p>
      <ul class="rules">
        {t().loginPoints.map((x) => (
          <li>{x}</li>
        ))}
      </ul>
      <div class="ex-actions">
        <button
          class="btn tg big"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setErr('');
            try {
              await startTelegramLogin();
            } catch (e) {
              setErr(errorText(e));
            }
            setBusy(false);
          }}
        >
          <TgIcon /> {busy ? t().loginWaiting : t().loginTelegram}
        </button>
      </div>
      {busy && <p class="muted small">{t().loginWaitingNote}</p>}
      {err && <p class="warn">{err}</p>}
      {sync.state === 'error' && sync.error && !err && <p class="warn">{errorText(sync.error)}</p>}
      <p>
        <button class="btn ghost" onClick={() => skipLogin()}>
          {t().loginSkip}
        </button>
      </p>
      <p class="muted small">{t().loginSkipNote}</p>
    </div>
  );
}

/** Account and sync status in the settings. */
export function AccountBlock() {
  const s = useSync();
  const ses = session();
  const [err, setErr] = useState('');
  if (!ses)
    return (
      <div class="card account">
        <h4>{t().account}</h4>
        <p class="muted small">{t().accountOff}</p>
        <button
          class="btn tg"
          onClick={async () => {
            setErr('');
            try {
              await startTelegramLogin();
            } catch (e) {
              setErr(errorText(e));
            }
          }}
        >
          <TgIcon /> {t().loginTelegram}
        </button>
        {err && <p class="warn">{err}</p>}
      </div>
    );
  return (
    <div class="card account">
      <h4>{t().account}</h4>
      <div class="acc-row">
        {ses.user.photo && <img class="avatar" src={ses.user.photo} alt="" referrerpolicy="no-referrer" />}
        <div>
          <b>{ses.user.name}</b>
          {ses.user.username && <small class="muted"> @{ses.user.username}</small>}
          <div class="muted small">
            <SyncText />
          </div>
        </div>
      </div>
      <div class="ex-actions wrap">
        <button class="btn" disabled={s.state === 'syncing'} onClick={() => void syncAll()}>
          {t().syncNow}
        </button>
        <button
          class="btn ghost"
          onClick={async () => {
            if (confirm(t().logoutConfirm)) await logout();
          }}
        >
          {t().logout}
        </button>
      </div>
    </div>
  );
}

function SyncText() {
  const s = useSync();
  if (s.state === 'syncing') return <>{t().syncing}</>;
  if (s.state === 'offline') return <>{t().syncOffline}</>;
  if (s.state === 'error') return <span class="bad">{`${t().syncError}: ${s.error}`}</span>;
  if (s.last) return <>{`${t().syncedAt} ${new Date(s.last).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`}</>;
  return <>{t().syncOn}</>;
}

/** Small cloud in the top bar. */
export function SyncBadge() {
  const s = useSync();
  if (!session()) return null;
  const cls = s.state === 'error' ? 'bad' : s.state === 'syncing' ? 'busy' : s.state === 'offline' ? 'off' : 'ok';
  const title = s.state === 'error' ? `${t().syncError}: ${s.error}` : s.state === 'syncing' ? t().syncing : s.last ? `${t().syncedAt} ${new Date(s.last).toLocaleTimeString()}` : t().syncOn;
  return (
    <a class={`sync-badge ${cls}`} href="#/settings" title={title}>
      <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
        <path fill="currentColor" d="M19.4 10A7 7 0 0 0 6.1 8.1 5.5 5.5 0 0 0 6.5 19H19a4.5 4.5 0 0 0 .4-9z" />
      </svg>
    </a>
  );
}
