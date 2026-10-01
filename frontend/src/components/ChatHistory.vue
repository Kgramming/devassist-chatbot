<script setup>
import { computed } from 'vue'

const props = defineProps({
  conversations: { type: Array, default: () => [] },
  activeId: { type: String, default: null },
  hasMessages: { type: Boolean, default: false },
  disabled: { type: Boolean, default: false },
})
const emit = defineEmits(['new-chat', 'select'])

function isToday(ts) {
  const d = new Date(ts)
  const now = new Date()
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  )
}

const today = computed(() =>
  props.conversations.filter((c) => isToday(c.updatedAt)),
)
const previous = computed(() =>
  props.conversations.filter((c) => !isToday(c.updatedAt)),
)
</script>

<template>
  <section aria-label="Chat history" class="rounded-xl border border-white/5 bg-white/[0.02] px-3.5 py-3">
    <div class="flex items-center justify-between">
      <h2 class="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
        Chat history
      </h2>
      <button
        type="button"
        @click="emit('new-chat')"
        :disabled="disabled"
        title="Start a new conversation (documents are kept)"
        class="rounded-lg border border-white/10 bg-white/[0.04] px-2 py-1 text-[11px] font-medium text-zinc-200 transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
      >
        + New chat
      </button>
    </div>

    <div v-if="conversations.length" class="chat-scroll mt-2 max-h-32 space-y-3 overflow-y-auto pr-0.5">
      <div v-if="today.length">
        <p class="mb-1 text-[10px] font-medium uppercase tracking-wider text-zinc-600">Today</p>
        <ul class="space-y-0.5">
          <li v-for="c in today" :key="c.id">
            <button
              type="button"
              @click="emit('select', c.id)"
              :disabled="disabled"
              :aria-current="c.id === activeId ? 'true' : undefined"
              :title="c.title"
              class="block w-full truncate rounded-lg px-2 py-1.5 text-left text-[12px] transition-colors disabled:cursor-not-allowed"
              :class="
                c.id === activeId
                  ? 'bg-emerald-500/15 font-medium text-emerald-200'
                  : 'text-zinc-400 hover:bg-white/5 hover:text-zinc-200'
              "
            >
              {{ c.title }}
            </button>
          </li>
        </ul>
      </div>

      <div v-if="previous.length">
        <p class="mb-1 text-[10px] font-medium uppercase tracking-wider text-zinc-600">Previous</p>
        <ul class="space-y-0.5">
          <li v-for="c in previous" :key="c.id">
            <button
              type="button"
              @click="emit('select', c.id)"
              :disabled="disabled"
              :aria-current="c.id === activeId ? 'true' : undefined"
              :title="c.title"
              class="block w-full truncate rounded-lg px-2 py-1.5 text-left text-[12px] transition-colors disabled:cursor-not-allowed"
              :class="
                c.id === activeId
                  ? 'bg-emerald-500/15 font-medium text-emerald-200'
                  : 'text-zinc-400 hover:bg-white/5 hover:text-zinc-200'
              "
            >
              {{ c.title }}
            </button>
          </li>
        </ul>
      </div>
    </div>

    <p v-else class="mt-2 text-[11px] text-zinc-600">
      No previous conversations yet.
    </p>
  </section>
</template>
