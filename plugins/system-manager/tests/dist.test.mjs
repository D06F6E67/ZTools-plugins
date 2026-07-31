import assert from 'node:assert/strict'
import { readFile, readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'

import { distRoot, limitBytes, modules, releaseRoot, root } from '../scripts/config.mjs'
import { inspectZip, sha256 } from '../scripts/zip.mjs'

async function walk(directory) {
  const output = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name)
    if (entry.isDirectory()) output.push(...await walk(target))
    else if (entry.isFile()) output.push(target)
  }
  return output
}

test('assembled manifest publishes five features and one root preload', async () => {
  const manifest = JSON.parse(await readFile(path.join(distRoot, 'plugin.json'), 'utf8'))
  assert.equal(manifest.name, 'system-manager')
  assert.equal(manifest.preload, 'preload/index.cjs')
  assert.deepEqual(manifest.features.map((feature) => feature.code), modules.map((module) => module.id))
  for (const feature of manifest.features) assert.deepEqual(feature.platform, ['darwin', 'win32', 'linux'])

  const preload = await readFile(path.join(distRoot, manifest.preload), 'utf8')
  for (const module of modules) {
    assert.match(preload, new RegExp(`\\.\\./modules/${module.id}/${module.finalPreload.replaceAll('.', '\\.')}`))
  }
})

test('dashboard and every module route are present with accessible return navigation', async () => {
  const dashboard = await readFile(path.join(distRoot, 'index.html'), 'utf8')
  const screenshot = await stat(path.join(distRoot, 'screenshots', 'main.png'))
  assert.ok(screenshot.isFile() && screenshot.size > 0)
  for (const module of modules) {
    assert.match(dashboard, new RegExp(`href=["']\\./modules/${module.id}/index\\.html["']`))
    const html = await readFile(path.join(distRoot, 'modules', module.id, 'index.html'), 'utf8')
    assert.match(html, /data-system-manager-navigation="style"/)
    assert.match(html, /data-system-manager-navigation="script"/)
    assert.match(html, /data-system-manager-home="\.\.\/\.\.\/index\.html"/)
  }
  const navigation = await readFile(path.join(distRoot, '_system-manager', 'navigation.js'), 'utf8')
  assert.match(navigation, /aria-label', '返回系统管家首页'/)
  assert.match(navigation, /textContent = '← 返回系统管家'/)
  assert.match(navigation, /addEventListener\('auxclick', openInCurrentView\)/)
  assert.match(navigation, /window\.location\.assign\(link\.href\)/)
  const dashboardScript = await readFile(path.join(distRoot, 'dashboard', 'app.js'), 'utf8')
  assert.match(dashboardScript, /addEventListener\('auxclick', openInCurrentView\)/)
  assert.match(dashboardScript, /window\.location\.assign\(fallback\)/)
})

test('release contains no nested manifests, source maps or unexpected development dependencies', async () => {
  const files = await walk(distRoot)
  const relative = files.map((file) => path.relative(distRoot, file).split(path.sep).join('/'))
  const runtimePrefixes = modules.flatMap((module) => (module.runtimeDependencies || [])
    .map((dependency) => `modules/${module.id}/preload/node_modules/${dependency}/`))
  const allowedRuntimeDependency = (file) => runtimePrefixes.some((prefix) => file.startsWith(prefix)
    && !/(?:^|\/)node_modules(?:\/|$)/.test(file.slice(prefix.length)))
  assert.equal(relative.filter((file) => file.endsWith('plugin.json')).length, 1)
  assert.equal(relative.some((file) => file.endsWith('.map')), false)
  assert.equal(relative.some((file) => /(?:^|\/)(?:src|tests)(?:\/|$)/.test(file)), false)
  assert.equal(relative.some((file) => /(?:^|\/)node_modules(?:\/|$)/.test(file) && !allowedRuntimeDependency(file)), false)
  for (const module of modules) {
    assert.ok(relative.includes(`modules/${module.id}/index.html`))
    assert.ok(relative.includes(`modules/${module.id}/${module.finalPreload}`))
    assert.equal(relative.includes(`modules/${module.id}/README.md`), false)
    assert.equal(relative.includes(`modules/${module.id}/SECURITY.md`), false)
    assert.equal(relative.some((file) => file.startsWith(`modules/${module.id}/screenshots/`)), false)
    if (module.sourcePreload !== module.finalPreload) assert.equal(relative.includes(`modules/${module.id}/${module.sourcePreload}`), false)
    for (const dependency of module.runtimeDependencies || []) {
      assert.ok(relative.includes(`modules/${module.id}/preload/node_modules/${dependency}/package.json`))
    }
  }
  const bytes = (await Promise.all(files.map((file) => stat(file)))).reduce((sum, info) => sum + info.size, 0)
  assert.ok(bytes < limitBytes, `dist ${bytes} must be < ${limitBytes}`)
})


test('dashboard and five module pages use one strict production CSP only', async () => {
  const pages = ['index.html', ...modules.map((module) => `modules/${module.id}/index.html`)]
  for (const page of pages) {
    const html = await readFile(path.join(distRoot, page), 'utf8')
    const policies = [...html.matchAll(/<meta\b[^>]*http-equiv=["']Content-Security-Policy["'][^>]*>/gi)]
    assert.equal(policies.length, 1, page)
    assert.match(policies[0][0], /connect-src 'none'/)
    assert.doesNotMatch(policies[0][0], /unsafe-inline|localhost|127\.0\.0\.1|ws:\/\//i)
    const firstResource = html.search(/<(?:script|link|style|img)\b/i)
    assert.ok(firstResource === -1 || policies[0].index < firstResource, `${page}: CSP must precede loadable resources`)
  }
})

test('ZIP is structurally valid, byte-bounded and exactly mirrors dist files', async () => {
  const packageJson = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))
  const zipPath = path.join(releaseRoot, `system-manager-${packageJson.version}.zip`)
  const buffer = await readFile(zipPath)
  assert.ok(buffer.length < limitBytes, `zip ${buffer.length} must be < ${limitBytes}`)
  const entries = inspectZip(buffer)
  const zipNames = entries.map((entry) => entry.name).sort()
  const distNames = (await walk(distRoot)).map((file) => path.relative(distRoot, file).split(path.sep).join('/')).sort()
  assert.deepEqual(zipNames, distNames)
  assert.equal(zipNames.filter((file) => file.endsWith('plugin.json')).length, 1)
  const entryByName = new Map(entries.map((entry) => [entry.name, entry]))
  for (const file of await walk(distRoot)) {
    const name = path.relative(distRoot, file).split(path.sep).join('/')
    const content = await readFile(file)
    assert.equal(entryByName.get(name)?.sha256, sha256(content), name)
  }
  const releaseNames = await readdir(releaseRoot)
  assert.equal(releaseNames.some((name) => name.startsWith('.system-manager-') && name.endsWith('.tmp')), false)
})
