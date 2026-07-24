const test = require('node:test')
const assert = require('node:assert/strict')
const { createRouteLifecycleManager } = require('../preload/routeLifecycleManager')

function setup(routes = {}, running = false) {
  const calls = []
  let status = { running, url: 'http://127.0.0.1:15721', config: { routes: { ...routes } } }
  const routerManager = {
    status: async () => structuredClone(status),
    start: async () => { calls.push('start'); status.running = true; return structuredClone(status) },
    stop: async () => { calls.push('stop'); status.running = false; return structuredClone(status) },
    saveConfig: async ({ routes: patch }) => { calls.push(`save:${JSON.stringify(patch)}`); status.config.routes = { ...status.config.routes, ...patch }; return structuredClone(status.config) }
  }
  const configManager = { setClientRouting: async (client, enabled) => { calls.push(`client:${client}:${enabled}`) } }
  return { manager: createRouteLifecycleManager({ routerManager, configManager }), calls, status, routerManager, configManager }
}

test('开启第一条路由自动启动引擎，后续路由复用同一服务', async () => {
  const ctx = setup()
  const first = await ctx.manager.setRoute('claude', true)
  const second = await ctx.manager.setRoute('codex', true)
  assert.equal(first.autoStarted, true)
  assert.equal(second.autoStarted, false)
  assert.equal(ctx.calls.filter((item) => item === 'start').length, 1)
  assert.deepEqual(ctx.status.config.routes, { claude: true, codex: true })
})

test('关闭单条路由不影响其他客户端，关闭最后一条后自动停止', async () => {
  const ctx = setup({ claude: true, codex: true }, true)
  const first = await ctx.manager.setRoute('claude', false)
  assert.equal(first.autoStopped, false)
  assert.equal(ctx.status.running, true)
  const last = await ctx.manager.setRoute('codex', false)
  assert.equal(last.autoStopped, true)
  assert.equal(ctx.status.running, false)
  assert.equal(ctx.calls.filter((item) => item === 'stop').length, 1)
})

test('保存失败时回滚客户端接管并停止本次自动启动的引擎', async () => {
  const ctx = setup()
  ctx.routerManager.saveConfig = async () => { ctx.calls.push('save:failed'); throw new Error('disk full') }
  await assert.rejects(() => ctx.manager.setRoute('gemini', true), /disk full/)
  assert.deepEqual(ctx.calls, ['start', 'client:gemini:true', 'save:failed', 'client:gemini:false', 'stop'])
  assert.equal(ctx.status.running, false)
})

test('并发切换按调用顺序串行执行', async () => {
  const ctx = setup()
  await Promise.all([ctx.manager.setRoute('claude', true), ctx.manager.setRoute('codex', true)])
  assert.deepEqual(ctx.calls.slice(0, 5), ['start', 'client:claude:true', 'save:{"claude":true}', 'client:codex:true', 'save:{"codex":true}'])
})
