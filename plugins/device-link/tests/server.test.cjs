'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const net = require('node:net')
const os = require('node:os')
const path = require('node:path')
const { WebSocket } = require('ws')
const { CHUNK_SIZE, createDeviceLinkServer } = require('../public/preload/core/server')
const { decryptJson, derivePairKey, encryptBytes, encryptJson, pairingProof, sha256 } = require('../public/preload/core/crypto')

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
    async listMessages() { return [...messages] },
    async putDevice(device) { const index = devices.findIndex((item) => item.id === device.id); index >= 0 ? devices.splice(index, 1, device) : devices.push(device); return device },
    async listDevices() { return [...devices] },
  }
}

test('server accepts browser-style numeric interval handles', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'device-link-timer-test-'))
  const repository = memoryRepository(root)
  const port = await freePort()
  const nativeSetInterval = global.setInterval
  const nativeClearInterval = global.clearInterval
  const handles = new Map()
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
  } finally {
    if (server) await server.close()
    for (const handle of handles.values()) nativeClearInterval(handle)
    global.setInterval = nativeSetInterval
    global.clearInterval = nativeClearInterval
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('pairing establishes an encrypted session and supports text plus chunked files', async (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'device-link-test-'))
  const repository = memoryRepository(root)
  const port = await freePort()
  const events = []
  const server = await createDeviceLinkServer({
    repository,
    deviceId: 'desktop-device',
    deviceName: 'Test Desktop',
    port,
    pairingCode: '834921',
    maxIncomingFileBytes: 10 * 1024 * 1024,
    transferTtlMs: 50,
    onEvent(type, data) { events.push({ type, data }) },
  })
  context.after(async () => {
    await server.close()
    fs.rmSync(root, { recursive: true, force: true })
  })

  const base = `http://127.0.0.1:${port}`
  const pairingResponse = await fetch(`${base}/api/pairing`)
  assert.equal(pairingResponse.headers.get('cache-control'), 'no-store')
  const pageResponse = await fetch(base)
  assert.match(pageResponse.headers.get('content-security-policy'), /script-src 'self' 'sha256-/)
  assert.equal(pageResponse.headers.get('x-frame-options'), 'DENY')
  const fallbackCrypto = await fetch(`${base}/crypto-fallback.js`)
  assert.equal(fallbackCrypto.status, 200)
  assert.match(await fallbackCrypto.text(), /deviceLinkCryptoFallback/)
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
