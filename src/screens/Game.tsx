import { useEffect, useMemo, useState } from 'preact/hooks';
import { getAssessments, type LogRec } from '../db';
import { getEssays, type Essay } from '../essays';
import { getMistakes, isFixed, shown } from '../mistakes';
import { achievements, leaderboard, newlyUnlocked, profileLevel, pushStats, streakInfo, weekXp, xpEvents, xpTotals, type Achievement, type Board } from '../gamify';
import { fmt, t } from '../i18n';
import { lessonPassed, lessonsOf } from '../lessons';
import { loadLogs, loadProgress, type ProgressInfo } from '../progress';
import { getState } from '../store';
import { session } from '../sync';
import type { LoadedCourse } from '../types';
import { Loading, Progress } from '../ui/common';

export interface Game {
  info: ProgressInfo;
  xp: { total: number; week: number; today: number };
  level: { level: number; into: number; need: number };
  streak: ReturnType<typeof streakInfo>;
  ach: Achievement[];
  fresh: Achievement[];
}

/** Everything about XP, level, streak and achievements for the open course (and push it to the board). */
export function useGame(c: LoadedCourse, tick: number): Game | null {
  const [g, setG] = useState<Game | null>(null);
  useEffect(() => {
    let alive = true;
    void (async () => {
      const [info, logs, essays, assess, mistakes] = await Promise.all([loadProgress(c), loadLogs(c), getEssays(c.meta.id), getAssessments<{ ts: number }>(c.meta.id), getMistakes(c.meta.id)]);
      const ev = xpEvents(c, info, logs as LogRec[], essays as Essay[], assess, getState().settings.dailyGoal);
      const xp = xpTotals(ev);
      const level = profileLevel(xp.total);
      const streak = streakInfo(info.prog.days);
      const ach = achievements(c, info, logs, essays, assess, mistakes.filter((m) => shown(m) && isFixed(m)).length);
      const fresh = newlyUnlocked(c.meta.id, ach);
      const lessons = c.units.reduce((n, u) => n + lessonsOf(c, u).filter((l) => lessonPassed(l, info.units.get(u.id))).length, 0);
      if (alive) setG({ info, xp, level, streak, ach, fresh });
      void pushStats(c.meta.id, { xpWeek: xp.week, xpTotal: xp.total, streak: streak.current, best: streak.best, words: info.learned.size, level: level.level, lessons, achievements: ach.filter((a) => a.done).length });
    })();
    return () => {
      alive = false;
    };
  }, [c, tick]);
  return g;
}

/** Celebration: confetti pieces that fall and fade (skipped with reduced motion). */
export function Confetti() {
  const pieces = useMemo(() => Array.from({ length: 36 }, (_, i) => ({ left: Math.random() * 100, delay: Math.random() * 0.4, hue: (i * 47) % 360, rot: Math.random() * 360 })), []);
  const [on, setOn] = useState(true);
  useEffect(() => {
    const id = setTimeout(() => setOn(false), 2600);
    return () => clearTimeout(id);
  }, []);
  if (!on) return null;
  return (
    <div class="confetti" aria-hidden="true">
      {pieces.map((p) => (
        <i style={{ left: `${p.left}%`, animationDelay: `${p.delay}s`, background: `hsl(${p.hue} 80% 60%)`, transform: `rotate(${p.rot}deg)` }} />
      ))}
    </div>
  );
}

export function AchievementToast({ list }: { list: Achievement[] }) {
  const [open, setOpen] = useState(list.length > 0);
  if (!open || !list.length) return null;
  return (
    <>
      <Confetti />
      <div class="ach-toast" role="status" onClick={() => setOpen(false)}>
        <b>{list.length > 1 ? t().achNewMany : t().achNew}</b>
        {list.map((a) => (
          <div>
            {a.icon} {t().ach[a.id]?.[0] || a.id}
          </div>
        ))}
        <small class="muted">{t().tapToClose}</small>
      </div>
    </>
  );
}

/** Home: XP, level and this week's board in one card. */
export function XpCard({ c, g }: { c: LoadedCourse; g: Game }) {
  const [board, setBoard] = useState<Board[] | null>(null);
  useEffect(() => void leaderboard().then(setBoard), [g]);
  const sorted = board ? [...board].sort((a, b) => weekXp(b) - weekXp(a)) : null;
  return (
    <a class="card xp-card" href="#/game">
      <div class="row-between">
        <span>
          <b class="xp-num">⚡ {g.xp.week}</b> <small class="muted">{t().xpWeek}</small>
        </span>
        <span class="pill">
          {t().profileLevel} {g.level.level}
        </span>
      </div>
      <Progress value={g.level.into} max={g.level.need} />
      {sorted && sorted.length > 1 && (
        <div class="mini-board">
          {sorted.map((b, i) => (
            <span class={b.me ? 'me' : ''}>
              {i === 0 ? '🥇' : '🥈'} {b.me ? t().you : b.name} · {weekXp(b)}
            </span>
          ))}
        </div>
      )}
      <small class="muted">{c.meta.title}</small>
    </a>
  );
}

/** Rating and achievements page. */
export function GamePage({ c, tick }: { c: LoadedCourse; tick: number }) {
  const g = useGame(c, tick);
  const [board, setBoard] = useState<Board[] | null | undefined>(undefined);
  useEffect(() => void leaderboard().then(setBoard), [tick]);
  if (!g) return <Loading />;
  const T = t();
  const sorted = board ? [...board].sort((a, b) => weekXp(b) - weekXp(a)) : null;
  const done = g.ach.filter((a) => a.done).length;
  return (
    <div class="page game">
      <h2>{T.gameTitle}</h2>
      <AchievementToast list={g.fresh} />
      <div class="card level-card">
        <div class="row-between">
          <b class="big-level small-level">
            {T.profileLevel} {g.level.level}
          </b>
          <span class="muted">{fmt(T.xpToNext, { n: g.level.need - g.level.into })}</span>
        </div>
        <Progress value={g.level.into} max={g.level.need} />
        <div class="result-grid">
          <div class="stat">
            <small>{T.xpToday}</small>
            <b>{g.xp.today}</b>
          </div>
          <div class="stat">
            <small>{T.xpWeek}</small>
            <b>{g.xp.week}</b>
          </div>
          <div class="stat">
            <small>{T.xpTotal}</small>
            <b>{g.xp.total}</b>
          </div>
          <div class="stat">
            <small>{T.streak}</small>
            <b>🔥 {g.streak.current}</b>
            <small class="muted">
              {T.bestStreak}: {g.streak.best}
            </small>
          </div>
        </div>
        <p class="small muted">
          ❄️ {g.streak.freezeLeft ? T.freezeLeft : T.freezeUsed}
          {g.streak.frozen.length > 0 && ` · ${fmt(T.freezeSaved, { n: g.streak.frozen.length })}`}
        </p>
      </div>

      <div class="card">
        <h4>{T.boardTitle}</h4>
        {!session() ? (
          <p class="muted small">{T.boardLogin}</p>
        ) : board === undefined ? (
          <Loading />
        ) : !sorted || !sorted.length ? (
          <p class="muted small">{T.boardEmpty}</p>
        ) : (
          <table class="topic-table board">
            <tr class="muted small">
              <td />
              <td>{T.xpWeek}</td>
              <td>🔥</td>
              <td>{T.words}</td>
              <td>{T.profileLevel}</td>
            </tr>
            {sorted.map((b, i) => {
              const cs = Object.values(b.courses);
              return (
                <tr class={b.me ? 'me' : ''}>
                  <td>
                    {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`} {b.me ? `${b.name} (${T.you})` : b.name}
                    <div class="muted small">{Object.keys(b.courses).join(', ')}</div>
                  </td>
                  <td>
                    <b>{weekXp(b)}</b>
                  </td>
                  <td>{Math.max(0, ...cs.map((x) => x.streak))}</td>
                  <td>{cs.reduce((s, x) => s + x.words, 0)}</td>
                  <td>{Math.max(1, ...cs.map((x) => x.level))}</td>
                </tr>
              );
            })}
          </table>
        )}
        <small class="muted">{T.boardNote}</small>
      </div>

      <div class="card">
        <h4>
          {T.achTitle} · {done}/{g.ach.length}
        </h4>
        <div class="ach-grid">
          {g.ach.map((a) => (
            <div class={`ach ${a.done ? 'done' : ''}`} title={T.ach[a.id]?.[1]}>
              <span class="ach-icon">{a.icon}</span>
              <b>{T.ach[a.id]?.[0] || a.id}</b>
              <small class="muted">{T.ach[a.id]?.[1]}</small>
              {!a.done && a.goal > 1 && <Progress value={a.value} max={a.goal} />}
            </div>
          ))}
        </div>
      </div>

      <div class="card">
        <h4>{T.xpHowTitle}</h4>
        <ul class="small">
          {T.xpHow.map((x) => (
            <li>{x}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}
