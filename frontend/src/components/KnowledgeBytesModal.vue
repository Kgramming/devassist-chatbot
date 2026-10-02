<script setup>
import { ref, computed } from 'vue'

const emit = defineEmits(['close', 'submit'])

const code = ref('')
const language = ref('')
const context = ref('')
const maxBytes = ref('')

const canSubmit = computed(() => code.value.trim().length > 0)

function onSubmit() {
  const c = code.value.trim()
  if (!c) return
  emit('submit', {
    code: c,
    language: language.value.trim(),
    context: context.value.trim(),
    maxBytes: maxBytes.value.trim(),
  })
}

function onKeydown(e) {
  if (e.key === 'Escape') emit('close')
}
</script>

<template>
  <div
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
    @click.self="emit('close')"
    @keydown="onKeydown"
    role="dialog"
    aria-modal="true"
    aria-label="Knowledge Bytes explainer"
  >
    <div
      class="flex max-h-[90dvh] w-full max-w-2xl flex-col rounded-2xl border border-white/10 bg-[#0d1119] shadow-2xl"
    >
      <!-- Header -->
      <div class="flex shrink-0 items-center justify-between border-b border-white/5 px-5 py-4">
        <div>
          <h2 class="text-[15px] font-semibold text-zinc-100">Knowledge Bytes</h2>
          <p class="mt-0.5 text-[12px] text-zinc-500">
            Break a code file into small, digestible explanations — one concept per byte.
          </p>
        </div>
        <button
          type="button"
          @click="emit('close')"
          title="Close"
          aria-label="Close"
          class="rounded-lg p-1.5 text-zinc-500 transition-colors hover:bg-white/10 hover:text-zinc-200"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      </div>

      <!-- Body -->
      <div class="chat-scroll min-h-0 flex-1 overflow-y-auto px-5 py-4">
        <label for="kb-code" class="mb-1.5 block text-[12px] font-medium text-zinc-300">
          Code to explain
        </label>
        <textarea
          id="kb-code"
          v-model="code"
          rows="10"
          placeholder="Paste your code here…"
          class="chat-scroll w-full resize-y rounded-xl border border-white/10 bg-white/[0.03] px-3.5 py-2.5 font-mono text-[12px] leading-relaxed text-zinc-100 placeholder:text-zinc-600 focus:border-emerald-500/50 focus:outline-none"
        ></textarea>

        <div class="mt-4 grid gap-3 sm:grid-cols-2">
          <div>
            <label for="kb-lang" class="mb-1.5 block text-[12px] font-medium text-zinc-300">
              Language <span class="font-normal text-zinc-600">(optional)</span>
            </label>
            <input
              id="kb-lang"
              v-model="language"
              type="text"
              placeholder="e.g. Python, Vue, Clojure"
              class="w-full rounded-xl border border-white/10 bg-white/[0.03] px-3.5 py-2 text-[13px] text-zinc-100 placeholder:text-zinc-600 focus:border-emerald-500/50 focus:outline-none"
            />
          </div>
          <div>
            <label for="kb-bytes" class="mb-1.5 block text-[12px] font-medium text-zinc-300">
              Length <span class="font-normal text-zinc-600">(optional)</span>
            </label>
            <input
              id="kb-bytes"
              v-model="maxBytes"
              type="text"
              placeholder="e.g. aim for 6-10 bytes total"
              class="w-full rounded-xl border border-white/10 bg-white/[0.03] px-3.5 py-2 text-[13px] text-zinc-100 placeholder:text-zinc-600 focus:border-emerald-500/50 focus:outline-none"
            />
          </div>
        </div>

        <div class="mt-3">
          <label for="kb-context" class="mb-1.5 block text-[12px] font-medium text-zinc-300">
            Context <span class="font-normal text-zinc-600">(optional)</span>
          </label>
          <input
            id="kb-context"
            v-model="context"
            type="text"
            placeholder="e.g. This is a Vue component — assume basic programming knowledge"
            class="w-full rounded-xl border border-white/10 bg-white/[0.03] px-3.5 py-2 text-[13px] text-zinc-100 placeholder:text-zinc-600 focus:border-emerald-500/50 focus:outline-none"
          />
        </div>
      </div>

      <!-- Footer -->
      <div class="flex shrink-0 items-center justify-end gap-2 border-t border-white/5 px-5 py-3.5">
        <button
          type="button"
          @click="emit('close')"
          class="rounded-lg border border-white/10 bg-white/[0.04] px-3.5 py-2 text-[13px] font-medium text-zinc-300 transition-colors hover:bg-white/10"
        >
          Cancel
        </button>
        <button
          type="button"
          @click="onSubmit"
          :disabled="!canSubmit"
          class="rounded-lg bg-emerald-500 px-4 py-2 text-[13px] font-semibold text-emerald-950 transition-colors hover:bg-emerald-400 disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-zinc-600"
        >
          Explain in bytes →
        </button>
      </div>
    </div>
  </div>
</template>
