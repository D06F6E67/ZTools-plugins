<template>
  <div class="jobs-list">
    <div class="jobs-header">
      <input
        ref="searchInputRef"
        v-model="searchQuery"
        type="text"
        class="search-input"
        placeholder="搜索 Jobs..."
      />
      <button class="refresh-btn" @click="refreshJobs" :disabled="loading">
        <span class="refresh-icon" :class="{ spinning: loading }"></span>
      </button>
    </div>

    <div class="jobs-content">
      <div v-if="loading" class="loading">
        加载中...
      </div>

      <div v-else-if="error" class="error">
        {{ error }}
      </div>

      <div v-else-if="filteredJobs.length === 0" class="empty">
        没有找到 Jobs
      </div>

      <div v-else class="jobs">
        <JobItem
          v-for="job in filteredJobs"
          :key="job.url"
          :job="job"
          :favorited="checkFavorited(job.fullName || job.name)"
          :show-full-name="props.currentView === '__favorites__'"
          @toggle-favorite="handleToggleFavorite"
          @build="handleBuild"
          @click="handleJobClick"
        />
      </div>
    </div>

    <!-- 构建确认弹窗 -->
    <div v-if="buildConfirmJob" class="modal-overlay" @click.self="cancelBuild">
      <div class="modal">
        <div class="modal-header">确认构建</div>
        <div class="modal-body">
          确定要触发 <strong>{{ buildConfirmJob.name }}</strong> 的构建吗？
        </div>
        <div class="modal-footer">
          <button class="btn btn-default" @click="cancelBuild">取消</button>
          <button class="btn btn-primary" @click="confirmBuild" :disabled="building">
            {{ building ? '构建中...' : '确认构建' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, nextTick } from 'vue'
import JobItem from './JobItem.vue'
import { useInstances } from '../composables/useInstances'
import { useFavorites } from '../composables/useFavorites'
import { flattenFavoriteJobs } from '../utils/jobs'
import type { JobInfo } from '../types'

const props = defineProps<{
  selectedJob?: string
  currentView?: string
  focusKey?: number
  initialQuery?: string
}>()

const emit = defineEmits<{
  (e: 'job-click', job: JobInfo): void
  (e: 'build-complete', result: { jobName: string; success: boolean }): void
}>()

const { currentInstance, currentClient, loadInstances } = useInstances()
const { isFavorited, toggleFavorite, loadFavorites, favorites } = useFavorites()

/**
 * 收藏的 Job 名称集合（响应式）
 */
const favoritedJobs = computed(() => {
  if (!currentInstance.value) return new Set<string>()
  return new Set(
    favorites.value
      .filter(f => f.instanceId === currentInstance.value?._id)
      .map(f => f.jobName)
  )
})

/**
 * 检查 Job 是否已收藏
 */
const checkFavorited = (jobName: string): boolean => {
  return favoritedJobs.value.has(jobName)
}

const jobs = ref<JobInfo[]>([])
const loading = ref(false)
const error = ref<string | null>(null)
const searchQuery = ref(props.initialQuery || '')
const searchInputRef = ref<HTMLInputElement | null>(null)
const buildConfirmJob = ref<JobInfo | null>(null)
const building = ref(false)

/**
 * 加载 Jobs
 */
const loadJobs = async () => {
  if (!currentClient.value) {
    jobs.value = []
    return
  }

  loading.value = true
  error.value = null

  let result
  // 收藏视图：加载所有 jobs，由 filteredJobs 过滤出收藏的
  if (props.currentView === '__favorites__') {
    result = await currentClient.value.getJobs()
  } else if (props.currentView) {
    result = await currentClient.value.getViewJobs(props.currentView)
  } else {
    result = await currentClient.value.getJobs()
  }

  if (result.error) {
    error.value = result.error
    jobs.value = []
  } else {
    jobs.value = result.data || []
  }

  loading.value = false
}

/**
 * 刷新 Jobs
 */
const refreshJobs = () => {
  loadJobs()
}

/**
 * 过滤 Jobs
 */
const filteredJobs = computed(() => {
  let list = jobs.value

  // 收藏视图：只显示收藏的 jobs
  if (props.currentView === '__favorites__') {
    list = flattenFavoriteJobs(list, favoritedJobs.value)
  }

  // 搜索过滤
  if (!searchQuery.value) return list

  const query = searchQuery.value.toLowerCase()
  return filterJobsRecursive(list, query)
})

/**
 * 递归过滤 Jobs（包括 Folder 内的 Jobs）
 */
const filterJobsRecursive = (jobList: JobInfo[], query: string): JobInfo[] => {
  const result: JobInfo[] = []

  for (const job of jobList) {
    if ((job.fullName || job.name).toLowerCase().includes(query)) {
      result.push(job)
    } else if (job.jobs && job.jobs.length > 0) {
      const filtered = filterJobsRecursive(job.jobs, query)
      if (filtered.length > 0) {
        result.push({
          ...job,
          jobs: filtered
        })
      }
    }
  }

  return result
}

/**
 * 处理收藏切换
 */
const handleToggleFavorite = (job: JobInfo) => {
  if (!currentInstance.value) return

  const instanceName = currentInstance.value.name
  const instanceId = currentInstance.value._id
  const viewName = props.currentView || 'all'

  toggleFavorite(instanceId, instanceName, job.fullName || job.name, viewName)
}

/**
 * 处理构建
 */
const handleBuild = (job: JobInfo) => {
  buildConfirmJob.value = job
}

const cancelBuild = () => {
  buildConfirmJob.value = null
}

const confirmBuild = async () => {
  if (!buildConfirmJob.value || !currentClient.value) return

  building.value = true
  const jobName = buildConfirmJob.value.fullName || buildConfirmJob.value.name

  const result = await currentClient.value.triggerBuild(jobName)

  building.value = false
  buildConfirmJob.value = null

  if (result.error) {
    window.ztools.showNotification(`构建触发失败: ${result.error}`, 'Jenkins Lite')
  } else {
    window.ztools.showNotification(`${jobName} 构建已触发`, 'Jenkins Lite')
    // 刷新 Jobs 列表以更新状态
    setTimeout(() => loadJobs(), 2000)
  }
}

/**
 * 处理 Job 点击
 */
const handleJobClick = (job: JobInfo) => {
  emit('job-click', job)
}

// 监听实例变化
watch(currentInstance, () => {
  loadJobs()
})

// 监听选中的 Job
watch(() => props.selectedJob, (newJob) => {
  if (newJob) {
    const job = findJob(jobs.value, newJob)
    if (job) {
      handleJobClick(job)
    }
  }
})

// 监听视图变化，重新加载 Jobs，并自动选中第一个
watch(() => props.currentView, () => {
  loadJobs()
})

// 当 Jobs 加载完成后，自动选中第一个（收藏视图除外）
watch(jobs, (newJobs) => {
  if (newJobs.length > 0 && !props.selectedJob && props.currentView !== '__favorites__') {
    const firstJob = getFirstJob(newJobs)
    if (firstJob) {
      handleJobClick(firstJob)
    }
  }
})

// 监听 focusKey，触发搜索框聚焦
watch(() => props.focusKey, (key) => {
  if (key) {
    nextTick(() => {
      searchInputRef.value?.focus()
    })
  }
})

const findJob = (jobList: JobInfo[], name: string): JobInfo | null => {
  for (const job of jobList) {
    if ((job.fullName || job.name) === name) return job
    if (job.jobs) {
      const found = findJob(job.jobs, name)
      if (found) return found
    }
  }
  return null
}

// 获取第一个 Job（递归）
const getFirstJob = (jobList: JobInfo[]): JobInfo | null => {
  for (const job of jobList) {
    if (job.jobs) {
      const firstChild = getFirstJob(job.jobs)
      if (firstChild) return firstChild
      continue
    }
    return job
  }
  return null
}

onMounted(async () => {
  await loadInstances()
  loadFavorites()
  loadJobs()
})
</script>

<style scoped>
.jobs-list {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.jobs-header {
  display: flex;
  gap: 8px;
  padding: 12px;
  border-bottom: 1px solid var(--border-color, #e0e0e0);
}

.search-input {
  flex: 1;
  padding: 8px 12px;
  border: 1px solid var(--border-color, #e0e0e0);
  border-radius: 4px;
  font-size: 13px;
  background: var(--bg-color, #fff);
  color: var(--text-color, #333);
}

.search-input:focus {
  outline: none;
  border-color: var(--primary-color, #0078d4);
}

.refresh-btn {
  padding: 8px 12px;
  border: 1px solid var(--border-color, #e0e0e0);
  border-radius: 4px;
  background: var(--bg-color, #fff);
  cursor: pointer;
  transition: background 0.2s;
}

.refresh-btn:hover:not(:disabled) {
  background: var(--bg-hover, #f0f0f0);
}

.refresh-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.refresh-icon {
  display: inline-block;
  width: 14px;
  height: 14px;
  border: 2px solid var(--text-secondary, #888);
  border-top-color: transparent;
  border-radius: 50%;
}

.refresh-icon.spinning {
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.jobs-content {
  flex: 1;
  overflow-y: auto;
}

.loading, .error, .empty {
  padding: 24px;
  text-align: center;
  color: var(--text-secondary, #666);
}

.error {
  color: #ff4d4f;
}

.jobs {
  padding: 8px;
}

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

.modal {
  background: var(--bg-color, #fff);
  border-radius: 8px;
  width: 320px;
  overflow: hidden;
}

.modal-header {
  padding: 16px;
  font-weight: 600;
  border-bottom: 1px solid var(--border-color, #e0e0e0);
}

.modal-body {
  padding: 24px 16px;
}

.modal-footer {
  padding: 12px 16px;
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  border-top: 1px solid var(--border-color, #e0e0e0);
}

.btn {
  padding: 8px 16px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 13px;
}

.btn-default {
  background: var(--bg-color, #fff);
  border: 1px solid var(--border-color, #e0e0e0);
  color: var(--text-color, #333);
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
</style>
