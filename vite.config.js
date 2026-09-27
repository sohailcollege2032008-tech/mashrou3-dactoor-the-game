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
        // Priority groups instead of a manualChunks function: under rolldown a
        // function-assigned group drags its dependencies in with it, so React
        // itself landed inside vendor-motion and every page — the landing page
        // included — paid for framer-motion. Higher priority claims first.
        codeSplitting: {
          groups: [
            { name: 'vendor-react',       test: /node_modules[\\/](react|react-dom|react-router|react-router-dom|scheduler|zustand|use-sync-external-store)[\\/]/, priority: 50 },
            { name: 'vendor-firebase',    test: /node_modules[\\/](@firebase|firebase|idb|tslib)[\\/]/, priority: 40 },
            { name: 'vendor-motion',      test: /node_modules[\\/](framer-motion|motion-dom|motion-utils)[\\/]/, priority: 30 },
            { name: 'vendor-icons',       test: /node_modules[\\/]lucide-react[\\/]/, priority: 30 },
            // Kept apart: confetti (~10 KB) is on every player screen, while
            // html2canvas (~195 KB) is only the host's bracket export.
            { name: 'vendor-html2canvas', test: /node_modules[\\/]html2canvas[\\/]/, priority: 30 },
            { name: 'vendor-confetti',    test: /node_modules[\\/]canvas-confetti[\\/]/, priority: 30 },
          ],
        },
      },
    },
  },
})
