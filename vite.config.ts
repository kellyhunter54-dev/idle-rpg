import { defineConfig } from 'vite';

// base './' makes the build work on GitHub Pages (served from /idle-rpg/)
// and later inside a Tauri desktop wrapper without changes.
export default defineConfig({
  base: './',
});
