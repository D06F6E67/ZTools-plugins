'use strict'

const crypto = require('node:crypto')
const fs = require('node:fs/promises')
const os = require('node:os')
const { opaqueId, sameFingerprint, secureFingerprint } = require('./safety.cjs')
const { runFile } = require('./runner.cjs')
const darwin = require('../platform/darwin.cjs')
const win32 = require('../platform/win32.cjs')
const linux = require('../platform/linux.cjs')

const DEFAULT_PLAN_TTL_MS = 2 * 60 * 1000
const MAX_APPS = 5000
const MAX_CANDIDATES = 200

function publicApp(app) {
  return {
    id: app.id, platform: app.platform, name: app.name, version: app.version,
    publisher: app.publisher, install: app.install, uninstall: app.uninstall, protected: app.protected,
  }
}

function publicCandidate(candidate) {
  return {
    id: candidate.id, path: candidate.path, category: candidate.category,
    sizeBytes: candidate.sizeBytes, exists: true, ownership: candidate.ownership,
    confidence: candidate.confidence, reason: candidate.reason,
    selectedByDefault: candidate.selectedByDefault, deletable: candidate.deletable,
  }
}

function createEngine(options = {}) {
  const platform = options.platform || process.platform
  const adapter = options.adapter || ({ darwin, win32, linux }[platform])
  if (!adapter) throw new Error(`不支持的平台：${platform}`)
  let systemHome = null
  try { systemHome = os.userInfo().homedir } catch {}
  const deps = {
    platform,
    home: options.home || systemHome || os.homedir(),
    env: options.env || process.env,
    fs: options.fs || fs,
    execFile: options.execFile || runFile,
    trashItem: options.trashItem || (async () => { throw new Error('废纸篓能力不可用') }),
    revealItem: options.revealItem || (() => false),
    now: options.now || (() => Date.now()),
    secret: options.secret || crypto.randomBytes(24).toString('hex'),
  }
  const apps = new Map()
  const plans = new Map()
  let scanFlight = null
  let inspectFlight = null
  let activeAction = null

  function actionBusyError() {
    const error = new Error(`系统管家正在执行${activeAction || '其他操作'}，请稍后重试`)
    error.code = 'ENGINE_BUSY'
    return error
  }

  async function withAction(kind, task) {
    if (activeAction) throw actionBusyError()
    activeAction = kind
    try { return await task() } finally { activeAction = null }
  }

  async function scanApps() {
    if (scanFlight) return scanFlight
    scanFlight = withAction('应用扫描', async () => {
      const adapterResult = await adapter.scanApps(deps)
      const sourceApps = Array.isArray(adapterResult) ? adapterResult : adapterResult.apps
      const sourceWarnings = Array.isArray(adapterResult) ? [] : adapterResult.warnings
      const source = (Array.isArray(sourceApps) ? sourceApps : []).slice(0, MAX_APPS)
      const found = []
      const seenIds = new Set()
      let duplicateIds = false
      for (const app of source) {
        if (!app || typeof app.id !== 'string' || !app.id || seenIds.has(app.id)) {
          duplicateIds = true
          continue
        }
        seenIds.add(app.id)
        found.push(app)
      }
      apps.clear()
      for (const app of found) apps.set(app.id, app)
      plans.clear()
      const warnings = Array.isArray(sourceWarnings) ? sourceWarnings.filter((item) => typeof item === 'string').slice(0, 20) : []
      if (source.length >= MAX_APPS) warnings.push('应用数量已达到安全上限')
      if (duplicateIds) warnings.push('检测到重复或无效的应用标识，相关条目已忽略')
      return { platform, scannedAt: new Date(deps.now()).toISOString(), apps: found.map(publicApp), warnings }
    })
    try { return await scanFlight } finally { scanFlight = null }
  }

  async function createPlan(appId) {
    if (typeof appId !== 'string' || !apps.has(appId)) throw new Error('应用标识已失效，请重新扫描')
    const app = apps.get(appId)
    // The UI exposes one preview at a time. Drop the previous hidden plan as
    // soon as a valid replacement starts, even if the new inspection fails.
    plans.clear()
    const raw = (await adapter.inspectApp(app, deps)).slice(0, MAX_CANDIDATES)
    const seen = new Set()
    const candidates = []
    for (const item of raw) {
      if (!item || typeof item.path !== 'string' || seen.has(item.path)) continue
      seen.add(item.path)
      const candidate = { ...item, id: opaqueId('item', `${app.id}:${item.path}`, deps.secret), sizeBytes: null, fingerprint: null }
      if (candidate.deletable) {
        try {
          candidate.fingerprint = await secureFingerprint(candidate.path, deps, deps.fs)
          candidate.sizeBytes = candidate.fingerprint.kind === 'file' ? candidate.fingerprint.size : candidate.fingerprint.treeBytes
        } catch (error) {
          candidate.deletable = false
          candidate.selectedByDefault = false
          candidate.reason = `${candidate.reason}；安全校验未通过：${error.message}`
        }
      }
      candidates.push(candidate)
    }
    const createdAt = deps.now()
    const planId = opaqueId('plan', `${app.id}:${createdAt}:${crypto.randomBytes(12).toString('hex')}`, deps.secret)
    const plan = { id: planId, app, createdAt, expiresAt: createdAt + (options.planTtlMs || DEFAULT_PLAN_TTL_MS), candidates, used: false }
    plans.set(planId, plan)
    return {
      id: planId, app: publicApp(app), createdAt: new Date(createdAt).toISOString(),
      expiresAt: new Date(plan.expiresAt).toISOString(), candidates: candidates.map(publicCandidate),
      warnings: [
        ...(!app.uninstall.supported ? ['当前应用需要使用系统工具手动卸载；仍可预览用户级残留。'] : []),
        ...(candidates.some((item) => item.deletable && item.confidence === 'exact' && !item.selectedByDefault && item.category !== 'application') ? ['应用标识来自应用、desktop 或注册表声明；关联残留不会默认选择，请核对路径后逐项确认。'] : []),
        ...(candidates.some((item) => item.confidence === 'strong') ? ['按显示名称推断的项目可能被同名应用共享，默认不会选择，请逐项确认。'] : []),
      ],
    }
  }

  async function inspectApp(appId) {
    if (inspectFlight) {
      if (inspectFlight.appId === appId) return inspectFlight.promise
      throw actionBusyError()
    }
    const promise = withAction('应用检查', () => createPlan(appId))
    inspectFlight = { appId, promise }
    try { return await promise } finally { if (inspectFlight && inspectFlight.promise === promise) inspectFlight = null }
  }

  async function runRegisteredUninstaller(app) {
    if (!app.uninstall.supported) return null
    if (platform === 'win32' && app.uninstall.mode === 'registered') throw new Error('注册表卸载命令属于可变元数据，自动执行已禁用')
    if (platform === 'linux' && app.uninstall.mode === 'package-manager') throw new Error('包管理器自动卸载已禁用，请使用发行版或 Flatpak 管理工具')
    return null
  }

  async function executePlanUnlocked(request) {
    if (!request || typeof request.planId !== 'string' || !plans.has(request.planId)) throw new Error('卸载计划不存在或已失效')
    const plan = plans.get(request.planId)
    if (plan.used) throw new Error('卸载计划已使用，请重新扫描')
    if (deps.now() > plan.expiresAt) { plans.delete(plan.id); throw new Error('卸载计划已过期，请重新扫描') }
    if (request.confirmation !== plan.app.name) throw new Error('请输入完整应用名称以确认')
    if (!Array.isArray(request.selectedIds) || request.selectedIds.length > MAX_CANDIDATES) throw new Error('候选项列表无效')
    const selected = new Set(request.selectedIds)
    if (selected.size !== request.selectedIds.length) throw new Error('候选项不能重复')
    const allowed = new Map(plan.candidates.map((item) => [item.id, item]))
    for (const id of selected) if (!allowed.has(id)) throw new Error('候选项不属于当前卸载计划')
    plan.used = true
    const results = []
    let uninstallFailed = false
    try {
      const uninstallResult = await runRegisteredUninstaller(plan.app)
      if (uninstallResult) results.push(uninstallResult)
    } catch (error) {
      results.push({ candidateId: 'uninstaller', status: 'failed', message: `卸载器执行失败：${error.message}` })
      uninstallFailed = true
    }
    if (uninstallFailed) {
      for (const id of request.selectedIds) results.push({ candidateId: id, status: 'skipped', message: '卸载器失败，未清理关联数据' })
      return { planId: plan.id, completedAt: new Date(deps.now()).toISOString(), results }
    }
    for (const id of request.selectedIds) {
      const item = allowed.get(id)
      if (!item.deletable || !item.fingerprint) {
        results.push({ candidateId: id, status: 'skipped', message: '此项目仅供预览，不能自动处理' })
        continue
      }
      try {
        const current = await secureFingerprint(item.path, deps, deps.fs)
        if (!sameFingerprint(item.fingerprint, current)) throw new Error('文件在预览后发生变化')
        await deps.trashItem(current.realPath)
        results.push({ candidateId: id, status: 'trashed' })
      } catch (error) {
        results.push({ candidateId: id, status: 'failed', message: error.message })
      }
    }
    return { planId: plan.id, completedAt: new Date(deps.now()).toISOString(), results }
  }

  async function executePlan(request) {
    return withAction('卸载处理', () => executePlanUnlocked(request))
  }

  function revealPath(pathId) {
    if (typeof pathId !== 'string') return false
    for (const plan of plans.values()) {
      const item = plan.candidates.find((candidate) => candidate.id === pathId)
      if (item) { deps.revealItem(item.path); return true }
    }
    return false
  }

  return { executePlan, inspectApp, revealPath, scanApps }
}

module.exports = { DEFAULT_PLAN_TTL_MS, createEngine, publicApp, publicCandidate }
