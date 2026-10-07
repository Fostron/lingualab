/** Bug reports: sent to the sync server with the exercise and the app version attached. */
import type { Ex } from './exercises';
import { getState } from './store';
import { api, session } from './sync';

declare const __BUILT_AT__: number;
declare const __COMMIT__: string;

export interface MyReport {
  id: number;
  created: number;
  text: string;
  status: 'new' | 'progress' | 'fixed' | 'wontfix';
  note?: string | null;
  fixedIn?: string | null;
  updated: number;
}

const sent = (s: { tk: [string, number, 0 | 1][] }) => s.tk.map(([w, , sp]) => w + (sp ? ' ' : '')).join('').trim();

/** What the exercise asked and expected, compact and readable. */
export function describeEx(ex: Ex): Record<string, unknown> {
  switch (ex.k) {
    case 'intro':
      return { k: ex.k, word: ex.word.w, tr: ex.word.tr, id: ex.word.id };
    case 'teach':
      return { k: ex.k, topic: ex.topic?.id, title: ex.title };
    case 'mcq':
      return { k: ex.k, mode: ex.mode, word: ex.word.w, tr: ex.word.tr, id: ex.word.id, options: ex.options, right: ex.options[ex.answer], sentence: ex.sent && sent(ex.sent) };
    case 'type':
      return { k: ex.k, mode: ex.mode, word: ex.word.w, tr: ex.word.tr, id: ex.word.id, answers: ex.answers };
    case 'cloze':
      return { k: ex.k, sentence: sent(ex.sent), sentenceId: ex.sent.id, tr: ex.sent.tr, gap: ex.i, answers: ex.answers, options: ex.options, hint: ex.hint, topic: ex.topic?.id || ex.cid };
    case 'drill':
      return { k: ex.k, topic: ex.topic.id, type: ex.drill.t, q: ex.drill.q, answers: ex.drill.a, options: ex.drill.o, hint: ex.drill.h };
    case 'conj':
      return { k: ex.k, verb: ex.verb, tense: ex.tense, person: ex.person, answers: ex.answers };
    case 'build':
    case 'translate':
    case 'dictation':
    case 'read':
      return { k: ex.k, sentence: sent(ex.sent), sentenceId: ex.sent.id, tr: ex.sent.tr };
  }
}

export function appVersion() {
  return `${new Date(__BUILT_AT__).toISOString().slice(0, 16).replace('T', ' ')} · ${__COMMIT__}`;
}

export async function sendReport(text: string, extra: Record<string, unknown> = {}) {
  if (!session()) throw new Error('login');
  const st = getState();
  const context = {
    version: appVersion(),
    course: st.course?.meta.id,
    route: location.hash,
    ui: st.info?.ui,
    device: navigator.userAgent,
    screen: `${innerWidth}×${innerHeight}`,
    ...extra,
  };
  const r = await api('/reports', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, context }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
  return j.id as number;
}

export async function myReports(): Promise<MyReport[]> {
  if (!session()) return [];
  const r = await api('/reports');
  return r.ok ? r.json() : [];
}
