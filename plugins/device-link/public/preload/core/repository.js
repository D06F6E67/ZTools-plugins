'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { randomId } = require('./crypto')

const MESSAGE_PREFIX = 'device-link:message:'
const DEVICE_PREFIX = 'device-link:device:'
const TOMBSTONE_PREFIX = 'device-link:tombstone:'
const SETTINGS_ID = 'device-link:settings'
const SYNC_ID = 'device-link:webdav'

function createRepository(db, dataDir) {
  const attachmentsDir = path.join(dataDir, 'attachments')
  const transfersDir = path.join(dataDir, 'transfers')
  fs.mkdirSync(attachmentsDir, { recursive: true })
  fs.mkdirSync(transfersDir, { recursive: true })

  async function allDocs(prefix) {
    if (typeof db.allDocs === 'function') {
      const result = await db.allDocs(prefix)
      return Array.isArray(result) ? result : result?.rows?.map((row) => row.doc).filter(Boolean) || []
    }
    return []
  }

  return {
    attachmentsDir,
    transfersDir,
    async get(id) {
      try {
        return await db.get(id)
      } catch {
        return null
      }
    },
    async put(doc) {
      const current = await this.get(doc._id)
      return db.put(current?._rev ? { ...doc, _rev: current._rev } : doc)
    },
    async remove(id) {
      const current = await this.get(id)
      if (!current) return false
      await db.remove(current)
      return true
    },
    async listMessages(limit = 1000) {
      const docs = await allDocs(MESSAGE_PREFIX)
      return docs
        .filter((doc) => doc && doc.type === 'device-link-message')
        .map(({ _id, _rev, type, ...message }) => message)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        .slice(-limit)
    },
    async putMessage(message) {
      await this.put({ _id: `${MESSAGE_PREFIX}${message.id}`, type: 'device-link-message', ...message })
      return message
    },
    async removeMessage(id, options = {}) {
      if (options.removeOwnedAttachments) {
        const current = await this.get(`${MESSAGE_PREFIX}${id}`)
        for (const attachment of current?.attachments || []) {
          if (!attachment.path) continue
          const relative = path.relative(attachmentsDir, path.resolve(attachment.path))
          if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) {
            try { await fs.promises.rm(attachment.path, { force: true }) } catch {}
          }
        }
      }
      return this.remove(`${MESSAGE_PREFIX}${id}`)
    },
    async listTombstones() {
      const docs = await allDocs(TOMBSTONE_PREFIX)
      return docs
        .filter((doc) => doc && doc.type === 'device-link-tombstone')
        .map(({ _id, _rev, type, ...tombstone }) => tombstone)
    },
    async putTombstone(tombstone) {
      await this.put({ _id: `${TOMBSTONE_PREFIX}${tombstone.id}`, type: 'device-link-tombstone', ...tombstone })
      return tombstone
    },
    async removeTombstone(id) {
      return this.remove(`${TOMBSTONE_PREFIX}${id}`)
    },
    async listDevices() {
      const docs = await allDocs(DEVICE_PREFIX)
      return docs
        .filter((doc) => doc && doc.type === 'device-link-device')
        .map(({ _id, _rev, type, ...device }) => ({ ...device, connected: false }))
        .sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt))
    },
    async putDevice(device) {
      await this.put({ _id: `${DEVICE_PREFIX}${device.id}`, type: 'device-link-device', ...device })
      return device
    },
    async removeDevice(id) {
      return this.remove(`${DEVICE_PREFIX}${id}`)
    },
    async getSettings() {
      return (await this.get(SETTINGS_ID)) || null
    },
    async putSettings(settings) {
      await this.put({ _id: SETTINGS_ID, type: 'device-link-settings', ...settings })
      return settings
    },
    async getSyncSettings() {
      return (await this.get(SYNC_ID)) || null
    },
    async putSyncSettings(settings) {
      await this.put({ _id: SYNC_ID, type: 'device-link-webdav', ...settings })
      return settings
    },
    newAttachmentPath(name) {
      return path.join(attachmentsDir, `${randomId(12)}-${name}`)
    },
    newTransferPath(id) {
      return path.join(transfersDir, `${id}.part`)
    },
  }
}

module.exports = { createRepository }
