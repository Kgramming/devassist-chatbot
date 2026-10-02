<script setup>
import { ref, nextTick, computed } from 'vue'

const props = defineProps({
  disabled: { type: Boolean, default: false },
  isGenerating: { type: Boolean, default: false },
})
const emit = defineEmits(['send', 'cancel', 'open-knowledge-bytes'])

const text = ref('')
const ta = ref(null)

const canSend = computed(
  () => text.value.trim().length > 0 && !props.disabled && !props.isGenerating,
)

function autoResize() {
  const el = ta.value
  if (!el) return
  el.style.height = 'auto'
  el.style.height = Math.min(el.scrollHeight, 200) + 'px'
}

function doSend() {
  const value = text.value.trim()
  if (!value || props.disabled || props.isGenerating) return
  emit('send', value)
  text.value = ''
  nextTick(autoResize)
}

function onKeydown(e) {
  // Enter sends; Shift+Enter inserts a newline.
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    doSend()
  }
}
</script>

<template>
  <div class="border-t border-white/5 bg-[#0b0e14]/80 px-3 pb-3 pt-2 backdrop-blur sm:px-6 sm:pb-4">
    <div
      class="mx-auto flex max-w-3xl items-end gap-2 rounded-2xl border border-white/10 bg-white/[0.04] p-2 transition-colors focus-within:border-emerald-500/50"
    >
      <label for="chat-input" class="sr-only">Message DevAssist</label>
      <textarea
        id="chat-input"
        ref="ta"
        v-model="text"
        rows="1"
        :disabled="disabled || isGenerating"
        @keydown="onKeydown"
        @input="autoResize"
        placeholder="Ask a programming question…  (Shift+Enter for newline)"
        aria-label="Message DevAssist"
        class="max-h-[200px] flex-1 resize-none bg-transparent px-3 py-2 font-mono text-[13px] leading-relaxed text-zinc-100 placeholder:text-zinc-600 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
      ></textarea>

      <button
        type="button"
        @click="emit('open-knowledge-bytes')"
        :disabled="disabled || isGenerating"
        title="Break a code file into knowledge bytes"
        aria-label="Open Knowledge Bytes explainer"
        class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-amber-300 transition-colors hover:bg-white/10 hover:text-amber-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 disabled:cursor-not-allowed disabled:opacity-40"
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"></path>
          <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"></path>
        </svg>
      </button>

      <button
        v-if="isGenerating"
        type="button"
        @click="emit('cancel')"
        title="Stop generating"
        aria-label="Stop generating"
        class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-red-500/20 text-red-300 transition-colors hover:bg-red-500/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <rect x="6" y="6" width="12" height="12" rx="2"></rect>
        </svg>
      </button>
      <button
        v-else
        type="button"
        @click="doSend"
        :disabled="!canSend"
        title="Send (Enter)"
        aria-label="Send message"
        class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-500 text-emerald-950 transition-all hover:bg-emerald-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300 disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-zinc-600"
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <line x1="22" y1="2" x2="11" y2="13"></line>
          <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
        </svg>
      </button>
    </div>
    <p class="mx-auto mt-1.5 max-w-3xl text-center text-[11px] text-zinc-600">
      DevAssist answers programming questions only · responses stream from the backend
    </p>
  </div>
</template>
