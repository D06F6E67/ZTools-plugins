<template>
  <div class="job-item">
    <div class="job-info" @click="$emit('click')">
      <span
        class="job-status"
        :style="{ color: statusInfo.color }"
      >
        {{ statusInfo.icon }}
      </span>
      <span class="job-name" :title="job.name">{{ job.name }}</span>
    </div>

    <div class="job-actions">
      <button
        class="action-btn favorite-btn"
        :class="{ active: favorited }"
        @click.stop="$emit('toggle-favorite')"
        :title="favorited ? '取消收藏' : '添加收藏'"
      >
        <span class="star-icon"></span>
      </button>
      <button
        class="action-btn build-btn"
        @click.stop="$emit('build')"
        title="触发构建"
      >
        <span class="play-icon"></span>
      </button>
    </div>

    <!-- 子 Jobs（Folder 展开） -->
    <div v-if="job.jobs && job.jobs.length > 0 && expanded" class="job-children">
      <JobItem
        v-for="child in job.jobs"
        :key="child.url"
        :job="child"
        :favorited="false"
        @toggle-favorite="$emit('toggle-favorite', child)"
        @build="$emit('build', child)"
        @click="$emit('click', child)"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import type { JobInfo } from '../types'
import { JOB_COLOR_MAP } from '../types'

const props = defineProps<{
  job: JobInfo
  favorited: boolean
}>()

defineEmits<{
  (e: 'toggle-favorite', job?: JobInfo): void
  (e: 'build', job?: JobInfo): void
  (e: 'click', job?: JobInfo): void
}>()

const expanded = ref(false)

/**
 * 获取状态信息
 */
const statusInfo = computed(() => {
  const colorKey = props.job.color?.replace('anime', '') || 'notbuilt'
  return JOB_COLOR_MAP[colorKey] || JOB_COLOR_MAP['notbuilt']
})
</script>

<style scoped>
.job-item {
  display: flex;
  align-items: center;
  padding: 10px 12px;
  margin-bottom: 4px;
  background: var(--bg-color, #fff);
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.2s;
}

.job-item:hover {
  background: var(--bg-hover, #f5f5f5);
}

.job-info {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 8px;
  overflow: hidden;
}

.job-status {
  font-size: 12px;
  width: 16px;
  text-align: center;
}

.job-name {
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.job-actions {
  display: flex;
  gap: 4px;
  opacity: 0;
  transition: opacity 0.2s;
}

.job-item:hover .job-actions {
  opacity: 1;
}

.action-btn {
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 4px;
  background: transparent;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  transition: background 0.2s;
}

.action-btn:hover {
  background: var(--bg-secondary, #f0f0f0);
}

.favorite-btn.active {
  color: #faad14;
}

.build-btn {
  color: var(--primary-color, #0078d4);
}

.star-icon {
  display: inline-block;
  width: 12px;
  height: 12px;
  background: var(--text-secondary, #888);
  clip-path: polygon(50% 0%, 61% 35%, 98% 35%, 68% 57%, 79% 91%, 50% 70%, 21% 91%, 32% 57%, 2% 35%, 39% 35%);
}

.favorite-btn.active .star-icon {
  background: #faad14;
}

.play-icon {
  display: inline-block;
  width: 0;
  height: 0;
  border-left: 8px solid var(--primary-color, #0078d4);
  border-top: 5px solid transparent;
  border-bottom: 5px solid transparent;
  margin-left: 2px;
}

.job-children {
  margin-left: 16px;
  margin-top: 4px;
}
</style>
