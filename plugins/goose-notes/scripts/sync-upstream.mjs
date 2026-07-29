#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { buildMainManifest } from './manifest.mjs'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const pluginDir = resolve(scriptDir, '..')
const upstreamDir = join(pluginDir, 'upstream')
const lockPath = join(pluginDir, 'upstream.lock.json')
const metaPath = join(pluginDir, 'compat', 'plugin-meta.json')
const pluginManifestPath = join(pluginDir, 'plugin.json')
const repository = 'https://github.com/eachann1024/goose-notes.git'

const getArg = (name, fallback = '') => {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : fallback
}

const hasFlag = (name) => process.argv.includes(name)
const ref = getArg('--ref', 'main')
const requestedVersion = getArg('--version')
const force = hasFlag('--force')

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'))
const writeJson = (path, value) => {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

const bumpPatch = (version) => {
  const match = String(version).match(/^(\d+)\.(\d+)\.(\d+)$/)
  if (!match) {
    throw new Error(`无法自动递增非标准版本号: ${version}`)
  }
  return `${match[1]}.${match[2]}.${Number(match[3]) + 1}`
}

const previousLock = existsSync(lockPath) ? readJson(lockPath) : null
const meta = readJson(metaPath)
const temporaryRoot = mkdtempSync(join(tmpdir(), 'goose-notes-sync-'))
const checkoutDir = join(temporaryRoot, 'checkout')

try {
  execFileSync('git', ['init', checkoutDir], { stdio: 'inherit' })
  execFileSync('git', ['-C', checkoutDir, 'remote', 'add', 'origin', repository])
  execFileSync('git', ['-C', checkoutDir, 'fetch', '--depth=1', 'origin', ref], {
    stdio: 'inherit'
  })
  execFileSync('git', ['-C', checkoutDir, 'checkout', '--detach', 'FETCH_HEAD'], {
    stdio: 'inherit'
  })

  const sha = execFileSync('git', ['-C', checkoutDir, 'rev-parse', 'HEAD'], {
    encoding: 'utf8'
  }).trim()

  if (previousLock?.sha === sha && existsSync(upstreamDir) && !force) {
    console.log(`goose-notes 已是目标版本: ${sha}`)
    process.exit(0)
  }

  const nextVersion = requestedVersion || (previousLock ? bumpPatch(meta.version) : meta.version)
  meta.version = nextVersion

  rmSync(upstreamDir, { recursive: true, force: true })
  cpSync(checkoutDir, upstreamDir, {
    recursive: true,
    filter: (source) => {
      const name = basename(source)
      return !['.git', 'node_modules', 'dist', 'dist-quicknote', 'output'].includes(name)
    }
  })

  const upstreamManifest = readJson(join(upstreamDir, 'plugin.json'))
  const upstreamPackage = readJson(join(upstreamDir, 'package.json'))
  writeJson(metaPath, meta)
  writeJson(pluginManifestPath, buildMainManifest(upstreamManifest, meta))
  writeJson(lockPath, {
    repository,
    ref,
    sha,
    upstreamVersion: upstreamManifest.version,
    packageVersion: upstreamPackage.version,
    adapterVersion: nextVersion,
    syncedAt: new Date().toISOString()
  })

  console.log(`已同步 goose-notes ${sha}，ZTools 插件版本 ${nextVersion}`)
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true })
}
