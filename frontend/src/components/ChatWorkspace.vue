<script setup>
// Chat Workspace: session statistics + conversation actions.
// Purely presentational — all state lives in App.vue composables.
// Clearing the chat never touches the knowledge-base documents.
defineProps({
  messageCount: { type: Number, default: 0 },
  documentCount: { type: Number, default: 0 },
  sourceCount: { type: Number, default: 0 },
  hasMessages: { type: Boolean, default: false },
})
defineEmits(['new-chat', 'export'])
</script>

<template>
  <section aria-label="Chat workspace" class="rounded-xl border border-white/5 bg-white/[0.02] px-3.5 py-3">
    <h2 class="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
      Chat workspace
    </h2>

    <dl class="mt-2.5 space-y-1.5">
      <div class="flex items-center justify-between text-[12px]">
        <dt class="text-zinc-500">Messages</dt>
        <dd class="font-mono text-zinc-200">{{ messageCount }}</dd>
      </div>
      <div class="flex items-center justify-between text-[12px]">
        <dt class="text-zinc-500">Documents</dt>
        <dd class="font-mono text-zinc-200">{{ documentCount }}</dd>
      </div>
      <div class="flex items-center justify-between text-[12px]">
        <dt class="text-zinc-500">Sources used</dt>
        <dd class="font-mono text-zinc-200">{{ sourceCount }}</dd>
      </div>
    </dl>

    <div class="mt-3 grid grid-cols-2 gap-2">
      <button
        type="button"
        @click="$emit('new-chat')"
        :disabled="!hasMessages"
        title="Clear the current conversation (documents are kept)"
        class="rounded-lg border border-white/10 bg-white/[0.04] px-2 py-1.5 text-[12px] font-medium text-zinc-200 transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
      >
        New chat
      </button>
      <button
        type="button"
        @click="$emit('export')"
        :disabled="!hasMessages"
        title="Download this conversation as Markdown"
        class="rounded-lg border border-white/10 bg-white/[0.04] px-2 py-1.5 text-[12px] font-medium text-zinc-200 transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
      >
        Export
      </button>
    </div>
  </section>
</template>
