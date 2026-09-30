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
  },
})
