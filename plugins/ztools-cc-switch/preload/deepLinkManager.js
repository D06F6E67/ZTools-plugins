'use strict'

const crypto = require('node:crypto')

const APPS = new Set(['claude', 'codex', 'gemini', 'grokbuild', 'opencode', 'openclaw', 'hermes'])
const MCP_APPS = new Set(['claude', 'codex', 'gemini', 'grokbuild', 'opencode', 'hermes'])
const MAX_LINK_LENGTH = 64 * 1024
const MAX_DECODED_BYTES = 1024 * 1024
const PENDING_TTL_MS = 10 * 60 * 1000

function required(params, name) {
  const value = String(params.get(name) || '').trim()
  if (!value) throw new Error(`Deep Link 缺少 ${name} 参数`)
  return value
}

function optionalBoolean(value, fallback = false) {
  if (value === null || value === undefined || value === '') return fallback
  if (value === 'true') return true
  if (value === 'false') return false
  throw new Error('enabled 只能是 true 或 false')
}

function validateHttpUrl(value, label, httpsOnly = false) {
  let parsed
  try { parsed = new URL(String(value || '')) } catch { throw new Error(`${label} 不是有效 URL`) }
  if (parsed.username || parsed.password) throw new Error(`${label} 不允许包含 URL 凭据`)
  if (httpsOnly ? parsed.protocol !== 'https:' : !['http:', 'https:'].includes(parsed.protocol)) throw new Error(`${label} 协议不受支持`)
  return parsed.href.replace(/\/$/, '')
}

function decodeBase64(value, label) {
  const input = String(value || '')
  if (!input || input.length > Math.ceil(MAX_DECODED_BYTES * 4 / 3) + 16 || !/^[A-Za-z0-9+/_=-]+$/.test(input)) throw new Error(`${label} Base64 无效或过大`)
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/')
  const buffer = Buffer.from(normalized, 'base64')
  if (!buffer.length || buffer.length > MAX_DECODED_BYTES) throw new Error(`${label} 解码内容无效或过大`)
  return buffer.toString('utf8')
}

function safeName(value, label = 'name') {
  const name = String(value || '').trim()
  if (!name || name.length > 160 || /[\0\r\n]/.test(name)) throw new Error(`${label} 无效`)
  return name
}

function safeId(value) {
  const base = String(value || '').normalize('NFKD').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80)
  return `${base || 'imported'}-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`
}

function parseDeepLink(input) {
  const raw = String(input || '').trim()
  if (!raw || raw.length > MAX_LINK_LENGTH) throw new Error('Deep Link 为空或过长')
  let url
  try { url = new URL(raw) } catch { throw new Error('Deep Link URL 无效') }
  if (url.protocol !== 'ccswitch:' || url.hostname !== 'v1' || url.pathname !== '/import') throw new Error('仅支持 ccswitch://v1/import')
  const params = url.searchParams
  const resource = required(params, 'resource')
  const enabled = optionalBoolean(params.get('enabled'), resource === 'skill')
  if (!['provider', 'prompt', 'mcp', 'skill'].includes(resource)) throw new Error(`不支持的 Deep Link 资源: ${resource}`)

  if (resource === 'provider') {
    const app = required(params, 'app')
    if (!APPS.has(app)) throw new Error(`不支持的 Provider 应用: ${app}`)
    const endpoint = params.get('endpoint')?.split(',').map((item, index) => validateHttpUrl(item.trim(), `endpoint[${index}]`)).filter(Boolean) || []
    const homepage = params.get('homepage') ? validateHttpUrl(params.get('homepage'), 'homepage') : ''
    const configUrl = params.get('configUrl') ? validateHttpUrl(params.get('configUrl'), 'configUrl', true) : ''
    return {
      resource, app, enabled, name: safeName(required(params, 'name')), homepage, endpoint,
      apiKey: String(params.get('apiKey') || ''), model: String(params.get('model') || '').trim(), notes: String(params.get('notes') || '').slice(0, 4000),
      haikuModel: String(params.get('haikuModel') || '').trim(), sonnetModel: String(params.get('sonnetModel') || '').trim(), opusModel: String(params.get('opusModel') || '').trim(),
      icon: String(params.get('icon') || '').trim().slice(0, 80), config: String(params.get('config') || ''), configFormat: String(params.get('configFormat') || '').trim(), configUrl,
      usageEnabled: optionalBoolean(params.get('usageEnabled'), Boolean(params.get('usageScript'))), usageScript: String(params.get('usageScript') || ''), usageApiKey: String(params.get('usageApiKey') || ''), usageBaseUrl: String(params.get('usageBaseUrl') || ''), usageAccessToken: String(params.get('usageAccessToken') || ''), usageUserId: String(params.get('usageUserId') || ''), usageAutoInterval: Number(params.get('usageAutoInterval') || 0)
    }
  }
  if (resource === 'prompt') {
    const app = required(params, 'app'); if (!APPS.has(app)) throw new Error(`不支持的 Prompt 应用: ${app}`)
    return { resource, app, enabled, name: safeName(required(params, 'name')), content: decodeBase64(required(params, 'content'), 'content'), description: String(params.get('description') || '').slice(0, 2000) }
  }
  if (resource === 'mcp') {
    const apps = [...new Set(required(params, 'apps').split(',').map((item) => item.trim() === 'grok' ? 'grokbuild' : item.trim()))]
    if (!apps.length || apps.some((app) => app !== 'openclaw' && !MCP_APPS.has(app))) throw new Error('MCP apps 包含不支持的应用')
    const decoded = JSON.parse(decodeBase64(required(params, 'config'), 'config'))
    if (!decoded?.mcpServers || typeof decoded.mcpServers !== 'object' || Array.isArray(decoded.mcpServers) || !Object.keys(decoded.mcpServers).length) throw new Error('MCP config 必须包含非空 mcpServers 对象')
    return { resource, apps, enabled, mcpServers: decoded.mcpServers }
  }
  const repo = required(params, 'repo')
  const parts = repo.split('/')
  if (parts.length !== 2 || parts.some((item) => !/^[A-Za-z0-9_.-]+$/.test(item))) throw new Error('Skill repo 必须是 owner/name')
  const branch = String(params.get('branch') || 'main').trim()
  if (!branch || branch.includes('..') || !/^[A-Za-z0-9._/-]+$/.test(branch)) throw new Error('Skill branch 无效')
  return { resource, repo, owner: parts[0], name: parts[1], directory: String(params.get('directory') || '').trim(), branch, enabled }
}

function inferProviderConfig(request, configValue) {
  if (!configValue || typeof configValue !== 'object') return request
  const next = { ...request }
  if (next.app === 'claude') {
    const env = configValue.env || configValue
    next.apiKey ||= env.ANTHROPIC_AUTH_TOKEN || env.ANTHROPIC_API_KEY || ''
    next.endpoint = next.endpoint.length ? next.endpoint : [env.ANTHROPIC_BASE_URL].filter(Boolean)
    next.model ||= env.ANTHROPIC_MODEL || ''
    next.haikuModel ||= env.ANTHROPIC_DEFAULT_HAIKU_MODEL || ''
    next.sonnetModel ||= env.ANTHROPIC_DEFAULT_SONNET_MODEL || ''
    next.opusModel ||= env.ANTHROPIC_DEFAULT_OPUS_MODEL || ''
  } else if (next.app === 'codex') {
    next.apiKey ||= configValue.auth?.OPENAI_API_KEY || configValue.OPENAI_API_KEY || ''
    const text = String(configValue.config || '')
    const base = /base_url\s*=\s*["']([^"']+)/.exec(text)?.[1] || configValue.baseUrl
    const model = /^model\s*=\s*["']([^"']+)/m.exec(text)?.[1] || configValue.model
    next.endpoint = next.endpoint.length ? next.endpoint : [base].filter(Boolean); next.model ||= model || ''
  } else {
    next.apiKey ||= configValue.GEMINI_API_KEY || configValue.apiKey || ''
    next.endpoint = next.endpoint.length ? next.endpoint : [configValue.GEMINI_BASE_URL || configValue.baseUrl].filter(Boolean)
    next.model ||= configValue.GEMINI_MODEL || configValue.model || ''
  }
  return next
}

function createDeepLinkManager(options = {}) {
  const configManager = options.configManager
  const extensionManager = options.extensionManager
  const skillManager = options.skillManager
  const saveUsageScript = options.saveUsageScript
  const fetchImpl = options.fetchImpl || globalThis.fetch
  const pending = new Map()

  function purge() { const now = Date.now(); for (const [id, item] of pending) if (item.expiresAt <= now) pending.delete(id) }
  async function fetchConfig(url) {
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 10000)
    try {
      const response = await fetchImpl(url, { signal: controller.signal, redirect: 'error', headers: { accept: 'application/json, text/plain' } })
      if (!response.ok) throw new Error(`配置下载失败: HTTP ${response.status}`)
      const length = Number(response.headers?.get?.('content-length') || 0); if (length > MAX_DECODED_BYTES) throw new Error('远端配置过大')
      const text = await response.text(); if (Buffer.byteLength(text) > MAX_DECODED_BYTES) throw new Error('远端配置过大')
      return text
    } finally { clearTimeout(timer) }
  }
  async function prepare(url) {
    purge()
    let request = parseDeepLink(url)
    if (request.resource === 'provider' && (request.config || request.configUrl)) {
      const content = request.config ? decodeBase64(request.config, 'config') : await fetchConfig(request.configUrl)
      let parsed
      try { parsed = JSON.parse(content) } catch { throw new Error('Provider config 目前必须是 JSON') }
      request = inferProviderConfig(request, parsed)
    }
    if (request.resource === 'provider' && request.usageScript) request.usageScript = decodeBase64(request.usageScript, 'usageScript')
    if (request.resource === 'provider') {
      if (!request.apiKey) throw new Error('Provider API Key 不能为空')
      if (!request.endpoint.length) throw new Error('Provider endpoint 不能为空')
      request.endpoint = request.endpoint.map((item, index) => validateHttpUrl(item, `endpoint[${index}]`))
    }
    const pendingId = crypto.randomUUID(); pending.set(pendingId, { request, expiresAt: Date.now() + PENDING_TTL_MS })
    const preview = request.resource === 'provider'
      ? { resource: request.resource, app: request.app, name: request.name, endpoint: request.endpoint, homepage: request.homepage, model: request.model, notes: request.notes, enabled: request.enabled, usageEnabled: request.usageEnabled && Boolean(request.usageScript), maskedApiKey: `${request.apiKey.slice(0, 4)}${'*'.repeat(12)}` }
      : request.resource === 'prompt' ? { resource: request.resource, app: request.app, name: request.name, description: request.description, contentPreview: request.content.slice(0, 240), enabled: request.enabled }
        : request.resource === 'mcp' ? { resource: request.resource, apps: request.apps, serverIds: Object.keys(request.mcpServers), enabled: request.enabled }
          : { resource: request.resource, repo: request.repo, directory: request.directory, branch: request.branch, enabled: request.enabled }
    return { pendingId, expiresAt: Date.now() + PENDING_TTL_MS, preview }
  }
  async function confirm(pendingId) {
    purge(); const item = pending.get(String(pendingId || '')); if (!item) throw new Error('Deep Link 已过期，请重新打开')
    pending.delete(String(pendingId)); const request = item.request
    if (request.resource === 'provider') {
      const apiType = request.app === 'claude' ? 'anthropic' : request.app === 'gemini' ? 'gemini' : 'openai_compat'
      const provider = await configManager.saveProvider({ id: safeId(request.name), name: request.name, apiKey: request.apiKey, baseUrl: request.endpoint[0], model: request.model, clients: [request.app], apiType, wireApi: request.app === 'codex' ? 'responses' : 'chat_completions', claudeAuthField: 'ANTHROPIC_AUTH_TOKEN', source: 'imported', notes: request.notes, homepage: request.homepage, customEndpoints: request.endpoint.slice(1), modelMap: request.app === 'claude' ? { haiku: request.haikuModel, sonnet: request.sonnetModel, opus: request.opusModel } : {} })
      if (request.usageScript && saveUsageScript) await saveUsageScript(provider.id, { enabled: request.usageEnabled, templateType: 'custom', code: request.usageScript, baseUrl: request.usageBaseUrl, apiKey: request.usageApiKey && request.usageApiKey !== request.apiKey ? request.usageApiKey : '', accessToken: request.usageAccessToken, userId: request.usageUserId, autoQueryInterval: request.usageAutoInterval })
      if (request.enabled) await configManager.switchProvider(request.app, provider.id)
      return { type: 'provider', id: provider.id, name: provider.name, app: request.app, enabled: request.enabled }
    }
    if (request.resource === 'prompt') {
      const prompt = await extensionManager.savePrompt({ id: safeId(request.name), name: request.name, content: request.content, description: request.description, apps: {} })
      if (request.enabled) await extensionManager.setPromptEnabled(prompt.id, request.app, true)
      return { type: 'prompt', id: prompt.id, name: prompt.name, app: request.app, enabled: request.enabled }
    }
    if (request.resource === 'mcp') {
      const importedIds = []; const failed = []
      for (const [id, spec] of Object.entries(request.mcpServers)) {
        try {
          const isHttp = typeof spec?.url === 'string'
          const saved = await extensionManager.saveMcp({ id, name: id, type: isHttp ? 'http' : 'command', url: spec?.url || '', headers: spec?.headers || spec?.http_headers || {}, command: spec?.command || '', args: spec?.args || [], env: spec?.env || {}, apps: {} })
          if (request.enabled) for (const app of request.apps) if (app !== 'openclaw') await extensionManager.setMcpEnabled(saved.id, app, true)
          importedIds.push(saved.id)
        } catch (error) { failed.push({ id, error: error.message }) }
      }
      return { type: 'mcp', importedCount: importedIds.length, importedIds, failed }
    }
    await skillManager.addSkillRepo({ owner: request.owner, name: request.name, branch: request.branch, enabled: request.enabled })
    return { type: 'skill', repo: request.repo, enabled: request.enabled }
  }
  function cancel(pendingId) { return pending.delete(String(pendingId || '')) }
  return { prepare, confirm, cancel }
}

module.exports = { APPS, MCP_APPS, parseDeepLink, decodeBase64, createDeepLinkManager }
