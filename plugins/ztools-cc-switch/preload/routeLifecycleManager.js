'use strict'

function createRouteLifecycleManager({ routerManager, configManager }) {
  if (!routerManager || !configManager) throw new Error('路由生命周期管理器缺少依赖')
  let queue = Promise.resolve()

  function hasEnabledRoute(config) {
    return Object.values(config?.routes || {}).some(Boolean)
  }

  async function apply(clientInput, enabledInput) {
    const client = String(clientInput || '')
    const enabled = Boolean(enabledInput)
    let status = await routerManager.status()
    let autoStarted = false
    let clientChanged = false

    if (enabled && !status.running) {
      status = await routerManager.start()
      autoStarted = true
    }

    try {
      await configManager.setClientRouting(client, enabled, status.url)
      clientChanged = true
      const config = await routerManager.saveConfig({ routes: { [client]: enabled } })
      let autoStopped = false
      if (!enabled && status.running && !hasEnabledRoute(config)) {
        status = await routerManager.stop()
        autoStopped = true
      } else status = await routerManager.status()
      return { client, enabled, autoStarted, autoStopped, status: { ...status, config } }
    } catch (error) {
      // 跨配置文件与监听服务的多步操作失败时，尽量回到操作前状态。
      if (clientChanged) await configManager.setClientRouting(client, !enabled, status.url).catch(() => {})
      if (autoStarted) {
        const latest = await routerManager.status().catch(() => null)
        if (latest?.running && !hasEnabledRoute(latest.config)) await routerManager.stop().catch(() => {})
      }
      throw error
    }
  }

  function setRoute(client, enabled) {
    const task = queue.then(() => apply(client, enabled))
    queue = task.catch(() => {})
    return task
  }

  return { setRoute }
}

module.exports = { createRouteLifecycleManager }
