<template>
  <div class="sticky" :style="{ '--note-font-size': settings.fontSize + 'px' }">
    <div class="sticky-titlebar">
      <span class="sticky-title" :title="draftTitle">{{ draftTitle || '便签' }}</span>
      <div class="sticky-actions">
        <el-button link size="small" @click="copyRaw">复制原文</el-button>
        <el-button link size="small" @click="copyPlain">复制纯文本</el-button>
        <el-button link size="small" type="primary" @click="onSave">保存</el-button>
        <el-button link size="small" :icon="Close" @click="onClose" />
      </div>
    </div>

    <MarkdownEditor
      :content="draft.content"
      :note-id="draft.noteId"
      :mode="settings.mode"
      @update:content="updateDraft"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, h } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Close } from '@element-plus/icons-vue'
import MarkdownEditor from './components/MarkdownEditor.vue'
import { useNotes, type NoteType } from './composables/useNotes'
import { useSettings } from './composables/useSettings'
import { toPlainText, normalizeContent, extractTitle } from './utils/md'

const props = defineProps<{ embedded?: boolean }>()
const emit = defineEmits<{
  (e: 'back'): void
  (e: 'saved'): void
}>()

const { draft, savedNotes, updateDraft, saveDraft } = useNotes()
const { settings } = useSettings()

const draftTitle = computed(() => extractTitle(draft.value.content))

async function onSave() {
  if (!draft.value.content.trim()) {
    ElMessage.warning('内容为空，未保存')
    return
  }
  // 新便签保存前选择类型：待办 / 笔记（已保存便签沿用原类型）
  let type: NoteType = draft.value.type
  if (!draft.value.noteId) {
    const picked = await askSaveType()
    if (!picked) return
    type = picked
  }
  saveDraft(type)
  ElMessage.success('已保存')
  emit('saved')
}

/** 弹窗选择保存类型：待办 / 笔记，取消返回 null */
function askSaveType(): Promise<NoteType | null> {
  let selected: NoteType = 'note'
  const radio = (value: NoteType, label: string) =>
    h('label', { style: 'margin-right: 16px; cursor: pointer; font-size: 14px' }, [
      h('input', {
        type: 'radio',
        name: 'easynote-save-type',
        value,
        checked: selected === value,
        onChange: () => (selected = value)
      }),
      ' ' + label
    ])

  return ElMessageBox({
    title: '选择保存类型',
    message: () =>
      h('div', { style: 'display: flex; align-items: center' }, [
        radio('todo', '待办'),
        radio('note', '笔记')
      ]),
    confirmButtonText: '保存',
    cancelButtonText: '取消',
    closeOnClickModal: false
  })
    .then(() => selected)
    .catch(() => null)
}

function copyRaw() {
  window.ztools.copyText(normalizeContent(draft.value.content || ''))
  ElMessage.success('已复制原文')
}

function copyPlain() {
  window.ztools.copyText(toPlainText(normalizeContent(draft.value.content)))
  ElMessage.success('已复制纯文本')
}

function onClose() {
  // 检查是否有未保存的修改
  const content = draft.value.content || ''
  const isDirty = content.trim() && (!draft.value.noteId || savedNotes.value.find((x) => x.id === draft.value.noteId)?.content !== content)
  if (isDirty && !confirm('当前便签有未保存的修改，确定要关闭吗？')) {
    return
  }
  // embedded（主窗口内）：返回 Home；独立便利贴窗口：关闭并结束插件进程
  if (props.embedded) {
    emit('back')
  } else {
    try {
      window.ztools.outPlugin(true)
    } catch {
      /* ignore */
    }
    window.close()
  }
}
</script>
