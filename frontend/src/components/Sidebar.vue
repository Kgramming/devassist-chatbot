<script setup>
import UploadPanel from './UploadPanel.vue'
import DocumentList from './DocumentList.vue'
import StatusBadge from './StatusBadge.vue'
import ChatWorkspace from './ChatWorkspace.vue'
import ChatHistory from './ChatHistory.vue'
import { API_BASE_URL_DISPLAY } from '../services/config.js'

const props = defineProps({
  open: { type: Boolean, default: false },
  documents: { type: Array, default: () => [] },
  backendState: { type: String, default: 'checking' }, // checking | online | offline
  groqConfigured: { type: Boolean, default: false },
  messageCount: { type: Number, default: 0 },
  sourceCount: { type: Number, default: 0 },
  hasMessages: { type: Boolean, default: false },
  conversations: { type: Array, default: () => [] },
  activeChatId: { type: String, default: null },
  chatBusy: { type: Boolean, default: false },
})
const emit = defineEmits(['close', 'upload', 'remove', 'dismiss-error', 'new-chat', 'select-chat', 'export'])
</script>

<template>
  <div>
    <!-- Mobile backdrop -->
    <div
      v-if="open"
      @click="emit('close')"
      class="fixed inset-0 z-30 bg-black/60 backdrop-blur-sm md:hidden"
      aria-hidden="true"
    ></div>

    <aside
      class="fixed inset-y-0 left-0 z-40 flex w-[300px] shrink-0 flex-col border-r border-white/5 bg-[#0d1119] transition-transform duration-200 md:static md:z-auto md:h-full md:translate-x-0"
      :class="open ? 'translate-x-0' : '-translate-x-full'"
      aria-label="DevAssist sidebar"
    >
      <!-- Branding -->
      <div class="flex shrink-0 items-center gap-3 border-b border-white/5 px-4 py-4">
        <div class="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-400 to-teal-600 text-emerald-950" aria-hidden="true">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="16 18 22 12 16 6"></polyline>
            <polyline points="8 6 2 12 8 18"></polyline>
          </svg>
        </div>
        <div class="min-w-0 flex-1">
          <h1 class="text-[15px] font-semibold tracking-tight text-zinc-100">DevAssist</h1>
          <p class="text-[11px] text-zinc-500">Programming assistant</p>
        </div>
        <button
          type="button"
          @click="emit('close')"
          title="Close sidebar"
          aria-label="Close sidebar"
          class="rounded-lg p-1.5 text-zinc-500 transition-colors hover:bg-white/10 hover:text-zinc-200 md:hidden"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      </div>

      <!-- Content column: fixed sections + independently scrolling document list.
           overflow-y-auto is a safety net: if the viewport is too short for
           all fixed sections, the column scrolls instead of overlapping. -->
      <div class="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 py-4">
        <h2 class="mb-2 shrink-0 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
          Knowledge base
        </h2>
        <div class="shrink-0">
          <UploadPanel :disabled="backendState !== 'online'" @select="(f) => emit('upload', f)" />
        </div>

        <h2 class="mb-2 mt-5 shrink-0 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
          Documents
          <span v-if="documents.length" class="ml-1 rounded-full bg-white/10 px-1.5 py-0.5 text-[10px] text-zinc-300">{{ documents.length }}</span>
        </h2>
        <div class="chat-scroll min-h-[100px] flex-1 overflow-y-auto">
          <DocumentList
            :documents="documents"
            @remove="(id) => emit('remove', id)"
            @dismiss-error="(id) => emit('dismiss-error', id)"
          />
        </div>

        <div class="mt-4 shrink-0">
          <ChatHistory
            :conversations="conversations"
            :active-id="activeChatId"
            :disabled="chatBusy"
            @new-chat="emit('new-chat')"
            @select="(id) => emit('select-chat', id)"
          />
        </div>

        <div class="mt-4 shrink-0">
          <ChatWorkspace
            :message-count="messageCount"
            :document-count="documents.length"
            :source-count="sourceCount"
            :has-messages="hasMessages"
            @new-chat="emit('new-chat')"
            @export="emit('export')"
          />
        </div>
      </div>

      <!-- Footer: backend status -->
      <div class="shrink-0 border-t border-white/5 px-4 py-3">
        <div class="flex items-center justify-between gap-2">
          <StatusBadge
            :state="backendState === 'online' ? 'online' : backendState === 'offline' ? 'offline' : 'checking'"
            :label="backendState === 'online' ? 'Backend online' : backendState === 'offline' ? 'Backend offline' : 'Checking backend…'"
          />
          <span
            v-if="backendState === 'online'"
            class="font-mono text-[10px]"
            :class="groqConfigured ? 'text-emerald-400/80' : 'text-amber-300/80'"
            :title="groqConfigured ? 'Groq API key is configured on the backend' : 'Groq API key is NOT configured — chat will use clearly-marked mock responses'"
          >
            {{ groqConfigured ? '● groq ready' : '● groq missing' }}
          </span>
        </div>
        <p class="mt-1.5 truncate font-mono text-[10px] text-zinc-600" :title="API_BASE_URL_DISPLAY">
          {{ API_BASE_URL_DISPLAY }}
        </p>
      </div>
    </aside>
  </div>
</template>
