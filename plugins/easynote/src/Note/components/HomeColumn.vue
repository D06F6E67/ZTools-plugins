<template>
  <div class="home-col">
    <div class="home-col-header">
      <span class="home-col-title">{{ title }}</span>
      <el-tag size="small" :type="tagType" effect="plain">
        <slot name="count">{{ items.length }}</slot>
      </el-tag>
    </div>
    <div class="home-list">
      <div
        v-for="n in items"
        :key="n.id"
        class="home-item"
        @click="$emit('open', n.id)"
      >
        <slot name="prefix" :item="n" />
        <div class="home-item-main">
          <div class="home-item-title" :class="{ 'home-item-done': n.done }">
            {{ n.title || '无标题' }}
          </div>
          <div class="home-item-meta">
            <span>{{ formatTime(n.updatedAt) }}</span>
          </div>
        </div>
        <el-button
          link
          :icon="Memo"
          title="打开便利贴"
          @click.stop="$emit('openSticky', n.id)"
        />
        <el-button link :icon="Delete" @click.stop="$emit('delete', n.id)" />
      </div>
      <div v-if="!items.length" class="home-empty">{{ emptyText }}</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Delete, Memo } from '@element-plus/icons-vue'
import { formatTime } from '../utils/time'
import type { Note } from '../composables/useNotes'

defineProps<{
  title: string
  emptyText: string
  items: Note[]
  tagType?: 'primary' | 'success' | 'warning' | 'info' | 'danger'
}>()

defineEmits<{
  (e: 'open', id: string): void
  (e: 'openSticky', id: string): void
  (e: 'delete', id: string): void
}>()
</script>
