import { lstat, rm } from 'node:fs/promises'

import { inside, modules, root } from './config.mjs'

const moduleId = process.argv[2]
if (!modules.some((module) => module.id === moduleId)) {
  throw new Error(`未知系统管家模块：${moduleId || '<empty>'}`)
}

const dist = inside(root, 'modules', moduleId, 'dist')
const manifest = inside(dist, 'plugin.json')
const release = inside(root, 'modules', moduleId, 'release')
const info = await lstat(manifest)
if (!info.isFile() || info.isSymbolicLink()) throw new Error(`${moduleId} 的中间 manifest 不是安全普通文件`)
await rm(manifest)
await rm(release, { recursive: true, force: true })

console.log(`[system-manager] Finalized internal module dist: ${moduleId}`)
