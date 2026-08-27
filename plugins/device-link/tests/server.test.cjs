'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const net = require('node:net')
const os = require('node:os')
const path = require('node:path')
const { WebSocket } = require('ws')
const { CHUNK_SIZE, createDeviceLinkServer } = require('../public/preload/core/server')
const { decryptJson, derivePairKey, encryptBytes, encryptJson, pairingProof, resumeProof, sha256 } = require('../public/preload/core/crypto')

async function freePort() {
  const socket = net.createServer()
  await new Promise((resolve) => socket.listen(0, '127.0.0.1', resolve))
  const port = socket.address().port
  await new Promise((resolve) => socket.close(resolve))
  return port
}

function memoryRepository(root) {
  const messages = []
  const devices = []
  return {
    messages,
    devices,
    newTransferPath(id) { return path.join(root, `${id}.part`) },
    newAttachmentPath(name) { return path.join(root, `${Date.now()}-${name}`) },
    async putMessage(message) { const index = messages.findIndex((item) => item.id === message.id); index >= 0 ? messages.splice(index, 1, message) : messages.push(message); return message },
    async listMessages(limit = 1000, options = {}) {
      const filtered = messages.filter((message) => typeof options.filter !== 'function' || options.filter(message))
      if (typeof options.groupBy !== 'function') return filtered.slice(-limit)
      const groups = new Map()
      for (const message of filtered) {
        const key = String(options.groupBy(message))
        groups.set(key, [...(groups.get(key) || []), message])
      }
      return [...groups.values()].flatMap((group) => group.slice(-limit)).sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    },
    async putDevice(device) { const index = devices.findIndex((item) => item.id === device.id); index >= 0 ? devices.splice(index, 1, device) : devices.push(device); return device },
    async listDevices() { return [...devices] },
  }
}

async function pairTestDevice(server, base, code, deviceId, deviceName, mode = 'qr') {
  const state = await (await fetch(`${base}/api/pairing`)).json()
  const pairingSecret = mode === 'manual' ? state.manualKey : server.pairing.secret
  const pairKey = derivePairKey(pairingSecret, code, state.salt)
  const proof = pairingProof(pairKey, state.sessionId, state.challenge)
  const response = await fetch(`${base}/api/pair`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId: state.sessionId, mode, proof, deviceName, deviceId, platform: 'test' }),
  })
  assert.equal(response.status, 200)
  const body = await response.json()
  const session = decryptJson(pairKey, body.package, `pair:${state.sessionId}`)
  return { ...session, key: Buffer.from(session.sessionKey, 'base64url') }
}

async function openTestSocket(port, session) {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${encodeURIComponent(session.token)}`)
  const received = []
  socket.on('message', (raw) => {
    const outer = JSON.parse(raw.toString())
    received.push(decryptJson(session.key, outer.data, `ws:${session.deviceId}`))
  })
  await new Promise((resolve, reject) => {
    socket.once('open', resolve)
    socket.once('error', reject)
  })
  return { socket, received }
}

async function waitForMessage(received, predicate, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const found = received.find(predicate)
    if (found) return found
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error('message timeout')
}

test('server accepts browser-style numeric timer handles', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'device-link-timer-test-'))
  const repository = memoryRepository(root)
  const port = await freePort()
  const nativeSetInterval = global.setInterval
  const nativeClearInterval = global.clearInterval
  const nativeSetTimeout = global.setTimeout
  const nativeClearTimeout = global.clearTimeout
  const handles = new Map()
  const timeoutHandles = new Map()
  let nextHandle = 1
  let server

  global.setInterval = (...args) => {
    const handle = nextHandle++
    handles.set(handle, nativeSetInterval(...args))
    return handle
  }
  global.clearInterval = (handle) => {
    const nativeHandle = handles.get(handle)
    handles.delete(handle)
    return nativeClearInterval(nativeHandle ?? handle)
  }
  global.setTimeout = (...args) => {
    const handle = nextHandle++
    timeoutHandles.set(handle, nativeSetTimeout(...args))
    return handle
  }
  global.clearTimeout = (handle) => {
    const nativeHandle = timeoutHandles.get(handle)
    timeoutHandles.delete(handle)
    return nativeClearTimeout(nativeHandle ?? handle)
  }

  try {
    server = await createDeviceLinkServer({
      repository,
      deviceId: 'desktop-device',
      deviceName: 'Test Desktop',
      port,
      pairingCode: '834921',
      maxIncomingFileBytes: 10 * 1024 * 1024,
      onEvent() {},
    })
    assert.equal(server.status.running, true)
    await server.close()
    server = null
    assert.equal(handles.size, 0)
    assert.equal(timeoutHandles.size, 0)
  } finally {
    if (server) await server.close()
    for (const handle of handles.values()) nativeClearInterval(handle)
    for (const handle of timeoutHandles.values()) nativeClearTimeout(handle)
    global.setInterval = nativeSetInterval
    global.clearInterval = nativeClearInterval
    global.setTimeout = nativeSetTimeout
    global.clearTimeout = nativeClearTimeout
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('expired pairing state rotates automatically and refreshes the desktop QR', async (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'device-link-pairing-expiry-test-'))
  const repository = memoryRepository(root)
  const port = await freePort()
  let pairingChangeCount = 0
  let pairingExpiryCount = 0
  const server = await createDeviceLinkServer({
    repository,
    deviceId: 'desktop-device',
    deviceName: 'Test Desktop',
    port,
    pairingCode: '834921',
    pairingTtlMs: 40,
    maxIncomingFileBytes: 10 * 1024 * 1024,
    onEvent() {},
    async onPairingExpired() {
      pairingExpiryCount += 1
      return '679776'
    },
    onPairingChanged() { pairingChangeCount += 1 },
  })
  context.after(async () => {
    await server.close()
    fs.rmSync(root, { recursive: true, force: true })
  })

  const initial = server.pairing
  const deadline = Date.now() + 2000
  while (server.pairing.sessionId === initial.sessionId && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10))
  }

  assert.notEqual(server.pairing.sessionId, initial.sessionId)
  assert.equal(server.pairing.code, '679776')
  assert.equal(pairingExpiryCount, 1)
  assert.equal(pairingChangeCount, 1)
  const latest = await (await fetch(`http://127.0.0.1:${port}/api/pairing`)).json()
  assert.equal(latest.sessionId, server.pairing.sessionId)
})

test('pairing endpoint lazily rotates expired state after sleep', async (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'device-link-pairing-wake-test-'))
  const repository = memoryRepository(root)
  const port = await freePort()
  const nativeDateNow = Date.now
  let nowOffset = 0
  Date.now = () => nativeDateNow() + nowOffset
  const server = await createDeviceLinkServer({
    repository,
    deviceId: 'desktop-device',
    deviceName: 'Test Desktop',
    port,
    pairingCode: '834921',
    pairingTtlMs: 60 * 1000,
    maxIncomingFileBytes: 10 * 1024 * 1024,
    onEvent() {},
    async onPairingExpired() { return '679776' },
  })
  context.after(async () => {
    Date.now = nativeDateNow
    await server.close()
    fs.rmSync(root, { recursive: true, force: true })
  })

  const initial = server.pairing
  nowOffset = 61 * 1000
  const latest = await (await fetch(`http://127.0.0.1:${port}/api/pairing`)).json()

  assert.notEqual(latest.sessionId, initial.sessionId)
  assert.equal(server.pairing.code, '679776')
})

test('pairing establishes an encrypted session and supports text plus chunked files', async (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'device-link-test-'))
  const repository = memoryRepository(root)
  const port = await freePort()
  const events = []
  let pairingChangeCount = 0
  const server = await createDeviceLinkServer({
    repository,
    deviceId: 'desktop-device',
    deviceName: 'Test Desktop',
    port,
    pairingCode: '834921',
    maxIncomingFileBytes: 10 * 1024 * 1024,
    transferTtlMs: 50,
    onEvent(type, data) { events.push({ type, data }) },
    onPairingChanged() { pairingChangeCount += 1 },
  })
  context.after(async () => {
    await server.close()
    fs.rmSync(root, { recursive: true, force: true })
  })

  const base = `http://127.0.0.1:${port}`
  const pairingResponse = await fetch(`${base}/api/pairing`)
  assert.equal(pairingResponse.headers.get('cache-control'), 'no-store')
  const pageResponse = await fetch(base)
  assert.match(pageResponse.headers.get('content-security-policy'), /script-src 'self'/)
  assert.equal(pageResponse.headers.get('x-frame-options'), 'DENY')
  const fallbackCrypto = await fetch(`${base}/crypto-fallback.js`)
  assert.equal(fallbackCrypto.status, 200)
  assert.match(await fallbackCrypto.text(), /deviceLinkCryptoFallback/)
  const mobileApp = await fetch(`${base}/app.js`)
  assert.equal(mobileApp.status, 200)
  assert.equal(mobileApp.headers.get('cache-control'), 'no-store')
  assert.match(await mobileApp.text(), /currentConversationId/)
  const state = await pairingResponse.json()
  const pairKey = derivePairKey(server.pairing.secret, '834921', state.salt)
  const proof = pairingProof(pairKey, state.sessionId, state.challenge)
  const pairResponse = await fetch(`${base}/api/pair`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId: state.sessionId, proof, deviceName: 'Test Phone', deviceId: 'phone-device-1234', platform: 'test' }),
  })
  assert.equal(pairResponse.status, 200)
  const pairBody = await pairResponse.json()
  const session = decryptJson(pairKey, pairBody.package, `pair:${state.sessionId}`)
  const sessionKey = Buffer.from(session.sessionKey, 'base64url')
  assert.equal(repository.devices[0].name, 'Test Phone')
  assert.equal(pairingChangeCount, 1)
  assert.notEqual(server.pairing.sessionId, state.sessionId)

  const historyResponse = await fetch(`${base}/api/messages`, { headers: { Authorization: `Bearer ${session.token}` } })
  const history = await historyResponse.json()
  assert.deepEqual(decryptJson(sessionKey, history.data, `messages:${session.deviceId}`), [])

  const socket = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${encodeURIComponent(session.token)}`)
  const received = []
  socket.on('message', (raw) => {
    const outer = JSON.parse(raw.toString())
    received.push(decryptJson(sessionKey, outer.data, `ws:${session.deviceId}`))
  })
  await new Promise((resolve, reject) => {
    socket.once('open', resolve)
    socket.once('error', reject)
  })
  socket.send(JSON.stringify({ data: encryptJson(sessionKey, { type: 'send:text', data: { text: 'hello from phone' } }, `ws:${session.deviceId}`) }))
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('message timeout')), 3000)
    const check = () => {
      if (received.some((item) => item.type === 'message:new')) { clearTimeout(timeout); resolve() }
      else setTimeout(check, 10)
    }
    check()
  })
  assert.equal(repository.messages[0].text, 'hello from phone')

  const content = Buffer.alloc(CHUNK_SIZE * 2 + 37, 0x5a)
  const transferResponse = await fetch(`${base}/api/transfers`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${session.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: encryptJson(sessionKey, { name: '../safe.txt', size: content.length, mime: 'text/plain' }, `transfer:new:${session.deviceId}`) }),
  })
  assert.equal(transferResponse.status, 200)
  const transferBody = await transferResponse.json()
  const transfer = decryptJson(sessionKey, transferBody.data, `transfer:created:${session.deviceId}`)
  for (let index = 0, offset = 0; offset < content.length; index += 1, offset += CHUNK_SIZE) {
    const chunk = content.subarray(offset, offset + CHUNK_SIZE)
    const chunkResponse = await fetch(`${base}/api/transfers/${transfer.id}/${index}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${session.token}`, 'Content-Type': 'application/octet-stream' },
      body: encryptBytes(sessionKey, chunk, `transfer:${transfer.id}:${index}`),
    })
    assert.equal(chunkResponse.status, 200)
  }
  const complete = await fetch(`${base}/api/transfers/${transfer.id}/complete`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${session.token}`, 'Content-Type': 'application/json' },
    body: '{}',
  })
  assert.equal(complete.status, 200)
  assert.equal(repository.messages[1].attachments[0].name, 'safe.txt')
  assert.equal(repository.messages[1].attachments[0].sha256, sha256(content))
  assert.deepEqual(fs.readFileSync(repository.messages[1].attachments[0].path), content)
  assert.equal(events.some((event) => event.type === 'transfer:progress'), true)

  const abandoned = []
  for (let index = 0; index < 4; index += 1) {
    const response = await fetch(`${base}/api/transfers`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: encryptJson(sessionKey, { name: `pending-${index}.bin`, size: 1 }, `transfer:new:${session.deviceId}`) }),
    })
    assert.equal(response.status, 200)
    const task = decryptJson(sessionKey, (await response.json()).data, `transfer:created:${session.deviceId}`)
    abandoned.push(repository.newTransferPath(task.id))
  }
  const limited = await fetch(`${base}/api/transfers`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${session.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: encryptJson(sessionKey, { name: 'too-many.bin', size: 1 }, `transfer:new:${session.deviceId}`) }),
  })
  assert.equal(limited.status, 429)
  const cleanupDeadline = Date.now() + 2500
  while (abandoned.some((filePath) => fs.existsSync(filePath)) && Date.now() < cleanupDeadline) {
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  assert.equal(abandoned.some((filePath) => fs.existsSync(filePath)), false)
  socket.close()
})

test('two phones pair independently and only shared conversations cross device boundaries', async (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'device-link-multi-device-test-'))
  const repository = memoryRepository(root)
  const port = await freePort()
  const server = await createDeviceLinkServer({
    repository,
    deviceId: 'desktop-device',
    deviceName: 'Test Desktop',
    port,
    pairingCode: '834921',
    maxIncomingFileBytes: 10 * 1024 * 1024,
    onEvent() {},
  })
  const sockets = []
  context.after(async () => {
    for (const socket of sockets) socket.close()
    await server.close()
    fs.rmSync(root, { recursive: true, force: true })
  })

  const base = `http://127.0.0.1:${port}`
  const phoneA = await pairTestDevice(server, base, '834921', 'phone-device-aaaa', 'Phone A')
  const phoneB = await pairTestDevice(server, base, '834921', 'phone-device-bbbb', 'Phone B')
  assert.deepEqual(repository.devices.map((device) => device.id).sort(), ['phone-device-aaaa', 'phone-device-bbbb'])

  const channelA = await openTestSocket(port, phoneA)
  const channelB = await openTestSocket(port, phoneB)
  sockets.push(channelA.socket, channelB.socket)
  await Promise.all([
    waitForMessage(channelA.received, (item) => item.type === 'messages:sync'),
    waitForMessage(channelB.received, (item) => item.type === 'messages:sync'),
  ])

  const now = new Date().toISOString()
  await server.publishMessage({
    id: 'private-for-a', conversationId: 'device:phone-device-aaaa', senderId: 'desktop-device', senderName: 'Test Desktop',
    direction: 'outgoing', kind: 'text', text: 'only A', attachments: [], createdAt: now, updatedAt: now, status: 'sent',
  })
  await waitForMessage(channelA.received, (item) => item.type === 'message:new' && item.data.id === 'private-for-a')
  await new Promise((resolve) => setTimeout(resolve, 80))
  assert.equal(channelB.received.some((item) => item.type === 'message:new' && item.data.id === 'private-for-a'), false)

  await server.publishMessage({
    id: 'shared-for-all', conversationId: 'shared', senderId: 'desktop-device', senderName: 'Test Desktop',
    direction: 'outgoing', kind: 'text', text: 'for everyone', attachments: [], createdAt: now, updatedAt: now, status: 'sent',
  })
  await Promise.all([
    waitForMessage(channelA.received, (item) => item.type === 'message:new' && item.data.id === 'shared-for-all'),
    waitForMessage(channelB.received, (item) => item.type === 'message:new' && item.data.id === 'shared-for-all'),
  ])

  channelB.socket.send(JSON.stringify({ data: encryptJson(phoneB.key, {
    type: 'send:text', data: { text: 'shared from B', conversationId: 'shared' },
  }, `ws:${phoneB.deviceId}`) }))
  await Promise.all([
    waitForMessage(channelA.received, (item) => item.type === 'message:new' && item.data.text === 'shared from B'),
    waitForMessage(channelB.received, (item) => item.type === 'message:new' && item.data.text === 'shared from B'),
  ])

  channelB.socket.send(JSON.stringify({ data: encryptJson(phoneB.key, {
    type: 'send:text', data: { text: 'private from B', conversationId: 'device:phone-device-bbbb' },
  }, `ws:${phoneB.deviceId}`) }))
  await waitForMessage(channelB.received, (item) => item.type === 'message:new' && item.data.text === 'private from B')
  await new Promise((resolve) => setTimeout(resolve, 80))
  assert.equal(channelA.received.some((item) => item.type === 'message:new' && item.data.text === 'private from B'), false)

  const historyAEnvelope = await (await fetch(`${base}/api/messages`, { headers: { Authorization: `Bearer ${phoneA.token}` } })).json()
  const historyBEnvelope = await (await fetch(`${base}/api/messages`, { headers: { Authorization: `Bearer ${phoneB.token}` } })).json()
  const historyA = decryptJson(phoneA.key, historyAEnvelope.data, `messages:${phoneA.deviceId}`)
  const historyB = decryptJson(phoneB.key, historyBEnvelope.data, `messages:${phoneB.deviceId}`)
  assert.deepEqual(historyA.map((message) => message.text).sort(), ['for everyone', 'only A', 'shared from B'])
  assert.deepEqual(historyB.map((message) => message.text).sort(), ['for everyone', 'private from B', 'shared from B'])

  const privateFile = path.join(root, 'private-a.txt')
  fs.writeFileSync(privateFile, 'private attachment')
  await server.publishMessage({
    id: 'private-file-a', conversationId: 'device:phone-device-aaaa', senderId: 'desktop-device', senderName: 'Test Desktop',
    direction: 'outgoing', kind: 'file', attachments: [{ id: 'attachment-private-a', name: 'private-a.txt', size: 18, mime: 'text/plain', path: privateFile }],
    createdAt: now, updatedAt: now, status: 'sent',
  })
  for (let index = 0; index < 1001; index += 1) {
    const createdAt = new Date(Date.parse(now) + index + 1).toISOString()
    await repository.putMessage({
      id: `private-b-noise-${index}`, conversationId: 'device:phone-device-bbbb', senderId: 'phone-device-bbbb', senderName: 'Phone B',
      direction: 'incoming', kind: 'text', text: `B ${index}`, attachments: [], createdAt, updatedAt: createdAt, status: 'received',
    })
  }
  const retainedEnvelope = await (await fetch(`${base}/api/messages`, { headers: { Authorization: `Bearer ${phoneA.token}` } })).json()
  const retainedHistory = decryptJson(phoneA.key, retainedEnvelope.data, `messages:${phoneA.deviceId}`)
  assert.equal(retainedHistory.some((message) => message.id === 'private-file-a'), true)
  assert.equal(retainedHistory.some((message) => message.id.startsWith('private-b-noise-')), false)
  const attachmentForA = await fetch(`${base}/api/attachments/attachment-private-a/meta`, { headers: { Authorization: `Bearer ${phoneA.token}` } })
  const attachmentForB = await fetch(`${base}/api/attachments/attachment-private-a/meta`, { headers: { Authorization: `Bearer ${phoneB.token}` } })
  assert.equal(attachmentForA.status, 200)
  assert.equal(attachmentForB.status, 404)
})

test('manual pairing persists a trusted device that resumes after server restart', async (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'device-link-resume-test-'))
  const repository = memoryRepository(root)
  const port = await freePort()
  const protectCredential = (value) => `sealed:${[...value].reverse().join('')}`
  const unprotectCredential = (value) => String(value).startsWith('sealed:') ? [...String(value).slice(7)].reverse().join('') : ''
  const events = []
  let server
  const start = () => createDeviceLinkServer({
    repository,
    deviceId: 'desktop-device',
    deviceName: 'Test Desktop',
    port,
    pairingCode: '834921',
    maxIncomingFileBytes: 10 * 1024 * 1024,
    protectCredential,
    unprotectCredential,
    onEvent(type, data) { events.push({ type, data }) },
  })
  context.after(async () => {
    if (server?.status.running) await server.close()
    fs.rmSync(root, { recursive: true, force: true })
  })

  server = await start()
  const base = `http://127.0.0.1:${port}`
  const paired = await pairTestDevice(server, base, '834921', 'trusted-phone-1234', 'Trusted Phone', 'manual')
  assert.equal(typeof paired.resumeSecret, 'string')
  assert.equal(Buffer.from(paired.resumeSecret, 'base64url').length, 32)
  assert.match(repository.devices[0].resumeCredential, /^sealed:/)
  assert.equal(repository.devices[0].resumeCredential.includes(paired.resumeSecret), false)
  const connectedEvent = events.find((event) => event.type === 'device:changed')
  assert.equal(Object.hasOwn(connectedEvent.data, 'resumeCredential'), false)
  const originalPairedAt = repository.devices[0].pairedAt

  await server.close()
  server = await start()
  const challengeResponse = await fetch(`${base}/api/resume/challenge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceId: paired.deviceId }),
  })
  assert.equal(challengeResponse.status, 200)
  const challenge = await challengeResponse.json()
  const proof = resumeProof(paired.resumeSecret, challenge.challengeId, challenge.challenge)
  const resumeResponse = await fetch(`${base}/api/resume`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceId: paired.deviceId, challengeId: challenge.challengeId, proof }),
  })
  assert.equal(resumeResponse.status, 200)
  const resumeBody = await resumeResponse.json()
  const resumed = decryptJson(Buffer.from(paired.resumeSecret, 'base64url'), resumeBody.package, `resume:${paired.deviceId}:${challenge.challengeId}`)
  assert.equal(resumed.deviceId, paired.deviceId)
  assert.notEqual(resumed.token, paired.token)
  assert.equal(repository.devices[0].pairedAt, originalPairedAt)

  const historyResponse = await fetch(`${base}/api/messages`, { headers: { Authorization: `Bearer ${resumed.token}` } })
  assert.equal(historyResponse.status, 200)
  const historyBody = await historyResponse.json()
  assert.deepEqual(decryptJson(Buffer.from(resumed.sessionKey, 'base64url'), historyBody.data, `messages:${resumed.deviceId}`), [])

  const replayResponse = await fetch(`${base}/api/resume`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceId: paired.deviceId, challengeId: challenge.challengeId, proof }),
  })
  assert.equal(replayResponse.status, 401)

  repository.devices.splice(0)
  const removedDeviceResponse = await fetch(`${base}/api/resume/challenge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceId: paired.deviceId }),
  })
  assert.equal(removedDeviceResponse.status, 401)
})
