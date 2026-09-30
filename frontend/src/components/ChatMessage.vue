<script setup>
import { ref, computed } from 'vue'
import MarkdownBlocks from './MarkdownBlocks.vue'
import StatusBadge from './StatusBadge.vue'

const props = defineProps({
  message: { type: Object, required: true },
})
const emit = defineEmits(['retry'])

const showSources = ref(false)
const isUser = computed(() => props.message.role === 'user')
const isStreaming = computed(() => props.message.state === 'streaming')
const hasError = computed(() => props.message.state === 'error')

function formatTime(ts) {
  try {
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  } catch {
    return ''
  }
}
</script>

<template>
  <div class="flex gap-3" :class="isUser ? 'flex-row-reverse' : 'flex-row'">
    <!-- Avatar -->
    <div
      class="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
      :class="isUser ? 'bg-emerald-500/15 text-emerald-300' : 'bg-violet-500/15 text-violet-300'"
      aria-hidden="true"
    >
      <svg v-if="isUser" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
        <circle cx="12" cy="7" r="4"></circle>
      </svg>
      <svg v-else width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="16 18 22 12 16 6"></polyline>
        <polyline points="8 6 2 12 8 18"></polyline>
      </svg>
    </div>

    <div class="min-w-0 max-w-[88%] sm:max-w-[80%] lg:max-w-[75%]">
      <div class="mb-1 flex items-center gap-2 text-[11px] text-zinc-500">
        <span class="font-medium">{{ isUser ? 'You' : 'DevAssist' }}</span>
        <span>{{ formatTime(message.ts) }}</span>
        <StatusBadge v-if="isStreaming" state="generating" />
      </div>

      <!-- User message: plain text, formatting preserved, no markdown -->
      <div
        v-if="isUser"
        class="whitespace-pre-wrap break-words rounded-2xl rounded-tr-md bg-emerald-500/15 px-4 py-2.5 text-[14px] leading-relaxed text-zinc-100"
      >{{ message.content }}</div>

      <!-- Assistant message -->
      <div v-else class="rounded-2xl rounded-tl-md border border-white/5 bg-white/[0.03] px-4 py-3">
        <MarkdownBlocks :source="message.content" />
        <span
          v-if="isStreaming"
          class="streaming-cursor"
          aria-hidden="true"
        ></span>

        <p v-if="isStreaming && message.statusText" class="mt-1 text-xs text-zinc-500" role="status">
          {{ message.statusText }}
        </p>

        <!-- Error state with retry -->
        <div
          v-if="hasError"
          class="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-[13px] text-red-200"
          role="alert"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="12" y1="8" x2="12" y2="12"></line>
            <line x1="12" y1="16" x2="12.01" y2="16"></line>
          </svg>
          <span class="flex-1">{{ message.error || 'Something went wrong.' }}</span>
          <button
            type="button"
            @click="emit('retry')"
            class="rounded-md bg-red-500/20 px-2.5 py-1 text-xs font-medium text-red-100 transition-colors hover:bg-red-500/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
          >
            Retry
          </button>
        </div>

        <p v-if="message.state === 'stopped'" class="mt-2 text-xs italic text-zinc-500">
          Response stopped.
        </p>

        <!-- RAG sources -->
        <div v-if="message.sources && message.sources.length" class="mt-3 border-t border-white/5 pt-2">
          <button
            type="button"
            @click="showSources = !showSources"
            :aria-expanded="showSources"
            class="inline-flex items-center gap-1.5 text-[11px] font-medium text-zinc-400 transition-colors hover:text-zinc-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 rounded"
            :title="showSources ? 'Hide retrieved sources' : 'Show retrieved sources'"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path>
              <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path>
            </svg>
            Sources ({{ message.sources.length }})
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" :class="showSources && 'rotate-180'" aria-hidden="true">
              <polyline points="6 9 12 15 18 9"></polyline>
            </svg>
          </button>
          <ul v-if="showSources" class="mt-2 space-y-1.5">
            <li
              v-for="(s, i) in message.sources"
              :key="i"
              class="rounded-md bg-white/[0.04] px-2.5 py-1.5 font-mono text-[11px] leading-relaxed text-zinc-400"
            >
              <span class="text-zinc-300">{{ s.filename || 'document' }}</span>
              <span class="text-zinc-600"> · chunk {{ s.chunk_index }}</span>
              <p class="mt-0.5 line-clamp-2 whitespace-pre-wrap font-sans text-zinc-500">{{ s.text }}</p>
            </li>
          </ul>
        </div>
      </div>
    </div>
  </div>
</template>
