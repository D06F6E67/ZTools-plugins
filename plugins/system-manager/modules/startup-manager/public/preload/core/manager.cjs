'use strict'

const crypto = require('node:crypto')
const nodeFs = require('node:fs/promises')
const os = require('node:os')
const defaultRunner = require('./runner.cjs')
const { publicItem } = require('./model.cjs')

const SNAPSHOT_TTL_MS = 10 * 60 * 1000
const MAX_SNAPSHOTS = 3
// The UI exposes only the latest undo action. Keeping older items alive can
// retain a complete platform origin proof, so the journal is intentionally
// limited to the one operation the user can still invoke.
const MAX_OPERATIONS = 1
const EXCLUSIVE_LOCK = 'startup-manager-exclusive'

function errorWithCode(message, code) {
  const error = new Error(message)
  error.code = code
  return error
}

function createManager(options = {}) {
  const platform = options.platform || process.platform
  const adapter = options.adapter || require(`../adapters/${platform}.cjs`)
  const deps = { runner: options.runner || defaultRunner, fs: options.fs || nodeFs, home: options.home || os.homedir(), uid: options.uid, powershell: options.powershell, locations: options.locations, desktopLocations: options.desktopLocations, toolPaths: options.toolPaths }
  const clock = options.clock || Date.now
  const snapshots = new Map()
  const operations = new Map()
  const locks = new Map()
  let scanFlight = null

  function trim(map, limit) {
    while (map.size > limit) map.delete(map.keys().next().value)
  }

  async function scan() {
    if (scanFlight) return scanFlight
    scanFlight = withLock(EXCLUSIVE_LOCK, async () => {
      const result = await adapter.scan(deps)
      const snapshotId = crypto.randomUUID()
      const createdAt = clock()
      const byId = new Map()
      const items = result.items.map((item) => {
        const id = crypto.randomUUID()
        byId.set(id, item)
        return publicItem(item, id)
      })
      snapshots.set(snapshotId, { createdAt, byId, publicItems: items })
      trim(snapshots, MAX_SNAPSHOTS)
      return { snapshotId, platform, generatedAt: new Date(createdAt).toISOString(), items, warnings: (result.warnings || []).slice(0, 100) }
    })
    try { return await scanFlight } finally { scanFlight = null }
  }

  function resolveItem(snapshotId, itemId) {
    if (typeof snapshotId !== 'string' || typeof itemId !== 'string') throw errorWithCode('请求参数无效', 'INVALID_REQUEST')
    const snapshot = snapshots.get(snapshotId)
    if (!snapshot || clock() - snapshot.createdAt > SNAPSHOT_TTL_MS) throw errorWithCode('扫描结果已过期，请刷新后重试', 'SNAPSHOT_EXPIRED')
    const item = snapshot.byId.get(itemId)
    if (!item) throw errorWithCode('启动项不存在或不属于该扫描结果', 'ITEM_NOT_FOUND')
    return { snapshot, item }
  }

  async function withLock(key, task) {
    if (locks.has(key)) throw errorWithCode('该项目正在执行其他操作', 'ITEM_BUSY')
    const marker = Symbol(key)
    locks.set(key, marker)
    try { return await task() } finally { if (locks.get(key) === marker) locks.delete(key) }
  }

  async function refreshItem(item, fallbackState) {
    try {
      const result = await adapter.scan(deps)
      const fresh = result.items.find((candidate) => candidate.key === item.key)
      if (fresh) {
        Object.assign(item, fresh)
        return item
      }
    } catch {
      // Adapters verify a mutation before returning. Preserve that verified
      // state so a temporary rescan failure cannot discard the undo journal.
    }
    if (fallbackState) {
      if (typeof fallbackState.enabled === 'boolean') item.enabled = fallbackState.enabled
      if (typeof fallbackState.running === 'boolean' || fallbackState.running === null) item.running = fallbackState.running
    }
    return item
  }

  async function setEnabled(request = {}) {
    if (typeof request.enabled !== 'boolean') throw errorWithCode('enabled 必须为布尔值', 'INVALID_REQUEST')
    const { item } = resolveItem(request.snapshotId, request.itemId)
    if (!item.action.canToggle || item.scope !== 'user') throw errorWithCode(item.action.reason || '该项目仅支持查看', 'READ_ONLY')
    return withLock(EXCLUSIVE_LOCK, async () => {
      if (item.enabled === request.enabled) return { changed: false, item: publicItem(item, request.itemId), operationId: null }
      const before = { enabled: item.enabled, running: item.running }
      const rollback = await adapter.applyEnabled(item, request.enabled, deps)
      await refreshItem(item, rollback.state || { enabled: request.enabled, running: request.enabled ? item.running : false })
      const operationId = crypto.randomUUID()
      operations.clear()
      operations.set(operationId, { item, itemId: request.itemId, before, rollback, createdAt: clock() })
      trim(operations, MAX_OPERATIONS)
      return { changed: true, operationId, item: publicItem(item, request.itemId) }
    })
  }

  async function undo(request = {}) {
    if (typeof request.operationId !== 'string') throw errorWithCode('operationId 无效', 'INVALID_REQUEST')
    const operation = operations.get(request.operationId)
    if (!operation) throw errorWithCode('撤销记录不存在或已使用', 'OPERATION_NOT_FOUND')
    if (clock() - operation.createdAt > SNAPSHOT_TTL_MS) { operations.delete(request.operationId); throw errorWithCode('撤销记录已过期', 'OPERATION_EXPIRED') }
    return withLock(EXCLUSIVE_LOCK, async () => {
      const result = await adapter.undo(operation.item, operation.rollback, deps)
      await refreshItem(operation.item, result && result.state ? result.state : operation.before)
      operations.delete(request.operationId)
      return { restored: true, item: publicItem(operation.item, operation.itemId) }
    })
  }

  return { scan, setEnabled, undo, _state: { snapshots, operations, locks } }
}

module.exports = { MAX_OPERATIONS, MAX_SNAPSHOTS, SNAPSHOT_TTL_MS, createManager }
