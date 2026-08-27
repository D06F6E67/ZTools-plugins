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
  const mobileApp = fs.readFileSync(path.join(root, 'public', 'web', 'app.js'), 'utf8')

  assert.match(preload, /\?pairing=\$\{encodeURIComponent\(pairing\.sessionId\)\}#pair=/)
  assert.match(preload, /onPairingExpired/)
  assert.match(mobile, /<script src="\/app\.js"><\/script>/)
  assert.match(mobileApp, /async function loadPairing\(\)/)
  assert.match(mobileApp, /await loadPairing\(\)/)
  assert.match(mobileApp, /window\.addEventListener\(["']hashchange["'],\s*refreshPairing\)/)
  assert.match(mobileApp, /requestedSessionId\s*!==\s*latestPairing\.sessionId/)
  assert.match(mobileApp, /mode\s*=\s*["']manual["']/)
  assert.match(mobileApp, /deviceLinkTrustedDevice/)
  assert.match(mobileApp, /\/api\/resume\/challenge/)
  assert.match(preload, /protectCredential:\s*seal/)
})
