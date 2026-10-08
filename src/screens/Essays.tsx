import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { displayWord } from '../content';
import { corrected, deleteEssay, essayStats, getEssays, languageTool, LENGTH, newEssayId, saveEssay, TOPICS, type Essay, type LTMatch } from '../essays';
import { fmt, t, ui } from '../i18n';
import { loadProgress, type ProgressInfo } from '../progress';
import { go } from '../router';
import { getState } from '../store';
import { LEVELS, type Level, type LoadedCourse, type Word } from '../types';
import { ConfirmDialog, Loading, SpeakBtn, tl } from '../ui/common';

const topicTitle = (x: [string, string, string, string, string]) => (ui() === 'ru' ? x[2] : x[1]);
const topicGuide = (x: [string, string, string, string, string]) => (ui() === 'ru' ? x[4] : x[3]);
const findTopic = (lvl: Level, id?: string) => TOPICS[lvl].find((x) => x[0] === id);

/** Error category in the learner's language (LanguageTool ids differ per language, so the rule id helps). */
function catLabel(m: LTMatch) {
  const T = t().ltCats;
  if (T[m.cat]) return T[m.cat];
  const r = `${m.cat} ${m.rule}`.toUpperCase();
  if (/ACCORD|AGREEMENT|CONCORD|GENDER|NUMBER/.test(r)) return T.agreement;
  if (/ACCENT|DIACRIT|ORTHO|SPELL|TYPO/.test(r)) return T.TYPOS;
  if (/PREP|HOMONYM|PARONYM|CONFUS/.test(r)) return T.CONFUSED_WORDS;
  if (/PONCT|PUNCT|VIRG|COMMA/.test(r)) return T.PUNCTUATION;
  if (/CONJ|VERB|TENSE|MODE|SUBJ/.test(r)) return T.verbs;
  return T[m.type] || T.other;
}

/** LanguageTool explains in the text's language; for the two commonest cases add a plain hint in the learner's. */
function plainHint(orig: string, rep?: string) {
  if (!rep || rep === orig) return '';
  const bare = (x: string) => x.normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (bare(orig).toLowerCase() === bare(rep).toLowerCase() && orig.toLowerCase() !== rep.toLowerCase()) return fmt(t().essayHintAccent, { w: rep });
  if (orig.toLowerCase() === rep.toLowerCase()) return fmt(t().essayHintCase, { w: rep });
  return '';
}

export function EssaysHome({ c }: { c: LoadedCourse }) {
  const [list, setList] = useState<Essay[] | null>(null);
  useEffect(() => void getEssays(c.meta.id).then(setList), [c]);
  if (!list) return <Loading />;
  return (
    <div class="page essays">
      <a href="#/practice" class="muted">
        ← {t().practice}
      </a>
      <h2>{t().essays}</h2>
      <p class="muted">{t().essaysLead}</p>
      <div class="ex-actions">
        <a class="btn primary big" href="#/essays/new">
          {t().essayNew}
        </a>
      </div>
      {list.length > 0 && (
        <div class="card">
          <h4>{t().essayMine}</h4>
          <table class="topic-table">
            {list.map((e) => (
              <tr onClick={() => go(`/essays/${e.id}`)}>
                <td>
                  <span class="pill">{e.level}</span> {e.topic.title}
                </td>
                <td class="muted">{e.stats ? fmt(t().essayWordsN, { n: e.stats.words }) : t().essayDraft}</td>
                <td class={e.check && e.check.matches.length ? 'bad' : ''}>{e.check ? fmt(t().essayErrorsN, { n: e.check.matches.length }) : ''}</td>
                <td class="muted">{new Date(e.ts).toLocaleDateString()}</td>
              </tr>
            ))}
          </table>
        </div>
      )}
    </div>
  );
}

export function EssayTopics({ c }: { c: LoadedCourse }) {
  const [info, setInfo] = useState<ProgressInfo | null>(null);
  const [lvl, setLvl] = useState<Level | null>(null);
  const [own, setOwn] = useState('');
  useEffect(() => void loadProgress(c).then((i) => (setInfo(i), setLvl(i.current.level))), [c]);
  if (!info || !lvl) return <Loading />;
  const start = async (title: string, id?: string) => {
    const e: Essay = { id: newEssayId(), ts: Date.now(), updated: Date.now(), course: c.meta.id, level: lvl, topic: { id, title }, text: '' };
    await saveEssay(e);
    go(`/essays/${e.id}`);
  };
  return (
    <div class="page essays">
      <a href="#/essays" class="muted">
        ← {t().essays}
      </a>
      <h2>{t().essayChoose}</h2>
      <div class="filter-chips">
        {LEVELS.map((L) => (
          <button class={L === lvl ? 'on' : ''} onClick={() => setLvl(L)}>
            {L}
          </button>
        ))}
      </div>
      <p class="muted small">{fmt(t().essayLength, { a: LENGTH[lvl][0], b: LENGTH[lvl][1] })}</p>
      <div class="choice-cards">
        {TOPICS[lvl].map((x) => (
          <button class="choice-card" onClick={() => void start(topicTitle(x), x[0])}>
            <b>{topicTitle(x)}</b>
            <small>{topicGuide(x)}</small>
          </button>
        ))}
      </div>
      <div class="card own-topic">
        <b>{t().essayOwn}</b>
        <div class="row-gap">
          <input class="search" value={own} placeholder={t().essayOwnPh} onInput={(e) => setOwn((e.target as HTMLInputElement).value)} />
          <button class="btn primary" disabled={!own.trim()} onClick={() => void start(own.trim())}>
            {t().start}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Words to try using: learned words of the current and previous unit. */
function suggestions(c: LoadedCourse, info: ProgressInfo): Word[] {
  const idx = info.currentIndex;
  const ids = [...(c.units[idx]?.words || []), ...(c.units[idx - 1]?.words || [])].filter((id) => info.learned.has(id));
  const pool = (ids.length ? ids : [...info.learned].slice(-40)).map((id) => c.wordById.get(id)!).filter((w) => w && ['noun', 'verb', 'adj', 'adv'].includes(w.pos));
  return pool.sort(() => Math.random() - 0.5).slice(0, 8);
}

export function EssayEditor({ c, id }: { c: LoadedCourse; id: string }) {
  const [e, setE] = useState<Essay | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [info, setInfo] = useState<ProgressInfo | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [stale, setStale] = useState(false);
  const [askDel, setAskDel] = useState(false);
  const [showFixed, setShowFixed] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    void getEssays(c.meta.id).then((l) => {
      const x = l.find((y) => y.id === id) || null;
      setE(x);
      setText(x?.text || '');
      setLoaded(true);
    });
    void loadProgress(c).then(setInfo);
  }, [id]);
  const sugg = useMemo(() => (info ? suggestions(c, info) : []), [info]);
  if (!loaded || !info) return <Loading />;
  if (!e) return <div class="page">—</div>;

  const words = (text.match(/[\p{L}'’-]+/gu) || []).length;
  const [lo, hi] = LENGTH[e.level];
  const topic = findTopic(e.level, e.topic.id);
  const persist = (next: Essay) => {
    setE(next);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => void saveEssay(next), 600);
  };
  const onText = (v: string) => {
    setText(v);
    if (e.check) setStale(true);
    persist({ ...e, text: v });
  };
  const check = async () => {
    setBusy(true);
    setErr('');
    try {
      const matches = await languageTool(text, c.meta.target, c.meta.ui);
      const next: Essay = { ...e, text, check: { ts: Date.now(), matches }, stats: essayStats(c, text, info.learned) };
      setE(next);
      setStale(false);
      await saveEssay(next);
    } catch (x) {
      setErr(String((x as Error).message) === 'rate' ? t().essayRate : `${t().essayCheckFailed} (${(x as Error).message})`);
    }
    setBusy(false);
  };
  const insert = (s: string) => {
    const el = area.current;
    const a = el ? el.selectionStart : text.length;
    const b = el ? el.selectionEnd : text.length;
    onText(text.slice(0, a) + s + text.slice(b));
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(a + s.length, a + s.length);
    });
  };
  /** Apply a suggestion: replace the fragment and shift the other errors. */
  const apply = (m: LTMatch, rep: string) => {
    const v = text.slice(0, m.o) + rep + text.slice(m.o + m.l);
    const delta = rep.length - m.l;
    const rest = (e.check?.matches || []).filter((x) => x !== m).map((x) => (x.o > m.o ? { ...x, o: x.o + delta } : x));
    setText(v);
    persist({ ...e, text: v, check: e.check ? { ...e.check, matches: rest } : undefined });
  };

  const matches = e.check && !stale ? e.check.matches : [];
  return (
    <div class="page essays essay-editor">
      <a href="#/essays" class="muted">
        ← {t().essays}
      </a>
      <h2>
        <span class="pill">{e.level}</span> {e.topic.title}
      </h2>
      {topic && <p class="muted">{topicGuide(topic)}</p>}
      {sugg.length > 0 && (
        <div class="card sugg">
          <small class="muted">{t().essayTryWords}</small>
          <div class="chips">
            {sugg.map((w) => (
              <button class="chip" title={w.tr} onClick={() => insert(w.w + ' ')} {...tl()}>
                {displayWord(w, c.meta.target)} <small class="muted">{w.tr.split(/[;,]/)[0]}</small>
              </button>
            ))}
          </div>
        </div>
      )}
      <div class="chars">
        {c.meta.chars.map((ch) => (
          <button type="button" tabIndex={-1} onMouseDown={(ev) => ev.preventDefault()} onClick={() => insert(ch)}>
            {ch}
          </button>
        ))}
      </div>
      <textarea ref={area} class="essay-text" rows={10} lang={c.meta.target} spellcheck={false} value={text} placeholder={t().essayPlaceholder} onInput={(ev) => onText((ev.target as HTMLTextAreaElement).value)} />
      <div class="row-between">
        <small class={words < lo ? 'muted' : words > hi ? 'warn' : 'ok'}>{fmt(t().essayCount, { n: words, a: lo, b: hi })}</small>
        <div class="ex-actions">
          <button class="btn ghost" onClick={() => setAskDel(true)}>
            {t().essayDelete}
          </button>
          <button class="btn primary" disabled={busy || words < 3} onClick={() => void check()}>
            {busy ? '…' : e.check ? t().essayRecheck : t().essayCheck}
          </button>
        </div>
      </div>
      {err && <p class="warn">{err}</p>}
      {stale && e.check && <p class="note">{t().essayStale}</p>}

      {e.check && !stale && (
        <>
          <div class="card">
            <h4>{matches.length ? fmt(t().essayFound, { n: matches.length }) : t().essayClean}</h4>
            {matches.length > 0 && (
              <div class="chips">
                {Object.entries(matches.reduce<Record<string, number>>((a, m) => ((a[catLabel(m)] = (a[catLabel(m)] || 0) + 1), a), {})).map(([k, n]) => (
                  <span class="chip">
                    {k}: <b>{n}</b>
                  </span>
                ))}
              </div>
            )}
            <div class="essay-marked" {...tl()}>
              <Marked text={text} matches={matches} />
            </div>
          </div>
          {matches.length > 0 && (
            <div class="card">
              <h4>{t().essayErrors}</h4>
              <ol class="essay-errors">
                {matches.map((m, i) => (
                  <li id={`m${i}`}>
                    <span class="pill">{catLabel(m)}</span> <b class="bad" {...tl()}>«{text.slice(m.o, m.o + m.l)}»</b>
                    {plainHint(text.slice(m.o, m.o + m.l), m.rep[0]) && <div class="small">💡 {plainHint(text.slice(m.o, m.o + m.l), m.rep[0])}</div>}
                    <div class="small muted" {...tl()}>
                      {m.msg}
                    </div>
                    {m.rep.length > 0 && (
                      <div class="chips">
                        {m.rep.map((r) => (
                          <button class="chip fix" title={t().essayApply} onClick={() => apply(m, r)} {...tl()}>
                            → {r || '∅'}
                          </button>
                        ))}
                      </div>
                    )}
                  </li>
                ))}
              </ol>
              <button class="btn small" onClick={() => setShowFixed(!showFixed)}>
                {showFixed ? t().essayHideFixed : t().essayShowFixed}
              </button>
              {showFixed && (
                <div class="essay-fixed" {...tl()}>
                  {corrected(text, matches)} <SpeakBtn text={corrected(text, matches)} small />
                </div>
              )}
            </div>
          )}
          {e.stats && <StatsCard s={e.stats} />}
          <p class="muted small">{t().essayAiLater}</p>
        </>
      )}
      {askDel && (
        <ConfirmDialog
          title={t().essayDeleteTitle}
          ok={t().essayDelete}
          cancel={t().back}
          danger
          onOk={async () => {
            await deleteEssay(c.meta.id, e.id);
            go('/essays');
          }}
          onCancel={() => setAskDel(false)}
        />
      )}
    </div>
  );
}

/** The text with the errors underlined; a tap scrolls to the explanation. */
function Marked({ text, matches }: { text: string; matches: LTMatch[] }) {
  const parts: preact.ComponentChildren[] = [];
  let pos = 0;
  [...matches]
    .map((m, i) => ({ m, i }))
    .sort((a, b) => a.m.o - b.m.o)
    .forEach(({ m, i }) => {
      if (m.o < pos) return;
      parts.push(text.slice(pos, m.o));
      parts.push(
        <mark class={`err cat-${m.type}`} title={m.msg} onClick={() => document.getElementById(`m${i}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })}>
          {text.slice(m.o, m.o + m.l)}
        </mark>,
      );
      pos = m.o + m.l;
    });
  parts.push(text.slice(pos));
  return <>{parts}</>;
}

function StatsCard({ s }: { s: NonNullable<Essay['stats']> }) {
  const total = Math.max(1, s.words);
  return (
    <div class="card">
      <h4>{t().essayStats}</h4>
      <div class="result-grid">
        <div class="stat">
          <small>{t().essayStatWords}</small>
          <b>{s.words}</b>
        </div>
        <div class="stat">
          <small>{t().essayStatSentences}</small>
          <b>{s.sentences}</b>
          <small class="muted">{fmt(t().essayStatAvg, { n: s.avgSentence })}</small>
        </div>
        <div class="stat">
          <small>{t().essayStatUnique}</small>
          <b>{s.unique}</b>
        </div>
        <div class="stat">
          <small>{t().essayStatLessons}</small>
          <b>{s.fromLessons}</b>
        </div>
      </div>
      <h4>{t().essayStatLevels}</h4>
      {[...LEVELS, '?'].map((L) => (
        <div class="level-row">
          <span>{L}</span>
          <div class="progress">
            <div style={{ width: `${(100 * (s.levels[L] || 0)) / total}%` }} />
          </div>
          <span>{Math.round((100 * (s.levels[L] || 0)) / total)}%</span>
        </div>
      ))}
      <small class="muted">{t().essayStatLevelsNote}</small>
    </div>
  );
}

export function essayRoute(c: LoadedCourse, a?: string) {
  if (!a) return <EssaysHome c={c} />;
  if (a === 'new') return <EssayTopics c={c} />;
  return <EssayEditor key={a} c={c} id={a} />;
}

export { getState };
