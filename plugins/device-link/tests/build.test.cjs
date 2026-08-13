'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const root = path.resolve(__dirname, '..')

test('installable manifest always opens the bundled UI', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'dist', 'plugin.json'), 'utf8'))

  assert.equal(manifest.main, 'index.html')
  assert.equal(manifest.development, undefined)
  assert.equal(fs.existsSync(path.join(root, 'dist', manifest.main)), true)
})
