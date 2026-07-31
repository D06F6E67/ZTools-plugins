window.services = {
  cancelCurrent,

  deleteFile(filePath) {
    try {
      const resolved = safeOut(filePath, '删除路径')
      if (fs.existsSync(resolved)) {
        fs.unlinkSync(resolved)
        log('INFO', 'deleteFile', safePathLabel(resolved))
        return true
      }
    } catch (e) {
      log('WARN', 'deleteFile failed', e && e.message)
    }
    return false
  },

  writeImageFile(base64Url, outputPath) {
    const matchs = /^data:image\/([a-z]{1,20});base64,/i.exec(base64Url)
    if (!matchs) {
      log('WARN', 'writeImageFile: invalid base64')
      return
    }
    let filePath
    if (outputPath) {
      filePath = safeOut(outputPath, '图片输出路径')
      ensuredDir(path.dirname(filePath))
    } else {
      const dir = outputDir('images')
      filePath = path.join(dir, Date.now().toString() + '.' + matchs[1])
    }
    fs.writeFileSync(filePath, base64Url.substring(matchs[0].length), { encoding: 'base64' })
    log('INFO', 'writeImageFile', safePathLabel(filePath))
    return filePath
  },

  async createPdfFromImages(imagePaths, outputPath, options = {}) {
    const out = safeOut(outputPath, 'PDF 输出路径')
    log('INFO', 'createPdfFromImages', { count: imagePaths.length, out: safePathLabel(out) })
    ensuredDir(path.dirname(out))
    const safeImages = imagePaths.map((p) => safeOut(p, '图片输入路径'))
    await buildPdfFromImages(safeImages, out, options)
    return out
  },

  async compressPdf(inputPath, outputPath, options = {}) {
    const input = safeIn(inputPath)
    const out = safeOut(outputPath, '压缩输出路径')
    ensuredDir(path.dirname(out))
    const mode = options && options.mode === 'strong' ? 'strong' : 'optimize'
    log('INFO', 'compressPdf', {
      input: safePathLabel(input),
      output: safePathLabel(out),
      mode,
    })

    if (mode === 'strong') {
      const tempDir = path.join(path.dirname(out), '.strong-tmp-' + Date.now())
      try {
        await strongCompressPdf({
          inputPath: input,
          outputPath: out,
          quality: options.quality,
          tempDir,
          log,
        })
      } finally {
        try {
          if (fs.existsSync(tempDir)) {
            for (const f of fs.readdirSync(tempDir)) {
              try {
                fs.unlinkSync(path.join(tempDir, f))
              } catch {}
            }
            fs.rmdirSync(tempDir)
          }
        } catch {}
      }
      return out
    }

    await callPdfcpu(['optimize', input, out])
    log('INFO', 'compressPdf done', safePathLabel(out))
    return out
  },

  async mergePdfs(inputPaths, outputPath) {
    const inputs = inputPaths.map((p) => safeIn(p))
    const out = safeOut(outputPath, '合并输出路径')
    ensuredDir(path.dirname(out))
    await callPdfcpu(['merge', out, ...inputs])
    return out
  },

  async splitPdf(inputPath, outputDirPath, options) {
    const input = safeIn(inputPath)
    const outDir = safeOut(outputDirPath, '拆分输出目录')
    ensuredDir(outDir)

    if (typeof options === 'string' && options.trim()) {
      const pagesSpec = options.trim()
      if (!/^[0-9,\-\s]+$/.test(pagesSpec)) throw new Error('页码范围格式无效')
      await callPdfcpu(['extract', '-m', 'page', '-p', pagesSpec, input, outDir])
      return listFiles(outDir, ['.pdf'])
    }

    const opts = options && typeof options === 'object' ? options : {}
    const pageRanges = Array.isArray(opts.pageRanges) ? opts.pageRanges : null
    const beforePages = Array.isArray(opts.beforePages)
      ? opts.beforePages.map((n) => Math.floor(Number(n))).filter((n) => n >= 2)
      : null
    const span = opts.span != null ? Math.max(1, Math.floor(Number(opts.span) || 1)) : null
    const mergeRanges = opts.mergeRanges !== false

    if (pageRanges && pageRanges.length > 0) {
      const base = path.basename(input, path.extname(input)) || 'split'
      const normalized = []
      for (const pair of pageRanges) {
        const a = Math.floor(Number(pair[0]))
        const b = Math.floor(Number(pair[1]))
        if (a >= 1 && b >= a) normalized.push([a, b])
      }
      if (!normalized.length) throw new Error('没有有效的页码范围')

      if (mergeRanges || normalized.length === 1) {
        const pagesSpec = normalized
          .map(([a, b]) => (a === b ? String(a) : a + '-' + b))
          .join(',')
        const label =
          normalized.length === 1
            ? normalized[0][0] === normalized[0][1]
              ? String(normalized[0][0])
              : normalized[0][0] + '-' + normalized[0][1]
            : 'extract'
        const outFile = path.join(outDir, base + '_' + label + '.pdf')
        await callPdfcpu(['collect', '-p', pagesSpec, input, outFile])
        return [outFile]
      }

      const outs = []
      for (const [a, b] of normalized) {
        const label = a === b ? String(a) : a + '-' + b
        const outFile = path.join(outDir, base + '_' + label + '.pdf')
        await callPdfcpu(['collect', '-p', a + '-' + b, input, outFile])
        outs.push(outFile)
      }
      return outs
    }

    if (beforePages && beforePages.length > 0) {
      const unique = Array.from(new Set(beforePages)).sort((a, b) => a - b)
      await callPdfcpu(['split', '-m', 'page', input, outDir, ...unique.map(String)])
    } else if (span != null) {
      await callPdfcpu(['split', '-m', 'span', input, outDir, String(span)])
    } else {
      await callPdfcpu(['split', '-m', 'span', input, outDir, '1'])
    }
    return listFiles(outDir, ['.pdf'])
  },

  async addWatermark(inputPath, outputPath, watermark) {
    const input = safeIn(inputPath)
    const out = safeOut(outputPath, '水印输出路径')
    ensuredDir(path.dirname(out))
    const text = (watermark && watermark.text) || 'Watermark'
    const opacity = watermark && watermark.opacity != null ? Number(watermark.opacity) : 0.3
    const points = watermark && watermark.points != null ? Number(watermark.points) : 36
    const rotation = watermark && watermark.rotation != null ? Number(watermark.rotation) : 0
    const margin = watermark && watermark.margin != null ? Number(watermark.margin) : 20
    const tile = !!(watermark && watermark.tile)
    const position = (watermark && watermark.position) || 'mc'
    const color = (watermark && watermark.color) || '#808080'
    const density = watermark && watermark.density != null ? Number(watermark.density) : 3

    try {
      await addWatermarkWithPdfLib(input, out, {
        text,
        opacity,
        points,
        rotation,
        margin,
        tile,
        position,
        color,
        density,
      })
      log('INFO', 'addWatermark done via pdf-lib', { output: safePathLabel(out) })
      return out
    } catch (e) {
      log('WARN', 'pdf-lib watermark failed, fallback pdfcpu', e && e.message)
    }

    const font = selectFontForText(text)
    if (font.windowsName) ensurePdfcpuFont(font.windowsName, font.pdfcpuName)
    const posMap = {
      tl: 'tl',
      tc: 'tc',
      tr: 'tr',
      ml: 'l',
      mc: 'c',
      mr: 'r',
      bl: 'bl',
      bc: 'bc',
      br: 'br',
      l: 'l',
      c: 'c',
      r: 'r',
    }
    const pos = posMap[position] || 'c'
    const desc = [
      'fontname:' + font.pdfcpuName,
      'points:' + points,
      'opacity:' + opacity,
      'rot:' + rotation,
      'fillcol:' + color,
      'pos:' + (tile ? 'c' : pos),
    ].join(', ')
    try {
      await callPdfcpu(['stamp', 'add', '-mode', 'text', desc, text, input, out])
    } catch (e1) {
      await callPdfcpu(['watermark', 'add', '-mode', 'text', desc, text, input, out])
    }
    return out
  },

  async convertPdf(inputPath, outputPath, format) {
    const input = safeIn(inputPath)
    const out = safeOut(outputPath, '转换输出路径')
    if (!['word', 'ppt', 'excel'].includes(format)) throw new Error('不支持的转换格式: ' + format)
    ensuredDir(path.dirname(out))
    let convertPdfLocal
    try {
      ;({ convertPdfLocal } = require('./convert/convert-local'))
    } catch (e) {
      if (e && e.code === 'MODULE_NOT_FOUND') {
        throw new Error('本地转换依赖未安装，请在 public/preload 执行 npm install')
      }
      throw e
    }
    return convertPdfLocal({ inputPath: input, outputPath: out, format })
  },

  resolveTaskPath(coords) {
    const r = resolveTaskCoords(getDownloadsRoot(), coords)
    if (r.filePath) {
      ensuredDir(path.dirname(r.filePath))
      return r.filePath
    }
    ensuredDir(r.dir)
    return r.dir
  },

  async getSettings() {
    return settingsStore.loadSettings(window.ztools.dbStorage)
  },

  async saveSettings(settings) {
    settingsStore.saveSettings(window.ztools.dbStorage, settings)
  },
}
