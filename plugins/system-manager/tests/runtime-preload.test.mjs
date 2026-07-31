import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import test from 'node:test'
import { pathToFileURL } from 'node:url'

import { distRoot, modules, root } from '../scripts/config.mjs'

const childScript = path.join(root, 'tests', 'runtime-preload-child.cjs')
const preload = path.join(distRoot, 'preload', 'index.cjs')

function exposedBridges(pageUrl) {
  const result = spawnSync(process.execPath, [childScript, preload, pageUrl], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, NODE_OPTIONS: '' },
    timeout: 10_000,
  })
  assert.equal(result.status, 0, `child failed: ${result.stderr}`)
  return JSON.parse(result.stdout)
}

test('final dist preload exposes only suite router on the trusted dashboard', () => {
  const page = pathToFileURL(path.join(distRoot, 'index.html')).href
  assert.deepEqual(exposedBridges(page), ['systemManagerSuite'])
})

test('four trusted module pages expose the suite router and their one business bridge only', () => {
  for (const module of modules) {
    const page = pathToFileURL(path.join(distRoot, 'modules', module.id, 'index.html')).href
    assert.deepEqual(exposedBridges(page), ['systemManagerSuite', module.bridge], module.id)
  }
})

test('unknown file and HTTP pages receive zero privileged bridges', () => {
  assert.deepEqual(exposedBridges(pathToFileURL(path.join(distRoot, 'unknown.html')).href), [])
  assert.deepEqual(exposedBridges('http://127.0.0.1:5173/modules/system-cleaner/index.html'), [])
})
