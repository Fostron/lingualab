import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

export default defineConfig({
  plugins: [preact()],
  server: { host: true, port: 5180 },
  build: { outDir: 'dist', emptyOutDir: true },
});
