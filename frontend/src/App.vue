<script setup>
// Layout shell only — all chat/WebSocket/document logic lives in the
// composables and services this shell wires together.
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useWebSocket } from './composables/useWebSocket.js'
import { useChat } from './composables/useChat.js'
import { useChatHistory } from './composables/useChatHistory.js'
import { useDocuments } from './composables/useDocuments.js'
import { getHealth } from './services/api.js'
import { API_BASE_URL_DISPLAY } from './services/config.js'
import Sidebar from './components/Sidebar.vue'
import ChatWindow from './components/ChatWindow.vue'
import ChatInput from './components/ChatInput.vue'
import StatusBadge from './components/StatusBadge.vue'
import KnowledgeBytesModal from './components/KnowledgeBytesModal.vue'
import { buildKnowledgeBytesPrompt } from './services/knowledgeBytes.js'
import { messagesToMarkdown, downloadTextFile, exportFilename } from './services/chatExport.js'

const ws = useWebSocket()
const chat = useChat(ws)
const docs = useDocuments()

// Destructure refs so the template auto-unwraps them (nested refs inside
// plain objects are NOT unwrapped — `docs.documents.filter` would break).
const { connectionState } = ws
const { messages, isGenerating, sendMessage, cancel, retryLast, clearChat, restoreMessages } = chat
const { documents, globalError, upload, remove, refresh, dismissError, clearGlobalError } = docs

// Frontend-only chat history (localStorage). Documents/RAG are untouched.
const history = useChatHistory(messages, { isGenerating, restoreMessages })
const { conversations, activeId } = history

const backendState = ref('checking') // checking | online | offline
const groqConfigured = ref(false)
const sidebarOpen = ref(false)
const showKbModal = ref(false)
let healthTimer = null

const backendOnline = computed(() => backendState.value === 'online')
const wsLabel = computed(() =>
  ws.connectionState.value === 'open'
    ? 'Chat connected'
    : ws.connectionState.value === 'connecting'
      ? 'Connecting…'
      : 'Chat disconnected',
)

// Chat Workspace session statistics (derived live from chat/documents).
const workspaceMessageCount = computed(() => messages.value.length)
const workspaceSourceCount = computed(() =>
  messages.value.reduce((n, m) => n + (m.sources ? m.sources.length : 0), 0),
)
const workspaceHasMessages = computed(() => messages.value.length > 0)

function handleNewChat() {
  // Saves the current conversation to local history, then starts a fresh
  // one. Knowledge-base documents are untouched.
  history.newChat()
  if (window.innerWidth < 768) sidebarOpen.value = false
}

function handleSelectChat(id) {
  // Restores a previous conversation's messages; documents/RAG unaffected.
  history.switchTo(id)
  if (window.innerWidth < 768) sidebarOpen.value = false
}

function handleExportChat() {
  downloadTextFile(exportFilename(), messagesToMarkdown(messages.value))
}

async function checkHealth() {
  try {
    const h = await getHealth()
    backendState.value = 'online'
    groqConfigured.value = !!h.groq_configured
  } catch {
    backendState.value = 'offline'
  }
}

function handleSend(text) {
  sendMessage(text)
  if (window.innerWidth < 768) sidebarOpen.value = false
}

function handleSuggestion(text) {
  handleSend(text)
}

function handleKnowledgeBytes({ code, language, context, maxBytes, difficulty }) {
  // Compose the Knowledge Bytes prompt and send through the normal chat
  // pipeline. No backend changes — the template is model-agnostic.
  try {
    const prompt = buildKnowledgeBytesPrompt(code, { language, context, maxBytes, difficulty })
    showKbModal.value = false
    handleSend(prompt)
  } catch {
    // Empty code is blocked by the modal's own validation; ignore.
  }
}

onMounted(async () => {
  await checkHealth()
  refresh()
  ws.connect() // chat socket; useChat reconnects lazily on send if needed
  healthTimer = setInterval(checkHealth, 20000)
})

onUnmounted(() => {
  if (healthTimer) clearInterval(healthTimer)
})
</script>

<template>
  <div class="flex h-dvh overflow-hidden bg-[#0b0e14] font-sans text-zinc-200 antialiased">
    <Sidebar
      :open="sidebarOpen"
      :documents="documents"
      :backend-state="backendState"
      :groq-configured="groqConfigured"
      :message-count="workspaceMessageCount"
      :source-count="workspaceSourceCount"
      :has-messages="workspaceHasMessages"
      :conversations="conversations"
      :active-chat-id="activeId"
      :chat-busy="isGenerating"
      @close="sidebarOpen = false"
      @upload="upload"
      @remove="remove"
      @dismiss-error="dismissError"
      @new-chat="handleNewChat"
      @select-chat="handleSelectChat"
      @export="handleExportChat"
    />

    <!-- Main column -->
    <div class="flex min-w-0 flex-1 flex-col">
      <!-- Top bar -->
      <header class="flex shrink-0 items-center gap-2 border-b border-white/5 bg-[#0b0e14]/90 px-3 py-2.5 backdrop-blur sm:px-6">
        <button
          type="button"
          @click="sidebarOpen = true"
          title="Open sidebar"
          aria-label="Open sidebar"
          class="rounded-lg p-2 text-zinc-400 transition-colors hover:bg-white/10 hover:text-zinc-100 md:hidden"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <line x1="3" y1="6" x2="21" y2="6"></line>
            <line x1="3" y1="12" x2="21" y2="12"></line>
            <line x1="3" y1="18" x2="21" y2="18"></line>
          </svg>
        </button>

        <div class="min-w-0 flex-1">
          <p class="truncate text-[13px] font-medium text-zinc-200">Programming Q&amp;A</p>
          <p class="truncate font-mono text-[10px] text-zinc-600">
            {{ documents.filter((d) => d._status === 'ready').length }} document(s) indexed
          </p>
        </div>

        <StatusBadge :state="connectionState" :label="wsLabel" />

        <button
          v-if="messages.length"
          type="button"
          @click="clearChat()"
          :disabled="isGenerating"
          title="Clear conversation"
          aria-label="Clear conversation"
          class="rounded-lg px-2.5 py-1.5 text-[12px] font-medium text-zinc-400 transition-colors hover:bg-white/10 hover:text-zinc-100 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Clear
        </button>
      </header>

      <!-- Backend unreachable notice (clean state, no crash) -->
      <div
        v-if="!backendOnline"
        class="shrink-0 border-b border-amber-500/20 bg-amber-500/10 px-4 py-2.5 sm:px-6"
        role="alert"
      >
        <p class="mx-auto max-w-3xl text-[12px] leading-relaxed text-amber-200">
          <span class="font-semibold">Backend unreachable</span> at
          <span class="font-mono">{{ API_BASE_URL_DISPLAY }}</span> — start the FastAPI
          server (<span class="font-mono">uvicorn app.main:app</span>) to enable chat and uploads.
        </p>
      </div>

      <!-- Document-operation error notice (e.g. list/delete failed) -->
      <div
        v-if="globalError"
        class="shrink-0 border-b border-red-500/20 bg-red-500/10 px-4 py-2.5 sm:px-6"
        role="alert"
      >
        <p class="mx-auto flex max-w-3xl items-center justify-between gap-3 text-[12px] leading-relaxed text-red-200">
          <span>{{ globalError }}</span>
          <button
            type="button"
            @click="clearGlobalError()"
            aria-label="Dismiss error"
            class="shrink-0 rounded px-2 py-0.5 font-medium text-red-300 transition-colors hover:bg-white/10 hover:text-red-100"
          >
            Dismiss
          </button>
        </p>
      </div>

      <ChatWindow
        :messages="messages"
        :is-generating="isGenerating"
        :backend-online="backendOnline"
        @retry="retryLast()"
        @suggestion="handleSuggestion"
      />

      <ChatInput
        :disabled="!backendOnline"
        :is-generating="isGenerating"
        @send="handleSend"
        @cancel="cancel()"
        @open-knowledge-bytes="showKbModal = true"
      />

      <KnowledgeBytesModal
        v-if="showKbModal"
        @close="showKbModal = false"
        @submit="handleKnowledgeBytes"
      />
    </div>
  </div>
</template>
