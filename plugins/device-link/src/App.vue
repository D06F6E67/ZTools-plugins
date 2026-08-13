<script setup lang="ts">
import { ref } from 'vue'
import { AlertTriangle, MoreHorizontal, Search, ShieldCheck } from 'lucide-vue-next'
import DeviceSidebar from './components/DeviceSidebar.vue'
import MessageComposer from './components/MessageComposer.vue'
import MessageList from './components/MessageList.vue'
import PairingDialog from './components/PairingDialog.vue'
import SettingsPanel from './components/SettingsPanel.vue'
import { useDeviceLink } from './composables/useDeviceLink'

const pairingOpen = ref(false)
const settingsOpen = ref(false)
const link = useDeviceLink()

async function sendText(text: string) {
  await link.sendText(text)
}
</script>

<template>
  <main class="app-shell">
    <DeviceSidebar
      :devices="link.devices.value"
      :server="link.server.value"
      :connected-count="link.connectedCount.value"
      @pair="pairingOpen = true"
      @settings="settingsOpen = true"
      @disconnect="link.disconnectDevice"
    />

    <section class="conversation">
      <header class="conversation-header">
        <div><div class="conversation-header__title"><h1>发送给我的设备</h1><span><ShieldCheck :size="13" />私人会话</span></div><p>{{ link.server.value?.running ? `${link.server.value.selectedIP}:${link.server.value.port} · 局域网实时通道` : '接收服务已停止' }}</p></div>
        <div class="conversation-header__actions"><button type="button" title="搜索消息"><Search :size="17" /></button><button type="button" title="更多"><MoreHorizontal :size="18" /></button></div>
      </header>

      <div v-if="link.loading.value" class="loading-state"><span class="spinner" />正在建立本机会话…</div>
      <MessageList v-else :messages="link.messages.value" @copy="link.copyMessage" @open="link.openAttachment" @delete="link.deleteMessage" />
      <MessageComposer :busy="link.busy.value" :connected-count="link.connectedCount.value" @send="sendText" @attach="link.chooseAndSendFiles" />
    </section>

    <PairingDialog v-if="pairingOpen" :server="link.server.value" :busy="link.busy.value" @close="pairingOpen = false" @regenerate="link.regeneratePairing" @toggle="link.toggleServer" />
    <SettingsPanel
      v-if="settingsOpen && link.settings.value"
      :settings="link.settings.value"
      :busy="link.busy.value"
      @close="settingsOpen = false"
      @save-settings="link.saveSettings"
      @save-web-dav="link.saveWebDav"
      @sync="link.syncWebDav"
    />

    <div v-if="link.error.value" class="error-banner"><AlertTriangle :size="16" /><span>{{ link.error.value }}</span><button type="button" @click="link.error.value = ''">关闭</button></div>
    <div v-if="link.notice.value" class="notice-toast">{{ link.notice.value }}</div>
  </main>
</template>
