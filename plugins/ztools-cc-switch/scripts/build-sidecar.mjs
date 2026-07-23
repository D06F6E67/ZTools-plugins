import { chmodSync, copyFileSync, mkdirSync, renameSync, rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const crateDir = path.join(root, 'rust-sidecar')
const outputDir = path.join(root, 'preload', 'bin')
const platform = process.platform
const arch = process.arch
const supported = ['darwin', 'win32', 'linux'].includes(platform) && ['arm64', 'x64'].includes(arch)

if (!supported) {
  throw new Error(`当前平台没有 sidecar 命名规则：${platform}-${arch}`)
}

const result = spawnSync('cargo', ['build', '--release', '--manifest-path', path.join(crateDir, 'Cargo.toml')], {
  cwd: root,
  stdio: 'inherit'
})
if (result.error) throw result.error
if (result.status !== 0) process.exit(result.status ?? 1)

const executable = platform === 'win32' ? 'cc-switch-sidecar.exe' : 'cc-switch-sidecar'
const source = path.join(crateDir, 'target', 'release', executable)
const filename = `cc-switch-sidecar-${platform}-${arch}${platform === 'win32' ? '.exe' : ''}`
const destination = path.join(outputDir, filename)
const temporaryDestination = `${destination}.${process.pid}.tmp`
mkdirSync(outputDir, { recursive: true })
try {
  // Never rewrite a running executable in place. On macOS that can leave the
  // child process stuck in an uninterruptible exit state while the file is
  // being replaced. A complete temporary copy followed by rename is atomic.
  copyFileSync(source, temporaryDestination)
  if (platform !== 'win32') chmodSync(temporaryDestination, 0o755)
  renameSync(temporaryDestination, destination)
} finally {
  rmSync(temporaryDestination, { force: true })
}
console.log(`Sidecar ready: ${path.relative(root, destination)}`)
