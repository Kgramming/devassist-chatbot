import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'

// DevAssist Chatbot — Vue 3 frontend
// TailwindCSS v4 is wired through the official @tailwindcss/vite plugin,
// so no postcss.config is needed; see src/assets/main.css for the entry.
export default defineConfig({
  plugins: [vue(), tailwindcss()],
  server: {
    port: 5173,
    // Allow access through the Ngrok public hostname for testing.
    // Host validation stays on for everything else (no `true` wildcard).
    // The leading-dot entry covers future Ngrok hostnames on this domain.
    allowedHosts: [
      'itinerary-rehire-ramrod.ngrok-free.dev',
      '.ngrok-free.dev',
    ],
    // Proxy backend traffic to the local FastAPI server so the browser
    // only ever talks to the Vite dev-server origin. This is what lets a
    // single Ngrok tunnel (port 5173) serve the whole app: the browser
    // requests https://<tunnel>/health, Vite forwards it to
    // http://localhost:8000/health. Same-origin requests need no CORS.
    //
    // Paths mirror the actual FastAPI routes (see backend/app/api/):
    //   GET  /health, POST /upload, GET|DELETE /documents[/{id}], WS /ws/chat
    proxy: {
      '/health': 'http://localhost:8000',
      '/upload': 'http://localhost:8000',
      '/documents': 'http://localhost:8000',
      '/ws': {
        target: 'http://localhost:8000',
        ws: true, // forward WebSocket upgrade for /ws/chat
      },
    },
  },
})
