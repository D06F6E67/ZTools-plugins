const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')

const destDir = path.resolve(__dirname, '../public/preload')

// 1. 清理并重建 public/preload
try { fs.rmSync(destDir, { recursive: true, force: true }) } catch (e) {}
fs.mkdirSync(destDir, { recursive: true })

// 2. 编译 TypeScript
execSync('tsc -p tsconfig.preload.json', { stdio: 'inherit' })

// 3. 复制静态资源
const srcDir = path.resolve(__dirname, '../src/preload')
const assets = [
  { from: 'package.json', to: 'package.json' },
  { from: 'proxy/proxy-daemon.html', to: 'proxy/proxy-daemon.html' },
]
for (const asset of assets) {
  const from = path.join(srcDir, asset.from)
  const to = path.join(destDir, asset.to)
  try {
    fs.mkdirSync(path.dirname(to), { recursive: true })
    fs.copyFileSync(from, to)
    console.log(`copied: ${asset.from}`)
  } catch (e) {
    console.warn(`skip: ${asset.from} (${e.message})`)
  }
}
