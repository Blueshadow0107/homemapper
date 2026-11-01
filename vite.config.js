import { defineConfig } from 'vite';

// /api/* -> local draft proxy (server/index.js) so the browser stays same-origin.
// DRAFT_PORT lets a second dev server target a different draft server (e.g. a mock) without touching the live one.
const draftPort = process.env.DRAFT_PORT || 5176;
export default defineConfig({
  server: { proxy: { '/api': `http://127.0.0.1:${draftPort}` } },
});
