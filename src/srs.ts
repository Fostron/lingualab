import { createEmptyCard, fsrs, generatorParameters, Rating, State, type Card, type Grade } from 'ts-fsrs';
import { addLog, getCard, putCards, type CardKind, type CardRec } from './db';

export { Rating, State };

let scheduler = fsrs(generatorParameters({ request_retention: 0.9, maximum_interval: 3650, enable_fuzz: true }));

export function setRetention(r: number) {
  scheduler = fsrs(generatorParameters({ request_retention: r, maximum_interval: 3650, enable_fuzz: true }));
}

function toCard(r: CardRec): Card {
  return {
    due: new Date(r.due),
    stability: r.stability,
    difficulty: r.difficulty,
    elapsed_days: r.elapsed_days,
    scheduled_days: r.scheduled_days,
    learning_steps: r.learning_steps,
    reps: r.reps,
    lapses: r.lapses,
    state: r.state,
    last_review: r.last_review ? new Date(r.last_review) : undefined,
  };
}

function fromCard(base: Omit<CardRec, keyof Card | 'due' | 'last_review'>, c: Card): CardRec {
  return {
    ...base,
    due: c.due.getTime(),
    stability: c.stability,
    difficulty: c.difficulty,
    elapsed_days: c.elapsed_days,
    scheduled_days: c.scheduled_days,
    learning_steps: c.learning_steps,
    reps: c.reps,
    lapses: c.lapses,
    state: c.state,
    last_review: c.last_review ? c.last_review.getTime() : undefined,
  };
}

export function kindOf(cid: string): CardKind {
  return cid.split(':')[0] as CardKind;
}

export function newCardRec(course: string, cid: string, now = new Date()): CardRec {
  const kind = kindOf(cid);
  const ref = cid.slice(cid.indexOf(':') + 1);
  return fromCard({ key: `${course}|${cid}`, course, cid, kind, ref, added: now.getTime() }, createEmptyCard(now));
}

/** Apply a review to a card (creating it if needed) and persist it with a log line. */
export async function review(course: string, cid: string, rating: Grade, ok: boolean, ex: string) {
  const now = new Date();
  const rec = (await getCard(course, cid)) || newCardRec(course, cid, now);
  const res = scheduler.next(toCard(rec), now, rating);
  const out = fromCard(rec, res.card);
  await putCards([out]);
  await addLog({ course, cid, rating, ts: now.getTime(), ok, ex });
  return out;
}

/** Register cards as already known (placement / test-out) with a long first interval. */
export function knownCardRec(course: string, cid: string, now = new Date()): CardRec {
  const rec = newCardRec(course, cid, now);
  const res = scheduler.next(toCard(rec), now, Rating.Easy);
  return fromCard(rec, res.card);
}

export function retrievability(r: CardRec, now = new Date()): number {
  if (r.state === State.New) return 0;
  return scheduler.get_retrievability(toCard(r), now, false) as number;
}

export function intervalLabel(ms: number, ui: 'en' | 'ru') {
  const m = ms / 60000;
  const ru = ui === 'ru';
  if (m < 60) return `${Math.max(1, Math.round(m))} ${ru ? 'мин' : 'min'}`;
  const h = m / 60;
  if (h < 24) return `${Math.round(h)} ${ru ? 'ч' : 'h'}`;
  const d = h / 24;
  if (d < 31) return `${Math.round(d)} ${ru ? 'дн' : 'd'}`;
  const mo = d / 30;
  if (mo < 12) return `${Math.round(mo)} ${ru ? 'мес' : 'mo'}`;
  return `${(d / 365).toFixed(1)} ${ru ? 'г' : 'y'}`;
}
