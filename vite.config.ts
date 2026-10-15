import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { viteSingleFile } from 'vite-plugin-singlefile'

// `--mode single` inlines everything into one HTML file (used for the shareable preview).
// The normal build emits a regular static site with relative paths, ready for Capacitor.
export default defineConfig(({ mode }) => ({
  base: './',
  // the Supabase integration on Vercel provides the public URL and key under these names
  envPrefix: ['VITE_', 'NEXT_PUBLIC_SUPABASE_'],
  plugins: [react(), tailwindcss(), ...(mode === 'single' ? [viteSingleFile()] : [])],
  // three.js is one ~600 kB chunk, loaded only when Slots opens
  build: { outDir: mode === 'single' ? 'dist-single' : 'dist', chunkSizeWarningLimit: 700 },
  // local dev only: forward /api to a stand-in for the Vercel functions
  server: { proxy: { '/api': 'http://127.0.0.1:3001' } },
}))
