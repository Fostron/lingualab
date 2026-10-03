import { useEffect, useMemo, useState } from 'preact/hooks';
import { COURSES, displayWord, genderTag, sentText } from '../content';
import { getProgress, getUnit, type CourseProgress, type UnitRec } from '../db';
import { fmt, t } from '../i18n';
import { loadProgress, markTopicRead, wordsLeft, type ProgressInfo } from '../progress';
import { go } from '../router';
import { bump, getState, selectCourse } from '../store';
import { bestVoice, ttsAvailable } from '../tts';
import { LEVELS, type LoadedCourse, type Unit, type Word } from '../types';
import { Icon, Loading, Markdown, Progress, SentenceView, SpeakBtn, WordLine } from '../ui/common';

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

function useInfo(c: LoadedCourse, tick: number) {
  const [info, setInfo] = useState<ProgressInfo | null>(null);
  const [prog, setProg] = useState<CourseProgress | null>(null);
  useEffect(() => {
    void loadProgress(c).then(setInfo);
    void getProgress(c.meta.id).then(setProg);
  }, [c, tick]);
  return { info, prog };
}

function streakOf(days: string[]) {
  const set = new Set(days);
  let n = 0;
  const d = new Date();
  const key = (x: Date) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
  if (!set.has(key(d))) d.setDate(d.getDate() - 1);
  while (set.has(key(d))) {
    n++;
    d.setDate(d.getDate() - 1);
  }
  return n;
}

export function Home({ c, tick }: { c: LoadedCourse; tick: number }) {
  const { info, prog } = useInfo(c, tick);
  if (!info || !prog) return <Loading />;
  if (!prog.placement && info.units.size === 0) {
    return (
      <div class="page">
        <h2>{c.meta.title}</h2>
        <p class="muted">{c.meta.subtitle}</p>
        <p>{t().placementIntro}</p>
        <div class="ex-actions">
          <a class="btn primary" href="#/placement">
            {t().start}
          </a>
        </div>
      </div>
    );
  }
  const unit = info.current;
  const left = wordsLeft(c, unit, info);
  const ur = info.units.get(unit.id);
  const levelUnits = c.units.filter((u) => u.level === unit.level);
  const levelDone = levelUnits.filter((u) => ['done', 'known'].includes(info.units.get(u.id)?.status || '')).length;
  const hasVoice = ttsAvailable() && !!bestVoice(c.meta.tts);
  const longTerm = info.cards.filter((x) => (x.kind === 'wp' || x.kind === 'wr') && x.stability >= 21).length / 2;
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
      <Progress value={levelDone} max={levelUnits.length} />

      <div class="cards-row">
        <button class={`action-card ${info.due.length ? 'hot' : ''}`} onClick={() => go('/review')} disabled={!info.due.length}>
          <Icon name="review" size={26} />
          <b>{info.due.length}</b>
          <span>{info.due.length ? t().dueNow : t().nothingDue}</span>
        </button>
        <button class="action-card primary" onClick={() => go(left.length ? `/learn/${unit.id}` : `/unit/${unit.id}`)}>
          <Icon name="book" size={26} />
          <b>
            {t().unit} {unit.n}
          </b>
          <span>{unit.title}</span>
        </button>
      </div>

      <div class="card">
        <div class="row-between">
          <span>
            {t().newToday}: <b>{info.newToday}</b> / {getStateSettings().newPerDay}
          </span>
          <a href={`#/unit/${unit.id}`}>{left.length ? fmt(t().unitWordsLeft, { n: left.length }) : t().allUnitWordsLearned}</a>
        </div>
        {ur && !ur.topicsRead.length && unit.topics.length > 0 && (
          <p>
            <a href={`#/topic/${unit.topics[0]}/${unit.id}`}>
              → {t().readRule}: {c.topicById.get(unit.topics[0])?.title}
            </a>
          </p>
        )}
      </div>

      <div class="stats-mini">
        <div>
          <b>{info.learned.size}</b>
          <small>{t().learnedWords}</small>
        </div>
        <div>
          <b>{Math.round(longTerm)}</b>
          <small>{t().wordsKnown}</small>
        </div>
        <div>
          <b>{prog.days.length}</b>
          <small>{t().studyDays}</small>
        </div>
      </div>
      {!hasVoice && <p class="warn">{t().noVoice}</p>}
    </div>
  );
}

function getStateSettings() {
  return getState().settings;
}

export function Path({ c, tick }: { c: LoadedCourse; tick: number }) {
  const { info } = useInfo(c, tick);
  if (!info) return <Loading />;
  return (
    <div class="page path">
      <div class="row-between">
        <h2>{t().units}</h2>
        <a class="btn small" href="#/placement">
          {t().placementTitle}
        </a>
      </div>
      {LEVELS.map((L) => {
        const us = c.units.filter((u) => u.level === L);
        if (!us.length) return null;
        return (
          <section class="level-block">
            <h3 class="level-title">
              <span class="pill">{L}</span>
            </h3>
            {us.map((u) => (
              <UnitRow u={u} rec={info.units.get(u.id)} current={u.id === info.current.id} />
            ))}
          </section>
        );
      })}
    </div>
  );
}

function UnitRow({ u, rec, current }: { u: Unit; rec?: UnitRec; current: boolean }) {
  const st = rec?.status || 'new';
  const pct = rec ? Math.round((100 * rec.learned.length) / Math.max(1, u.words.length)) : 0;
  return (
    <a class={`unit-row st-${st} ${current ? 'current' : ''}`} href={`#/unit/${u.id}`}>
      <span class="unit-n">{st === 'done' || st === 'known' ? <Icon name="check" size={18} /> : u.n}</span>
      <span class="unit-body">
        <b>{u.title}</b>
        <small>
          {st === 'done' ? t().done : st === 'known' ? t().known : st === 'learning' ? `${t().inProgress} · ${pct}%` : t().locked}
          {rec?.test ? ` · ${t().unitTest} ${Math.round(rec.test.score * 100)}%` : ''}
        </small>
      </span>
    </a>
  );
}

export function UnitView({ c, unitId, tick }: { c: LoadedCourse; unitId: string; tick: number }) {
  const unit = c.unitById.get(unitId);
  const [rec, setRec] = useState<UnitRec | null>(null);
  useEffect(() => {
    if (unit) void getUnit(c.meta.id, unit.id).then(setRec);
  }, [unitId, tick]);
  if (!unit || !rec) return <Loading />;
  const words = unit.words.map((id) => c.wordById.get(id)!).filter(Boolean);
  const left = words.filter((w) => !rec.learned.includes(w.id));
  return (
    <div class="page unit">
      <a href="#/path" class="muted">
        ← {t().units}
      </a>
      <h2>
        <span class="pill">{unit.level}</span> {t().unit} {unit.n}: {unit.title}
      </h2>
      <div class="unit-actions">
        {unit.topics.map((tid) => {
          const tp = c.topicById.get(tid);
          return (
            tp && (
              <a class={`step ${rec.topicsRead.includes(tid) ? 'done' : ''}`} href={`#/topic/${tid}/${unit.id}`}>
                <span class="step-n">1</span>
                <span>
                  <b>{t().readRule}</b>
                  <small>{tp.title}</small>
                </span>
              </a>
            )
          );
        })}
        <a class={`step ${left.length ? '' : 'done'}`} href={`#/learn/${unit.id}`}>
          <span class="step-n">2</span>
          <span>
            <b>{t().learnWords}</b>
            <small>{left.length ? fmt(t().unitWordsLeft, { n: left.length }) : t().allUnitWordsLearned}</small>
          </span>
        </a>
        <a class={`step ${rec.status === 'done' ? 'done' : ''}`} href={`#/test/${unit.id}`}>
          <span class="step-n">3</span>
          <span>
            <b>{t().unitTest}</b>
            <small>{rec.test ? `${Math.round(rec.test.score * 100)}%` : t().unitTestIntro}</small>
          </span>
        </a>
      </div>
      <h3>{t().wordsOfUnit}</h3>
      <div class="word-list">
        {words.map((w) => (
          <div class={rec.learned.includes(w.id) ? 'learned' : ''}>
            <WordLine w={w} onClick={() => go(`/word/${w.id}`)} />
          </div>
        ))}
      </div>
      {unit.sents.length > 0 && (
        <>
          <h3>{t().examples}</h3>
          <div class="sent-list">
            {unit.sents.slice(0, 8).map((id) => {
              const s = c.sents.get(id);
              return (
                s && (
                  <div class="ex-sent">
                    <SpeakBtn text={sentText(s)} audio={s.au} small /> <SentenceView s={s} />
                    <div class="tr">{s.tr}</div>
                  </div>
                )
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

export function TopicView({ c, topicId, unitId }: { c: LoadedCourse; topicId: string; unitId?: string }) {
  const topic = c.topicById.get(topicId);
  const unit = unitId ? c.unitById.get(unitId) : c.units.find((u) => u.topics.includes(topicId));
  useEffect(() => {
    if (topic && unit) void markTopicRead(c, unit, topic.id).then(bump);
  }, [topicId]);
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
          <a class="btn primary" href={`#/learn/${unit.id}`}>
            {t().practice}
          </a>
        </div>
      )}
    </div>
  );
}

export function GrammarList({ c }: { c: LoadedCourse }) {
  const [q, setQ] = useState('');
  const list = c.topics.filter((tp) => !q || (tp.title + ' ' + tp.md).toLowerCase().includes(q.toLowerCase()));
  return (
    <div class="page">
      <h2>{t().grammar}</h2>
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
                  <a href={`#/topic/${tp.id}`} class="topic-link">
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

export function Dictionary({ c }: { c: LoadedCourse }) {
  const [q, setQ] = useState('');
  const results = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return c.words.slice(0, 50);
    const strip = (x: string) => x.normalize('NFD').replace(/[̀-ͯ]/g, '');
    const ss = strip(s);
    const starts: Word[] = [];
    const inc: Word[] = [];
    for (const w of c.words) {
      const tw = strip(w.w.toLowerCase());
      const tr = w.tr.toLowerCase();
      if (tw === ss || tw.startsWith(ss) || tr.split(/[,;]\s*/).some((g) => g === s || g === `to ${s}`)) starts.push(w);
      else if (tw.includes(ss) || tr.includes(s)) inc.push(w);
      if (starts.length > 60) break;
    }
    return [...starts, ...inc].slice(0, 80);
  }, [q]);
  return (
    <div class="page">
      <h2>{t().dictionary}</h2>
      <input class="search" placeholder={t().search} value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)} autoFocus />
      <div class="word-list">
        {results.map((w) => (
          <WordLine w={w} onClick={() => go(`/word/${w.id}`)} />
        ))}
        {!results.length && <p class="muted">{t().noResults}</p>}
      </div>
    </div>
  );
}

export function WordPage({ c, id }: { c: LoadedCourse; id: number }) {
  const w = c.wordById.get(id);
  if (!w) return <div class="page">?</div>;
  const unit = w.u !== undefined ? c.units[w.u] : undefined;
  const conj = w.pos === 'verb' ? c.conj[w.w] : undefined;
  const exs = (w.ex || []).map((x) => c.sents.get(x)).filter(Boolean);
  return (
    <div class="page word-page">
      <a href="#/dict" class="muted">
        ← {t().dictionary}
      </a>
      <div class="intro-word">
        <span class="big-word">{displayWord(w, c.meta.target)}</span> <SpeakBtn text={w.w} /> <SpeakBtn text={w.w} slow />
      </div>
      <div class="intro-meta">
        {t().pos[w.pos] || w.pos} {genderTag(w)} {w.ipa && <span class="ipa">{w.ipa}</span>}
        {unit && (
          <a href={`#/unit/${unit.id}`}>
            {' '}
            · {t().unit} {unit.n}
          </a>
        )}
      </div>
      <div class="intro-tr">{w.tr}</div>
      {w.alt && w.alt.length > 0 && <div class="muted">{w.alt.join('; ')}</div>}
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
  const items = [
    ['mixed', t().practiceMixed],
    ['listening', t().practiceListening],
    ['reading', t().practiceReading],
    ['conj', t().practiceConj],
    ['weak', t().practiceWeak],
  ];
  return (
    <div class="page">
      <h2>{t().practice}</h2>
      <p class="muted">{t().practiceNote}</p>
      <div class="choice-cards">
        {items.map(([k, label]) => (
          <a class="choice-card" href={`#/practice/${k}`}>
            <b>{label}</b>
          </a>
        ))}
      </div>
    </div>
  );
}
