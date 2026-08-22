import { ref, onUnmounted } from 'vue'
import type { BuildInfo } from '../types'
import { useInstances } from './useInstances'

let pollingInterval: ReturnType<typeof setInterval> | null = null
let currentPollingJob: string | null = null
const currentBuilds = ref<BuildInfo[]>([])

export function useBuildPolling() {
  const { currentClient } = useInstances()

  /**
   * 开始轮询指定 Job 的构建状态
   */
  const startPolling = (jobName: string, intervalMs = 10000) => {
    stopPolling()
    currentPollingJob = jobName

    // 立即获取一次
    fetchBuilds()

    // 设置轮询
    pollingInterval = setInterval(fetchBuilds, intervalMs)
  }

  /**
   * 停止轮询
   */
  const stopPolling = () => {
    if (pollingInterval) {
      clearInterval(pollingInterval)
      pollingInterval = null
    }
    currentPollingJob = null
  }

  /**
   * 获取构建列表
   */
  const fetchBuilds = async () => {
    if (!currentPollingJob || !currentClient.value) return

    const result = await currentClient.value.getBuilds(currentPollingJob)
    if (result.data) {
      currentBuilds.value = result.data
    }
  }

  /**
   * 检查是否有正在运行中的构建
   */
  const hasBuilding = () => {
    return currentBuilds.value.some(b => b.building)
  }

  /**
   * 获取最后完成的构建（状态不再是 building）
   */
  const getLastCompletedBuild = (): BuildInfo | null => {
    const completed = currentBuilds.value.filter(b => !b.building)
    return completed.length > 0 ? completed[0] : null
  }

  /**
   * 清理
   */
  onUnmounted(() => {
    stopPolling()
  })

  return {
    currentBuilds,
    startPolling,
    stopPolling,
    hasBuilding,
    getLastCompletedBuild,
    fetchBuilds
  }
}
