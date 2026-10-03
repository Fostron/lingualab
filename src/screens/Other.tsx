import { useEffect, useState } from 'preact/hooks';
import { exportAll, importAll, logsFor, resetCourse, type LogRec } from '../db';
import { t } from '../i18n';
import { loadProgress, type ProgressInfo } from '../progress';
import { go } from '../router';
import { bump, getState, updateSettings } from '../store';
import { speak, voicesFor } from '../tts';
import type { LoadedCourse } from '../types';
import { Loading } from '../ui/common';

export function Stats({ c }: { c: LoadedCourse }) {
  const [info, setInfo] = useState<ProgressInfo | null>(null);
  const [logs, setLogs] = useState<LogRec[] | null>(null);
  useEffect(() => {
    void loadProgress(c).then(setInfo);
    void logsFor(c.meta.id).then(setLogs);
  }, [c]);
  if (!info || !logs) return <Loading />;
  const now = Date.now();
  const day = 86400000;
  const recent = logs.filter((l) => l.ts > now - 30 * day && l.ex !== 'lesson');
  const retention = recent.length ? Math.round((100 * recent.filter((l) => l.ok).length) / recent.length) : null;
  const perDay: number[] = [];
  for (let i = 13; i >= 0; i--) {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const s = start.getTime() - i * day;
    perDay.push(logs.filter((l) => l.ts >= s && l.ts < s + day).length);
  }
  const forecast: number[] = [];
  for (let i = 0; i < 7; i++) {
    const end = new Date();
    end.setHours(23, 59, 59, 999);
    const e = end.getTime() + i * day;
    const s = i === 0 ? 0 : e - day;
    forecast.push(info.cards.filter((x) => x.due > s && x.due <= e).length);
  }
  const maxD = Math.max(1, ...perDay);
  const maxF = Math.max(1, ...forecast);
  const words = info.cards.filter((x) => x.kind === 'wp');
  const mature = words.filter((x) => x.stability >= 21).length;
  const young = words.length - mature;
  const levelCounts = ['A1', 'A2', 'B1', 'B2', 'C1'].map((L) => {
    const us = c.units.filter((u) => u.level === L);
    const done = us.filter((u) => ['done', 'known'].includes(info.units.get(u.id)?.status || '')).length;
    return { L, done, total: us.length };
  });
  return (
    <div class="page stats">
      <h2>{t().stats}</h2>
      <div class="result-grid">
        <div class="stat">
          <small>{t().learnedWords}</small>
          <b>{info.learned.size}</b>
        </div>
        <div class="stat">
          <small>{t().wordsKnown}</small>
          <b>{mature}</b>
          <small class="muted">+{young}</small>
        </div>
        <div class="stat">
          <small>{t().retention}</small>
          <b>{retention === null ? '—' : `${retention}%`}</b>
        </div>
        <div class="stat">
          <small>{t().reviewsTotal}</small>
          <b>{logs.length}</b>
        </div>
      </div>
      <div class="card">
        <h4>14 d</h4>
        <div class="bars">
          {perDay.map((n) => (
            <div class="bar" style={{ height: `${(100 * n) / maxD}%` }} title={String(n)} />
          ))}
        </div>
      </div>
      <div class="card">
        <h4>{t().forecast}</h4>
        <div class="bars">
          {forecast.map((n) => (
            <div class="bar alt" style={{ height: `${(100 * n) / maxF}%` }} title={String(n)}>
              <span>{n}</span>
            </div>
          ))}
        </div>
      </div>
      <div class="card">
        {levelCounts.map(({ L, done, total }) => (
          <div class="level-row">
            <span>{L}</span>
            <div class="progress">
              <div style={{ width: `${(100 * done) / Math.max(1, total)}%` }} />
            </div>
            <span>
              {done}/{total}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function SettingsPage({ c }: { c: LoadedCourse | null }) {
  const s = getState().settings;
  const [msg, setMsg] = useState('');
  const voices = c ? voicesFor(c.meta.tts) : [];
  const num = (k: 'newPerDay' | 'wordsPerLesson', min: number, max: number) => (
    <input
      type="number"
      min={min}
      max={max}
      value={s[k]}
      onChange={(e) => {
        const v = Math.max(min, Math.min(max, Number((e.target as HTMLInputElement).value) || min));
        void updateSettings({ [k]: v });
      }}
    />
  );
  return (
    <div class="page settings">
      <h2>{t().settings}</h2>
      <label class="set-row">
        <span>{t().settingsNewPerDay}</span>
        {num('newPerDay', 0, 100)}
      </label>
      <label class="set-row">
        <span>{t().settingsWordsPerLesson}</span>
        {num('wordsPerLesson', 3, 20)}
      </label>
      <label class="set-row">
        <span>{t().settingsTyping}</span>
        <input type="checkbox" checked={s.typingOnly} onChange={(e) => void updateSettings({ typingOnly: (e.target as HTMLInputElement).checked })} />
      </label>
      <label class="set-row">
        <span>{t().settingsStrict}</span>
        <input type="checkbox" checked={s.strictAccents} onChange={(e) => void updateSettings({ strictAccents: (e.target as HTMLInputElement).checked })} />
      </label>
      <label class="set-row">
        <span>{t().settingsAutoplay}</span>
        <input type="checkbox" checked={s.autoplay} onChange={(e) => void updateSettings({ autoplay: (e.target as HTMLInputElement).checked })} />
      </label>
      <label class="set-row">
        <span>
          {t().settingsRate}: {s.rate.toFixed(2)}
        </span>
        <input type="range" min={0.5} max={1.2} step={0.05} value={s.rate} onChange={(e) => void updateSettings({ rate: Number((e.target as HTMLInputElement).value) })} />
      </label>
      {c && (
        <label class="set-row">
          <span>{t().settingsVoice}</span>
          <select
            value={s.voice[c.meta.tts] || ''}
            onChange={(e) => {
              const v = (e.target as HTMLSelectElement).value;
              void updateSettings({ voice: { ...s.voice, [c.meta.tts]: v } }).then(() => speak(c.meta.target === 'es' ? 'Hola, ¿qué tal?' : 'Bonjour, ça va ?', c.meta.tts));
            }}
          >
            <option value="">Auto</option>
            {voices.map((v) => (
              <option value={v.name}>
                {v.name} ({v.lang})
              </option>
            ))}
          </select>
        </label>
      )}
      <label class="set-row">
        <span>
          {t().settingsRetention}: {Math.round(s.retention * 100)}%
        </span>
        <input type="range" min={0.8} max={0.97} step={0.01} value={s.retention} onChange={(e) => void updateSettings({ retention: Number((e.target as HTMLInputElement).value) })} />
      </label>
      <label class="set-row">
        <span>{t().settingsTheme}</span>
        <select value={s.theme} onChange={(e) => void updateSettings({ theme: (e.target as HTMLSelectElement).value as any })}>
          <option value="auto">{t().themeAuto}</option>
          <option value="light">{t().themeLight}</option>
          <option value="dark">{t().themeDark}</option>
        </select>
      </label>
      <div class="ex-actions wrap">
        <button
          class="btn"
          onClick={async () => {
            const data = await exportAll();
            const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = `lingualab-${new Date().toISOString().slice(0, 10)}.json`;
            a.click();
          }}
        >
          {t().exportData}
        </button>
        <label class="btn">
          {t().importData}
          <input
            type="file"
            accept="application/json"
            hidden
            onChange={async (e) => {
              const f = (e.target as HTMLInputElement).files?.[0];
              if (!f) return;
              try {
                await importAll(JSON.parse(await f.text()));
                setMsg(t().importOk);
                bump();
              } catch (err) {
                setMsg(String(err));
              }
            }}
          />
        </label>
        {c && (
          <button
            class="btn danger"
            onClick={async () => {
              if (!confirm(t().resetConfirm)) return;
              await resetCourse(c.meta.id);
              bump();
              go('/');
            }}
          >
            {t().resetCourse}
          </button>
        )}
      </div>
      {msg && <p>{msg}</p>}
      <h3>{t().sources}</h3>
      <ul class="sources">
        <li>
          Sentences & recordings: <a href="https://tatoeba.org" target="_blank" rel="noopener">Tatoeba</a> (CC BY 2.0 FR; audio per contributor licence)
        </li>
        <li>
          Word recordings: <a href="https://lingualibre.org" target="_blank" rel="noopener">Lingua Libre</a> /{' '}
          <a href="https://commons.wikimedia.org" target="_blank" rel="noopener">Wikimedia Commons</a> (CC BY-SA, per file)
        </li>
        <li>
          Dictionary data: <a href="https://kaikki.org" target="_blank" rel="noopener">Wiktionary via kaikki.org</a>, <a href="https://www.wikdict.com" target="_blank" rel="noopener">WikDict</a> (CC BY-SA)
        </li>
        <li>
          Word frequencies: <a href="https://github.com/hermitdave/FrequencyWords" target="_blank" rel="noopener">FrequencyWords</a> (CC BY-SA 4.0),{' '}
          <a href="http://www.lexique.org" target="_blank" rel="noopener">Lexique 3.83</a> (CC BY-SA 4.0)
        </li>
        <li>
          Conjugations: <a href="https://github.com/bretttolbert/verbecc" target="_blank" rel="noopener">verbecc</a> (LGPL-3.0)
        </li>
        <li>
          Scheduling: <a href="https://github.com/open-spaced-repetition/ts-fsrs" target="_blank" rel="noopener">FSRS (ts-fsrs)</a>
        </li>
      </ul>
    </div>
  );
}
