/** Answer normalization, tolerant checking and diffs. */

export type Verdict = 'exact' | 'accent' | 'typo' | 'partial' | 'wrong';

export interface CheckResult {
  ok: boolean;
  verdict: Verdict;
  best: string; // the closest accepted answer
}

export function normalize(s: string) {
  return s
    .normalize('NFC')
    .toLowerCase()
    .replace(/[’‘`´]/g, "'")
    .replace(/[¿¡?!.,;:«»"“”()…]/g, ' ')
    .replace(/[-–—]/g, ' ')
    .replace(/'\s+/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

export function stripAccents(s: string) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').normalize('NFC');
}

export function lev(a: string, b: string) {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = new Array(n + 1);
  let cur = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    [prev, cur] = [cur, prev];
  }
  return prev[n];
}

export function check(input: string, answers: string[], opts: { strictAccents?: boolean; partial?: string[] } = {}): CheckResult {
  const ni = normalize(input);
  let best = answers[0] || '';
  if (!ni) return { ok: false, verdict: 'wrong', best };
  for (const a of answers) if (normalize(a) === ni) return { ok: true, verdict: 'exact', best: a };
  const si = stripAccents(ni);
  for (const a of answers) {
    if (stripAccents(normalize(a)) === si) return { ok: !opts.strictAccents, verdict: 'accent', best: a };
  }
  for (const p of opts.partial || []) {
    if (stripAccents(normalize(p)) === si) return { ok: false, verdict: 'partial', best };
  }
  let bestD = Infinity;
  for (const a of answers) {
    const sa = stripAccents(normalize(a));
    const d = lev(si, sa);
    if (d < bestD) {
      bestD = d;
      best = a;
    }
  }
  const len = stripAccents(normalize(best)).length;
  const tol = len >= 12 ? 2 : len >= 5 ? 1 : 0;
  if (bestD <= tol) return { ok: true, verdict: 'typo', best };
  return { ok: false, verdict: 'wrong', best };
}

export interface DiffPart {
  text: string;
  kind: 'same' | 'add' | 'del';
}

/** Word-level (or char-level for single words) diff of user input against the expected answer. */
export function diff(input: string, expected: string): DiffPart[] {
  const single = !/\s/.test(expected.trim()) && !/\s/.test(input.trim());
  const split = (s: string) => (single ? [...s] : s.split(/(\s+)/).filter((x) => x.length));
  const a = split(input);
  const b = split(expected);
  const exact = (x: string, y: string) => normalize(x) === normalize(y) || x === y;
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--)
    for (let j = n - 1; j >= 0; j--)
      dp[i][j] = exact(a[i], b[j]) ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out: DiffPart[] = [];
  let i = 0;
  let j = 0;
  const push = (text: string, kind: DiffPart['kind']) => {
    const last = out[out.length - 1];
    if (last && last.kind === kind) last.text += text;
    else out.push({ text, kind });
  };
  while (i < m && j < n) {
    if (exact(a[i], b[j])) {
      push(b[j], 'same');
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      if (!/^\s+$/.test(a[i])) push(a[i], 'del');
      i++;
    } else {
      push(b[j], 'add');
      j++;
    }
  }
  while (i < m) {
    if (!/^\s+$/.test(a[i])) push(a[i], 'del');
    i++;
  }
  while (j < n) push(b[j++], 'add');
  return out;
}

export function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function sample<T>(arr: T[], n: number): T[] {
  return shuffle(arr).slice(0, n);
}
