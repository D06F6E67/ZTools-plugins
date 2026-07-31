'use strict'

const { createManager } = require('./core/manager.cjs')

let manager
try {
  manager = createManager()
} catch {
  manager = {
    async scan() { return { snapshotId: '', platform: process.platform, generatedAt: new Date().toISOString(), items: [], warnings: ['当前平台暂不支持'] } },
    async setEnabled() { throw new Error('当前平台暂不支持管理启动项') },
    async undo() { throw new Error('当前平台暂不支持撤销') },
  }
}

function safeMessage(error) {
  const allowed = new Set(['INVALID_REQUEST', 'SNAPSHOT_EXPIRED', 'ITEM_NOT_FOUND', 'ITEM_BUSY', 'READ_ONLY', 'ITEM_CHANGED', 'NO_ROLLBACK', 'OPERATION_NOT_FOUND', 'OPERATION_EXPIRED', 'VERIFY_FAILED', 'STATE_UNKNOWN', 'ROLLBACK_FAILED', 'UNSAFE_FILE', 'TOOL_UNAVAILABLE'])
  if (error && allowed.has(error.code)) return { code: error.code, message: error.message }
  return { code: 'OPERATION_FAILED', message: '操作失败，请刷新后重试' }
}

async function call(method, value) {
  try { return { ok: true, value: await manager[method](value) } }
  catch (error) { return { ok: false, error: safeMessage(error) } }
}

window.startupManager = Object.freeze({
  scan: () => call('scan'),
  setEnabled: (request) => call('setEnabled', request),
  undo: (request) => call('undo', request),
})
