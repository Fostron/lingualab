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

let currentAudio: HTMLAudioElement | null = null;

export function stopSpeech() {
  if (ttsAvailable()) speechSynthesis.cancel();
  if (currentAudio) {
    currentAudio.pause();
    currentAudio = null;
  }
}

export function speak(text: string, lang: string, opts: { slow?: boolean } = {}): Promise<void> {
  stopSpeech();
  if (!ttsAvailable() || !text) return Promise.resolve();
  return new Promise((resolve) => {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = lang;
    const v = bestVoice(lang);
    if (v) u.voice = v;
    u.rate = opts.slow ? Math.max(0.5, rate * 0.65) : rate;
    u.onend = () => resolve();
    u.onerror = () => resolve();
    speechSynthesis.speak(u);
  });
}

export function audioUrl(audioId: number) {
  return `https://tatoeba.org/audio/download/${audioId}`;
}

/** Play a native recording if we have one, otherwise synthesize. */
export function say(text: string, lang: string, audioId?: number, opts: { slow?: boolean } = {}): Promise<void> {
  if (audioId && !opts.slow) {
    stopSpeech();
    return new Promise((resolve) => {
      const a = new Audio(audioUrl(audioId));
      currentAudio = a;
      a.onended = () => resolve();
      a.onerror = () => speak(text, lang, opts).then(resolve);
      a.play().catch(() => speak(text, lang, opts).then(resolve));
    });
  }
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
