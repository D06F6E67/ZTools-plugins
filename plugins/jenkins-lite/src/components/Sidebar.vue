<template>
  <aside class="sidebar">
    <div class="sidebar-header">
      <h1 class="logo">Jenkins Lite</h1>
    </div>

    <!-- 服务选择器 -->
    <div class="service-selector" v-if="hasInstances">
      <div class="service-current" @click="toggleServiceMenu">
        <span class="service-name">{{ currentInstance?.name || '选择实例' }}</span>
        <span class="service-arrow" :class="{ open: showServiceMenu }"></span>
      </div>
      <div class="service-menu" v-if="showServiceMenu">
        <div
          v-for="inst in instances"
          :key="inst._id"
          class="service-option"
          :class="{ active: inst._id === currentInstance?._id }"
          @click="selectService(inst._id)"
        >
          <span class="service-dot"></span>
          <span class="service-option-name">{{ inst.name }}</span>
        </div>
        <div class="service-divider"></div>
        <div class="service-option add-service" @click="openSettings">
          <span class="add-icon">+</span>
          <span>管理实例</span>
        </div>
      </div>
    </div>

    <nav class="sidebar-nav">
      <!-- Jenkins 视图列表 -->
      <div class="nav-section" v-if="hasInstances && currentInstance">
        <div class="nav-section-title">视图</div>
        <div
          v-for="view in views"
          :key="view.name"
          class="nav-item"
          :class="{ active: props.currentView === view.name }"
          @click="selectView(view.name)"
        >
          <span class="nav-icon view-icon"></span>
          <span class="nav-label" :title="view.name">{{ view.name }}</span>
        </div>
        <div v-if="views.length === 0" class="nav-empty">
          加载中...
        </div>
      </div>

      <!-- 收藏列表 -->
      <div class="nav-section">
        <div class="nav-section-title">收藏</div>
        <div
          v-for="fav in favorites"
          :key="fav._id"
          class="nav-item"
          :class="{ active: isActiveFavorite(fav) }"
          @click="handleFavoriteClick(fav)"
        >
          <span class="nav-icon star-icon"></span>
          <span class="nav-label">{{ fav.jobName }}</span>
        </div>
        <div v-if="favorites.length === 0" class="nav-empty">
          暂无收藏
        </div>
      </div>
    </nav>

    <div class="sidebar-footer">
      <div class="version">v1.0.0</div>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { ref, watch, onMounted } from 'vue'
import { useInstances } from '../composables/useInstances'
import { useFavorites } from '../composables/useFavorites'
import type { Favorite, JenkinsView } from '../types'

const props = defineProps<{
  currentView: string
}>()

const emit = defineEmits<{
  (e: 'favorite-click', fav: Favorite): void
  (e: 'view-change', viewName: string): void
  (e: 'open-settings'): void
}>()

const { instances, currentInstance, currentClient, hasInstances, switchInstance } = useInstances()
const { favorites } = useFavorites()

const views = ref<JenkinsView[]>([])
const showServiceMenu = ref(false)

/**
 * 切换服务菜单
 */
const toggleServiceMenu = () => {
  showServiceMenu.value = !showServiceMenu.value
}

/**
 * 选择服务
 */
const selectService = (instanceId: string) => {
  switchInstance(instanceId)
  showServiceMenu.value = false
  emit('view-change', '')
}

/**
 * 打开设置
 */
const openSettings = () => {
  showServiceMenu.value = false
  emit('open-settings')
}

/**
 * 加载视图列表
 */
const loadViews = async () => {
  if (!currentClient.value) {
    views.value = []
    return
  }

  const result = await currentClient.value.getViews()
  if (result.data) {
    views.value = result.data.filter(v => v.name !== 'All')
  }
}

/**
 * 选择视图
 */
const selectView = (viewName: string) => {
  emit('view-change', viewName)
}

const isActiveFavorite = (fav: Favorite) => {
  return currentInstance.value?._id === fav.instanceId
}

const handleFavoriteClick = (fav: Favorite) => {
  // 如果不在当前实例，切换实例
  if (currentInstance.value?._id !== fav.instanceId) {
    switchInstance(fav.instanceId)
  }
  emit('favorite-click', fav)
}

// 监听实例变化，加载视图
watch(currentInstance, () => {
  loadViews()
})

watch(currentClient, () => {
  if (currentClient.value) {
    loadViews()
  }
})

onMounted(() => {
  if (currentClient.value) {
    loadViews()
  }
})
</script>

<style scoped>
.sidebar {
  width: 200px;
  height: 100%;
  background: var(--bg-secondary, #f5f5f5);
  border-right: 1px solid var(--border-color, #e0e0e0);
  display: flex;
  flex-direction: column;
}

.sidebar-header {
  padding: 16px;
  border-bottom: 1px solid var(--border-color, #e0e0e0);
}

.logo {
  font-size: 16px;
  font-weight: 600;
  margin: 0;
}

/* 服务选择器 */
.service-selector {
  position: relative;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-color, #e0e0e0);
}

.service-current {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  background: var(--bg-color, #fff);
  border: 1px solid var(--border-color, #e0e0e0);
  border-radius: 6px;
  cursor: pointer;
  transition: border-color 0.2s;
}

.service-current:hover {
  border-color: var(--primary-color, #0078d4);
}

.service-name {
  font-size: 13px;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.service-arrow {
  width: 0;
  height: 0;
  border-left: 4px solid transparent;
  border-right: 4px solid transparent;
  border-top: 5px solid var(--text-secondary, #888);
  margin-left: 8px;
  transition: transform 0.2s;
}

.service-arrow.open {
  transform: rotate(180deg);
}

.service-menu {
  position: absolute;
  top: 100%;
  left: 16px;
  right: 16px;
  margin-top: 4px;
  background: var(--bg-color, #fff);
  border: 1px solid var(--border-color, #e0e0e0);
  border-radius: 6px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.15);
  z-index: 100;
  overflow: hidden;
}

.service-option {
  display: flex;
  align-items: center;
  padding: 10px 12px;
  cursor: pointer;
  transition: background 0.15s;
}

.service-option:hover {
  background: var(--bg-hover, #f5f5f5);
}

.service-option.active {
  background: var(--primary-bg, rgba(0,120,212,0.1));
}

.service-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--text-secondary, #888);
  margin-right: 8px;
}

.service-option.active .service-dot {
  background: var(--primary-color, #0078d4);
}

.service-option-name {
  font-size: 13px;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.service-divider {
  height: 1px;
  background: var(--border-color, #e0e0e0);
  margin: 4px 0;
}

.add-service {
  color: var(--primary-color, #0078d4);
}

.add-icon {
  width: 16px;
  height: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  font-weight: 600;
  margin-right: 8px;
}

.sidebar-nav {
  flex: 1;
  overflow-y: auto;
  padding: 8px 0;
}

.nav-section {
  margin-bottom: 16px;
}

.nav-section-title {
  padding: 8px 16px 4px;
  font-size: 11px;
  font-weight: 600;
  color: var(--text-secondary, #666);
  text-transform: uppercase;
}

.nav-item {
  display: flex;
  align-items: center;
  padding: 8px 16px;
  cursor: pointer;
  transition: background 0.2s;
}

.nav-item:hover {
  background: var(--bg-hover, rgba(0,0,0,0.05));
}

.nav-item.active {
  background: var(--primary-bg, rgba(0,120,212,0.1));
  color: var(--primary-color, #0078d4);
}

.nav-icon {
  width: 16px;
  height: 16px;
  margin-right: 8px;
  background: var(--text-secondary, #888);
}

.view-icon {
  mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2'%3E%3Crect x='3' y='3' width='7' height='7'/%3E%3Crect x='14' y='3' width='7' height='7'/%3E%3Crect x='3' y='14' width='7' height='7'/%3E%3Crect x='14' y='14' width='7' height='7'/%3E%3C/svg%3E") center/contain no-repeat;
  -webkit-mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2'%3E%3Crect x='3' y='3' width='7' height='7'/%3E%3Crect x='14' y='3' width='7' height='7'/%3E%3Crect x='3' y='14' width='7' height='7'/%3E%3Crect x='14' y='14' width='7' height='7'/%3E%3C/svg%3E") center/contain no-repeat;
}

.star-icon {
  clip-path: polygon(50% 0%, 61% 35%, 98% 35%, 68% 57%, 79% 91%, 50% 70%, 21% 91%, 32% 57%, 2% 35%, 39% 35%);
}

.nav-item.active .nav-icon {
  background: var(--primary-color, #0078d4);
}

.nav-label {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
}

.nav-empty {
  padding: 8px 16px;
  font-size: 12px;
  color: var(--text-secondary, #999);
}

.sidebar-footer {
  padding: 12px 16px;
  border-top: 1px solid var(--border-color, #e0e0e0);
}

.version {
  font-size: 11px;
  color: var(--text-secondary, #999);
}
</style>
