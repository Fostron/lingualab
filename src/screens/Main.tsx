import { useEffect, useMemo, useState } from 'preact/hooks';
import { COURSES, displayWord, genderTag, loadRefDict, OXFORD, oxfordUrl, sentText, type RefEntry } from '../content';
import { today, type CardRec, type LogRec, type UnitRec } from '../db';
import { fmt, t } from '../i18n';
import { lessonPassed, lessonsOf, lessonUnlocked, unitComplete, unitUnlocked } from '../lessons';
import { applyPlacement, loadLogs, loadProgress, weakTopics, weakWords, type ProgressInfo } from '../progress';
import { go } from '../router';
import { retrievability } from '../srs';
import { bump, getState, selectCourse } from '../store';
import { bestVoice, speak, ttsAvailable } from '../tts';
import { LEVELS, type LoadedCourse, type Unit, type Word } from '../types';
import { Icon, Loading, Markdown, Progress, SentenceView, SpeakBtn, WordLine, tl } from '../ui/common';
import { lessonTitle } from './Study';
import { ta } from '../i18n-assess';

export function Welcome() {
  return (
    <div class="page welcome">
      <div class="brand">
        <span class="logo">L</span>
        <h1>LinguaLab</h1>
      </div>
      <p class="tagline">{t().tagline}</p>
      <h3>{t().chooseCourse}</h3>
      <div class="course-list">
        {COURSES.map((ci) => (
          <button
            class="course-card"
            onClick={async () => {
              await selectCourse(ci.id);
              go('/');
            }}
          >
            <span class={`flag flag-${ci.target}`}>{ci.flag}</span>
            <span>
              <b>{ci.title}</b>
              <small>{ci.subtitle}</small>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function useInfo(c: LoadedCourse, tick: number, withLogs = false) {
  const [info, setInfo] = useState<ProgressInfo | null>(null);
  const [logs, setLogs] = useState<LogRec[] | null>(withLogs ? null : []);
  useEffect(() => {
    void loadProgress(c).then(setInfo);
    if (withLogs) void loadLogs(c).then(setLogs);
  }, [c, tick]);
  return { info, logs };
}

export function streakOf(days: string[]) {
  const set = new Set(days);
  let n = 0;
  const d = new Date();
  if (!set.has(today(d))) d.setDate(d.getDate() - 1);
  while (set.has(today(d))) {
    n++;
    d.setDate(d.getDate() - 1);
  }
  return n;
}

export function lessonsPassedCount(c: LoadedCourse, info: ProgressInfo) {
  let n = 0;
  for (const u of c.units) {
    const r = info.units.get(u.id);
    if (r) for (const l of lessonsOf(c, u)) if (lessonPassed(l, r)) n++;
  }
  return n;
}

function Onboarding({ c }: { c: LoadedCourse }) {
  return (
    <div class="page onboarding">
      <h2>{c.meta.title}</h2>
      <p class="muted">{c.meta.subtitle}</p>
      <div class="card how">
        <h4>{t().howTitle}</h4>
        <ol>
          {t().howItems.map((x) => (
            <li>{x}</li>
          ))}
        </ol>
      </div>
      <h3>{t().whereStart}</h3>
      <div class="choice-cards">
        <button
          class="choice-card primary"
          onClick={async () => {
            await applyPlacement(c, 0, 'A0', 0, {});
            bump();
            const first = lessonsOf(c, c.units[0])[0];
            go(`/lesson/${c.units[0].id}/${first.slug}`);
          }}
        >
          <b>{t().placementFromZero}</b>
          <small>{t().fromZeroNote}</small>
        </button>
        <a class="choice-card" href="#/placement">
          <b>{t().placementTake}</b>
          <small>{t().placementNote}</small>
        </a>
      </div>
    </div>
  );
}

export function Home({ c, tick }: { c: LoadedCourse; tick: number }) {
  const { info, logs } = useInfo(c, tick, true);
  if (!info || !logs) return <Loading />;
  const prog = info.prog;
  if (!prog.placement && info.units.size === 0) return <Onboarding c={c} />;
  const next = info.next;
  const unit = next?.unit || info.current;
  const lessons = lessonsOf(c, unit);
  const rec = info.units.get(unit.id);
  const passed = lessons.filter((l) => lessonPassed(l, rec)).length;
  const levelUnits = c.units.filter((u) => u.level === unit.level);
  const levelDone = levelUnits.filter((u) => unitComplete(c, u, info.units.get(u.id))).length;
  const hasVoice = ttsAvailable() && !!bestVoice(c.meta.tts);
  const d = today();
  const lessonsToday = prog.lessonsDone?.[d] || 0;
  const goal = getState().settings.dailyGoal;
  const minsToday = Math.round((prog.time?.[d] || 0) / 60);
  const weakT = weakTopics(logs)
    .map((s) => c.topicById.get(s.id))
    .filter(Boolean);
  const weakW = weakWords(info.cards, logs);
  const longTerm = info.cards.filter((x) => x.kind === 'wp' && x.stability >= 21).length;
  const many = info.due.length >= 40;
  return (
    <div class="page home">
      <div class="home-head">
        <div>
          <small class="muted">{c.meta.title}</small>
          <h2>
            {t().level} {unit.level}
          </h2>
        </div>
        <div class="streak" title={t().streak}>
          <b>{streakOf(prog.days)}</b>
          <small>{t().streak}</small>
        </div>
      </div>
      <div class="level-line">
        <Progress value={levelDone} max={levelUnits.length} />
        <small class="muted">{fmt(t().unitsOfLevel, { a: levelDone, b: levelUnits.length, level: unit.level })}</small>
      </div>

      <div class="goal card">
        <div class={`goal-ring ${lessonsToday >= goal ? 'met' : ''}`} style={{ '--p': `${Math.min(100, (100 * lessonsToday) / Math.max(1, goal))}` } as any}>
          <span>
            {lessonsToday}/{goal}
          </span>
        </div>
        <div>
          <b>{lessonsToday >= goal ? t().goalMet : t().dailyGoal}</b>
          <small class="muted">
            {fmt(t().todayStats, { m: minsToday, n: lessonsToday })}
          </small>
        </div>
      </div>

      {next ? (
        <button class="continue-card" onClick={() => go(`/lesson/${unit.id}/${next.slug}`)}>
          <small>
            {t().unit} {unit.n}: {unit.title} · {fmt(t().lessonOf, { i: next.idx + 1, n: lessons.length })}
          </small>
          <b>{lessonTitle(c, next)}</b>
          <div class="lesson-dots">
            {lessons.map((l) => (
              <span class={lessonPassed(l, rec) ? 'on' : l === next ? 'cur' : ''} />
            ))}
          </div>
          <span class="btn primary">{passed ? t().continue : t().start} →</span>
        </button>
      ) : (
        <div class="card">
          <b>{t().courseDone}</b>
        </div>
      )}

      <div class="cards-row">
        <button class={`action-card ${info.due.length ? 'hot' : ''}`} onClick={() => go('/review')} disabled={!info.due.length}>
          <Icon name="review" size={26} />
          <b>{info.due.length}</b>
          <span>{info.due.length ? t().dueNow : t().nothingDue}</span>
        </button>
        <button class="action-card" onClick={() => go('/practice/weak')} disabled={!weakT.length && !weakW.length}>
          <Icon name="dumbbell" size={26} />
          <b>{weakT.length + Math.min(weakW.length, 99)}</b>
          <span>{weakT.length || weakW.length ? t().weakSpots : t().noWeakShort}</span>
        </button>
      </div>
      {many && <p class="note">{t().reviewFirst}</p>}
      {weakT.length > 0 && (
        <div class="card weak">
          <h4>{t().needsAttention}</h4>
          {weakT.slice(0, 3).map((tp) => (
            <a class="weak-row" href={`#/topic/${tp!.id}`}>
              <span>{tp!.title}</span>
              <small>{t().reread} →</small>
            </a>
          ))}
        </div>
      )}

      <div class="stats-mini">
        <div>
          <b>{info.learned.size}</b>
          <small>{t().learnedWords}</small>
        </div>
        <div>
          <b>{longTerm}</b>
          <small>{t().wordsKnown}</small>
        </div>
        <div>
          <b>{lessonsPassedCount(c, info)}</b>
          <small>{t().lessonsDoneTotal}</small>
        </div>
      </div>
      {!hasVoice && <p class="warn">{t().noVoice}</p>}
    </div>
  );
}

export function Path({ c, tick }: { c: LoadedCourse; tick: number }) {
  const { info } = useInfo(c, tick);
  const [openLv, setOpenLv] = useState<string | null>(null);
  if (!info) return <Loading />;
  const curLevel = info.current.level;
  const shown = openLv || curLevel;
  return (
    <div class="page path">
      <div class="row-between">
        <h2>{t().units}</h2>
        <a class="btn small" href="#/placement">
          {ta().title}
        </a>
      </div>
      <p class="muted small">{t().pathNote}</p>
      {LEVELS.map((L) => {
        const us = c.units.filter((u) => u.level === L);
        if (!us.length) return null;
        const done = us.filter((u) => unitComplete(c, u, info.units.get(u.id))).length;
        const open = shown === L;
        return (
          <section class="level-block">
            <button class={`level-head ${open ? 'open' : ''}`} onClick={() => setOpenLv(open ? '-' : L)}>
              <span class="pill">{L}</span>
              <span class="level-name">{t().levelNames[L]}</span>
              <span class="muted">
                {done}/{us.length}
              </span>
              <Progress value={done} max={us.length} />
            </button>
            {open &&
              us.map((u) => {
                const idx = c.units.indexOf(u);
                return <UnitRow c={c} u={u} rec={info.units.get(u.id)} open={unitUnlocked(c, idx, info.units)} current={u.id === info.current.id} />;
              })}
          </section>
        );
      })}
    </div>
  );
}

function UnitRow({ c, u, rec, open, current }: { c: LoadedCourse; u: Unit; rec?: UnitRec; open: boolean; current: boolean }) {
  const ls = lessonsOf(c, u);
  const passed = ls.filter((l) => lessonPassed(l, rec)).length;
  const complete = unitComplete(c, u, rec);
  const st = complete ? 'done' : !open ? 'locked' : passed ? 'learning' : 'new';
  const body = (
    <>
      <span class="unit-n">{complete ? <Icon name="check" size={18} /> : !open ? <Icon name="lock" size={16} /> : u.n}</span>
      <span class="unit-body">
        <b>
          {u.n}. {u.title}
        </b>
        <small>
          {rec?.status === 'known'
            ? t().known
            : complete
              ? `${t().done}${rec?.test ? ` · ${t().unitTest} ${Math.round(rec.test.score * 100)}%` : ''}`
              : !open
                ? t().lockedUnit
                : fmt(t().lessonsProgress, { a: passed, b: ls.length })}
        </small>
        {open && !complete && passed > 0 && <Progress value={passed} max={ls.length} />}
      </span>
    </>
  );
  if (!open) return <div class={`unit-row st-${st}`}>{body}</div>;
  return (
    <a class={`unit-row st-${st} ${current ? 'current' : ''}`} href={`#/unit/${u.id}`}>
      {body}
    </a>
  );
}

export function UnitView({ c, unitId, tick }: { c: LoadedCourse; unitId: string; tick: number }) {
  const unit = c.unitById.get(unitId);
  const { info } = useInfo(c, tick);
  if (!unit) return <div class="page">?</div>;
  if (!info) return <Loading />;
  const idx = c.units.indexOf(unit);
  const rec = info.units.get(unit.id);
  const open = unitUnlocked(c, idx, info.units);
  const ls = lessonsOf(c, unit);
  const passed = ls.filter((l) => lessonPassed(l, rec)).length;
  const words = unit.words.map((id) => c.wordById.get(id)!).filter(Boolean);
  const learnedW = words.filter((w) => info.known.has(w.id));
  const next = ls.find((l) => !lessonPassed(l, rec));
  return (
    <div class="page unit">
      <a href="#/path" class="muted">
        ← {t().units}
      </a>
      <h2>
        <span class="pill">{unit.level}</span> {t().unit} {unit.n}: {unit.title}
      </h2>
      {!open ? (
        <div class="card lock-card">
          <p>🔒 {t().lockedUnitLong}</p>
          {info.next && (
            <a class="btn primary" href={`#/lesson/${info.next.unit.id}/${info.next.slug}`}>
              {t().continueWhere}
            </a>
          )}
        </div>
      ) : (
        <>
          <div class="level-line">
            <Progress value={passed} max={ls.length} />
            <small class="muted">{fmt(t().lessonsProgress, { a: passed, b: ls.length })}</small>
          </div>
          <div class="lesson-list">
            {ls.map((l) => {
              const ok = lessonPassed(l, rec);
              const can = lessonUnlocked(c, l, open, rec);
              const r = rec?.lessons?.[l.slug];
              const cur = l === next;
              const inner = (
                <>
                  <span class={`step-n ${ok ? 'ok' : ''}`}>{ok ? <Icon name="check" size={16} /> : can ? l.idx + 1 : <Icon name="lock" size={14} />}</span>
                  <span>
                    <b>{lessonTitle(c, l)}</b>
                    <small>
                      {ok
                        ? r && r.tries
                          ? `${t().best}: ${Math.round(r.best * 100)}%`
                          : t().done
                        : l.kind === 'test' && !cur
                          ? t().testOutNote
                          : can
                            ? r
                              ? `${t().best}: ${Math.round(r.best * 100)}% · ${t().notPassedYet}`
                              : t().lessonKinds[l.kind]
                            : t().lessonKinds[l.kind]}
                    </small>
                  </span>
                </>
              );
              return can ? (
                <a class={`step ${ok ? 'done' : ''} ${cur ? 'current' : ''}`} href={`#/lesson/${unit.id}/${l.slug}`}>
                  {inner}
                </a>
              ) : (
                <div class="step locked">{inner}</div>
              );
            })}
          </div>
        </>
      )}
      {unit.topics.length > 0 && (
        <>
          <h3>{t().grammar}</h3>
          <div class="topic-list">
            {unit.topics.map((tid) => (
              <a class="topic-link" href={`#/topic/${tid}/${unit.id}`}>
                {c.topicById.get(tid)?.title}
              </a>
            ))}
          </div>
        </>
      )}
      <h3>{t().wordsOfUnit}</h3>
      <div class="word-list">
        {learnedW.map((w) => (
          <WordLine w={w} onClick={() => go(`/word/${w.id}`)} />
        ))}
      </div>
      {words.length > learnedW.length && <p class="muted">{fmt(t().upcomingWords, { n: words.length - learnedW.length })}</p>}
      {open && learnedW.length > 0 && unit.sents.length > 0 && (
        <>
          <h3>{t().examples}</h3>
          <div class="sent-list">
            {unit.sents
              .map((id) => c.sents.get(id)!)
              .filter((s) => s && s.tk.every(([, w]) => !w || info.known.has(w)))
              .slice(0, 8)
              .map((s) => (
                <div class="ex-sent">
                  <SpeakBtn text={sentText(s)} audio={s.au} small /> <SentenceView s={s} />
                  <div class="tr">{s.tr}</div>
                </div>
              ))}
          </div>
        </>
      )}
    </div>
  );
}

export function TopicView({ c, topicId, unitId }: { c: LoadedCourse; topicId: string; unitId?: string }) {
  const topic = c.topicById.get(topicId);
  const unit = unitId ? c.unitById.get(unitId) : c.units.find((u) => u.topics.includes(topicId));
  if (!topic) return <div class="page">?</div>;
  const exs = topic.ex.map((id) => c.sents.get(id)).filter(Boolean).slice(0, 8);
  return (
    <div class="page topic">
      <a href={unit ? `#/unit/${unit.id}` : '#/grammar'} class="muted">
        ← {unit ? `${t().unit} ${unit.n}` : t().grammar}
      </a>
      <h2>
        <span class="pill">{topic.level}</span> {topic.title}
      </h2>
      <Markdown md={topic.md} />
      {exs.length > 0 && (
        <>
          <h3>{t().examples}</h3>
          <div class="sent-list">
            {exs.map(
              (s) =>
                s && (
                  <div class="ex-sent">
                    <SpeakBtn text={sentText(s)} audio={s.au} small /> <SentenceView s={s} />
                    <div class="tr">{s.tr}</div>
                  </div>
                ),
            )}
          </div>
        </>
      )}
      {unit && (
        <div class="ex-actions">
          <a class="btn primary" href={`#/unit/${unit.id}`}>
            {t().unit} {unit.n}: {unit.title}
          </a>
        </div>
      )}
    </div>
  );
}

export function GrammarList({ c, tick }: { c: LoadedCourse; tick: number }) {
  const [q, setQ] = useState('');
  const { info } = useInfo(c, tick);
  if (!info) return <Loading />;
  const studied = new Set<string>();
  for (const u of c.units) {
    const r = info.units.get(u.id);
    if (!r) continue;
    for (const l of lessonsOf(c, u)) if ((l.kind === 'rule' || l.kind === 'drill') && l.topic && lessonPassed(l, r)) studied.add(l.topic.id);
  }
  const list = c.topics.filter((tp) => !q || (tp.title + ' ' + tp.md).toLowerCase().includes(q.toLowerCase()));
  return (
    <div class="page">
      <h2>{t().grammar}</h2>
      <p class="muted small">{fmt(t().grammarSummary, { a: studied.size, b: c.topics.length })}</p>
      <input class="search" placeholder={t().search} value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)} />
      {LEVELS.map((L) => {
        const ts = list.filter((x) => x.level === L);
        return (
          ts.length > 0 && (
            <section>
              <h3>
                <span class="pill">{L}</span>
              </h3>
              <div class="topic-list">
                {ts.map((tp) => (
                  <a href={`#/topic/${tp.id}`} class={`topic-link ${studied.has(tp.id) ? 'studied' : 'later'}`}>
                    {studied.has(tp.id) ? '✓ ' : ''}
                    {tp.title}
                  </a>
                ))}
              </div>
            </section>
          )
        );
      })}
    </div>
  );
}

// ---- dictionary ----

function Strength({ card }: { card?: CardRec }) {
  if (!card) return null;
  const r = retrievability(card);
  const bars = Math.max(1, Math.round(r * 5));
  const tone = r >= 0.9 ? 'ok' : r >= 0.75 ? 'mid' : 'low';
  return (
    <span class={`strength ${tone}`} title={`${Math.round(r * 100)}%`}>
      {[0, 1, 2, 3, 4].map((i) => (
        <i class={i < bars ? 'on' : ''} />
      ))}
    </span>
  );
}

const strip = (x: string) => x.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

function matchWords<T>(items: T[], q: string, key: (x: T) => [string, string], limit = 80): T[] {
  const s = q.trim().toLowerCase();
  const ss = strip(s);
  // translations match at the start of a word: "spit" finds "to spit", not "hospital"
  const inTr = new RegExp(`(^|[^\\p{L}])${s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'iu');
  const exact: T[] = [];
  const starts: T[] = [];
  const inc: T[] = [];
  for (const x of items) {
    const [w, tr] = key(x);
    const tw = strip(w);
    const trl = tr.toLowerCase();
    const glosses = trl.split(/[,;]\s*/);
    if (tw === ss || glosses.some((g) => g === s || g === `to ${s}` || g === `a ${s}` || g === `the ${s}`)) exact.push(x);
    else if (tw.startsWith(ss)) starts.push(x);
    else if (inc.length < limit && (tw.includes(ss) || inTr.test(trl))) inc.push(x);
    if (exact.length + starts.length > limit) break;
  }
  return [...exact, ...starts, ...inc].slice(0, limit);
}

export function Dictionary({ c, tick }: { c: LoadedCourse; tick: number }) {
  const { info } = useInfo(c, tick);
  const [tab, setTab] = useState<'mine' | 'all'>('mine');
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<'all' | 'strong' | 'weak'>('all');
  const [limit, setLimit] = useState(100);
  const [ref, setRef] = useState<RefEntry[] | null>(null);
  const [openRef, setOpenRef] = useState<string | null>(null);
  useEffect(() => {
    if (tab === 'all' && q.trim() && !ref) void loadRefDict(c.meta.id).then(setRef);
  }, [tab, q]);
  const cardOf = useMemo(() => {
    const m = new Map<number, CardRec>();
    for (const x of info?.cards || []) if (x.kind === 'wp') m.set(Number(x.ref), x);
    return m;
  }, [info]);
  const allResults = useMemo(() => (q.trim() ? matchWords(c.words, q, (w) => [w.w, w.tr]) : c.words.slice(0, limit)), [q, limit]);
  const refResults = useMemo(() => {
    if (!ref || !q.trim()) return [];
    const have = new Set(c.words.map((w) => `${w.w}|${w.pos}`));
    return matchWords(
      ref.filter((e) => !have.has(`${e[0]}|${e[1]}`)),
      q,
      (e) => [e[0], e[2]],
      60,
    );
  }, [ref, q]);
  if (!info) return <Loading />;

  const total = c.words.length;
  const mine = c.words.filter((w) => info.known.has(w.id));
  const mineF = mine.filter((w) => {
    const card = cardOf.get(w.id);
    if (filter === 'all') return true;
    const r = card ? retrievability(card) : 1;
    return filter === 'strong' ? r >= 0.9 && (card?.stability || 0) >= 7 : r < 0.85 || (card?.lapses || 0) > 0;
  });
  const mineQ = q.trim() ? matchWords(mineF, q, (w) => [w.w, w.tr], 400) : mineF;
  // group "my words" by unit
  const groups = new Map<number, Word[]>();
  for (const w of mineQ) {
    const k = w.u ?? -1;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(w);
  }
  const unitWords = c.units.reduce((n, u) => n + u.words.length, 0);
  const lockedUnits = c.units.filter((u, i) => !unitUnlocked(c, i, info.units)).length;

  return (
    <div class="page dict">
      <h2>{t().dictionary}</h2>
      <div class="card dict-sum">
        <div class="row-between">
          <b>{fmt(t().dictSummary, { n: mine.length, total: unitWords })}</b>
          <small class="muted">{fmt(t().dictTotal, { n: total.toLocaleString() })}</small>
        </div>
        <Progress value={mine.length} max={unitWords} />
        <div class="lv-chips">
          {LEVELS.map((L) => {
            const us = c.units.filter((u) => u.level === L);
            const all = us.flatMap((u) => u.words);
            const k = all.filter((id) => info.known.has(id)).length;
            return (
              <span class="lv-chip">
                <b>{L}</b> {k}/{all.length}
              </span>
            );
          })}
        </div>
      </div>
      {OXFORD[c.meta.target] && (
        <p class="muted small">
          {t().oxfordNote}{' '}
          <a href={oxfordUrl(c.meta.target)} target="_blank" rel="noopener">
            {OXFORD[c.meta.target].title} ↗
          </a>
          {OXFORD[c.meta.target].loan ? ` — ${t().oxfordLoan}` : ` — ${t().oxfordFree}`}
        </p>
      )}
      <div class="tabs">
        <button class={tab === 'mine' ? 'on' : ''} onClick={() => setTab('mine')}>
          {t().myWords} ({mine.length})
        </button>
        <button class={tab === 'all' ? 'on' : ''} onClick={() => setTab('all')}>
          {t().allWords}
        </button>
      </div>
      <input class="search" placeholder={tab === 'mine' ? t().searchMine : t().searchAll} value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)} />
      {tab === 'mine' ? (
        <>
          <div class="filter-chips">
            {(['all', 'strong', 'weak'] as const).map((f) => (
              <button class={filter === f ? 'on' : ''} onClick={() => setFilter(f)}>
                {t().wordFilters[f]}
              </button>
            ))}
          </div>
          {!mine.length && <p class="muted">{t().noWordsYet}</p>}
          {[...groups.entries()].map(([u, ws]) => (
            <section class="dict-group">
              <h4>{u >= 0 ? `${t().unit} ${c.units[u]?.n}: ${c.units[u]?.title}` : t().extraVocab}</h4>
              <div class="word-list">
                {ws.map((w) => (
                  <div class="dict-line" onClick={() => go(`/word/${w.id}`)}>
                    <WordLine w={w} />
                    <Strength card={cardOf.get(w.id)} />
                  </div>
                ))}
              </div>
            </section>
          ))}
          {lockedUnits > 0 && !q && <p class="muted locked-note">🔒 {fmt(t().wordsAhead, { n: unitWords - mine.length, u: lockedUnits })}</p>}
        </>
      ) : (
        <>
          <div class="word-list">
            {allResults.map((w) => (
              <div class="dict-line" onClick={() => go(`/word/${w.id}`)}>
                <WordLine w={w} />
                <WordStatus c={c} w={w} known={info.known.has(w.id)} />
              </div>
            ))}
          </div>
          {!q.trim() && allResults.length < c.words.length && (
            <div class="ex-actions center">
              <button class="btn" onClick={() => setLimit(limit + 200)}>
                {t().showMore}
              </button>
            </div>
          )}
          {q.trim() && (
            <>
              {ref === null ? (
                <p class="muted">{t().loadingDict}</p>
              ) : (
                refResults.length > 0 && (
                  <>
                    <h4 class="ref-head">{t().refDict}</h4>
                    <div class="word-list">
                      {refResults.map((e) => (
                        <div class="word-line clickable ref" onClick={() => setOpenRef(openRef === e[0] + e[1] ? null : e[0] + e[1])}>
                          <button
                            class="icon-btn small"
                            onClick={(ev) => {
                              ev.stopPropagation();
                              void speak(e[0], c.meta.tts);
                            }}
                          >
                            <Icon name="speaker" size={16} />
                          </button>
                          <span class="wl-target">{e[0]}</span>
                          <span class="wl-tr">
                            <small class="muted">{t().pos[e[1]] || e[1]}</small> {openRef === e[0] + e[1] ? e[2] : e[2].split(/;\s*/).slice(0, 2).join('; ')}
                            {openRef === e[0] + e[1] && (
                              <div onClick={(ev) => ev.stopPropagation()}>
                                <OxfordLink target={c.meta.target} word={e[0]} />
                              </div>
                            )}
                          </span>
                        </div>
                      ))}
                    </div>
                  </>
                )
              )}
              {!allResults.length && ref !== null && !refResults.length && <p class="muted">{t().noResults}</p>}
            </>
          )}
        </>
      )}
    </div>
  );
}

export function OxfordLink({ target, word }: { target: string; word: string }) {
  const b = OXFORD[target];
  if (!b) return null;
  return (
    <a class="oxford-link" href={oxfordUrl(target, word)} target="_blank" rel="noopener" title={b.loan ? t().oxfordLoan : t().oxfordFree}>
      📖 {fmt(t().oxfordLookup, { title: b.title })} ↗
    </a>
  );
}

function WordStatus({ c, w, known }: { c: LoadedCourse; w: Word; known: boolean }) {
  if (known) return <span class="w-status ok">✓</span>;
  if (w.u !== undefined) return <span class="w-status">🔒 {c.units[w.u]?.level}</span>;
  return <span class="w-status muted">+</span>;
}

export function WordPage({ c, id, tick }: { c: LoadedCourse; id: number; tick: number }) {
  const w = c.wordById.get(id);
  const { info } = useInfo(c, tick);
  if (!w) return <div class="page">?</div>;
  const unit = w.u !== undefined ? c.units[w.u] : undefined;
  const conj = w.pos === 'verb' ? c.conj[w.w] : undefined;
  const exs = (w.ex || []).map((x) => c.sents.get(x)).filter(Boolean);
  const card = info?.cards.find((x) => x.cid === `wp:${w.id}`);
  const known = info?.known.has(w.id);
  return (
    <div class="page word-page">
      <a href="#/dict" class="muted">
        ← {t().dictionary}
      </a>
      <div class="intro-word">
        <span class="big-word" {...tl()}>{displayWord(w, c.meta.target)}</span> <SpeakBtn text={w.w} wa={w.wa} /> <SpeakBtn text={w.w} slow />
      </div>
      <div class="intro-meta">
        {t().pos[w.pos] || w.pos} {genderTag(w)} {w.ipa && <span class="ipa">{w.ipa}</span>}
        {unit && <span class="pill">{unit.level}</span>}
      </div>
      <div class="intro-tr">{w.tr}</div>
      {w.alt && w.alt.length > 0 && <div class="muted">{w.alt.join('; ')}</div>}
      <OxfordLink target={c.meta.target} word={w.w} />
      {info && (
        <div class="word-status card">
          {known ? (
            <>
              <b>✓ {t().wordLearned}</b>
              {unit && (
                <a href={`#/unit/${unit.id}`}>
                  {' '}
                  · {t().unit} {unit.n}
                </a>
              )}
              {card && (
                <div class="muted small">
                  {t().memory}: <Strength card={card} /> · {t().nextReview}: {new Date(card.due).toLocaleDateString()}
                  {card.lapses > 0 && ` · ${t().lapses}: ${card.lapses}`}
                </div>
              )}
            </>
          ) : unit ? (
            <span>
              🔒 {fmt(t().taughtIn, { n: unit.n, title: unit.title })}
            </span>
          ) : (
            <span class="muted">{t().extraWord}</span>
          )}
        </div>
      )}
      {(w.pl || w.fem) && (
        <div class="intro-forms">
          {w.fem && (
            <span>
              {t().feminine}: <b>{w.fem}</b>{' '}
            </span>
          )}
          {w.pl && (
            <span>
              {t().plural}: <b>{w.pl}</b>
            </span>
          )}
        </div>
      )}
      {w.note && <div class="intro-note">{w.note}</div>}
      {exs.length > 0 && (
        <>
          <h3>{t().examples}</h3>
          {exs.map(
            (s) =>
              s && (
                <div class="ex-sent">
                  <SpeakBtn text={sentText(s)} audio={s.au} small /> <SentenceView s={s} highlight={s.tk.findIndex(([, x]) => x === w.id)} />
                  <div class="tr">{s.tr}</div>
                </div>
              ),
          )}
        </>
      )}
      {conj && <ConjTableView c={c} table={conj} />}
    </div>
  );
}

function ConjTableView({ c, table }: { c: LoadedCourse; table: Record<string, string[]> }) {
  const order = Object.keys(c.meta.tenseNames).filter((k) => table[k]);
  return (
    <>
      <h3>{t().conjugation}</h3>
      <div class="conj-grid">
        {order.map((k) => (
          <div class="conj-block">
            <b>{c.meta.tenseNames[k]}</b>
            <table>
              {table[k].map((f, i) =>
                f ? (
                  <tr>
                    <td class="muted">{table[k].length === 1 ? '' : c.meta.persons[i]}</td>
                    <td>{f.replace(/\//g, ' / ')}</td>
                  </tr>
                ) : null,
              )}
            </table>
          </div>
        ))}
      </div>
    </>
  );
}

export function PracticeMenu() {
  const items: [string, string, string][] = [
    ['weak', t().practiceWeak, t().practiceWeakNote],
    ['mixed', t().practiceMixed, t().practiceMixedNote],
    ['grammar', t().practiceGrammar, t().practiceGrammarNote],
    ['listening', t().practiceListening, t().practiceListeningNote],
    ['reading', t().practiceReading, t().practiceReadingNote],
    ['conj', t().practiceConj, t().practiceConjNote],
  ];
  return (
    <div class="page">
      <h2>{t().practice}</h2>
      <p class="muted">{t().practiceNote}</p>
      <div class="choice-cards">
        {items.map(([k, label, note]) => (
          <a class="choice-card" href={`#/practice/${k}`}>
            <b>{label}</b>
            <small>{note}</small>
          </a>
        ))}
      </div>
    </div>
  );
}
