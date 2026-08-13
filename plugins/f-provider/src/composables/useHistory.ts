import { ref } from 'vue'

/**
 * 历史记录单例：跨组件共享同一份历史列表。
 *
 * - Recognize / Translate 完成识别/翻译后，由 Manage 调用 pushHistory 写入。
 * - HistoryView 读取 historyList 渲染左侧缩略列表与右侧详情面板。
 * - 持久化到 window.ztools.dbStorage（key: `history.list`），最多保留 100 条。
 *
 * 与 useNativeEngine 同构的「模块级单例」模式：切 tab 卸载组件时数据不丢，
 * 重新挂载仍读到同一份列表。
 */

/** dbStorage 中存储历史记录的 key。 */
const STORAGE_KEY = 'history.list'

/** 最多保留的历史记录条数。超出自动淘汰最旧的（数组末尾）。 */
const MAX_ITEMS = 100

// ─── 模块级单例（进程内唯一，跨组件共享）────────────────────────────────
const historyList = ref<HistoryItem[]>([])

/** 从 dbStorage 载入历史记录到单例 ref。启动时调一次。 */
function loadHistory(): void {
  try {
    const stored = window.ztools.dbStorage.getItem<HistoryItem[]>(STORAGE_KEY)
    historyList.value = Array.isArray(stored) ? stored : []
  } catch (_) {
    // dbStorage 不可用等异常：保持空列表，不阻塞 UI
    historyList.value = []
  }
}

/** 同步当前单例列表到 dbStorage。 */
function persist(): void {
  try {
    window.ztools.dbStorage.setItem(STORAGE_KEY, historyList.value)
  } catch (_) {
    /* 写入失败不阻塞 UI */
  }
}

/**
 * 新增一条历史记录：unshift 到头部，超 MAX_ITEMS 条尾裁剪，并同步到 dbStorage。
 * @param item 不含 id / ts 的条目，由本函数补全。
 */
function pushHistory(item: HistoryEmitItem): void {
  const full: HistoryItem = {
    ...item,
    id:
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : String(Date.now()) + '-' + Math.random().toString(36).slice(2, 10),
    ts: Date.now()
  }
  historyList.value.unshift(full)
  if (historyList.value.length > MAX_ITEMS) {
    historyList.value.length = MAX_ITEMS
  }
  persist()
}

/** 删除指定 id 的历史记录。 */
function removeHistory(id: string): void {
  historyList.value = historyList.value.filter((it) => it.id !== id)
  persist()
}

/** 清空全部历史记录。 */
function clearHistory(): void {
  historyList.value = []
  persist()
}

export function useHistory() {
  return {
    historyList,
    loadHistory,
    pushHistory,
    removeHistory,
    clearHistory
  }
}
