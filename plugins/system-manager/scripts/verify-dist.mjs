import { access, lstat, readFile, readdir, stat } from 'node:fs/promises'
import { builtinModules, createRequire } from 'node:module'
import path from 'node:path'

import { distRoot, inside, limitBytes, modules, requireStrictSemver, root } from './config.mjs'

const strictProductionCsp = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'; worker-src 'none'"

async function walk(directory) {
  const output = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name)
    const info = await lstat(target)
    if (info.isSymbolicLink()) throw new Error(`发布目录禁止符号链接：${path.relative(distRoot, target)}`)
    if (entry.isDirectory()) output.push(...await walk(target))
    else if (entry.isFile()) output.push(target)
  }
  return output
}

async function requireFile(relative) {
  const target = inside(distRoot, relative)
  await access(target)
  const info = await stat(target)
  if (!info.isFile() || info.size === 0) throw new Error(`发布文件无效：${relative}`)
  return target
}

for (const relative of [
  'index.html',
  'plugin.json',
  'logo.svg',
  'README.md',
  'SECURITY.md',
  'screenshots/main.png',
  'preload/index.cjs',
  'preload/router.cjs',
  '_system-manager/navigation.js',
  '_system-manager/navigation.css',
]) await requireFile(relative)

const manifest = JSON.parse(await readFile(path.join(distRoot, 'plugin.json'), 'utf8'))
const packageJson = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))
requireStrictSemver(packageJson.version)
if (manifest.name !== 'system-manager') throw new Error(`根插件 ID 错误：${manifest.name}`)
if (manifest.version !== packageJson.version) throw new Error('plugin.json 与 package.json 版本不一致')
for (const field of ['main', 'preload', 'logo']) {
  const value = manifest[field]
  if (typeof value !== 'string' || !value || path.isAbsolute(value) || path.normalize(value).startsWith('..')) {
    throw new Error(`${field} 不是安全相对路径`)
  }
  await requireFile(value)
}

const expectedFeatures = modules.map((module) => module.id)
const actualFeatures = Array.isArray(manifest.features) ? manifest.features.map((feature) => feature.code) : []
if (JSON.stringify(actualFeatures) !== JSON.stringify(expectedFeatures)) {
  throw new Error(`Feature 必须按固定顺序完整声明：${expectedFeatures.join(', ')}`)
}
for (const feature of manifest.features) {
  if (new Set(feature.platform || []).size !== 3 || !['darwin', 'win32', 'linux'].every((value) => feature.platform.includes(value))) {
    throw new Error(`Feature ${feature.code} 未覆盖三平台`)
  }
  if (!Array.isArray(feature.cmds) || feature.cmds.length === 0) throw new Error(`Feature ${feature.code} 缺少触发词`)
}

for (const module of modules) {
  const prefix = `modules/${module.id}`
  const htmlPath = await requireFile(`${prefix}/index.html`)
  await requireFile(`${prefix}/logo.svg`)
  await requireFile(`${prefix}/${module.finalPreload}`)
  if (module.sourcePreload !== module.finalPreload && await relativeExists(`${prefix}/${module.sourcePreload}`)) {
    throw new Error(`${module.id} 仍包含未重命名的 preload：${module.sourcePreload}`)
  }
  const html = await readFile(htmlPath, 'utf8')
  if (!html.includes('data-system-manager-navigation="style"') || !html.includes('data-system-manager-navigation="script"')) {
    throw new Error(`${module.id} 缺少返回系统管家导航注入`)
  }
  if (!html.includes('data-system-manager-home="../../index.html"')) {
    throw new Error(`${module.id} 的返回路径不可访问`)
  }
}

async function relativeExists(relative) {
  try { await lstat(inside(distRoot, relative)); return true } catch (error) {
    if (error.code === 'ENOENT') return false
    throw error
  }
}

const files = await walk(distRoot)
const relativeFiles = files.map((file) => path.relative(distRoot, file).split(path.sep).join('/'))
const nestedManifests = relativeFiles.filter((relative) => relative !== 'plugin.json' && relative.endsWith('/plugin.json'))
if (nestedManifests.length) throw new Error(`发布物包含嵌套 plugin.json：${nestedManifests.join(', ')}`)
const forbidden = relativeFiles.filter((relative) => relative.endsWith('.map') || /(?:^|\/)(?:node_modules|src|tests)(?:\/|$)/.test(relative))
if (forbidden.length) throw new Error(`发布物包含开发文件：${forbidden.join(', ')}`)
const moduleDocumentation = relativeFiles.filter((relative) => /^modules\/[^/]+\/(?:README\.md|SECURITY\.md|screenshots\/)/.test(relative))
if (moduleDocumentation.length) throw new Error(`最终模块包含重复文档或截图：${moduleDocumentation.join(', ')}`)

for (const relative of ['index.html', ...modules.map((module) => `modules/${module.id}/index.html`)]) {
  const html = await readFile(inside(distRoot, relative), 'utf8')
  const policies = [...html.matchAll(/<meta\b[^>]*http-equiv=["']Content-Security-Policy["'][^>]*>/gi)]
  if (policies.length !== 1 || !policies[0][0].includes(`content="${strictProductionCsp}"`)) {
    throw new Error(`${relative} 未使用唯一严格生产 CSP`)
  }
  if (/unsafe-inline|127\.0\.0\.1|localhost|ws:\/\//i.test(policies[0][0])) throw new Error(`${relative} CSP 包含开发或不安全来源`)
  const cspIndex = html.indexOf(policies[0][0])
  const firstResourceIndex = html.search(/<(?:script|link|style|img)\b/i)
  if (firstResourceIndex !== -1 && cspIndex > firstResourceIndex) throw new Error(`${relative} 的 CSP 必须位于首个可加载资源之前`)
}

const builtins = new Set([...builtinModules, ...builtinModules.map((name) => `node:${name}`)])
const hostRuntimeModules = new Set(['electron'])
for (const file of files.filter((target) => /(?:^|[/\\])preload[/\\].*\.(?:c?js)$/i.test(target))) {
  const source = await readFile(file, 'utf8')
  const relative = path.relative(distRoot, file)
  if (/webpackBootstrap|__webpack_require__|sourceMappingURL|eval\s*\(/.test(source)) {
    throw new Error(`preload 不可审核：${relative}`)
  }
  const localRequire = createRequire(file)
  for (const match of source.matchAll(/\brequire\(\s*["']([^"']+)["']\s*\)/g)) {
    const specifier = match[1]
    if (builtins.has(specifier) || hostRuntimeModules.has(specifier)) continue
    try { localRequire.resolve(specifier) } catch (error) {
      throw new Error(`${relative} 的依赖无法解析：${specifier}`, { cause: error })
    }
  }
}

const totalBytes = (await Promise.all(files.map((file) => stat(file)))).reduce((sum, info) => sum + info.size, 0)
if (totalBytes >= limitBytes) throw new Error(`dist ${totalBytes} bytes，必须严格小于 15 MiB`)
console.log(`Verified system-manager dist: ${files.length} files, ${totalBytes} bytes (< 15 MiB)`)
