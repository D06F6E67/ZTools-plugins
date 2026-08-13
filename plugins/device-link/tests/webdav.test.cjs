'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { applyTombstones, mergeMessages, mergeTombstones } = require('../public/preload/core/webdav')

test('WebDAV merge is deterministic and keeps the newest update', () => {
  const left = [{ id: 'a', text: 'old', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }]
  const right = [
    { id: 'b', text: 'second', createdAt: '2026-01-02T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z' },
    { id: 'a', text: 'new', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-03T00:00:00.000Z' },
  ]
  assert.deepEqual(mergeMessages(left, right).map((item) => [item.id, item.text]), [['a', 'new'], ['b', 'second']])
})

test('WebDAV tombstones are merged by deletion time and prevent resurrection', () => {
  const messages = [{ id: 'deleted', text: 'stale offline copy', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }]
  const tombstones = mergeTombstones(
    [{ id: 'deleted', deletedAt: '2026-01-02T00:00:00.000Z', sourceDeviceId: 'a' }],
    [{ id: 'deleted', deletedAt: '2026-01-03T00:00:00.000Z', sourceDeviceId: 'b' }],
  )
  assert.equal(tombstones.length, 1)
  assert.equal(tombstones[0].sourceDeviceId, 'b')
  assert.deepEqual(applyTombstones(messages, tombstones), [])
})
