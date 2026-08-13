'use strict'

const crypto = require('node:crypto')
const fs = require('node:fs')
const http = require('node:http')
const os = require('node:os')
const path = require('node:path')
const { WebSocketServer, WebSocket } = require('ws')
const {
  decryptBytes,
  decryptJson,
  derivePairKey,
  encryptBytes,
  encryptJson,
  pairingProof,
  randomId,
  secureEqual,
} = require('./crypto')
const { cleanDeviceName, cleanText, detectKind, isPrivateAddress, safeFilename } = require('./validation')

const PAIRING_TTL_MS = 30 * 60 * 1000
const SESSION_TTL_MS = 24 * 60 * 60 * 1000
const TRANSFER_TTL_MS = 30 * 60 * 1000
const LOCKOUT_MS = 10 * 60 * 1000
const MAX_PAIR_ATTEMPTS = 5
const MAX_SESSIONS = 128
const MAX_ACTIVE_TRANSFERS = 16
const MAX_ACTIVE_TRANSFERS_PER_SESSION = 4
const JSON_BODY_LIMIT = 256 * 1024
const CHUNK_SIZE = 4 * 1024 * 1024

class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message)
    this.status = status
    this.extra = extra
  }
}

function getLanIPs() {
  const values = []
  for (const interfaces of Object.values(os.networkInterfaces())) {
    for (const info of interfaces || []) {
      if (info.family === 'IPv4' && !info.internal && isPrivateAddress(info.address)) values.push(info.address)
    }
  }
  return [...new Set(values)].sort((a, b) => Number(!a.startsWith('192.168.')) - Number(!b.startsWith('192.168.')))
}

function bearerToken(request) {
  const header = String(request.headers.authorization || '')
  return header.startsWith('Bearer ') ? header.slice(7) : ''
}

function messageView(message) {
  return {
    ...message,
    attachments: (message.attachments || []).map(({ path: _path, ...attachment }) => attachment),
  }
}

function createPairingState(pairingCode) {
  return {
    secret: randomId(32),
    code: pairingCode,
    sessionId: randomId(16),
    salt: randomId(16),
    challenge: randomId(24),
    expiresAt: Date.now() + PAIRING_TTL_MS,
  }
}

function readBody(request, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let total = 0
    let tooLarge = false
    request.on('data', (chunk) => {
      total += chunk.length
      if (total > maxBytes) {
        tooLarge = true
        chunks.length = 0
      } else if (!tooLarge) chunks.push(chunk)
    })
    request.on('end', () => {
      if (tooLarge) reject(new HttpError(413, '请求内容超过安全上限'))
      else resolve(Buffer.concat(chunks))
    })
    request.on('aborted', () => reject(new HttpError(400, '请求已中断')))
    request.on('error', reject)
  })
}

async function readJson(request) {
  const contentType = String(request.headers['content-type'] || '').split(';')[0]
  if (contentType !== 'application/json') throw new HttpError(415, '请求必须使用 application/json')
  const body = await readBody(request, JSON_BODY_LIMIT)
  try {
    return body.length ? JSON.parse(body.toString('utf8')) : {}
  } catch {
    throw new HttpError(400, 'JSON 请求格式无效')
  }
}

function sendJson(response, status, value) {
  const body = Buffer.from(JSON.stringify(value))
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  })
  response.end(body)
}

function mobileSecurityHeaders(html) {
  const hashes = (tag) => [...html.matchAll(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'gi'))]
    .map((match) => `'sha256-${crypto.createHash('sha256').update(match[1]).digest('base64')}'`)
  const scripts = mobileSecurityHeadersFor(hashes('script'))
  return {
    'Content-Security-Policy': `default-src 'none'; script-src 'self' ${scripts}; style-src 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ws: wss:; font-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Cache-Control': 'no-store',
  }
}

function mobileSecurityHeadersFor(hashes) {
  return hashes.length ? hashes.join(' ') : "'none'"
}

async function createDeviceLinkServer(options) {
  const {
    repository,
    deviceId,
    deviceName,
    port,
    pairingCode,
    maxIncomingFileBytes,
    onEvent,
    transferTtlMs = TRANSFER_TTL_MS,
  } = options
  const sessions = new Map()
  const attempts = new Map()
  const transfers = new Map()
  let pairing = createPairingState(pairingCode)
  let status = null
  let closing = false

  const webRoot = path.join(__dirname, '..', '..', 'web')
  const mobileHtml = await fs.promises.readFile(path.join(webRoot, 'index.html'))
  const fallbackCryptoScript = await fs.promises.readFile(path.join(webRoot, 'crypto-fallback.js'))
  const securityHeaders = mobileSecurityHeaders(mobileHtml.toString('utf8'))

  function currentSession(request) {
    const token = bearerToken(request)
    const session = sessions.get(token)
    if (!session || session.expiresAt < Date.now()) {
      if (session) revokeSession(token, session, 4001, 'Session expired')
      return null
    }
    session.lastSeenAt = new Date().toISOString()
    return { token, session }
  }

  function requireSession(request) {
    const auth = currentSession(request)
    if (!auth) throw new HttpError(401, '配对会话已失效，请重新配对')
    return auth
  }

  async function registerDevice(session) {
    const now = new Date().toISOString()
    const device = {
      id: session.deviceId,
      name: session.deviceName,
      platform: session.platform,
      connected: true,
      pairedAt: session.pairedAt,
      lastSeenAt: now,
      permissions: session.permissions,
    }
    await repository.putDevice(device)
    try { onEvent('device:changed', device) } catch {}
  }

  function sessionEnvelope(session, type, data) {
    return JSON.stringify({ data: encryptJson(session.key, { type, data }, `ws:${session.deviceId}`) })
  }

  function sendToSession(session, type, data) {
    if (session.socket?.readyState === WebSocket.OPEN) {
      try { session.socket.send(sessionEnvelope(session, type, data)) } catch {}
    }
  }

  function broadcast(type, data, exceptDeviceId = '') {
    for (const session of sessions.values()) {
      if (session.deviceId !== exceptDeviceId) sendToSession(session, type, data)
    }
  }

  async function publishMessage(message, exceptDeviceId = '') {
    await repository.putMessage(message)
    broadcast('message:new', messageView(message), exceptDeviceId)
    try { onEvent('message:new', message) } catch {}
    return message
  }

  async function removeTransfer(transfer) {
    transfers.delete(transfer.id)
    transfer.session.activeTransfers.delete(transfer.id)
    try {
      await fs.promises.rm(transfer.path, { force: true })
    } catch {}
  }

  async function cleanupOrphanTransferFiles(now = Date.now()) {
    if (!repository.transfersDir) return
    let entries
    try { entries = await fs.promises.readdir(repository.transfersDir, { withFileTypes: true }) } catch { return }
    const activePaths = new Set([...transfers.values()].map((transfer) => path.resolve(transfer.path)))
    await Promise.all(entries.map(async (entry) => {
      if (!entry.isFile() || !entry.name.endsWith('.part')) return
      const filePath = path.join(repository.transfersDir, entry.name)
      if (activePaths.has(path.resolve(filePath))) return
      try {
        const stat = await fs.promises.stat(filePath)
        if (stat.mtimeMs + transferTtlMs < now) await fs.promises.rm(filePath, { force: true })
      } catch {}
    }))
  }

  function revokeSession(token, session, code = 4001, reason = 'Authorization revoked') {
    session.socket?.close(code, reason)
    sessions.delete(token)
    for (const transferId of [...session.activeTransfers]) {
      const transfer = transfers.get(transferId)
      if (transfer) void removeTransfer(transfer)
    }
  }

  async function findAttachment(id) {
    const messages = await repository.listMessages()
    for (const message of messages) {
      const attachment = (message.attachments || []).find((item) => item.id === id)
      if (attachment) return attachment
    }
    return null
  }

  async function route(request, response) {
    const address = String(request.socket?.remoteAddress || '')
    if (!isPrivateAddress(address)) throw new HttpError(403, '仅允许局域网设备访问')
    const url = new URL(request.url || '/', 'http://device-link.local')
    let pathname
    try { pathname = decodeURIComponent(url.pathname) } catch { throw new HttpError(400, '请求路径格式无效') }

    if ((request.method === 'GET' || request.method === 'HEAD') && (pathname === '/' || pathname === '/index.html')) {
      response.writeHead(200, { ...securityHeaders, 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': mobileHtml.length })
      response.end(request.method === 'HEAD' ? undefined : mobileHtml)
      return
    }

    if ((request.method === 'GET' || request.method === 'HEAD') && pathname === '/crypto-fallback.js') {
      response.writeHead(200, {
        'Content-Type': 'application/javascript; charset=utf-8',
        'Content-Length': fallbackCryptoScript.length,
        'Cache-Control': 'public, max-age=86400',
        'X-Content-Type-Options': 'nosniff',
      })
      response.end(request.method === 'HEAD' ? undefined : fallbackCryptoScript)
      return
    }

    if (request.method === 'GET' && pathname === '/api/pairing') {
      sendJson(response, 200, {
        version: 1,
        sessionId: pairing.sessionId,
        salt: pairing.salt,
        challenge: pairing.challenge,
        expiresAt: new Date(pairing.expiresAt).toISOString(),
        deviceName,
        iterations: 210000,
      })
      return
    }

    if (request.method === 'POST' && pathname === '/api/pair') {
      const body = await readJson(request)
      const attempt = attempts.get(address) || { count: 0, lockedUntil: 0, lastAttemptAt: Date.now() }
      if (attempt.lockedUntil > Date.now()) throw new HttpError(429, '匹配码错误次数过多，请稍后再试')
      if (pairing.expiresAt < Date.now() || body.sessionId !== pairing.sessionId) throw new HttpError(410, '配对信息已过期，请在电脑端刷新二维码')
      let pairKey
      try {
        pairKey = derivePairKey(pairing.secret, pairing.code, pairing.salt)
        const expected = pairingProof(pairKey, pairing.sessionId, pairing.challenge)
        if (!secureEqual(expected, body.proof)) throw new Error('proof mismatch')
      } catch {
        attempt.count += 1
        attempt.lastAttemptAt = Date.now()
        if (attempt.count >= MAX_PAIR_ATTEMPTS) {
          attempt.count = 0
          attempt.lockedUntil = Date.now() + LOCKOUT_MS
        }
        attempts.set(address, attempt)
        throw new HttpError(401, '匹配码不正确')
      }
      attempts.delete(address)
      const token = randomId(32)
      const pairedDeviceId = typeof body.deviceId === 'string' && body.deviceId.length >= 12 ? body.deviceId.slice(0, 100) : randomId(16)
      for (const [existingToken, existingSession] of sessions) {
        if (existingSession.deviceId === pairedDeviceId) revokeSession(existingToken, existingSession, 4000, 'Device paired again')
      }
      if (sessions.size >= MAX_SESSIONS) throw new HttpError(503, '已配对设备过多，请先移除旧设备')
      const session = {
        token,
        key: Buffer.from(randomId(32), 'base64url'),
        deviceId: pairedDeviceId,
        deviceName: cleanDeviceName(body.deviceName || '移动设备'),
        platform: cleanDeviceName(body.platform || 'browser'),
        pairedAt: new Date().toISOString(),
        lastSeenAt: new Date().toISOString(),
        expiresAt: Date.now() + SESSION_TTL_MS,
        permissions: { text: true, files: true, clipboard: true, autoDownload: false },
        socket: null,
        activeTransfers: new Set(),
      }
      sessions.set(token, session)
      await registerDevice(session)
      pairing = createPairingState(pairing.code)
      sendJson(response, 200, {
        package: encryptJson(pairKey, {
          token,
          sessionKey: session.key.toString('base64url'),
          deviceId: session.deviceId,
          serverDeviceId: deviceId,
          expiresAt: new Date(session.expiresAt).toISOString(),
        }, `pair:${body.sessionId}`),
      })
      return
    }

    if (request.method === 'GET' && pathname === '/api/messages') {
      const auth = requireSession(request)
      const messages = (await repository.listMessages()).map(messageView)
      sendJson(response, 200, { data: encryptJson(auth.session.key, messages, `messages:${auth.session.deviceId}`) })
      return
    }

    if (request.method === 'POST' && pathname === '/api/transfers') {
      const auth = requireSession(request)
      if (!auth.session.permissions.files) throw new HttpError(403, '该设备没有文件发送权限')
      if (transfers.size >= MAX_ACTIVE_TRANSFERS || auth.session.activeTransfers.size >= MAX_ACTIVE_TRANSFERS_PER_SESSION) {
        throw new HttpError(429, '进行中的文件传输过多，请等待现有任务完成')
      }
      const body = await readJson(request)
      let metadata
      try {
        metadata = decryptJson(auth.session.key, body.data, `transfer:new:${auth.session.deviceId}`)
      } catch {
        throw new HttpError(400, '无法验证传输信息')
      }
      const size = Number(metadata.size)
      if (!Number.isSafeInteger(size) || size < 0 || size > maxIncomingFileBytes) throw new HttpError(413, '文件大小超出接收限制')
      const id = randomId(18)
      const transfer = {
        id,
        session: auth.session,
        name: safeFilename(metadata.name),
        mime: String(metadata.mime || 'application/octet-stream').slice(0, 120),
        size,
        received: 0,
        expectedIndex: 0,
        path: repository.newTransferPath(id),
        text: typeof metadata.text === 'string' ? metadata.text.slice(0, 2000) : '',
        createdAt: Date.now(),
        lastActivityAt: Date.now(),
        busy: false,
        hash: crypto.createHash('sha256'),
      }
      await fs.promises.writeFile(transfer.path, Buffer.alloc(0), { flag: 'wx' })
      transfers.set(id, transfer)
      auth.session.activeTransfers.add(id)
      sendJson(response, 200, { data: encryptJson(auth.session.key, { id, chunkSize: CHUNK_SIZE, nextIndex: 0 }, `transfer:created:${auth.session.deviceId}`) })
      return
    }

    let match = /^\/api\/transfers\/([A-Za-z0-9_-]+)\/(\d+)$/.exec(pathname)
    if (request.method === 'PUT' && match) {
      const auth = requireSession(request)
      const transfer = transfers.get(match[1])
      const index = Number(match[2])
      if (!transfer || transfer.session !== auth.session) throw new HttpError(404, '传输任务不存在')
      if (transfer.busy) throw new HttpError(409, '传输任务正在处理上一分块', { nextIndex: transfer.expectedIndex })
      if (index !== transfer.expectedIndex) throw new HttpError(409, '分块顺序错误', { nextIndex: transfer.expectedIndex })
      transfer.busy = true
      try {
        const envelope = await readBody(request, CHUNK_SIZE + 64 * 1024)
        let plain
        try {
          plain = decryptBytes(auth.session.key, envelope, `transfer:${transfer.id}:${index}`)
        } catch {
          throw new HttpError(400, '文件分块校验失败')
        }
        if (plain.length > CHUNK_SIZE || transfer.received + plain.length > transfer.size) throw new HttpError(413, '文件分块超出限制')
        if (plain.length === 0 && transfer.received < transfer.size) throw new HttpError(400, '文件分块不能为空')
        const descriptor = await fs.promises.open(transfer.path, 'r+')
        try {
          await descriptor.write(plain, 0, plain.length, transfer.received)
        } finally {
          await descriptor.close()
        }
        transfer.hash.update(plain)
        transfer.received += plain.length
        transfer.expectedIndex += 1
        transfer.lastActivityAt = Date.now()
        try { onEvent('transfer:progress', { id: transfer.id, name: transfer.name, received: transfer.received, size: transfer.size }) } catch {}
        sendJson(response, 200, { nextIndex: transfer.expectedIndex, received: transfer.received })
      } finally {
        transfer.busy = false
      }
      return
    }

    match = /^\/api\/transfers\/([A-Za-z0-9_-]+)\/complete$/.exec(pathname)
    if (request.method === 'POST' && match) {
      const auth = requireSession(request)
      await readJson(request)
      const transfer = transfers.get(match[1])
      if (!transfer || transfer.session !== auth.session) throw new HttpError(404, '传输任务不存在')
      if (transfer.busy) throw new HttpError(409, '传输任务仍在写入')
      if (transfer.received !== transfer.size) throw new HttpError(409, '文件尚未传输完成', { received: transfer.received })
      transfer.busy = true
      const digest = transfer.digest || (transfer.digest = transfer.hash.digest('hex'))
      const destination = repository.newAttachmentPath(transfer.name)
      let committed = false
      try {
        await fs.promises.rename(transfer.path, destination)
        const now = new Date().toISOString()
        const attachment = {
          id: randomId(18),
          name: transfer.name,
          size: transfer.size,
          mime: transfer.mime,
          path: destination,
          sha256: digest,
          chunkSize: CHUNK_SIZE,
          chunks: Math.ceil(transfer.size / CHUNK_SIZE),
        }
        const message = {
          id: randomId(18),
          senderId: auth.session.deviceId,
          senderName: auth.session.deviceName,
          direction: 'incoming',
          kind: transfer.mime.startsWith('image/') ? 'image' : 'file',
          text: transfer.text,
          attachments: [attachment],
          createdAt: now,
          updatedAt: now,
          status: 'received',
        }
        await publishMessage(message, auth.session.deviceId)
        committed = true
        transfers.delete(transfer.id)
        auth.session.activeTransfers.delete(transfer.id)
        sendToSession(auth.session, 'message:new', messageView(message))
        sendJson(response, 200, { data: encryptJson(auth.session.key, messageView(message), `transfer:complete:${auth.session.deviceId}`) })
      } catch (error) {
        if (!committed) {
          try { await fs.promises.rename(destination, transfer.path) } catch {}
          transfer.busy = false
          transfer.lastActivityAt = Date.now()
        }
        throw error
      }
      return
    }

    match = /^\/api\/attachments\/([A-Za-z0-9_-]+)\/meta$/.exec(pathname)
    if (request.method === 'GET' && match) {
      const auth = requireSession(request)
      const attachment = await findAttachment(match[1])
      if (!attachment?.path) throw new HttpError(404, '附件不存在或尚未同步到本机')
      try { await fs.promises.access(attachment.path, fs.constants.R_OK) } catch { throw new HttpError(404, '附件不存在或尚未同步到本机') }
      const { path: _path, ...metadata } = attachment
      metadata.chunkSize = CHUNK_SIZE
      metadata.chunks = Math.ceil(metadata.size / CHUNK_SIZE)
      sendJson(response, 200, { data: encryptJson(auth.session.key, metadata, `attachment:meta:${auth.session.deviceId}`) })
      return
    }

    match = /^\/api\/attachments\/([A-Za-z0-9_-]+)\/chunks\/(\d+)$/.exec(pathname)
    if (request.method === 'GET' && match) {
      const auth = requireSession(request)
      const attachment = await findAttachment(match[1])
      const index = Number(match[2])
      if (!attachment?.path || !Number.isSafeInteger(index) || index < 0) throw new HttpError(404, '附件分块不存在')
      const descriptor = await fs.promises.open(attachment.path, 'r').catch(() => null)
      if (!descriptor) throw new HttpError(404, '附件分块不存在')
      try {
        const buffer = Buffer.allocUnsafe(CHUNK_SIZE)
        const { bytesRead } = await descriptor.read(buffer, 0, CHUNK_SIZE, index * CHUNK_SIZE)
        if (bytesRead === 0 && attachment.size > 0) throw new HttpError(416, '附件分块越界')
        const envelope = encryptBytes(auth.session.key, buffer.subarray(0, bytesRead), `attachment:${attachment.id}:${index}`)
        response.writeHead(200, {
          'Content-Type': 'application/octet-stream',
          'Content-Length': envelope.length,
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
        })
        response.end(envelope)
      } finally {
        await descriptor.close()
      }
      return
    }

    throw new HttpError(404, '请求的资源不存在')
  }

  const server = http.createServer((request, response) => {
    route(request, response).catch((error) => {
      if (response.headersSent) {
        response.destroy()
        return
      }
      const statusCode = error instanceof HttpError ? error.status : 500
      const message = error instanceof HttpError ? error.message : '服务处理请求时发生错误'
      sendJson(response, statusCode, { error: message, ...(error.extra || {}) })
    })
  })
  server.requestTimeout = 5 * 60 * 1000
  server.headersTimeout = 30 * 1000
  server.keepAliveTimeout = 5 * 1000
  server.maxHeadersCount = 64
  server.maxConnections = 64

  const wss = new WebSocketServer({ noServer: true, maxPayload: 512 * 1024 })
  server.on('upgrade', (request, socket, head) => {
    try {
      if (!isPrivateAddress(request.socket.remoteAddress || '')) return socket.destroy()
      const url = new URL(request.url, 'http://device-link.local')
      if (url.pathname !== '/ws') return socket.destroy()
      const session = sessions.get(url.searchParams.get('token') || '')
      if (!session || session.expiresAt < Date.now()) return socket.destroy()
      wss.handleUpgrade(request, socket, head, (client) => wss.emit('connection', client, session))
    } catch {
      socket.destroy()
    }
  })

  wss.on('connection', async (socket, session) => {
    session.socket?.close(4000, 'Replaced by a newer connection')
    session.socket = socket
    session.lastSeenAt = new Date().toISOString()
    try {
      await registerDevice(session)
      sendToSession(session, 'session:ready', { deviceId, deviceName, expiresAt: new Date(session.expiresAt).toISOString() })
      sendToSession(session, 'messages:sync', (await repository.listMessages()).map(messageView))
    } catch {
      socket.close(1011, 'Unable to initialize session')
    }

    socket.on('message', async (raw) => {
      try {
        const outer = JSON.parse(raw.toString())
        const message = decryptJson(session.key, outer.data, `ws:${session.deviceId}`)
        if (message.type === 'send:text' && session.permissions.text) {
          const text = cleanText(message.data?.text)
          const now = new Date().toISOString()
          const record = {
            id: randomId(18),
            senderId: session.deviceId,
            senderName: session.deviceName,
            direction: 'incoming',
            kind: detectKind(text),
            text,
            attachments: [],
            createdAt: now,
            updatedAt: now,
            status: 'received',
          }
          await publishMessage(record, session.deviceId)
          sendToSession(session, 'message:new', messageView(record))
        }
      } catch {
        socket.close(4003, 'Invalid encrypted message')
      }
    })

    socket.on('close', async () => {
      if (session.socket === socket) session.socket = null
      const stored = (await repository.listDevices()).find((item) => item.id === session.deviceId)
      if (stored) {
        try { onEvent('device:changed', { ...stored, connected: false }) } catch {}
      }
    })
  })

  const cleanupTimer = setInterval(() => {
    const now = Date.now()
    for (const [token, session] of sessions) {
      if (session.expiresAt < now) revokeSession(token, session, 4001, 'Session expired')
    }
    for (const [address, attempt] of attempts) {
      if (attempt.lockedUntil < now && attempt.lastAttemptAt + LOCKOUT_MS < now) attempts.delete(address)
    }
    for (const transfer of transfers.values()) {
      if (!transfer.busy && transfer.lastActivityAt + transferTtlMs < now) void removeTransfer(transfer)
    }
    void cleanupOrphanTransferFiles(now)
  }, Math.min(60 * 1000, Math.max(1000, transferTtlMs)))
  cleanupTimer.unref()
  await cleanupOrphanTransferFiles()

  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '0.0.0.0', () => {
      server.off('error', reject)
      resolve()
    })
  })
  const lanIPs = getLanIPs()
  const selectedIP = lanIPs[0] || '127.0.0.1'
  const accessUrl = `http://${selectedIP}:${port}`
  status = { running: true, port, lanIPs, selectedIP, accessUrl }

  return {
    get status() {
      return { ...status }
    },
    get pairing() {
      return { ...pairing }
    },
    regeneratePairing(nextCode = pairing.code) {
      pairing = createPairingState(nextCode)
      return { ...pairing }
    },
    updatePairingCode(nextCode) {
      pairing = createPairingState(nextCode)
    },
    publishMessage,
    connectedDevices() {
      return [...sessions.values()].filter((session) => session.socket).map((session) => session.deviceId)
    },
    disconnectDevice(id) {
      for (const [token, session] of sessions) {
        if (session.deviceId === id) revokeSession(token, session)
      }
    },
    async close() {
      if (closing) return
      closing = true
      clearInterval(cleanupTimer)
      await Promise.all([...transfers.values()].map(removeTransfer))
      for (const session of sessions.values()) session.socket?.close(1001, 'Server stopped')
      sessions.clear()
      await new Promise((resolve) => wss.close(() => resolve()))
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
      status = { running: false, port, lanIPs: [], selectedIP: '', accessUrl: '' }
    },
  }
}

module.exports = {
  CHUNK_SIZE,
  MAX_ACTIVE_TRANSFERS,
  MAX_ACTIVE_TRANSFERS_PER_SESSION,
  TRANSFER_TTL_MS,
  createDeviceLinkServer,
  getLanIPs,
  messageView,
}
