import assert from 'node:assert/strict'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import test from 'node:test'

import { modules } from '../scripts/config.mjs'

const require = createRequire(import.meta.url)
const { FEATURE_ROUTES, createSuiteRouter, installSuiteRouter, resolveSuitePage } = require('../public/preload/router.cjs')
const { bootstrap } = require('../public/preload/index.cjs')
const suiteRoot = path.resolve('/trusted/system-manager')

function hrefFor(relativePath) {
  return pathToFileURL(path.join(suiteRoot, ...relativePath.split('/'))).href
}

function hostAt(href) {
  const assigned = []
  const location = {
    href,
    assign(value) {
      assigned.push(value)
      this.href = value
    },
  }
  return { host: { location }, assigned }
}

test('exact root file page installs only the frozen suite router', () => {
  const { host } = hostAt(hrefFor('index.html'))
  const installed = installSuiteRouter(host, suiteRoot)
  assert.equal(installed.page.kind, 'dashboard')
  assert.equal(installed.page.featureCode, null)
  assert.equal(host.systemManagerSuite, installed.router)
  assert.equal(Object.isFrozen(installed.router), true)
  assert.deepEqual(Object.keys(installed.router), ['openFeature'])
})

test('four exact module file pages resolve to their fixed feature codes', () => {
  for (const module of modules) {
    const page = resolveSuitePage(hrefFor(`modules/${module.id}/index.html`), suiteRoot)
    assert.equal(page.kind, 'module')
    assert.equal(page.featureCode, module.id)
  }
  assert.deepEqual(Object.keys(FEATURE_ROUTES), modules.map((module) => module.id))
})

test('router navigates only by fixed code and unknown values return false without navigation', () => {
  const { host, assigned } = hostAt(hrefFor('index.html'))
  const router = createSuiteRouter(host, suiteRoot)
  assert.equal(router.openFeature('system-cleaner'), true)
  assert.deepEqual(assigned, [hrefFor('modules/system-cleaner/index.html')])
  for (const value of ['', '../outside', 'https://evil.invalid', 'constructor', '__proto__', null, 42, { code: 'startup-manager' }]) {
    const before = assigned.length
    assert.equal(router.openFeature(value), false)
    assert.equal(assigned.length, before)
  }
})

test('only documented same-page skip fragments retain the exact page bridge', () => {
  assert.equal(resolveSuitePage(`${hrefFor('index.html')}#modules`, suiteRoot).kind, 'dashboard')
  assert.equal(resolveSuitePage(`${hrefFor('modules/system-cleaner/index.html')}#main`, suiteRoot).featureCode, 'system-cleaner')
  for (const href of [
    `${hrefFor('index.html')}#main`,
    `${hrefFor('modules/system-cleaner/index.html')}#modules`,
    `${hrefFor('modules/startup-manager/index.html')}#main`,
    `${hrefFor('index.html')}#%6dodules`,
  ]) assert.equal(resolveSuitePage(href, suiteRoot), null, href)
})

test('external file, HTTP(S), query, unrecognized hash and malicious paths expose no router', () => {
  const rawRootHref = pathToFileURL(`${suiteRoot}${path.sep}`).href
  const untrusted = [
    pathToFileURL('/outside/index.html').href,
    'http://127.0.0.1/index.html',
    'https://trusted.invalid/index.html',
    `${hrefFor('index.html')}?feature=system-cleaner`,
    `${hrefFor('index.html')}#system-cleaner`,
    hrefFor('modules/system-cleaner/other.html'),
    `${rawRootHref}evil/../index.html`,
    `${rawRootHref}modules/%2e%2e/index.html`,
    `${rawRootHref}modules/%2foutside/index.html`,
    `${rawRootHref}/index.html`,
    `${rawRootHref}%69ndex.html`,
    hrefFor('index.html').replace('file:///', 'file://localhost/'),
  ]
  for (const href of untrusted) {
    const { host, assigned } = hostAt(href)
    assert.equal(installSuiteRouter(host, suiteRoot), null, href)
    assert.equal(Object.hasOwn(host, 'systemManagerSuite'), false, href)
    assert.deepEqual(assigned, [])
  }
})

test('Windows file URLs are canonical, case-insensitive, and reject UNC or ambiguous forms', () => {
  const windowsRoot = String.raw`C:\Users\Demo\System Manager`
  const windowsPage = path.win32.join(windowsRoot, 'modules', 'startup-manager', 'index.html')
  const href = pathToFileURL(windowsPage, { windows: true }).href
  assert.equal(resolveSuitePage(href, windowsRoot, 'win32').featureCode, 'startup-manager')
  assert.equal(resolveSuitePage(href.replace('C:', 'c:'), windowsRoot, 'win32').featureCode, 'startup-manager')
  assert.equal(resolveSuitePage(href.replace('file:', 'FILE:'), windowsRoot, 'win32').featureCode, 'startup-manager')
  const loads = []
  const bootstrapped = bootstrap(hostAt(href.replace('C:', 'c:')).host, { suiteRoot: windowsRoot, platform: 'win32', runtimeRequire: (value) => loads.push(value) })
  assert.equal(bootstrapped.serviceLoaded, true)
  assert.deepEqual(loads, ['../modules/startup-manager/preload/services.cjs'])
  for (const value of [
    'file://server/share/System%20Manager/index.html',
    href.replace('file:///', 'file:/'),
    href.replace('file:///', 'file:'),
    href.replace('/C:/', '/C|/'),
    ` ${href}`,
    `${href} `,
    href.replace('file:///', 'file://%6cocalhost/'),
    `${href}?query=1`,
    href.replace('/modules/', '/modules/%2e%2e/'),
    href.replace('/startup-manager/', '/startup-manager%2fescape/'),
    href.replace('System%20Manager', 'System%2520Manager'),
  ]) assert.equal(resolveSuitePage(value, windowsRoot, 'win32'), null, value)
})

test('plugin entry lifecycle reads only allowlisted code and ignores payload paths', () => {
  let onEnter
  const { host, assigned } = hostAt(hrefFor('modules/startup-manager/index.html'))
  host.ztools = { onPluginEnter(callback) { onEnter = callback } }
  installSuiteRouter(host, suiteRoot)
  onEnter({ code: 'lan-device-discovery', payload: 'file:///outside/index.html' })
  assert.deepEqual(assigned, [hrefFor('modules/lan-device-discovery/index.html')])
  onEnter({ code: '../outside' })
  assert.equal(assigned.length, 1)
})

test('bootstrap loads no service on dashboard and exactly one cjs service per module page', () => {
  const dashboardLoads = []
  const dashboard = bootstrap(hostAt(hrefFor('index.html')).host, { suiteRoot, runtimeRequire: (value) => dashboardLoads.push(value) })
  assert.equal(dashboard.serviceLoaded, false)
  assert.deepEqual(dashboardLoads, [])

  for (const module of modules) {
    const loads = []
    const result = bootstrap(hostAt(hrefFor(`modules/${module.id}/index.html`)).host, {
      suiteRoot,
      runtimeRequire: (value) => loads.push(value),
    })
    assert.equal(result.serviceLoaded, true)
    assert.deepEqual(loads, [`../modules/${module.id}/preload/services.cjs`])
  }
})

test('bootstrap on unknown or non-file pages exposes neither router nor business service', () => {
  for (const href of [pathToFileURL('/outside/index.html').href, 'http://127.0.0.1/index.html', hrefFor('unknown.html')]) {
    const loads = []
    const { host } = hostAt(href)
    const result = bootstrap(host, { suiteRoot, runtimeRequire: (value) => loads.push(value) })
    assert.equal(result.page, null)
    assert.equal(result.router, null)
    assert.equal(result.serviceLoaded, false)
    assert.equal(Object.hasOwn(host, 'systemManagerSuite'), false)
    assert.deepEqual(loads, [])
  }
})
