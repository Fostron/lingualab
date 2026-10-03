/** Speech: browser TTS (speechSynthesis) with optional native recordings from Tatoeba. */

let voicesCache: SpeechSynthesisVoice[] = [];
let rate = 0.9;
let preferred: Record<string, string> = {};

const voiceListeners = new Set<() => void>();

export function onVoicesChanged(f: () => void) {
  voiceListeners.add(f);
  return () => voiceListeners.delete(f);
}

function loadVoices() {
  if (typeof speechSynthesis === 'undefined') return [];
  const before = voicesCache.length;
  voicesCache = speechSynthesis.getVoices();
  if (voicesCache.length !== before) for (const f of voiceListeners) f();
  return voicesCache;
}
if (typeof speechSynthesis !== 'undefined') {
  loadVoices();
  speechSynthesis.addEventListener?.('voiceschanged', loadVoices);
}

export function ttsAvailable() {
  return typeof speechSynthesis !== 'undefined';
}

export function configureTts(r: number, voice: Record<string, string>) {
  rate = r;
  preferred = voice;
}

export function voicesFor(lang: string): SpeechSynthesisVoice[] {
  const base = lang.split('-')[0];
  return (voicesCache.length ? voicesCache : loadVoices()).filter((v) => v.lang.replace('_', '-').toLowerCase().startsWith(base));
}

function score(v: SpeechSynthesisVoice, lang: string) {
  let s = 0;
  const vl = v.lang.replace('_', '-').toLowerCase();
  if (vl === lang.toLowerCase()) s += 10;
  if (/natural|neural|online/i.test(v.name)) s += 8;
  if (/google/i.test(v.name)) s += 5;
  if (/microsoft/i.test(v.name)) s += 2;
  if (v.localService) s += 1;
  return s;
}

export function bestVoice(lang: string): SpeechSynthesisVoice | undefined {
  const list = voicesFor(lang);
  const pref = preferred[lang];
  if (pref) {
    const v = list.find((x) => x.name === pref);
    if (v) return v;
  }
  return [...list].sort((a, b) => score(b, lang) - score(a, lang))[0];
}

/** What happened to a playback request. */
export type PlayResult = 'played' | 'blocked' | 'failed';

// One shared <audio>: on iPhone an element may play by itself only after it has once been started
// from a tap, so it is "unlocked" on the first touch anywhere.
let el: HTMLAudioElement | null = null;
let gen = 0; // each new playback supersedes the previous one
/** 0.1 s of silence as a WAV blob (always decodable), used to unlock playback. */
function silence() {
  const n = 800;
  const v = new DataView(new ArrayBuffer(44 + n));
  const w = (o: number, str: string) => [...str].forEach((ch, i) => v.setUint8(o + i, ch.charCodeAt(0)));
  w(0, 'RIFF');
  v.setUint32(4, 36 + n, true);
  w(8, 'WAVEfmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, 8000, true);
  v.setUint32(28, 8000, true);
  v.setUint16(32, 1, true);
  v.setUint16(34, 8, true);
  w(36, 'data');
  v.setUint32(40, n, true);
  for (let i = 0; i < n; i++) v.setUint8(44 + i, 128);
  return URL.createObjectURL(new Blob([v.buffer], { type: 'audio/wav' }));
}

function audioEl() {
  if (!el) {
    el = new Audio();
    el.preload = 'auto';
  }
  return el;
}

function unlock() {
  const a = audioEl();
  a.src = silence();
  a.play().then(() => a.pause()).catch(() => {});
  if (ttsAvailable()) {
    try {
      speechSynthesis.speak(new SpeechSynthesisUtterance(''));
    } catch {
      /* ignore */
    }
  }
}
if (typeof document !== 'undefined') {
  document.addEventListener('pointerdown', unlock, { once: true, capture: true });
  document.addEventListener('keydown', unlock, { once: true, capture: true });
}

export function stopSpeech() {
  gen++;
  if (ttsAvailable()) speechSynthesis.cancel();
  if (el) el.pause();
}

export function speak(text: string, lang: string, opts: { slow?: boolean } = {}): Promise<PlayResult> {
  stopSpeech();
  if (!ttsAvailable() || !text) return Promise.resolve('failed');
  const my = gen;
  return new Promise((resolve) => {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = lang;
    const v = bestVoice(lang);
    if (v) u.voice = v;
    u.rate = opts.slow ? Math.max(0.5, rate * 0.65) : rate;
    let done = false;
    const finish = (r: PlayResult) => {
      if (!done) {
        done = true;
        resolve(r);
      }
    };
    u.onstart = () => finish('played');
    u.onend = () => finish('played');
    u.onerror = (e) => finish((e as SpeechSynthesisErrorEvent).error === 'not-allowed' ? 'blocked' : 'failed');
    // Chrome sometimes ignores speak() right after cancel(), or stays paused: give it a moment
    setTimeout(() => {
      if (my !== gen) return finish('failed');
      speechSynthesis.resume();
      speechSynthesis.speak(u);
    }, 60);
    setTimeout(() => finish('failed'), 8000);
  });
}

export function audioUrl(audioId: number) {
  return `https://tatoeba.org/en/audio/download/${audioId}`;
}

/** Wikimedia Commons recording → mp3 URL (non-mp3 originals are served as mp3 transcodes). */
export function commonsUrl(path: string) {
  const base = 'https://upload.wikimedia.org/wikipedia/commons/';
  if (/\.mp3$/i.test(path)) return base + path;
  const file = path.slice(path.lastIndexOf('/') + 1);
  return `${base}transcoded/${path}/${file}.mp3`;
}

const START_TIMEOUT = 6000; // a recording that hasn't started by then is replaced by speech synthesis

/**
 * Play a recording; fall back to speech synthesis if it fails or is too slow to start.
 * Resolves as soon as sound starts (or definitely won't). A newer playback cancels this one quietly.
 */
function playUrl(url: string, fallback: () => Promise<PlayResult>): Promise<PlayResult> {
  stopSpeech();
  const my = gen;
  const a = audioEl();
  return new Promise((resolve) => {
    let settled = false;
    const finish = (r: PlayResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      a.onplaying = a.onerror = null;
      resolve(r);
    };
    const fail = () => {
      if (settled) return;
      if (my !== gen) return finish('failed'); // superseded by another sound: stay silent
      a.onplaying = a.onerror = null;
      a.pause();
      settled = true;
      clearTimeout(timer);
      fallback().then(resolve);
    };
    a.onplaying = () => finish('played');
    a.onerror = () => fail();
    const timer = setTimeout(fail, START_TIMEOUT);
    a.src = url;
    a.play().catch((e: DOMException) => {
      if (my !== gen || e.name === 'AbortError') return; // interrupted by a newer sound — not an error
      if (e.name === 'NotAllowedError') finish('blocked');
      else fail();
    });
  });
}

/** Say a single word: native recording if we have one, otherwise speech synthesis. */
export function sayWord(text: string, lang: string, wa?: string, opts: { slow?: boolean } = {}): Promise<PlayResult> {
  if (wa && !opts.slow) return playUrl(commonsUrl(wa), () => speak(text, lang, opts));
  return speak(text, lang, opts);
}

/** Play a native recording if we have one, otherwise synthesize. */
export function say(text: string, lang: string, audioId?: number, opts: { slow?: boolean } = {}): Promise<PlayResult> {
  if (audioId && !opts.slow) return playUrl(audioUrl(audioId), () => speak(text, lang, opts));
  return speak(text, lang, opts);
}

/** Speech recognition (Chrome/Edge/Safari). Returns transcripts or null when unsupported. */
export function recognitionSupported() {
  const w = window as any;
  return !!(w.SpeechRecognition || w.webkitSpeechRecognition);
}

export function listen(lang: string): Promise<string[]> {
  const w = window as any;
  const SR = w.SpeechRecognition || w.webkitSpeechRecognition;
  if (!SR) return Promise.reject(new Error('unsupported'));
  return new Promise((resolve, reject) => {
    const r = new SR();
    r.lang = lang;
    r.interimResults = false;
    r.maxAlternatives = 5;
    r.onresult = (e: any) => {
      const res = e.results[0];
      const out: string[] = [];
      for (let i = 0; i < res.length; i++) out.push(res[i].transcript);
      resolve(out);
    };
    r.onerror = (e: any) => reject(new Error(e.error || 'error'));
    r.onend = () => resolve([]);
    r.start();
  });
}
