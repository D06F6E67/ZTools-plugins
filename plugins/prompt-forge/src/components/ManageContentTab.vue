<script setup lang="ts">
defineProps<{
  editTitle: string
  editBody: string
}>()

const emit = defineEmits<{
  (e: 'update:editTitle', v: string): void
  (e: 'update:editBody', v: string): void
}>()
</script>

<template>
  <div class="field"><label>标题</label><input :value="editTitle" @input="emit('update:editTitle', ($event.target as HTMLInputElement).value)" /></div>
  <div class="field"><label>正文</label><textarea :value="editBody" class="body-editor" @input="emit('update:editBody', ($event.target as HTMLTextAreaElement).value)" /></div>
</template>

<style scoped>
.field { margin-bottom: 14px; }
.field label { display: block; font-size: 12px; font-weight: 600; color: var(--pf-text-secondary); margin-bottom: 5px; text-transform: uppercase; letter-spacing: 0.04em; }
.field input, .field textarea { width: 100%; border: 1px solid var(--pf-border); background: var(--pf-surface); border-radius: var(--pf-radius-sm); padding: 10px 14px; font-size: 13.5px; }
.field input:focus, .field textarea:focus { border-color: var(--pf-accent); outline: none; box-shadow: 0 0 0 3px var(--pf-accent-soft); }
.body-editor { min-height: 250px; max-height: 50vh; resize: vertical; font-family: var(--pf-font-mono); line-height: 1.6; }
</style>
