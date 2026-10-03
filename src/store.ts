import { useEffect, useState } from 'preact/hooks';
import { COURSES, loadCourse, type CourseInfo } from './content';
import { DEFAULT_SETTINGS, getSettings, saveSettings, type Settings } from './db';
import { setUi } from './i18n';
import { setRetention } from './srs';
import { configureTts, onVoicesChanged } from './tts';
import type { LoadedCourse } from './types';

interface State {
  settings: Settings;
  info: CourseInfo | null;
  course: LoadedCourse | null;
  loading: boolean;
  error: string | null;
  tick: number; // bump to make screens refetch progress
}

const state: State = { settings: DEFAULT_SETTINGS, info: null, course: null, loading: false, error: null, tick: 0 };
const subs = new Set<() => void>();

function emit() {
  for (const s of subs) s();
}

export function useStore(): State {
  const [, set] = useState(0);
  useEffect(() => {
    const f = () => set((x) => x + 1);
    subs.add(f);
    return () => {
      subs.delete(f);
    };
  }, []);
  return state;
}

export function getState() {
  return state;
}

export function bump() {
  state.tick++;
  emit();
}

function applyTheme(theme: Settings['theme']) {
  const root = document.documentElement;
  if (theme === 'auto') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);
}

export async function initStore() {
  onVoicesChanged(() => emit());
  state.settings = await getSettings();
  configureTts(state.settings.rate, state.settings.voice);
  setRetention(state.settings.retention);
  applyTheme(state.settings.theme);
  let id: string | null = null;
  try {
    id = localStorage.getItem('lingualab.course');
  } catch {
    /* storage unavailable */
  }
  if (id && COURSES.some((c) => c.id === id)) await selectCourse(id);
  else setUi(navigator.language.startsWith('ru') ? 'ru' : 'en');
  emit();
}

export async function selectCourse(id: string) {
  const info = COURSES.find((c) => c.id === id) || null;
  state.info = info;
  if (!info) return;
  setUi(info.ui);
  try {
    localStorage.setItem('lingualab.course', id);
  } catch {
    /* ignore */
  }
  state.loading = true;
  state.error = null;
  emit();
  try {
    state.course = await loadCourse(id);
  } catch (e) {
    state.course = null;
    state.error = String(e);
  }
  state.loading = false;
  emit();
}

export async function updateSettings(patch: Partial<Settings>) {
  state.settings = { ...state.settings, ...patch };
  await saveSettings(state.settings);
  configureTts(state.settings.rate, state.settings.voice);
  setRetention(state.settings.retention);
  applyTheme(state.settings.theme);
  emit();
}
