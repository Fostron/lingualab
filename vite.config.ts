import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

export default defineConfig({
  base: './',
  plugins: [preact()],
  define: { __BUILD__: JSON.stringify(Date.now().toString(36)) },
  server: { host: true, port: 5180 },
  build: { outDir: 'dist', emptyOutDir: true },
});
