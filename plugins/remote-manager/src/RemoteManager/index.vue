<script lang="ts" setup>
import { ref, onMounted, computed } from 'vue'

defineProps({
  enterAction: {
    type: Object,
    required: true
  }
})

interface RemoteHost {
  id: string
  address: string
  username: string
  password: string
  order?: number
}

const hosts = ref<RemoteHost[]>([])
const showAddModal = ref(false)
const showEditModal = ref(false)
const showDeleteModal = ref(false)
const showAddPassword = ref(false)
const showEditPassword = ref(false)
const tip = ref('')
const search = ref('')
const draggingIndex = ref(-1)
const dragOverIndex = ref(-1)
const dragSourceIndex = ref(-1)
const dragHandlePressed = ref(false)
const hostToDelete = ref<RemoteHost | null>(null)

const isSearching = computed(() => search.value.trim().length > 0)

const filteredHosts = computed(() => {
  const keyword = search.value.trim().toLowerCase()
  if (!keyword) return hosts.value
  return hosts.value.filter(h => h.id.toLowerCase().includes(keyword))
})

const form = ref<RemoteHost>({
  id: '',
  address: '',
  username: '',
  password: ''
})

const editForm = ref<RemoteHost>({
  id: '',
  address: '',
  username: '',
  password: ''
})

const originalId = ref('')
const originalEncryptedPassword = ref('')
const editOriginalPassword = ref('')

onMounted(() => {
  loadHosts()
})

function loadHosts() {
  try {
    hosts.value = window.services.getHosts() || []
  } catch {
    hosts.value = []
  }
}

function openAdd() {
  form.value = { id: '', address: '', username: '', password: '' }
  showAddModal.value = true
}

function openEdit(host: RemoteHost) {
  originalId.value = host.id
  originalEncryptedPassword.value = host.password
  const plainPassword = window.services.decryptPassword(host.password)
  editOriginalPassword.value = plainPassword
  editForm.value = { ...host, password: plainPassword }
  showEditModal.value = true
}

function handleAdd() {
  if (!form.value.id || !form.value.address || !form.value.username || !form.value.password) {
    showTip('请填写完整信息')
    return
  }
  try {
    const result = window.services.addHost(form.value)
    if (result.success) {
      showAddModal.value = false
      loadHosts()
      showTip('添加成功')
    } else {
      showTip(result.error)
    }
  } catch (e: any) {
    showTip('添加失败: ' + e.message)
  }
}

function handleEdit() {
  if (!editForm.value.id || !editForm.value.address || !editForm.value.username || !editForm.value.password) {
    showTip('请填写完整信息')
    return
  }
  try {
    const passwordToSave = editForm.value.password === editOriginalPassword.value
      ? originalEncryptedPassword.value
      : editForm.value.password
    const result = window.services.updateHost(originalId.value, { ...editForm.value, password: passwordToSave })
    if (result.success) {
      showEditModal.value = false
      loadHosts()
      showTip('修改成功')
    } else {
      showTip(result.error)
    }
  } catch (e: any) {
    showTip('修改失败: ' + e.message)
  }
}

function handleDelete(host: RemoteHost) {
  hostToDelete.value = host
  showDeleteModal.value = true
}

function confirmDelete() {
  if (!hostToDelete.value) return
  try {
    const result = window.services.deleteHost(hostToDelete.value.id)
    if (result.success) {
      loadHosts()
      showTip('删除成功')
    } else {
      showTip(result.error)
    }
  } catch (e: any) {
    showTip('删除失败: ' + e.message)
  } finally {
    showDeleteModal.value = false
    hostToDelete.value = null
  }
}

function cancelDelete() {
  showDeleteModal.value = false
  hostToDelete.value = null
}

function handleConnect(host: RemoteHost) {
  try {
    const result = window.services.connectRdp(host.address, host.username, host.password)
    if (result.success) {
      showTip('正在连接...')
      setTimeout(() => window.ztools.hideMainWindow(), 800)
    } else {
      showTip('连接失败: ' + result.error)
    }
  } catch (e: any) {
    showTip('连接失败: ' + e.message)
  }
}

function handleDragStart(e: DragEvent, index: number) {
  if (!dragHandlePressed.value || isSearching.value) {
    e.preventDefault()
    dragHandlePressed.value = false
    return
  }
  draggingIndex.value = index
  dragSourceIndex.value = index
  dragOverIndex.value = index
  dragHandlePressed.value = false
}

function handleTbodyDragOver(e: DragEvent) {
  e.preventDefault()
  if (draggingIndex.value === -1 || isSearching.value) return

  const tbody = e.currentTarget as HTMLElement
  const rows = Array.from(tbody.querySelectorAll('tr.draggable-row'))
  if (rows.length === 0) return

  let newIndex = rows.length
  for (let i = 0; i < rows.length; i++) {
    const rect = rows[i].getBoundingClientRect()
    const midpoint = rect.top + rect.height / 2
    if (e.clientY < midpoint) {
      newIndex = i
      break
    }
  }

  dragOverIndex.value = newIndex
}

function handleTbodyDragLeave(e: DragEvent) {
  const tbody = e.currentTarget as HTMLElement
  const related = e.relatedTarget as HTMLElement
  if (!tbody.contains(related)) {
    dragOverIndex.value = -1
  }
}

function handleTbodyDrop(e: DragEvent) {
  e.preventDefault()
  if (draggingIndex.value === -1 || dragOverIndex.value === -1 || isSearching.value) return

  const sourceIndex = dragSourceIndex.value
  const targetIndex = dragOverIndex.value
  if (sourceIndex === targetIndex || sourceIndex + 1 === targetIndex) {
    draggingIndex.value = -1
    dragOverIndex.value = -1
    dragSourceIndex.value = -1
    return
  }

  const newList = [...filteredHosts.value]
  const [movedItem] = newList.splice(sourceIndex, 1)

  let insertIndex = targetIndex
  if (sourceIndex < targetIndex) {
    insertIndex = targetIndex - 1
  }
  newList.splice(insertIndex, 0, movedItem)

  hosts.value = newList.map((h, index) => ({ ...h, order: index + 1 }))

  try {
    const result = window.services.updateOrder(hosts.value)
    if (!result.success) {
      showTip('排序保存失败: ' + result.error)
    }
  } catch (err: any) {
    showTip('排序保存失败: ' + err.message)
  }

  draggingIndex.value = -1
  dragOverIndex.value = -1
  dragSourceIndex.value = -1
}

function handleDragEnd() {
  draggingIndex.value = -1
  dragOverIndex.value = -1
  dragSourceIndex.value = -1
  dragHandlePressed.value = false
}

function showTip(msg: string) {
  tip.value = msg
  setTimeout(() => { tip.value = '' }, 2000)
}
</script>

<template>
  <div class="remote-manager">
    <div class="toolbar">
      <div class="toolbar-left">
        <svg class="toolbar-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="2" y="3" width="20" height="14" rx="2"/>
          <line x1="8" y1="21" x2="16" y2="21"/>
          <line x1="12" y1="17" x2="12" y2="21"/>
        </svg>
        <h2>远程桌面管理</h2>
      </div>
      <div class="toolbar-right">
        <div class="search-box">
          <svg viewBox="0 0 16 16" fill="currentColor" width="14" height="14">
            <path d="M11.742 10.344a6.5 6.5 0 1 0-1.397 1.398h-.001l3.85 3.85a1 1 0 0 0 1.415-1.414l-3.85-3.85zm-5.242.156a5 5 0 1 1 0-10 5 5 0 0 1 0 10z"/>
          </svg>
          <input v-model="search" type="text" placeholder="搜索编号" />
        </div>
        <button class="btn-add" @click="openAdd">
          <svg viewBox="0 0 16 16" fill="currentColor" width="16" height="16" style="display:inline-block;vertical-align:middle">
            <path d="M9 1h-2v5H2v2h5v5h2V8h5V6h-5V1z"/>
          </svg>
          <span>新增主机</span>
        </button>
      </div>
    </div>

    <div v-if="filteredHosts.length === 0" class="empty">
      <svg class="empty-icon" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="8" y="12" width="48" height="32" rx="4"/>
        <line x1="24" y1="52" x2="40" y2="52"/>
        <line x1="32" y1="44" x2="32" y2="52"/>
        <line x1="24" y1="28" x2="40" y2="28" stroke-dasharray="2 4"/>
      </svg>
      <p v-if="hosts.length === 0">暂无远程主机，请点击右上角"新增主机"添加</p>
      <p v-else>未找到匹配的远程主机</p>
    </div>

    <div v-else class="table-wrapper">
      <table class="hosts-table">
        <thead>
          <tr>
            <th class="col-drag"></th>
            <th class="col-id">编号</th>
            <th class="col-address">地址</th>
            <th class="col-username">用户名</th>
            <th class="col-actions">操作</th>
          </tr>
        </thead>
        <tbody
          @dragover.prevent="handleTbodyDragOver"
          @dragleave="handleTbodyDragLeave"
          @drop.prevent="handleTbodyDrop"
        >
          <template v-for="(host, index) in filteredHosts" :key="host.id">
            <tr
              v-if="draggingIndex !== -1 && dragOverIndex === index"
              class="drop-indicator"
            >
              <td colspan="5"><div class="drop-line"></div></td>
            </tr>
            <tr
              :draggable="!isSearching"
              class="draggable-row"
              :class="{ dragging: draggingIndex === index, 'drag-disabled': isSearching }"
              @mousedown="dragHandlePressed = false"
              @dragstart="handleDragStart($event, index)"
              @dragend="handleDragEnd"
            >
              <td class="col-drag" @mousedown.stop="dragHandlePressed = true">
                <svg class="drag-handle" viewBox="0 0 16 16" fill="currentColor" width="14" height="14">
                  <circle cx="4" cy="4" r="1.5"/>
                  <circle cx="8" cy="4" r="1.5"/>
                  <circle cx="12" cy="4" r="1.5"/>
                  <circle cx="4" cy="8" r="1.5"/>
                  <circle cx="8" cy="8" r="1.5"/>
                  <circle cx="12" cy="8" r="1.5"/>
                  <circle cx="4" cy="12" r="1.5"/>
                  <circle cx="8" cy="12" r="1.5"/>
                  <circle cx="12" cy="12" r="1.5"/>
                </svg>
              </td>
              <td class="col-id">{{ host.id }}</td>
              <td class="col-address">{{ host.address }}</td>
              <td class="col-username">{{ host.username }}</td>
              <td class="col-actions">
                <button class="btn-connect" @click="handleConnect(host)">连接</button>
                <button class="btn-edit" @click="openEdit(host)">编辑</button>
                <button class="btn-delete" @click="handleDelete(host)">删除</button>
              </td>
            </tr>
          </template>
          <tr
            v-if="draggingIndex !== -1 && dragOverIndex === filteredHosts.length"
            class="drop-indicator"
          >
            <td colspan="5"><div class="drop-line"></div></td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="tip" class="tip">{{ tip }}</div>

    <div v-if="showAddModal" class="modal-overlay" @click.self="showAddModal = false">
      <div class="modal">
        <div class="modal-header">
          <h3>新增主机</h3>
          <button class="modal-close" @click="showAddModal = false">&times;</button>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label>编号</label>
            <input v-model="form.id" placeholder="唯一标识，支持中文" />
          </div>
          <div class="form-group">
            <label>地址</label>
            <input v-model="form.address" placeholder="IP 或域名" />
          </div>
          <div class="form-group">
            <label>用户名</label>
            <input v-model="form.username" placeholder="远程登录用户名" />
          </div>
          <div class="form-group">
            <label>密码</label>
            <div class="password-input">
              <input v-model="form.password" :type="showAddPassword ? 'text' : 'password'" placeholder="远程登录密码" />
              <button class="btn-toggle-password" type="button" @click="showAddPassword = !showAddPassword">
                <svg v-if="!showAddPassword" viewBox="0 0 16 16" fill="currentColor" width="16" height="16">
                  <path d="M8 3.5C4.36 3.5 1.22 5.91 0 9c1.22 3.09 4.36 5.5 8 5.5s6.78-2.41 8-5.5c-1.22-3.09-4.36-5.5-8-5.5zm0 8.5c-1.66 0-3-1.34-3-3s1.34-3 3-3 3 1.34 3 3-1.34 3-3 3zm0-4.5c-.83 0-1.5.67-1.5 1.5s.67 1.5 1.5 1.5 1.5-.67 1.5-1.5-.67-1.5-1.5-1.5z"/>
                </svg>
                <svg v-else viewBox="0 0 16 16" fill="currentColor" width="16" height="16">
                  <path d="M8 5c-1.657 0-3 1.343-3 3s1.343 3 3 3 3-1.343 3-3-1.343-3-3-3zm0 4.5c-.828 0-1.5-.672-1.5-1.5s.672-1.5 1.5-1.5 1.5.672 1.5 1.5-.672 1.5-1.5 1.5z"/>
                  <path d="M8 2.5C3.5 2.5.5 6.348.5 8c0 1.652 3 5.5 7.5 5.5s7.5-3.848 7.5-5.5c0-1.652-3-5.5-7.5-5.5zm0 9.5c-3.033 0-5.723-2.73-6.43-4 .707-1.27 3.397-4 6.43-4s5.723 2.73 6.43 4c-.707 1.27-3.397 4-6.43 4z"/>
                </svg>
              </button>
            </div>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn-cancel" @click="showAddModal = false">取消</button>
          <button class="btn-confirm" @click="handleAdd">确定</button>
        </div>
      </div>
    </div>

    <div v-if="showEditModal" class="modal-overlay" @click.self="showEditModal = false">
      <div class="modal">
        <div class="modal-header">
          <h3>编辑主机</h3>
          <button class="modal-close" @click="showEditModal = false">&times;</button>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label>编号</label>
            <input v-model="editForm.id" placeholder="唯一标识，支持中文" />
          </div>
          <div class="form-group">
            <label>地址</label>
            <input v-model="editForm.address" placeholder="IP 或域名" />
          </div>
          <div class="form-group">
            <label>用户名</label>
            <input v-model="editForm.username" placeholder="远程登录用户名" />
          </div>
          <div class="form-group">
            <label>密码</label>
            <div class="password-input">
              <input v-model="editForm.password" :type="showEditPassword ? 'text' : 'password'" placeholder="远程登录密码" />
              <button class="btn-toggle-password" type="button" @click="showEditPassword = !showEditPassword">
                <svg v-if="!showEditPassword" viewBox="0 0 16 16" fill="currentColor" width="16" height="16">
                  <path d="M8 3.5C4.36 3.5 1.22 5.91 0 9c1.22 3.09 4.36 5.5 8 5.5s6.78-2.41 8-5.5c-1.22-3.09-4.36-5.5-8-5.5zm0 8.5c-1.66 0-3-1.34-3-3s1.34-3 3-3 3 1.34 3 3-1.34 3-3 3zm0-4.5c-.83 0-1.5.67-1.5 1.5s.67 1.5 1.5 1.5 1.5-.67 1.5-1.5-.67-1.5-1.5-1.5z"/>
                </svg>
                <svg v-else viewBox="0 0 16 16" fill="currentColor" width="16" height="16">
                  <path d="M8 5c-1.657 0-3 1.343-3 3s1.343 3 3 3 3-1.343 3-3-1.343-3-3-3zm0 4.5c-.828 0-1.5-.672-1.5-1.5s.672-1.5 1.5-1.5 1.5.672 1.5 1.5-.672 1.5-1.5 1.5z"/>
                  <path d="M8 2.5C3.5 2.5.5 6.348.5 8c0 1.652 3 5.5 7.5 5.5s7.5-3.848 7.5-5.5c0-1.652-3-5.5-7.5-5.5zm0 9.5c-3.033 0-5.723-2.73-6.43-4 .707-1.27 3.397-4 6.43-4s5.723 2.73 6.43 4c-.707 1.27-3.397 4-6.43 4z"/>
                </svg>
              </button>
            </div>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn-cancel" @click="showEditModal = false">取消</button>
          <button class="btn-confirm" @click="handleEdit">确定</button>
        </div>
      </div>
    </div>
    <div v-if="showDeleteModal" class="modal-overlay" @click.self="cancelDelete">
      <div class="modal modal-confirm">
        <div class="modal-header">
          <h3>确认删除</h3>
          <button class="modal-close" @click="cancelDelete">&times;</button>
        </div>
        <div class="modal-body">
          <p class="confirm-text">
            确定删除主机 <strong>"{{ hostToDelete?.id }}"</strong> 吗？<br>
            <span class="confirm-tip">删除后无法恢复</span>
          </p>
        </div>
        <div class="modal-footer">
          <button class="btn-cancel" @click="cancelDelete">取消</button>
          <button class="btn-delete" @click="confirmDelete">删除</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.remote-manager {
  padding: 0;
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 280px;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Microsoft YaHei', sans-serif;
}

.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-color, #e8e8e8);
  background: var(--bg-color, #fafafa);
}

.toolbar-left {
  display: flex;
  align-items: center;
  gap: 8px;
}

.toolbar-right {
  display: flex;
  align-items: center;
  gap: 10px;
}

.search-box {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 10px;
  border: 1px solid var(--border-color, #ddd);
  border-radius: 4px;
  background: var(--input-bg, #fff);
  transition: border-color 0.2s;
}

.search-box:focus-within {
  border-color: rgb(88, 164, 246);
}

.search-box svg {
  color: #999;
  flex-shrink: 0;
}

.search-box input {
  border: none;
  outline: none;
  background: transparent;
  font-size: 13px;
  width: 120px;
  color: var(--text-color, #333);
}

.search-box input::placeholder {
  color: #bbb;
}

.toolbar-icon {
  width: 18px;
  height: 18px;
  color: rgb(88, 164, 246);
}

.toolbar h2 {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: var(--text-color, #333);
}

.btn-add {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 16px;
  font-size: 13px;
  border-radius: 4px;
  line-height: 1.5;
  white-space: nowrap;
  min-width: 96px;
  justify-content: center;
}

.empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 32px 20px;
  color: #999;
}

.empty-icon {
  width: 56px;
  height: 56px;
  margin-bottom: 12px;
  opacity: 0.35;
}

.empty p {
  margin: 0;
  font-size: 14px;
}

.table-wrapper {
  flex: 1;
  overflow-y: auto;
}

.hosts-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}

.hosts-table thead {
  position: sticky;
  top: 0;
  z-index: 1;
}

.hosts-table th,
.hosts-table td {
  padding: 10px 12px;
  text-align: center;
  border-bottom: 1px solid var(--border-color, #f0f0f0);
  vertical-align: middle;
  line-height: 1.5;
}

.hosts-table th {
  font-weight: 600;
  color: #666;
  font-size: 12px;
  background: var(--bg-color, #fafafa);
  border-bottom-color: var(--border-color, #e8e8e8);
  white-space: nowrap;
}

.hosts-table tbody tr {
  transition: background 0.15s;
}

.hosts-table tbody tr:hover {
  background: var(--hover-bg, rgba(88, 164, 246, 0.06));
}

.draggable-row {
  cursor: default;
}

.draggable-row.dragging {
  opacity: 0.4;
  background: rgba(88, 164, 246, 0.08);
}

.draggable-row.drag-disabled {
  cursor: default;
}

.draggable-row.drag-disabled .drag-handle {
  opacity: 0.3;
  cursor: default;
}

.col-drag {
  width: 32px;
  padding: 0;
  cursor: grab;
}

.drag-handle {
  color: #bbb;
  display: block;
  margin: 0 auto;
  cursor: grab;
}

.draggable-row:hover .drag-handle {
  color: #888;
}

.drop-indicator {
  height: 2px;
  padding: 0;
}

.drop-indicator td {
  padding: 0;
  border: none;
  height: 2px;
}

.drop-line {
  height: 2px;
  background: rgb(88, 164, 246);
  border-radius: 1px;
  box-shadow: 0 0 4px rgba(88, 164, 246, 0.5);
}

.col-id {
  width: 90px;
  font-weight: 500;
  color: var(--text-color, #333);
}

.col-address {
  width: 160px;
  font-family: 'Consolas', 'Courier New', monospace;
  font-size: 12.5px;
  color: var(--text-color, #333);
}

.col-username {
  width: 90px;
  color: var(--text-color, #333);
}

.col-actions {
  width: auto;
  padding-right: 12px;
}

.col-actions button {
  padding: 5px 14px;
  font-size: 12px;
  border-radius: 3px;
  line-height: 1.6;
  margin: 0 3px;
}

.btn-connect {
  background: #4caf50;
}

.btn-edit {
  background: #2196f3;
}

.btn-delete {
  background: #f44336;
}

.tip {
  position: fixed;
  bottom: 16px;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(0, 0, 0, 0.75);
  color: #fff;
  padding: 6px 14px;
  border-radius: 4px;
  font-size: 13px;
  z-index: 1000;
  pointer-events: none;
  animation: tipIn 0.2s ease;
}

@keyframes tipIn {
  from { opacity: 0; transform: translateX(-50%) translateY(8px); }
  to { opacity: 1; transform: translateX(-50%) translateY(0); }
}

.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 999;
  animation: fadeIn 0.15s ease;
}

@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

.modal {
  background: var(--bg-color, #fff);
  color: var(--text-color, #333);
  border-radius: 8px;
  width: 360px;
  max-width: 90vw;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.18);
  animation: modalIn 0.2s ease;
}

@keyframes modalIn {
  from { opacity: 0; transform: scale(0.95) translateY(-8px); }
  to { opacity: 1; transform: scale(1) translateY(0); }
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 18px;
  border-bottom: 1px solid var(--border-color, #e8e8e8);
}

.modal-header h3 {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
}

.modal-close {
  background: none;
  color: #999;
  font-size: 20px;
  line-height: 1;
  padding: 2px 4px;
  border-radius: 3px;
  cursor: pointer;
}

.modal-close:hover {
  background: var(--hover-bg, #f0f0f0);
  color: var(--text-color, #333);
}

.modal-body {
  padding: 16px 18px;
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 18px;
  border-top: 1px solid var(--border-color, #e8e8e8);
}

.form-group {
  margin-bottom: 12px;
}

.form-group:last-child {
  margin-bottom: 0;
}

.form-group label {
  display: block;
  margin-bottom: 5px;
  font-size: 12px;
  color: #666;
}

.form-group input {
  width: 100%;
  padding: 7px 10px;
  border: 1px solid var(--border-color, #ddd);
  border-radius: 4px;
  background: var(--input-bg, #fff);
  color: var(--text-color, #333);
  box-sizing: border-box;
  font-size: 13px;
  transition: border-color 0.2s;
}

.form-group input:focus {
  outline: none;
  border-color: rgb(88, 164, 246);
  box-shadow: 0 0 0 2px rgba(88, 164, 246, 0.15);
}

.password-input {
  position: relative;
  display: flex;
  align-items: center;
}

.password-input input {
  padding-right: 32px;
}

.btn-toggle-password {
  position: absolute;
  right: 4px;
  top: 50%;
  transform: translateY(-50%);
  background: none;
  color: #999;
  border: none;
  padding: 4px;
  cursor: pointer;
  line-height: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}

.btn-toggle-password:hover {
  color: rgb(88, 164, 246);
}

.modal-confirm {
  width: 320px;
}

.confirm-text {
  margin: 0;
  font-size: 14px;
  line-height: 1.6;
  text-align: center;
  color: var(--text-color, #333);
}

.confirm-text strong {
  color: #f44336;
}

.confirm-tip {
  display: block;
  margin-top: 6px;
  font-size: 12px;
  color: #999;
}

.modal-body .confirm-text {
  padding: 8px 0;
}

.btn-cancel {
  background: #999;
}

.btn-confirm {
  background: rgb(88, 164, 246);
}
</style>
