<script setup>
import { ref } from 'vue'
import StatusBadge from './StatusBadge.vue'

const props = defineProps({
  documents: { type: Array, default: () => [] },
})
const emit = defineEmits(['remove', 'dismiss-error'])

const confirming = ref(null)
let confirmTimer = null

function formatBytes(n) {
  if (n == null) return '—'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

function extOf(name) {
  const m = /\.([a-z0-9]+)$/i.exec(name || '')
  return m ? m[1].toLowerCase() : ''
}

function formatTime(iso) {
  if (!iso) return ''
  try {
    return new Date(iso).toLocaleString([], {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return ''
  }
}

function onRemove(doc) {
  if (confirming.value === doc.document_id) {
    clearTimeout(confirmTimer)
    confirming.value = null
    emit('remove', doc.document_id)
  } else {
    confirming.value = doc.document_id
    clearTimeout(confirmTimer)
    confirmTimer = setTimeout(() => (confirming.value = null), 3500)
  }
}
</script>

<template>
  <div>
    <p v-if="!documents.length" class="rounded-lg bg-white/[0.02] px-3 py-4 text-center text-[12px] text-zinc-600">
      No documents yet. Uploaded files are chunked, embedded locally and
      indexed for retrieval-augmented answers.
    </p>

    <ul v-else class="space-y-2" aria-label="Uploaded documents">
      <li
        v-for="doc in documents"
        :key="doc.document_id"
        class="rounded-xl border border-white/10 bg-white/[0.03] p-3"
      >
        <div class="flex items-start gap-2.5">
          <!-- File-type icon -->
          <div
            class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg font-mono text-[10px] font-bold uppercase"
            :class="{
              'bg-red-500/15 text-red-300': extOf(doc.filename) === 'pdf',
              'bg-sky-500/15 text-sky-300': extOf(doc.filename) === 'txt',
              'bg-violet-500/15 text-violet-300': extOf(doc.filename) === 'md',
              'bg-zinc-500/15 text-zinc-400': !['pdf', 'txt', 'md'].includes(extOf(doc.filename)),
            }"
            aria-hidden="true"
          >
            {{ extOf(doc.filename) || '?' }}
          </div>

          <div class="min-w-0 flex-1">
            <p class="truncate text-[13px] font-medium text-zinc-100" :title="doc.filename">
              {{ doc.filename }}
            </p>
            <p class="mt-0.5 font-mono text-[11px] text-zinc-500">
              {{ formatBytes(doc.size_bytes) }}
              <span v-if="doc.chunks != null"> · {{ doc.chunks }} chunks</span>
              <span v-if="doc.uploaded_at"> · {{ formatTime(doc.uploaded_at) }}</span>
            </p>

            <!-- Upload progress -->
            <div v-if="doc._status === 'uploading'" class="mt-2" role="progressbar" :aria-valuenow="Math.round(doc._progress * 100)" aria-valuemin="0" aria-valuemax="100" aria-label="Upload progress">
              <div class="h-1.5 overflow-hidden rounded-full bg-white/10">
                <div
                  class="h-full rounded-full bg-sky-400 transition-all duration-200"
                  :style="{ width: `${Math.round(doc._progress * 100)}%` }"
                ></div>
              </div>
              <p class="mt-1 text-[11px] text-sky-300/80">Uploading… {{ Math.round(doc._progress * 100) }}%</p>
            </div>

            <div v-if="doc._status === 'indexing'" class="mt-2 flex items-center gap-2" role="status">
              <span class="h-3 w-3 animate-spin rounded-full border-2 border-violet-400/30 border-t-violet-300" aria-hidden="true"></span>
              <p class="text-[11px] text-violet-300/90">Indexing — chunking, embedding &amp; building the search index…</p>
            </div>

            <p v-if="doc._status === 'error'" class="mt-2 flex items-start gap-1.5 text-[11px] leading-snug text-red-300" role="alert">
              <span class="flex-1">{{ doc._error || 'Processing failed.' }}</span>
              <button
                type="button"
                @click="emit('dismiss-error', doc.document_id)"
                class="shrink-0 underline underline-offset-2 hover:text-red-100"
                title="Dismiss this error"
              >Dismiss</button>
            </p>
          </div>

          <div class="flex shrink-0 flex-col items-end gap-1.5">
            <StatusBadge
              :state="doc._status === 'error' ? 'error' : doc._status"
              :label="doc._status === 'ready' && doc.chunks != null ? `${doc.chunks} chunks` : ''"
            />
            <button
              type="button"
              @click="onRemove(doc)"
              :disabled="doc._pending"
              :title="confirming === doc.document_id ? 'Click again to confirm removal' : `Remove ${doc.filename}`"
              :aria-label="confirming === doc.document_id ? `Confirm removal of ${doc.filename}` : `Remove ${doc.filename}`"
              class="rounded-md px-2 py-1 text-[11px] font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400 disabled:opacity-50"
              :class="confirming === doc.document_id
                ? 'bg-red-500/25 text-red-100 hover:bg-red-500/35'
                : 'text-zinc-500 hover:bg-white/10 hover:text-red-300'"
            >
              {{ doc._pending ? '…' : confirming === doc.document_id ? 'Confirm?' : 'Remove' }}
            </button>
          </div>
        </div>
      </li>
    </ul>
  </div>
</template>
