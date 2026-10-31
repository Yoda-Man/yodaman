import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'

// The status bar used to carry a hardcoded build number, which sat at v0.3.8
// through two releases. Inject the real one instead so it cannot drift again.
const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
  build: {
    // The largest chunk is the Holocron VR modal, about 660 kB, almost all
    // three.js. It loads only when Holocron VR is opened, and splitting it
    // would not make it smaller.
    chunkSizeWarningLimit: 700,
  },
  server: {
    port: 5190,
    proxy: {
      '/api': {
        target: 'http://localhost:3090',
        changeOrigin: true,
      },
    },
  },
})
