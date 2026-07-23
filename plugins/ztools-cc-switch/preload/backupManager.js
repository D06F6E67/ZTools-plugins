'use strict'
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const path = require('node:path')
const crypto = require('node:crypto')

const DATA_FILES = ['providers.json', 'universal-providers.json', 'common-config-snippets.json', 'profiles.json', 'omo-profiles.json', 'skills-state.json', 'extensions.json', 'router-config.json', 'request-logs.jsonl', 'model-pricing.json', 'billing-defaults.json', 'connectivity-check-config.json', 'connectivity-check-logs.jsonl', 'log-config.json']
function createBackupManager(options = {}) {
  const dataDir = path.resolve(options.dataDir)
  const localBackupDir = path.join(dataDir, 'backups')
  const localSettingsPath = path.join(dataDir, 'backup-settings.json')
  async function atomicWrite(filePath, content) {
    await fsp.mkdir(path.dirname(filePath), { recursive: true })
    if (fs.existsSync(filePath)) await fsp.copyFile(filePath, `${filePath}.pre-import-${Date.now()}.bak`)
    const temp = `${filePath}.${process.pid}.${crypto.randomBytes(5).toString('hex')}.tmp`
    await fsp.writeFile(temp, content, { mode: 0o600 }); await fsp.rename(temp, filePath)
  }
  function redact(value) {
    if (Array.isArray(value)) return value.map(redact)
    if (!value || typeof value !== 'object') return value
    const output = {}
    for (const [key, child] of Object.entries(value)) output[key] = /api.?key|token|secret|authorization/i.test(key) ? '' : redact(child)
    return output
  }
  async function exportBackup(destination, options = {}) {
    const files = {}
    for (const filename of DATA_FILES) {
      if (filename === 'request-logs.jsonl' && options.includeLogs === false) continue
      try {
        const text = await fsp.readFile(path.join(dataDir, filename), 'utf8')
        if (!options.includeSecrets && filename.endsWith('.json')) files[filename] = `${JSON.stringify(redact(JSON.parse(text)), null, 2)}\n`
        else files[filename] = text
      } catch (error) { if (error.code !== 'ENOENT') throw error }
    }
    const bundle = { format: 'ztools-cc-switch-backup', version: 1, exportedAt: new Date().toISOString(), files }
    const target = path.resolve(String(destination || ''))
    if (!target.endsWith('.json')) throw new Error('备份文件必须使用 .json 扩展名')
    await atomicWrite(target, `${JSON.stringify(bundle, null, 2)}\n`)
    return { path: target, fileCount: Object.keys(files).length }
  }
  async function importBackup(source) {
    const sourcePath = path.resolve(String(source || '')); const bundle = JSON.parse(await fsp.readFile(sourcePath, 'utf8'))
    if (bundle.format !== 'ztools-cc-switch-backup' || bundle.version !== 1 || !bundle.files || typeof bundle.files !== 'object') throw new Error('不是有效的 AI Provider Switch 备份')
    let imported = 0
    for (const [filename, content] of Object.entries(bundle.files)) {
      if (!DATA_FILES.includes(filename) || typeof content !== 'string') continue
      if (filename.endsWith('.json')) JSON.parse(content)
      await atomicWrite(path.join(dataDir, filename), content); imported += 1
    }
    return { imported, source: sourcePath }
  }
  function validateFilename(filename) {
    const value = String(filename || '')
    if (!/^[A-Za-z0-9_.-]+\.snapshot\.json$/.test(value) || value.includes('..')) throw new Error('无效的快照文件名')
    return value
  }
  async function getLocalBackupSettings() {
    try {
      const value = JSON.parse(await fsp.readFile(localSettingsPath, 'utf8'))
      return { intervalHours: [0, 6, 12, 24, 48, 168].includes(Number(value.intervalHours)) ? Number(value.intervalHours) : 24, retainCount: Math.min(50, Math.max(3, Number(value.retainCount) || 10)) }
    } catch (error) { if (error.code === 'ENOENT') return { intervalHours: 24, retainCount: 10 }; throw error }
  }
  async function saveLocalBackupSettings(input) {
    const current = await getLocalBackupSettings()
    const next = {
      intervalHours: input?.intervalHours === undefined ? current.intervalHours : Number(input.intervalHours),
      retainCount: input?.retainCount === undefined ? current.retainCount : Number(input.retainCount)
    }
    if (![0, 6, 12, 24, 48, 168].includes(next.intervalHours)) throw new Error('自动备份间隔无效')
    if (!Number.isInteger(next.retainCount) || next.retainCount < 3 || next.retainCount > 50) throw new Error('备份保留数量必须在 3 到 50 之间')
    await atomicWrite(localSettingsPath, `${JSON.stringify(next, null, 2)}\n`)
    await cleanupLocalBackups(next.retainCount)
    return next
  }
  function timestamp() {
    const value = new Date().toISOString().replace(/[-:]/g, '').replace('T', '_').replace(/\.\d{3}Z$/, '')
    return value
  }
  async function listLocalBackups() {
    try {
      const entries = await fsp.readdir(localBackupDir, { withFileTypes: true })
      const result = []
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith('.snapshot.json')) continue
        const stat = await fsp.stat(path.join(localBackupDir, entry.name))
        result.push({ filename: entry.name, sizeBytes: stat.size, createdAt: stat.mtime.toISOString() })
      }
      return result.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    } catch (error) { if (error.code === 'ENOENT') return []; throw error }
  }
  async function cleanupLocalBackups(retainCount) {
    const entries = await listLocalBackups()
    for (const entry of entries.slice(retainCount)) await fsp.rm(path.join(localBackupDir, entry.filename), { force: true })
  }
  async function createLocalBackup(label = 'db_backup') {
    await fsp.mkdir(localBackupDir, { recursive: true })
    const safeLabel = String(label || 'db_backup').trim().replace(/[^A-Za-z0-9_-]+/g, '_').slice(0, 40) || 'db_backup'
    let filename = `${safeLabel}_${timestamp()}.snapshot.json`; let counter = 1
    while (fs.existsSync(path.join(localBackupDir, filename))) filename = `${safeLabel}_${timestamp()}_${counter++}.snapshot.json`
    const result = await exportBackup(path.join(localBackupDir, filename), { includeSecrets: true, includeLogs: true })
    const settings = await getLocalBackupSettings(); await cleanupLocalBackups(settings.retainCount)
    return { filename, ...result }
  }
  async function restoreLocalBackup(filename) {
    const value = validateFilename(filename)
    const restoreSource = path.join(dataDir, `.restore-source-${process.pid}-${crypto.randomBytes(4).toString('hex')}.tmp.json`)
    await fsp.copyFile(path.join(localBackupDir, value), restoreSource)
    try {
      const safety = await createLocalBackup('safety_before_restore')
      const result = await importBackup(restoreSource)
      return { ...result, safetyBackup: safety.filename }
    } finally { await fsp.rm(restoreSource, { force: true }) }
  }
  async function renameLocalBackup(filename, newName) {
    const oldValue = validateFilename(filename)
    const base = String(newName || '').trim().replace(/\.snapshot\.json$/, '')
    if (!base || base.length > 100 || !/^[A-Za-z0-9_.-]+$/.test(base) || base.includes('..')) throw new Error('快照名称只能包含字母、数字、点、下划线和短横线')
    const next = `${base}.snapshot.json`
    await fsp.rename(path.join(localBackupDir, oldValue), path.join(localBackupDir, next))
    return next
  }
  async function deleteLocalBackup(filename) {
    await fsp.rm(path.join(localBackupDir, validateFilename(filename)))
    return true
  }
  async function periodicLocalBackupIfNeeded() {
    const settings = await getLocalBackupSettings()
    if (!settings.intervalHours) return { created: false, disabled: true }
    if (!DATA_FILES.some((filename) => fs.existsSync(path.join(dataDir, filename)))) return { created: false, noData: true }
    const latest = (await listLocalBackups())[0]
    if (latest && Date.now() - new Date(latest.createdAt).getTime() < settings.intervalHours * 3600000) return { created: false }
    return { created: true, backup: await createLocalBackup('db_backup') }
  }
  return { exportBackup, importBackup, getLocalBackupSettings, saveLocalBackupSettings, listLocalBackups, createLocalBackup, restoreLocalBackup, renameLocalBackup, deleteLocalBackup, periodicLocalBackupIfNeeded }
}
module.exports = { DATA_FILES, createBackupManager }
