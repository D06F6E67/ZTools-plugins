#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const pluginDir = resolve(scriptDir, '..')
const upstreamDir = join(pluginDir, 'upstream')
const mainDist = join(pluginDir, 'dist')
const quicknoteDist = join(pluginDir, 'dist-quicknote-ztools')
const compatBuildScript = join(
  pluginDir,
  'compat',
  'upstream-scripts',
  'utools-build.js'
)
const contract = JSON.parse(
  readFileSync(join(pluginDir, 'compat', 'api-contract.json'), 'utf8')
)

const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}

assert(existsSync(compatBuildScript), `缺少受控的上游构建脚本: ${compatBuildScript}`)

const walk = (directory) => readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
  const path = join(directory, entry.name)
  return entry.isDirectory() ? walk(path) : [path]
})

const verifyManifest = (directory, expectedName, expectedPreload, expectsMain) => {
  const manifestPath = join(directory, 'plugin.json')
  assert(existsSync(manifestPath), `缺少 plugin.json: ${directory}`)
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  assert(manifest.name === expectedName, `name 配置错误: ${manifest.name}`)
  assert(typeof manifest.title === 'string' && manifest.title.length > 0, '缺少 title')
  assert(manifest.preload === expectedPreload, `preload 配置错误: ${manifest.preload}`)
  assert(existsSync(join(directory, manifest.preload)), `preload 文件不存在: ${manifest.preload}`)
  if (expectsMain) {
    assert(manifest.main === 'index.html', `main 配置错误: ${manifest.main}`)
    assert(existsSync(join(directory, manifest.main)), `main 文件不存在: ${manifest.main}`)
  } else {
    assert(!manifest.main, '速记模板插件不应声明 main')
  }
  assert(/^\d+\.\d+\.\d+$/.test(manifest.version), `版本号无效: ${manifest.version}`)
}

const verifyPreload = (path) => {
  const source = readFileSync(path, 'utf8')
  assert(source.includes('bootstrapGooseForZTools'), `未注入 ZTools bootstrap: ${path}`)
  assert(source.includes('globalThis.ztools'), `未绑定 ztools 运行时: ${path}`)
  assert(source.includes('window.utools = utools'), `未建立 window.utools 别名: ${path}`)
}

const contractFiles = [
  ...walk(join(upstreamDir, 'preload')).filter((path) => path.endsWith('.cjs')),
  join(upstreamDir, 'src', 'lib', 'host', 'runtime.utools.ts'),
  ...walk(join(upstreamDir, 'src', 'lib', 'utools')).filter((path) => path.endsWith('.ts'))
]
const apiPattern = /(?<![.\w$])utools\s*\??\.\s*([A-Za-z_$][\w$]*)/g
const usedApis = new Set()
for (const path of contractFiles) {
  const source = readFileSync(path, 'utf8')
  for (const match of source.matchAll(apiPattern)) usedApis.add(match[1])
}

const knownApis = new Set([...contract.supported, ...contract.optionalUnsupported])
const unknownApis = [...usedApis].filter((name) => !knownApis.has(name)).sort()
assert(unknownApis.length === 0, `发现未评估的 uTools API: ${unknownApis.join(', ')}`)

for (const directory of [mainDist, quicknoteDist]) {
  for (const file of ['plugin.json', 'package.json', 'logo.png', 'LICENSE', 'UPSTREAM.json']) {
    const path = join(directory, file)
    assert(existsSync(path) && statSync(path).isFile(), `缺少发布文件: ${path}`)
  }
}

verifyManifest(mainDist, 'goose-notes', 'preload.js', true)
verifyManifest(quicknoteDist, 'goose-notes-quicknote', 'preload-quicknote.js', false)
verifyPreload(join(mainDist, 'preload.js'))
verifyPreload(join(quicknoteDist, 'preload-quicknote.js'))

console.log(`兼容契约检查通过，已识别 ${usedApis.size} 个 uTools API`)
if (contract.optionalUnsupported.length > 0) {
  console.log(`按能力检测降级: ${contract.optionalUnsupported.join(', ')}`)
}
