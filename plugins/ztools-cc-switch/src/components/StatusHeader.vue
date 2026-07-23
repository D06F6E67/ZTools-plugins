<script setup>
import ProfileSwitcher from './ProfileSwitcher.vue'
defineProps({
  client: { type: Object, required: true },
  activeProvider: { type: Object, default: null },
  providerCount: { type: Number, default: 0 }
})
defineEmits(['add', 'profile-applied', 'toast'])
</script>

<template>
  <header class="status-header" :style="{ '--client-accent': client.accent }">
    <div class="status-copy">
      <div class="eyebrow">
        <span class="live-dot" :class="{ on: activeProvider }" />
        {{ activeProvider ? 'Route active' : 'Route not set' }}
      </div>
      <h1>{{ client.name }}</h1>
      <p v-if="activeProvider">
        当前流量经由 <strong>{{ activeProvider.name }}</strong>
        <span class="inline-divider" />
        {{ activeProvider.model || '默认模型' }}
      </p>
      <p v-else>选择一个 Provider，为客户端建立 API 路由。</p>
    </div>

    <div class="header-actions">
      <ProfileSwitcher :client="client" @applied="$emit('profile-applied')" @toast="(...args) => $emit('toast', ...args)" />
      <div class="provider-count"><strong>{{ providerCount }}</strong><span>routes</span></div>
      <button class="primary-button" @click="$emit('add')">
        <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M9 3h2v6h6v2h-6v6H9v-6H3V9h6V3Z"/></svg>
        添加 Provider
      </button>
    </div>
  </header>
</template>
