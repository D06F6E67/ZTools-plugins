const fs = require('fs')
const path = require('path')

const oldPath = path.join(__dirname, '../public/preload/services.js')
// Prefer full backup if present
const backup = '/tmp/services-full-backup.js'
const srcPath = fs.existsSync(backup) ? backup : oldPath
const lines = fs.readFileSync(srcPath, 'utf8').split(/\n/)

// 1-based line ranges from backup:
// 135-279: CJK + fonts + selectFont + ensurePdfcpuFont (before outputDir)
// 449-546: loadCjkFontBytes + addWatermarkWithPdfLib
const part1 = lines.slice(134, 279).join('\n') // 135..279
const part2 = lines.slice(448, 546).join('\n') // 449..546

const head = fs.readFileSync(path.join(__dirname, '_services-head.js'), 'utf8')
const tail = fs.readFileSync(path.join(__dirname, '_services-tail.js'), 'utf8')
const out = head + '\n' + part1 + '\n\n' + part2 + '\n' + tail
fs.writeFileSync(oldPath, out)
console.log('wrote', oldPath, 'lines', out.split(/\n/).length)
