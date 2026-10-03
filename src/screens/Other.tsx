import { useEffect, useState } from 'preact/hooks';
import { exportAll, getAssessments, importAll, logsFor, resetCourse, today, type CardRec, type Difficulty, type LogRec } from '../db';
import { LEVEL_NAMES, type AReport } from '../assessment';
import { ta } from '../i18n-assess';
import { fmt, t } from '../i18n';
import { lessonPassed, lessonsOf } from '../lessons';
import { loadProgress, topicStats, unitComplete, weakWords, type ProgressInfo } from '../progress';
import { go } from '../router';
import { retrievability } from '../srs';
import { bump, getState, updateSettings } from '../store';
import { speak, voicesFor } from '../tts';
import { LEVELS, type LoadedCourse } from '../types';
import { Loading } from '../ui/common';
import { AccountBlock } from './Account';
import { lessonsPassedCount, streakOf } from './Main';

const DAY = 86400000;

/** Exercise labels grouped into skills. */
const SKILLS: [string, string[]][] = [
  ['recognition', ['mcq-t2n', 'mcq-sent', 'read']],
  ['recall', ['type-n2t', 'mcq-n2t', 'cloze-word', 'translate']],
  ['listening', ['mcq-listen', 'type-listen', 'dictation']],
  ['grammar', ['drill-gap', 'drill-choice', 'drill-transform', 'cloze']],
  ['conjugation', ['conj']],
  ['sentences', ['build']],
];

function bestStreak(days: string[]) {
  const set = [...new Set(days)].sort();
  let best = 0;
  let run = 0;
  let prev = 0;
  for (const d of set) {
    const ts = new Date(d + 'T12:00:00').getTime();
    run = prev && Math.round((ts - prev) / DAY) === 1 ? run + 1 : 1;
    best = Math.max(best, run);
    prev = ts;
  }
  return best;
}

function hm(sec: number) {
  const m = Math.round(sec / 60);
  return m < 60 ? `${m} ${t().mins}` : `${Math.floor(m / 60)} ${t().hours} ${m % 60} ${t().mins}`;
}

export function Stats({ c }: { c: LoadedCourse }) {
  const [info, setInfo] = useState<ProgressInfo | null>(null);
  const [logs, setLogs] = useState<LogRec[] | null>(null);
  const [allTopics, setAllTopics] = useState(false);
  const [assess, setAssess] = useState<AReport[]>([]);
  useEffect(() => {
    void loadProgress(c).then(setInfo);
    void logsFor(c.meta.id).then(setLogs);
    void getAssessments<AReport>(c.meta.id).then(setAssess);
  }, [c]);
  if (!info || !logs) return <Loading />;
  const prog = info.prog;
  const now = Date.now();
  const start0 = new Date();
  start0.setHours(0, 0, 0, 0);
  const todayStart = start0.getTime();

  // totals
  const totalSec = Object.values(prog.time || {}).reduce((a, b) => a + b, 0);
  const recent = logs.filter((l) => l.ts > now - 30 * DAY);
  const acc30 = recent.length ? Math.round((100 * recent.filter((l) => l.ok).length) / recent.length) : null;
  const wordsCards = info.cards.filter((x) => x.kind === 'wp');
  const mature = wordsCards.filter((x) => x.stability >= 21).length;
  const topicsStudied = new Set<string>();
  for (const u of c.units) {
    const r = info.units.get(u.id);
    if (r) for (const l of lessonsOf(c, u)) if (l.topic && lessonPassed(l, r)) topicsStudied.add(l.topic.id);
  }
  const unitsDone = c.units.filter((u) => unitComplete(c, u, info.units.get(u.id))).length;

  // activity heatmap: 20 weeks ending this week
  const perDay = new Map<string, number>();
  for (const l of logs) {
    const k = today(new Date(l.ts));
    perDay.set(k, (perDay.get(k) || 0) + 1);
  }
  const weeks = 20;
  const end = new Date(todayStart);
  end.setDate(end.getDate() + (6 - ((end.getDay() + 6) % 7))); // Sunday of this week
  const cells: { key: string; n: number; future: boolean }[] = [];
  for (let i = weeks * 7 - 1; i >= 0; i--) {
    const d = new Date(end);
    d.setDate(d.getDate() - i);
    const key = today(d);
    cells.push({ key, n: perDay.get(key) || 0, future: d.getTime() > now });
  }
  const maxDay = Math.max(1, ...cells.map((x) => x.n));
  const heat = (n: number) => (n === 0 ? 0 : n < maxDay * 0.25 ? 1 : n < maxDay * 0.5 ? 2 : n < maxDay * 0.75 ? 3 : 4);

  // last 14 days: minutes and answers
  const days14: { label: string; min: number; n: number; acc: number | null }[] = [];
  for (let i = 13; i >= 0; i--) {
    const s = todayStart - i * DAY;
    const d = new Date(s);
    const ls = logs.filter((l) => l.ts >= s && l.ts < s + DAY);
    days14.push({
      label: String(d.getDate()),
      min: Math.round((prog.time?.[today(d)] || 0) / 60),
      n: ls.length,
      acc: ls.length ? ls.filter((l) => l.ok).length / ls.length : null,
    });
  }
  const maxMin = Math.max(1, ...days14.map((x) => x.min));

  // skills
  const skills = SKILLS.map(([k, labels]) => {
    const ls = recent.filter((l) => labels.includes(l.ex));
    return { k, n: ls.length, acc: ls.length ? ls.filter((l) => l.ok).length / ls.length : null };
  });

  // memory strength of words
  const nowD = new Date();
  const mem = { learning: 0, young: 0, mature: 0, fading: 0 };
  for (const x of wordsCards) {
    const r = retrievability(x, nowD);
    if (r < 0.8 && x.reps > 1) mem.fading++;
    else if (x.stability >= 21) mem.mature++;
    else if (x.stability >= 3) mem.young++;
    else mem.learning++;
  }
  const memTotal = Math.max(1, wordsCards.length);

  // forecast
  const forecast: number[] = [];
  for (let i = 0; i < 7; i++) {
    const e = todayStart + (i + 1) * DAY;
    const s = i === 0 ? 0 : e - DAY;
    forecast.push(info.cards.filter((x) => x.due > s && x.due <= e).length);
  }
  const maxF = Math.max(1, ...forecast);

  // grammar topics
  const ts = topicStats(logs);
  const gcards = new Map(info.cards.filter((x) => x.kind === 'g').map((x) => [x.ref, x] as [string, CardRec]));
  const topicRows = [...topicsStudied]
    .map((id) => ({ id, tp: c.topicById.get(id)!, st: ts.get(id), card: gcards.get(id) }))
    .filter((x) => x.tp)
    .sort((a, b) => (a.st?.acc ?? 1) - (b.st?.acc ?? 1));
  const hard = weakWords(info.cards, logs).slice(0, 10);

  return (
    <div class="page stats">
      <h2>{t().stats}</h2>
      <div class="result-grid">
        <div class="stat">
          <small>{t().streak}</small>
          <b>{streakOf(prog.days)}</b>
          <small class="muted">
            {t().bestStreak}: {bestStreak(prog.days)}
          </small>
        </div>
        <div class="stat">
          <small>{t().studyTime}</small>
          <b>{hm(totalSec)}</b>
          <small class="muted">
            {prog.days.length} {t().studyDaysShort}
          </small>
        </div>
        <div class="stat">
          <small>{t().lessonsDoneTotal}</small>
          <b>{lessonsPassedCount(c, info)}</b>
          <small class="muted">
            {t().units}: {unitsDone}/{c.units.length}
          </small>
        </div>
        <div class="stat">
          <small>{t().learnedWords}</small>
          <b>{info.learned.size}</b>
          <small class="muted">
            {t().wordsKnownShort}: {mature}
          </small>
        </div>
        <div class="stat">
          <small>{t().grammar}</small>
          <b>
            {topicsStudied.size}/{c.topics.length}
          </b>
          <small class="muted">{t().topicsStudied}</small>
        </div>
        <div class="stat">
          <small>{t().accuracy30}</small>
          <b>{acc30 === null ? '—' : `${acc30}%`}</b>
          <small class="muted">
            {logs.length} {t().answers}
          </small>
        </div>
      </div>

      <div class="card assess-card">
        <h4>{ta().lastAssessment}</h4>
        {assess.length ? (
          (() => {
            const r = assess[assess.length - 1];
            return (
              <>
                <div class="row-between">
                  <span>
                    <b class="big-level small-level">{LEVEL_NAMES[r.overall.level]}</b>{' '}
                    {r.vocab && <span class="muted">· ≈ {r.vocab.estimate.toLocaleString()} {t().words.toLowerCase()}</span>}
                  </span>
                  <small class="muted">{new Date(r.ts).toLocaleDateString()}</small>
                </div>
                <div class="chips">
                  {(['vocab', 'grammar', 'reading', 'listening', 'writing'] as const).map(
                    (k) =>
                      r.skills[k] && (
                        <span class="chip">
                          {ta().skillNames[k]}: <b>{LEVEL_NAMES[r.skills[k]!.level]}</b>
                        </span>
                      ),
                  )}
                </div>
                <div class="ex-actions">
                  <a class="btn small" href={`#/assessment/${assess.length - 1}`}>
                    {ta().openReport}
                  </a>
                  <a class="btn small" href="#/placement">
                    {ta().retake}
                  </a>
                </div>
              </>
            );
          })()
        ) : (
          <>
            <p class="muted small">{ta().lead}</p>
            <a class="btn small primary" href="#/placement">
              {ta().start}
            </a>
          </>
        )}
      </div>

      <div class="card">
        <h4>{t().activity}</h4>
        <div class="heatmap" style={{ gridTemplateColumns: `repeat(${weeks}, 1fr)` }}>
          {Array.from({ length: weeks }, (_, w) => (
            <div class="heat-col">
              {cells.slice(w * 7, w * 7 + 7).map((x) => (
                <i class={`h${x.future ? 'f' : heat(x.n)}`} title={`${x.key}: ${x.n}`} />
              ))}
            </div>
          ))}
        </div>
      </div>

      <div class="card">
        <h4>{t().minutesPerDay}</h4>
        <div class="bars labeled">
          {days14.map((d) => (
            <div class="bar-wrap" title={`${d.min} ${t().mins} · ${d.n} ${t().answers}${d.acc !== null ? ` · ${Math.round(d.acc * 100)}%` : ''}`}>
              <div class="bar" style={{ height: `${(100 * d.min) / maxMin}%` }}>
                {d.min > 0 && <span>{d.min}</span>}
              </div>
              <small>{d.label}</small>
            </div>
          ))}
        </div>
      </div>

      <div class="card">
        <h4>{t().skills}</h4>
        {skills.map((s) => (
          <div class="level-row wide">
            <span>{t().skillNames[s.k]}</span>
            <div class="progress">
              <div class={s.acc !== null && s.acc < 0.7 ? 'low' : ''} style={{ width: `${s.acc === null ? 0 : s.acc * 100}%` }} />
            </div>
            <span>{s.acc === null ? '—' : `${Math.round(s.acc * 100)}%`}</span>
          </div>
        ))}
        <small class="muted">{t().skillsNote}</small>
      </div>

      <div class="card">
        <h4>{t().wordsByLevel}</h4>
        {LEVELS.map((L) => {
          const all = c.units.filter((u) => u.level === L).flatMap((u) => u.words);
          const k = all.filter((id) => info.known.has(id)).length;
          return (
            <div class="level-row">
              <span>{L}</span>
              <div class="progress">
                <div style={{ width: `${(100 * k) / Math.max(1, all.length)}%` }} />
              </div>
              <span>
                {k}/{all.length}
              </span>
            </div>
          );
        })}
      </div>

      <div class="card">
        <h4>{t().memoryTitle}</h4>
        <div class="stack">
          {(['mature', 'young', 'learning', 'fading'] as const).map((k) => (
            <div class={`seg ${k}`} style={{ width: `${(100 * mem[k]) / memTotal}%` }} />
          ))}
        </div>
        <div class="legend">
          {(['mature', 'young', 'learning', 'fading'] as const).map((k) => (
            <span>
              <i class={`dot ${k}`} /> {t().memNames[k]}: <b>{mem[k]}</b>
            </span>
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

      {topicRows.length > 0 && (
        <div class="card">
          <h4>{t().grammarTopics}</h4>
          <table class="topic-table">
            {(allTopics ? topicRows : topicRows.slice(0, 8)).map((r) => (
              <tr onClick={() => go(`/topic/${r.id}`)}>
                <td>{r.tp.title}</td>
                <td class={r.st && r.st.acc < 0.7 ? 'bad' : ''}>{r.st ? `${Math.round(r.st.acc * 100)}%` : '—'}</td>
                <td class="muted">{r.card ? `${Math.round(retrievability(r.card) * 100)}%` : ''}</td>
              </tr>
            ))}
          </table>
          <small class="muted">{t().topicTableNote}</small>
          {topicRows.length > 8 && !allTopics && (
            <div>
              <button class="btn small" onClick={() => setAllTopics(true)}>
                {t().showMore}
              </button>
            </div>
          )}
        </div>
      )}

      {hard.length > 0 && (
        <div class="card">
          <h4>{t().hardestWords}</h4>
          <div class="chips">
            {hard.map((x) => {
              const w = c.wordById.get(Number(x.ref));
              return (
                w && (
                  <a class="chip" href={`#/word/${w.id}`} title={w.tr}>
                    {w.w} {x.lapses > 0 && <small class="muted">×{x.lapses}</small>}
                  </a>
                )
              );
            })}
          </div>
          <a class="btn small" href="#/practice/weak">
            {t().practiceWeak}
          </a>
        </div>
      )}
    </div>
  );
}

declare const __BUILT_AT__: number;
declare const __COMMIT__: string;

export function SettingsPage({ c }: { c: LoadedCourse | null }) {
  const s = getState().settings;
  const [msg, setMsg] = useState('');
  const voices = c ? voicesFor(c.meta.tts) : [];
  return (
    <div class="page settings">
      <h2>{t().settings}</h2>
      <AccountBlock />
      <label class="set-row">
        <span>
          {t().settingsDifficulty}
          <small class="muted">{t().diffHelp[s.difficulty]}</small>
        </span>
        <select value={s.difficulty} onChange={(e) => void updateSettings({ difficulty: (e.target as HTMLSelectElement).value as Difficulty })}>
          {(['auto', 'easy', 'normal', 'hard'] as const).map((k) => (
            <option value={k}>{t().diffNames[k]}</option>
          ))}
        </select>
      </label>
      <label class="set-row">
        <span>{t().settingsGoal}</span>
        <input
          type="number"
          min={1}
          max={20}
          value={s.dailyGoal}
          onChange={(e) => void updateSettings({ dailyGoal: Math.max(1, Math.min(20, Number((e.target as HTMLInputElement).value) || 1)) })}
        />
      </label>
      <label class="set-row">
        <span>{t().settingsHints}</span>
        <input type="checkbox" checked={s.hints} onChange={(e) => void updateSettings({ hints: (e.target as HTMLInputElement).checked })} />
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
      <p class="version muted small">
        {t().appVersion}: {new Date(__BUILT_AT__).toLocaleString([], { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })} · {__COMMIT__}
        {c && (
          <>
            <br />
            {t().dataVersion}: {c.meta.version}
          </>
        )}
      </p>
    </div>
  );
}

export { fmt };
