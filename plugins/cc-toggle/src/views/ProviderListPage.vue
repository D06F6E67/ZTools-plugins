<script setup lang="ts">
  // @ts-nocheck TODO: 逐步添加类型注解后移除
  import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue';
  import { useProviders } from '../composables/useProviders';
  import { useBalance } from '../composables/useBalance';
  import { useWidgets } from '../composables/useWidgets';
  import { getSkillNest } from '../composables/shared';
  import TabBar from '../components/common/TabBar.vue';
  import ProviderCard from '../components/provider/ProviderCard.vue';
  import ProviderForm from '../components/provider/ProviderForm.vue';

  const message = useMessage();
  const {
    providers,
    activeTab,
    loadProviders,
    switchProvider,
    saveProvider,
    deleteProvider,
    copyProvider,
    getFullProvider
  } = useProviders();
  const { views: balanceViews, thresholdFor, init, dispose, refreshOne } = useBalance();
  const { isStatusOpen, toggleStatus, refresh: refreshWidgetState } = useWidgets();
  const showForm = ref(false),
    editingId = ref(null),
    formInitialData = ref(null);

  const currentProvider = computed(() => providers.value.find(p => p.isCurrent));
  const otherProviders = computed(() => providers.value.filter(p => !p.isCurrent));

  // FLIP 动画状态
  const flipStyle = ref({});
  const isFlipping = ref(false);

  onMounted(() => {
    loadProviders();
    init();
    refreshWidgetState();
  });

  let flipTimer = null;
  onUnmounted(() => {
    if (flipTimer) clearTimeout(flipTimer);
    dispose();
  });

  function onAdd() {
    editingId.value = null;
    formInitialData.value = null;
    showForm.value = true;
  }
  function onEdit(id) {
    // 代理运行中禁止编辑已激活供应商：保存不会重写 CLI 配置，改动不生效，避免误导
    const p = providers.value.find(x => x.id === id);
    if (p?.isCurrent && getSkillNest().getProxyStatus?.(activeTab())?.running) {
      message.warning('代理运行中，已激活供应商不可编辑，请先停止代理');
      return;
    }
    editingId.value = id;
    formInitialData.value = getFullProvider(id);
    showForm.value = true;
  }
  function onSave(data) {
    if (editingId.value) {
      data.id = editingId.value;
      data.sortOrder = providers.value.find(p => p.id === editingId.value)?.sortOrder || 0;
    }
    saveProvider(data);
    showForm.value = false;
    editingId.value = null;
  }

  function onCopy(id) {
    const r = copyProvider(id);
    if (r.success) message.success('已复制 ' + r.name);
    else message.warning(r.error);
  }

  function onDelete(id) {
    deleteProvider(id);
  }

  function onBalanceRefresh(id) {
    refreshOne(activeTab(), id);
  }

  function onWidgetToggle() {
    const r = toggleStatus();
    if (r && r.success === false) message.error(r.error || '小组件打开失败');
  }

  function onSwitch(id, event) {
    const r = switchProvider(id);
    if (r?.success) message.success('已切换到 ' + r.providerName);
    if (!event) return r;

    const clickedCard = event.currentTarget.closest('.provider-card') || event.currentTarget;
    const firstRect = clickedCard.getBoundingClientRect();

    nextTick(() => {
      const heroEl = document.querySelector('.hero-card .provider-card');
      if (!heroEl) return;
      const { left, top } = heroEl.getBoundingClientRect();

      flipStyle.value = {
        transform: `translate(${firstRect.left - left}px, ${firstRect.top - top}px)`,
        transition: 'none'
      };
      isFlipping.value = true;

      requestAnimationFrame(() => {
        flipStyle.value = { transform: 'translate(0, 0)', transition: 'transform 0.3s ease-out' };
        flipTimer = setTimeout(() => {
          isFlipping.value = false;
          flipStyle.value = {};
        }, 300);
      });
    });
  }
</script>

<template>
  <div class="page">
    <div class="tab-bar-wrap">
      <TabBar />
    </div>
    <div class="page-body">
      <div class="page-header">
        <n-text depth="3" style="font-size: 14px; font-weight: 500"
          >{{ providers.length }} 个供应商</n-text
        >
        <n-button type="primary" size="small" @click="onAdd">+ 添加供应商</n-button>
      </div>

      <n-empty v-if="providers.length === 0" description="暂无供应商配置" style="padding: 60px 0">
        <template #extra>
          <n-text depth="3" style="font-size: 13px">点击「+ 添加供应商」开始</n-text>
        </template>
      </n-empty>

      <template v-else>
        <div
          class="hero-card"
          :class="{ 'is-flipping': isFlipping }"
          :style="isFlipping ? flipStyle : {}"
        >
          <ProviderCard
            v-if="currentProvider"
            :key="currentProvider.id"
            :provider="currentProvider"
            compact
            :show-widget="true"
            :widget-open="isStatusOpen"
            :balance="balanceViews[currentProvider.id]"
            :low-threshold="thresholdFor(currentProvider)"
            @switch="onSwitch"
            @edit="onEdit"
            @copy="onCopy"
            @delete="onDelete"
            @refresh="onBalanceRefresh"
            @widget="onWidgetToggle"
          />
        </div>

        <div v-if="otherProviders.length" class="providers-section">
          <div class="section-label">
            <n-text depth="3">其他供应商</n-text>
            <n-tag size="tiny" :bordered="false" round>{{ otherProviders.length }}</n-tag>
          </div>
          <n-grid :cols="2" :x-gap="8" :y-gap="8" responsive="screen" :item-responsive="true">
            <n-gi v-for="p in otherProviders" :key="p.id" :span="1">
              <ProviderCard
                :provider="p"
                compact
                :balance="balanceViews[p.id]"
                :low-threshold="thresholdFor(p)"
                @switch="onSwitch"
                @edit="onEdit"
                @copy="onCopy"
                @delete="onDelete"
                @refresh="onBalanceRefresh"
              />
            </n-gi>
          </n-grid>
        </div>
      </template>
    </div>

    <ProviderForm
      :visible="showForm"
      :initial-data="formInitialData"
      @close="showForm = false"
      @save="onSave"
    />
  </div>
</template>

<style scoped>
  .page {
    height: 100%;
    display: flex;
    flex-direction: column;
  }
  .tab-bar-wrap {
    padding: 0 10px;
    flex-shrink: 0;
    background: var(--bg-hover);
    border-bottom: 1px solid var(--border);
  }
  .page-body {
    flex: 1;
    overflow-y: auto;
    overflow-x: hidden;
    padding: 12px 20px 16px;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .page-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    min-height: 36px;
    padding: 0 10px;
  }

  /* ── Inactive providers section ── */
  .providers-section {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .section-label {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.8px;
    color: var(--text-muted);
    padding-bottom: 6px;
    border-bottom: 1px solid var(--border);
  }

  /* ── Hero card FLIP ── */

  .hero-card {
    will-change: transform, opacity;
  }
  .hero-card.is-flipping {
    z-index: 10;
    pointer-events: none;
  }
  :deep(.hero-card .compact-bottom) {
    padding-top: 3px;
  }
</style>
