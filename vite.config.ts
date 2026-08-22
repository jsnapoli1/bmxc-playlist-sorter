import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// `base` is configurable so the built app can be served from a subpath
// (e.g. GitHub Pages at /bmxc-playlist-sorter/) without code changes.
export default defineConfig({
  base: process.env.APP_BASE ?? '/',
  plugins: [react()],
  server: { port: 5173 },
})
