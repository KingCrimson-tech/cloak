import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Cloak is a fully static, browser-only app. ES module workers are used for
// export so mediabunny can run off the main thread.
export default defineConfig({
  plugins: [react()],
  worker: {
    format: 'es',
  },
})
