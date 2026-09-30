<script setup>
import { ref, watch, nextTick, onMounted } from 'vue'
import ChatMessage from './ChatMessage.vue'

const props = defineProps({
  messages: { type: Array, default: () => [] },
  isGenerating: { type: Boolean, default: false },
  backendOnline: { type: Boolean, default: true },
})
const emit = defineEmits(['retry', 'suggestion'])

const scrollEl = ref(null)
const nearBottom = ref(true)

const SUGGESTIONS = [
  'Explain how Python list comprehensions work',
  'Write a FastAPI endpoint that streams a response',
  'How do I debug a race condition in async code?',
  'What is the difference between TCP and UDP?',
]

function onScroll() {
  const el = scrollEl.value
  if (!el) return
  nearBottom.value = el.scrollHeight - el.scrollTop - el.clientHeight < 120
}

function scrollToBottom() {
  const el = scrollEl.value
  if (el) el.scrollTop = el.scrollHeight
}

function maybeScroll() {
  if (nearBottom.value) nextTick(scrollToBottom)
}

// New messages…
watch(
  () => props.messages.length,
  () => nextTick(() => {
    nearBottom.value = true
    scrollToBottom()
  }),
)
// …and streamed tokens only scroll when the user was already near the bottom.
watch(
  () => props.messages[props.messages.length - 1]?.content?.length,
  () => maybeScroll(),
)

onMounted(scrollToBottom)
defineExpose({ scrollToBottom })
</script>

<template>
  <div
    ref="scrollEl"
    @scroll="onScroll"
    class="chat-scroll min-h-0 flex-1 overflow-y-auto px-3 py-6 sm:px-6"
    role="log"
    aria-live="polite"
    aria-label="Conversation with DevAssist"
  >
    <div class="mx-auto max-w-3xl">
      <!-- Empty state -->
      <div v-if="!messages.length" class="flex flex-col items-center pt-10 text-center sm:pt-16">
        <div class="flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-500/15 text-emerald-300" aria-hidden="true">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="16 18 22 12 16 6"></polyline>
            <polyline points="8 6 2 12 8 18"></polyline>
          </svg>
        </div>
        <h2 class="mt-4 text-xl font-semibold text-zinc-100">Ask me anything about programming</h2>
        <p class="mt-2 max-w-md text-[13px] leading-relaxed text-zinc-500">
          Debugging, algorithms, system design, APIs, databases, code review —
          upload a document on the left and I'll ground answers in it too.
        </p>
        <div class="mt-6 grid w-full max-w-xl gap-2 sm:grid-cols-2">
          <button
            v-for="s in SUGGESTIONS"
            :key="s"
            type="button"
            @click="emit('suggestion', s)"
            :disabled="!backendOnline"
            class="rounded-xl border border-white/10 bg-white/[0.03] px-3.5 py-2.5 text-left font-mono text-[12px] leading-snug text-zinc-300 transition-all hover:border-emerald-500/40 hover:bg-emerald-500/5 hover:text-zinc-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {{ s }}
          </button>
        </div>
        <p v-if="!backendOnline" class="mt-4 text-xs text-amber-300/80">
          The backend is unreachable — start the FastAPI server to begin chatting.
        </p>
      </div>

      <!-- Messages -->
      <div v-else class="space-y-6">
        <ChatMessage
          v-for="m in messages"
          :key="m.id"
          :message="m"
          @retry="emit('retry')"
        />
        <div v-if="isGenerating" class="sr-only" role="status">DevAssist is generating a response…</div>
      </div>
    </div>
  </div>
</template>
