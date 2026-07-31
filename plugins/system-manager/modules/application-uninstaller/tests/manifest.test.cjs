'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const root = path.resolve(__dirname, '..')
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'public', 'plugin.json'), 'utf8'))

test('manifest has stable identity, entries and three-platform feature', () => {
  assert.equal(manifest.name, 'application-uninstaller')
  assert.equal(manifest.main, 'index.html')
  assert.equal(manifest.preload, 'preload/services.cjs')
  assert.equal(manifest.logo, 'logo.svg')
  assert.deepEqual(manifest.features[0].platform, ['darwin', 'win32', 'linux'])
  assert.deepEqual(manifest.features[0].cmds, ['应用卸载', '彻底卸载', '软件卸载', '卸载助手'])
  for (const file of [manifest.main, manifest.preload, manifest.logo]) {
    const source = file === manifest.main ? path.join(root, file) : path.join(root, 'public', file)
    assert.equal(fs.existsSync(source), true)
  }
})

test('preload exposes only the opaque uninstall bridge', () => {
  const source = fs.readFileSync(path.join(root, 'public', 'preload', 'services.cjs'), 'utf8')
  const match = source.match(/window\.applicationUninstaller\s*=\s*Object\.freeze\(\{([\s\S]*?)\}\)/)
  assert.ok(match)
  const methods = [...match[1].matchAll(/^\s+(\w+):/gm)].map((item) => item[1])
  assert.deepEqual(methods, ['scanApps', 'inspectApp', 'executePlan', 'revealPath'])
  assert.doesNotMatch(match[1], /\b(?:fs|exec|spawn|path)\b/)
})

test('manifest version matches package version', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
  assert.equal(manifest.version, pkg.version)
})
