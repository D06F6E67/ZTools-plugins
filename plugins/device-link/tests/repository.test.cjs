'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { createRepository } = require('../public/preload/core/repository')

test('message limits apply after access filtering and independently per conversation', async (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'device-link-repository-test-'))
  context.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const now = Date.parse('2026-08-14T00:00:00.000Z')
  const messages = [{
    _id: 'device-link:message:private-a', type: 'device-link-message', id: 'private-a', conversationId: 'device:phone-a',
    senderId: 'phone-a', createdAt: new Date(now).toISOString(), updatedAt: new Date(now).toISOString(), attachments: [],
  }]
  for (let index = 0; index < 1001; index += 1) {
    const createdAt = new Date(now + index + 1).toISOString()
    messages.push({
      _id: `device-link:message:private-b-${index}`, type: 'device-link-message', id: `private-b-${index}`, conversationId: 'device:phone-b',
      senderId: 'phone-b', createdAt, updatedAt: createdAt, attachments: [],
    })
  }
  const repository = createRepository({
    async allDocs() { return messages },
    async get() { return null },
    async put() {},
    async remove() {},
  }, root)

  const phoneA = await repository.listMessages(1000, { filter: (message) => message.conversationId === 'device:phone-a' })
  assert.deepEqual(phoneA.map((message) => message.id), ['private-a'])

  const grouped = await repository.listMessages(2, { groupBy: (message) => message.conversationId })
  assert.deepEqual(grouped.filter((message) => message.conversationId === 'device:phone-a').map((message) => message.id), ['private-a'])
  assert.deepEqual(grouped.filter((message) => message.conversationId === 'device:phone-b').map((message) => message.id), ['private-b-999', 'private-b-1000'])
})
