#!/usr/bin/env node
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildQuicknoteManifest } from './manifest.mjs'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const pluginDir = resolve(scriptDir, '..')
const upstreamDir = join(pluginDir, 'upstream')
const mainSourceDir = join(upstreamDir, 'dist')
const quicknoteSourceDir = join(upstreamDir, 'dist-quicknote')
const mainOutputDir = join(pluginDir, 'dist')
const quicknoteOutputDir = join(pluginDir, 'dist-quicknote-ztools')

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'))
const writeJson = (path, value) => {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

const copyClean = (source, target) => {
  if (!existsSync(source)) throw new Error(`构建产物不存在: ${source}`)
  rmSync(target, { recursive: true, force: true })
  mkdirSync(target, { recursive: true })
  cpSync(source, target, { recursive: true })
}

const wrapPreload = (preloadPath) => {
  if (!existsSync(preloadPath)) throw new Error(`preload 不存在: ${preloadPath}`)
  const source = readFileSync(preloadPath, 'utf8')
  if (source.includes('bootstrapGooseForZTools')) return

  const wrapped = `;(function bootstrapGooseForZTools(utools) {
  if (!utools) throw new Error('ZTools plugin runtime is unavailable')
${source}
}).call(globalThis, globalThis.ztools)
`
  writeFileSync(preloadPath, wrapped)
}

const copyMetadata = (outputDir) => {
  cpSync(join(upstreamDir, 'LICENSE'), join(outputDir, 'LICENSE'))
  cpSync(join(pluginDir, 'upstream.lock.json'), join(outputDir, 'UPSTREAM.json'))
}

copyClean(mainSourceDir, mainOutputDir)
wrapPreload(join(mainOutputDir, 'preload.js'))
cpSync(join(pluginDir, 'plugin.json'), join(mainOutputDir, 'plugin.json'))
copyMetadata(mainOutputDir)

copyClean(quicknoteSourceDir, quicknoteOutputDir)
wrapPreload(join(quicknoteOutputDir, 'preload-quicknote.js'))
const meta = readJson(join(pluginDir, 'compat', 'plugin-meta.json'))
const quicknoteManifest = readJson(join(upstreamDir, 'quicknote-plugin.json'))
writeJson(
  join(quicknoteOutputDir, 'plugin.json'),
  buildQuicknoteManifest(quicknoteManifest, meta)
)
copyMetadata(quicknoteOutputDir)

console.log('ZTools 主插件与速记候选产物转换完成')
