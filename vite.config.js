import { defineConfig } from 'vite';

// /api/* -> local draft proxy (server/index.js) so the browser stays same-origin.
export default defineConfig({
  server: { proxy: { '/api': 'http://127.0.0.1:5176' } },
});
