<template>
  <div v-if="show" class="modal-overlay" @click.self="$emit('close')">
    <div class="modal settings-modal">
      <div class="modal-header">
        <h2>设置</h2>
        <button class="close-btn" @click="$emit('close')">×</button>
      </div>

      <div class="modal-body">
        <!-- 添加实例 -->
        <div class="settings-section">
          <h3>添加 Jenkins 实例</h3>
          <form @submit.prevent="handleAddInstance">
            <div class="form-group">
              <label>显示名称</label>
              <input
                v-model="form.name"
                type="text"
                placeholder="例如：测试环境-Jenkins"
                required
              />
            </div>

            <div class="form-group">
              <label>Jenkins URL</label>
              <input
                v-model="form.url"
                type="url"
                placeholder="https://jenkins.example.com"
                required
              />
            </div>

            <div class="form-group">
              <label>用户名</label>
              <input
                v-model="form.username"
                type="text"
                placeholder="Jenkins 用户名"
                required
              />
            </div>

            <div class="form-group">
              <label>API Token</label>
              <input
                v-model="form.apiToken"
                type="password"
                placeholder="Jenkins API Token"
                required
              />
              <span class="help-text">
                获取方式：登录 Jenkins → 点击用户名 → Configure → API Token → Add new Token
              </span>
            </div>

            <div v-if="formError" class="error-text">{{ formError }}</div>

            <button type="submit" class="btn btn-primary" :disabled="formLoading">
              {{ formLoading ? '验证中...' : '添加并测试连接' }}
            </button>
          </form>
        </div>

        <!-- 实例列表 -->
        <div class="settings-section">
          <h3>已配置的实例</h3>
          <div v-if="instances.length === 0" class="empty-text">
            暂无已配置的实例
          </div>
          <div v-else class="instance-list">
            <div
              v-for="instance in instances"
              :key="instance._id"
              class="instance-item"
            >
              <div class="instance-info">
                <span class="instance-name">{{ instance.name }}</span>
                <span class="instance-url">{{ instance.url }}</span>
              </div>
              <button
                class="btn btn-danger btn-sm"
                @click="handleDeleteInstance(instance._id)"
              >
                删除
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive } from 'vue'
import { useInstances } from '../composables/useInstances'

defineProps<{
  show: boolean
}>()

const emit = defineEmits<{
  (e: 'close'): void
}>()

const { instances, addInstance, deleteInstance } = useInstances()

const form = reactive({
  name: '',
  url: '',
  username: '',
  apiToken: ''
})

const formLoading = ref(false)
const formError = ref<string | null>(null)

/**
 * 添加实例
 */
const handleAddInstance = async () => {
  formLoading.value = true
  formError.value = null

  const result = await addInstance({
    name: form.name,
    url: form.url,
    username: form.username,
    apiToken: form.apiToken
  })

  formLoading.value = false

  if (result.success) {
    // 清空表单
    form.name = ''
    form.url = ''
    form.username = ''
    form.apiToken = ''
    window.ztools.showNotification('✅ 实例添加成功', 'Jenkins Lite')
    emit('close')
  } else {
    formError.value = result.error || '添加失败'
  }
}

/**
 * 删除实例
 */
const handleDeleteInstance = (id: string) => {
  if (confirm('确定要删除这个实例吗？')) {
    deleteInstance(id)
    window.ztools.showNotification('🗑️ 实例已删除', 'Jenkins Lite')
  }
}
</script>

<style scoped>
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.settings-modal {
  background: var(--bg-color, #fff);
  border-radius: 8px;
  width: 480px;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border-color, #e0e0e0);
}

.modal-header h2 {
  margin: 0;
  font-size: 18px;
}

.close-btn {
  width: 28px;
  height: 28px;
  border: none;
  background: transparent;
  font-size: 20px;
  cursor: pointer;
  border-radius: 4px;
}

.close-btn:hover {
  background: var(--bg-hover, #f0f0f0);
}

.modal-body {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
}

.settings-section {
  margin-bottom: 24px;
}

.settings-section:last-child {
  margin-bottom: 0;
}

.settings-section h3 {
  margin: 0 0 12px;
  font-size: 14px;
  font-weight: 600;
}

.form-group {
  margin-bottom: 16px;
}

.form-group label {
  display: block;
  margin-bottom: 6px;
  font-size: 13px;
  font-weight: 500;
}

.form-group input {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid var(--border-color, #e0e0e0);
  border-radius: 4px;
  font-size: 13px;
  box-sizing: border-box;
  background: var(--bg-color, #fff);
  color: var(--text-color, #333);
}

.form-group input::placeholder {
  color: var(--text-secondary, #999);
}

.form-group input:focus {
  outline: none;
  border-color: var(--primary-color, #0078d4);
}

.help-text {
  display: block;
  margin-top: 4px;
  font-size: 11px;
  color: var(--text-secondary, #888);
}

.error-text {
  margin-bottom: 12px;
  padding: 8px 12px;
  background: #fff2f0;
  border: 1px solid #ffccc7;
  border-radius: 4px;
  color: #ff4d4f;
  font-size: 13px;
}

.btn {
  padding: 8px 16px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 13px;
}

.btn-primary {
  background: var(--primary-color, #0078d4);
  border: 1px solid var(--primary-color, #0078d4);
  color: #fff;
}

.btn-primary:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.btn-danger {
  background: #fff;
  border: 1px solid #ff4d4f;
  color: #ff4d4f;
}

.btn-danger:hover {
  background: #fff2f0;
}

.btn-sm {
  padding: 4px 12px;
  font-size: 12px;
}

.empty-text {
  padding: 16px;
  text-align: center;
  color: var(--text-secondary, #888);
  font-size: 13px;
}

.instance-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.instance-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px;
  background: var(--bg-secondary, #f5f5f5);
  border-radius: 6px;
}

.instance-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.instance-name {
  font-weight: 500;
  font-size: 13px;
}

.instance-url {
  font-size: 11px;
  color: var(--text-secondary, #888);
}
</style>
