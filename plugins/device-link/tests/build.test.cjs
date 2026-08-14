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

test('pairing links and mobile client refresh the pairing generation', () => {
  const preload = fs.readFileSync(path.join(root, 'public', 'preload', 'services.js'), 'utf8')
  const mobile = fs.readFileSync(path.join(root, 'public', 'web', 'index.html'), 'utf8')

  assert.match(preload, /\?pairing=\$\{encodeURIComponent\(pairing\.sessionId\)\}#pair=/)
  assert.match(mobile, /async function loadPairing\(\)/)
  assert.match(mobile, /await loadPairing\(\)/)
  assert.match(mobile, /window\.addEventListener\('hashchange',refreshPairing\)/)
  assert.match(mobile, /requestedSessionId!==latestPairing\.sessionId/)
})
