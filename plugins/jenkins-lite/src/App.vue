<script setup lang="ts">
import { ref, onMounted } from 'vue'
import Sidebar from './components/Sidebar.vue'
import JobsList from './components/JobsList.vue'
import BuildHistory from './components/BuildHistory.vue'
import SettingsModal from './components/SettingsModal.vue'
import { useInstances } from './composables/useInstances'
import { useFavorites } from './composables/useFavorites'
import type { JobInfo, Favorite } from './types'

const { loadInstances, currentInstance, hasInstances } = useInstances()
const { loadFavorites } = useFavorites()

const selectedJob = ref<string | undefined>(undefined)
const showSettings = ref(false)
const currentView = ref<string>('')
const autoSelectFirstJob = ref(false)

/**
 * 处理收藏点击 - 跳转到收藏的视图并选中该 job
 */
const handleFavoriteClick = (fav: Favorite) => {
  // 如果视图不同，先切换视图
  const targetView = fav.viewName || ''
  if (currentView.value !== targetView) {
    currentView.value = targetView
    // 延迟选中 job，等视图加载完成
    setTimeout(() => {
      selectedJob.value = fav.jobName
    }, 100)
  } else {
    selectedJob.value = fav.jobName
  }
}

/**
 * 处理视图切换 - 自动选中第一个 job
 */
const handleViewChange = (viewName: string) => {
  currentView.value = viewName
  autoSelectFirstJob.value = true
  // 重置标记，等待 JobsList 处理
  setTimeout(() => {
    autoSelectFirstJob.value = false
  }, 100)
}

/**
 * 处理 Job 点击
 */
const handleJobClick = (job: JobInfo) => {
  selectedJob.value = job.name
}

/**
 * 处理构建完成
 */
const handleBuildComplete = (result: { jobName: string; success: boolean }) => {
  // 构建完成通知由 JobsList 组件处理
}

onMounted(async () => {
  await loadInstances()
  loadFavorites()

  // 首次使用：没有配置实例时，自动显示设置引导
  if (!hasInstances.value) {
    showSettings.value = true
  }
})
</script>

<template>
  <div class="app">
    <Sidebar
      :current-view="currentView"
      @favorite-click="handleFavoriteClick"
      @view-change="handleViewChange"
      @open-settings="showSettings = true"
    />

    <main class="main-content">
      <header class="content-header">
        <div class="header-left">
          <h2 v-if="currentInstance">{{ currentInstance.name }}</h2>
          <h2 v-else>Jenkins Lite</h2>
        </div>
        <div class="header-right">
          <button class="header-btn settings-icon" @click="showSettings = true" title="设置"></button>
        </div>
      </header>

      <div class="content-body">
        <div class="jobs-panel">
          <JobsList
            :selected-job="selectedJob"
            :current-view="currentView"
            @job-click="handleJobClick"
            @build-complete="handleBuildComplete"
          />
        </div>

        <div class="history-panel">
          <BuildHistory :selected-job="selectedJob" />
        </div>
      </div>
    </main>

    <SettingsModal :show="showSettings" @close="showSettings = false" />
  </div>
</template>

<style>
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

html, body, #app {
  height: 100%;
  width: 100%;
  overflow: hidden;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
  font-size: 14px;
  line-height: 1.5;
  color: var(--text-color, #333);
  background: var(--bg-color, #fff);
}

@media (prefers-color-scheme: dark) {
  body {
    --bg-color: #1e1e1e;
    --bg-secondary: #252526;
    --bg-hover: rgba(255,255,255,0.05);
    --text-color: #cccccc;
    --text-secondary: #888888;
    --border-color: #404040;
    --primary-color: #0078d4;
    --primary-bg: rgba(0,120,212,0.15);
  }
}
</style>

<style scoped>
.app {
  display: flex;
  height: 100%;
  width: 100%;
}

.main-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.content-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-color, #e0e0e0);
}

.header-left h2 {
  font-size: 16px;
  font-weight: 600;
}

.header-right {
  display: flex;
  gap: 8px;
}

.header-btn {
  width: 32px;
  height: 32px;
  border: none;
  background: transparent;
  border-radius: 4px;
  cursor: pointer;
  font-size: 16px;
  transition: background 0.2s;
}

.header-btn:hover {
  background: var(--bg-hover, #f0f0f0);
}

.settings-icon::before {
  content: "\2699";
  font-size: 18px;
  color: var(--text-color, #333);
}

.content-body {
  flex: 1;
  display: flex;
  overflow: hidden;
}

.jobs-panel {
  flex: 1;
  overflow: hidden;
  border-right: 1px solid var(--border-color, #e0e0e0);
}

.history-panel {
  width: 300px;
  overflow: hidden;
}
</style>
