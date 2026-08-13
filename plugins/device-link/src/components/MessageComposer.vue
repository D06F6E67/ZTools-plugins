<script setup lang="ts">
import { ref } from 'vue'
import { Paperclip, SendHorizontal } from 'lucide-vue-next'

defineProps<{ busy: boolean; connectedCount: number }>()
const emit = defineEmits<{ send: [text: string]; attach: [] }>()
const draft = ref('')

function send() {
  const text = draft.value.trim()
  if (!text) return
  emit('send', text)
  draft.value = ''
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault()
    send()
  }
}
</script>

<template>
  <footer class="composer">
    <div class="composer__box">
      <button class="composer__attach" type="button" title="发送文件或文件夹" @click="emit('attach')"><Paperclip :size="19" /></button>
      <textarea v-model="draft" rows="1" maxlength="200000" placeholder="发送文字、链接或粘贴内容…" @keydown="onKeydown" />
      <button class="composer__send" type="button" :disabled="busy || !draft.trim()" title="发送" @click="send"><SendHorizontal :size="18" /></button>
    </div>
    <div class="composer__hint"><span>Enter 发送 · Shift + Enter 换行</span><span>{{ connectedCount ? `将实时推送到 ${connectedCount} 台设备` : '消息会保留，设备上线后可通过 WebDAV 同步' }}</span></div>
  </footer>
</template>
