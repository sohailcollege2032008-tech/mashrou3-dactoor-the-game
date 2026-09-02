import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    target: 'esnext',
    cssCodeSplit: true,
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            // Before the react rule: framer's own paths only, so it cannot be
            // stolen by the substring match — and the chunk stops being named
            // after whichever small component happened to share it.
            if (id.includes('framer-motion') || id.includes('motion-dom') || id.includes('motion-utils')) {
              return 'vendor-motion'
            }
            if (id.includes('react') || id.includes('react-dom') || id.includes('react-router') || id.includes('zustand')) {
              return 'vendor-react'
            }
            if (id.includes('firebase')) {
              return 'vendor-firebase'
            }
            if (id.includes('lucide-react')) {
              return 'vendor-icons'
            }
            if (id.includes('html2canvas') || id.includes('canvas-confetti')) {
              return 'vendor-canvas'
            }
          }
        }
      }
    }
  }
})

