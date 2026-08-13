<script setup lang="ts">
import { computed } from 'vue'
import { Laptop, Link2, Plus, Radio, Settings, ShieldCheck, Smartphone, Unplug } from 'lucide-vue-next'
import type { PairedDevice, ServerStatus } from '../types'

const props = defineProps<{
  devices: PairedDevice[]
  server: ServerStatus | null
  connectedCount: number
}>()

const emit = defineEmits<{
  pair: []
  settings: []
  disconnect: [id: string]
}>()

const statusText = computed(() => props.server?.running ? `${props.connectedCount} 台在线` : '服务已停止')
</script>

<template>
  <aside class="sidebar">
    <div class="brand">
      <span class="brand__mark"><Link2 :size="20" /></span>
      <div><strong>设备互联</strong><small>Device Link</small></div>
    </div>

    <button class="pair-button" type="button" @click="emit('pair')"><Plus :size="17" />连接新设备</button>

    <div class="section-label"><span>我的设备</span><span class="live"><i />{{ statusText }}</span></div>
    <div class="device-list">
      <article class="device-card device-card--self">
        <span class="device-icon"><Laptop :size="18" /></span>
        <div><strong>这台电脑</strong><small><ShieldCheck :size="12" />会话中枢</small></div>
      </article>
      <article v-for="device in devices" :key="device.id" class="device-card">
        <span class="device-icon"><Smartphone :size="18" /></span>
        <div class="device-card__body"><strong>{{ device.name }}</strong><small :class="{ online: device.connected }"><Radio :size="11" />{{ device.connected ? '实时连接' : '最近离线' }}</small></div>
        <button class="ghost-icon danger-hover" type="button" title="撤销设备授权" @click="emit('disconnect', device.id)"><Unplug :size="15" /></button>
      </article>
      <p v-if="devices.length === 0" class="empty-device">还没有配对设备。手机扫码后会出现在这里。</p>
    </div>

    <button class="settings-button" type="button" @click="emit('settings')"><Settings :size="17" />设置与同步</button>
  </aside>
</template>
