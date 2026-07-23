<script setup>
import { computed, ref } from 'vue'

const props = defineProps({ request: { type: Object, required: true } })
const emit = defineEmits(['close', 'imported', 'toast'])
const busy = ref(false)
const preview = computed(() => props.request.preview || {})
const resourceLabel = computed(() => ({ provider: 'Provider', prompt: 'Prompt', mcp: 'MCP Servers', skill: 'Skill Repository' })[preview.value.resource] || 'Resource')

async function cancel() {
  await window.ccSwitch.cancelDeepLinkImport(props.request.pendingId).catch(() => {})
  emit('close')
}

async function confirm() {
  busy.value = true
  try {
    const result = await window.ccSwitch.confirmDeepLinkImport(props.request.pendingId)
    emit('imported', result)
    emit('close')
  } catch (error) { emit('toast', error.message || 'Deep Link 导入失败', 'error') }
  finally { busy.value = false }
}
</script>

<template>
  <Teleport to="body">
    <div class="modal-backdrop deeplink-backdrop" @click.self="cancel">
      <section class="provider-modal deeplink-modal" role="dialog" aria-modal="true" aria-labelledby="deeplink-title">
        <header class="modal-header"><div><span class="eyebrow">ZTOOLS HOST ENTRY / {{ resourceLabel }}</span><h2 id="deeplink-title">确认导入 {{ resourceLabel }}</h2><p>配置来自外部链接，请核对后再写入本地。</p></div><button class="icon-button" aria-label="关闭" @click="cancel">×</button></header>
        <div class="deeplink-body">
          <div class="deeplink-signal"><i /><div><strong>已在 Preload 安全解析</strong><small>密钥和原始配置不会返回 Web UI；确认 ID 将于 10 分钟后失效。</small></div></div>
          <dl v-if="preview.resource === 'provider'" class="deeplink-fields"><div><dt>应用</dt><dd>{{ preview.app }}</dd></div><div><dt>名称</dt><dd>{{ preview.name }}</dd></div><div><dt>端点</dt><dd>{{ preview.endpoint?.join(', ') }}</dd></div><div><dt>模型</dt><dd>{{ preview.model || '未指定' }}</dd></div><div><dt>API Key</dt><dd>{{ preview.maskedApiKey }}</dd></div><div><dt>导入后切换</dt><dd>{{ preview.enabled ? '是' : '否' }}</dd></div></dl>
          <dl v-else-if="preview.resource === 'prompt'" class="deeplink-fields"><div><dt>应用</dt><dd>{{ preview.app }}</dd></div><div><dt>名称</dt><dd>{{ preview.name }}</dd></div><div class="wide"><dt>描述</dt><dd>{{ preview.description || '—' }}</dd></div><div class="wide"><dt>内容预览</dt><dd class="preview-copy">{{ preview.contentPreview }}</dd></div></dl>
          <dl v-else-if="preview.resource === 'mcp'" class="deeplink-fields"><div><dt>目标应用</dt><dd>{{ preview.apps?.join(', ') }}</dd></div><div><dt>Server 数量</dt><dd>{{ preview.serverIds?.length }}</dd></div><div class="wide"><dt>Server IDs</dt><dd>{{ preview.serverIds?.join(', ') }}</dd></div><div><dt>立即同步</dt><dd>{{ preview.enabled ? '是' : '否' }}</dd></div></dl>
          <dl v-else class="deeplink-fields"><div><dt>GitHub 仓库</dt><dd>{{ preview.repo }}</dd></div><div><dt>分支</dt><dd>{{ preview.branch }}</dd></div><div><dt>目录</dt><dd>{{ preview.directory || '仓库根目录' }}</dd></div><div><dt>启用发现</dt><dd>{{ preview.enabled ? '是' : '否' }}</dd></div></dl>
          <div class="deeplink-warning"><strong>外部配置可以启动本地命令或改变 API 流量去向。</strong><span>只导入你信任的来源，导入后仍可在对应管理页编辑或删除。</span></div>
        </div>
        <footer class="deeplink-actions"><button class="secondary-button" :disabled="busy" @click="cancel">取消</button><button class="primary-button" :disabled="busy" @click="confirm"><span v-if="busy" class="spinner" />确认导入</button></footer>
      </section>
    </div>
  </Teleport>
</template>
