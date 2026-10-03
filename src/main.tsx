import { render } from 'preact';
import { App } from './app';
import { warmOfflineCache } from './content';
import { initStore } from './store';
import { initSync } from './sync';
import './styles.css';

void initStore().then(() => {
  initSync();
  render(<App />, document.getElementById('app')!);
});

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    const first = !navigator.serviceWorker.controller;
    if (first) navigator.serviceWorker.addEventListener('controllerchange', warmOfflineCache, { once: true });
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {});
  });
}
