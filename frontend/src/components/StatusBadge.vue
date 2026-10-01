<script setup>
import { computed } from 'vue'

const props = defineProps({
  state: { type: String, default: 'idle' },
  label: { type: String, default: '' },
})

// Shared pill for connection / upload / generation states.
const MAP = {
  online:     { dot: 'bg-emerald-400', text: 'text-emerald-300', pulse: false, label: 'Online' },
  offline:    { dot: 'bg-red-400',     text: 'text-red-300',     pulse: false, label: 'Offline' },
  checking:   { dot: 'bg-amber-400',   text: 'text-amber-300',   pulse: true,  label: 'Checking…' },
  connecting: { dot: 'bg-amber-400',   text: 'text-amber-300',   pulse: true,  label: 'Connecting…' },
  open:       { dot: 'bg-emerald-400', text: 'text-emerald-300', pulse: false, label: 'Connected' },
  closed:     { dot: 'bg-zinc-500',    text: 'text-zinc-400',    pulse: false, label: 'Disconnected' },
  idle:       { dot: 'bg-zinc-500',    text: 'text-zinc-400',    pulse: false, label: 'Idle' },
  uploading:  { dot: 'bg-sky-400',     text: 'text-sky-300',     pulse: true,  label: 'Uploading' },
  indexing:   { dot: 'bg-violet-400',  text: 'text-violet-300',  pulse: true,  label: 'Indexing…' },
  queued:     { dot: 'bg-zinc-400',   text: 'text-zinc-400',   pulse: false, label: 'Queued' },
  cancelled:  { dot: 'bg-zinc-500',   text: 'text-zinc-500',   pulse: false, label: 'Cancelled' },
  generating: { dot: 'bg-emerald-400', text: 'text-emerald-300', pulse: true,  label: 'Generating' },
  ready:      { dot: 'bg-emerald-400', text: 'text-emerald-300', pulse: false, label: 'Ready' },
  error:      { dot: 'bg-red-400',     text: 'text-red-300',     pulse: false, label: 'Error' },
}

const cfg = computed(() => MAP[props.state] || MAP.idle)
const text = computed(() => props.label || cfg.value.label)
</script>

<template>
  <span
    class="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-white/5 px-2.5 py-1 text-[11px] font-medium leading-none"
    :class="cfg.text"
    role="status"
  >
    <span
      class="h-1.5 w-1.5 rounded-full"
      :class="[cfg.dot, cfg.pulse && 'animate-pulse']"
      aria-hidden="true"
    ></span>
    {{ text }}
  </span>
</template>
