import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
// @ts-ignore — Node built-in; the project has no @types/node
import { execSync } from 'node:child_process';

/** Short git commit of the build (shown in Settings as part of the version). */
const commit = (() => {
  try {
    return String(execSync('git rev-parse --short HEAD')).trim();
  } catch {
    return 'dev';
  }
})();
const builtAt = Date.now();

export default defineConfig({
  base: './',
  plugins: [preact()],
  define: {
    __BUILD__: JSON.stringify(builtAt.toString(36)),
    __BUILT_AT__: JSON.stringify(builtAt),
    __COMMIT__: JSON.stringify(commit),
  },
  server: { host: true, port: 5180 },
  build: { outDir: 'dist', emptyOutDir: true },
});
