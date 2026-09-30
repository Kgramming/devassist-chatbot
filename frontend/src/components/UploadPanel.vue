<script setup>
import { ref } from 'vue'
import { ALLOWED_EXTENSIONS } from '../services/config.js'

const props = defineProps({
  disabled: { type: Boolean, default: false },
})
const emit = defineEmits(['select'])

const input = ref(null)
const dragging = ref(false)

function openPicker() {
  if (!props.disabled) input.value?.click()
}

function onPicked(e) {
  const f = e.target.files && e.target.files[0]
  e.target.value = ''
  if (f) emit('select', f)
}

function onDrop(e) {
  dragging.value = false
  if (props.disabled) return
  const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]
  if (f) emit('select', f)
}
</script>

<template>
  <div>
    <div
      role="button"
      tabindex="0"
      :aria-disabled="disabled"
      aria-label="Upload a document (PDF, TXT or MD, up to 5 MB)"
      @click="openPicker"
      @keydown.enter.prevent="openPicker"
      @keydown.space.prevent="openPicker"
      @dragover.prevent="!disabled && (dragging = true)"
      @dragleave.prevent="dragging = false"
      @drop.prevent="onDrop"
      class="cursor-pointer rounded-xl border border-dashed px-4 py-5 text-center transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
      :class="[
        disabled ? 'cursor-not-allowed opacity-50' : '',
        dragging
          ? 'border-emerald-400/70 bg-emerald-500/10'
          : 'border-white/15 bg-white/[0.02] hover:border-emerald-500/40 hover:bg-emerald-500/5',
      ]"
    >
      <div class="mx-auto flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-300" aria-hidden="true">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
          <polyline points="17 8 12 3 7 8"></polyline>
          <line x1="12" y1="3" x2="12" y2="15"></line>
        </svg>
      </div>
      <p class="mt-2.5 text-[13px] font-medium text-zinc-200">
        Drop a file here or <span class="text-emerald-300 underline underline-offset-2">browse</span>
      </p>
      <p class="mt-1 font-mono text-[11px] text-zinc-500">
        {{ ALLOWED_EXTENSIONS.join(' · ').toUpperCase() }} — max 5 MB
      </p>
      <input
        ref="input"
        type="file"
        :accept="ALLOWED_EXTENSIONS.join(',')"
        class="hidden"
        tabindex="-1"
        aria-hidden="true"
        :disabled="disabled"
        @change="onPicked"
      />
    </div>
  </div>
</template>
