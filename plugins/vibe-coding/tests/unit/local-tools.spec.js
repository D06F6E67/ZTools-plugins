import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { createHash } from 'node:crypto'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { createFileTools } = require('../../public/runtime/tools/file-tools.js')
const { createProcessManager } = require('../../public/runtime/tools/process-manager.js')
const { createSearchTools } = require('../../public/runtime/tools/search-tools.js')
const {
  TOOL_MANIFEST,
  downloadAsset,
  resolveManagedAsset,
  resolvePlatformKey,
  validateArchiveEntries,
} = require('../../public/runtime/tools/binary-manager.js')

test('read 按行读取且 edit 原子应用多个修改并保留 BOM 与 CRLF', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'zvc-file-tools-'))
  const filePath = path.join(root, 'sample.txt')
  await fs.writeFile(filePath, '\uFEFFfirst\r\nsecond\r\nthird\r\n', 'utf8')
  const tools = createFileTools({
    resolvePath: (_workspace, input) => path.resolve(root, String(input)),
    getAttachmentStore: () => { throw new Error('本用例不读取图片') },
    createPresentedResult: (output, presentation, modelContext = []) => ({ output, presentation, modelContext }),
    computeDiffs: (target, before, after) => [{ path: target, oldText: before, newText: after }],
    resolveLanguage: () => '',
    createLines: (content, firstLine) => content.split('\n').map((text, index) => ({ number: firstLine + index, text })),
  })

  try {
    const readResult = await tools.execute('read', { path: 'sample.txt', offset: 2, limit: 1 }, null)
    assert.equal(readResult.output.content, 'second\n\n[显示第 2-2 行，共 4 行。请使用 offset=3 继续读取。]')
    await tools.execute('edit', {
      path: 'sample.txt',
      edits: [
        { oldText: 'first', newText: 'one' },
        { oldText: 'third', newText: 'three' },
      ],
    }, null)
    assert.equal(await fs.readFile(filePath, 'utf8'), '\uFEFFone\r\nsecond\r\nthree\r\n')
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('edit 拒绝非唯一匹配且不改写原文件', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'zvc-edit-unique-'))
  const filePath = path.join(root, 'sample.txt')
  await fs.writeFile(filePath, 'same\nsame\n', 'utf8')
  const tools = createFileTools({
    resolvePath: (_workspace, input) => path.resolve(root, String(input)),
    getAttachmentStore: () => null,
    createPresentedResult: (output, presentation) => ({ output, presentation }),
    computeDiffs: () => [],
    resolveLanguage: () => '',
    createLines: () => [],
  })

  try {
    await assert.rejects(
      tools.execute('edit', { path: 'sample.txt', edits: [{ oldText: 'same', newText: 'next' }] }, null),
      /必须唯一匹配/,
    )
    assert.equal(await fs.readFile(filePath, 'utf8'), 'same\nsame\n')
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('ls 返回排序后的单层目录并标识子目录', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'zvc-ls-'))
  await fs.mkdir(path.join(root, 'Folder'))
  await fs.writeFile(path.join(root, 'alpha.txt'), 'a')
  const tools = createSearchTools({
    resolvePath: (_workspace, input) => path.resolve(root, String(input)),
    processManager: createProcessManager({ outputRoot: path.join(root, 'output') }),
    getEnvironment: () => process.env,
  })

  try {
    const result = await tools.execute('ls', { path: '.' }, null, {})
    assert.deepEqual(result.entries, ['alpha.txt', 'Folder/'])
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('子进程管理器节流发布过程输出并能取消整个调用', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'zvc-process-manager-'))
  const manager = createProcessManager({ outputRoot: root, updateIntervalMs: 20 })
  const updates = []

  try {
    const completed = await manager.run(process.execPath, ['-e', "process.stdout.write('first'); setTimeout(() => process.stdout.write(' second'), 80)"], {
      callId: 'stream-test',
      cwd: root,
      onUpdate: (update) => updates.push(update),
      timeoutMs: 2000,
    })
    assert.equal(completed.code, 0)
    assert.equal(completed.output, 'first second')
    assert.ok(updates.some((update) => String(update.output).includes('first')))

    const running = manager.run(process.execPath, ['-e', 'setInterval(() => process.stdout.write("tick\\n"), 20)'], {
      callId: 'cancel-test',
      cwd: root,
      timeoutMs: 5000,
    })
    await new Promise((resolve) => setTimeout(resolve, 100))
    assert.equal(manager.cancel('cancel-test'), true)
    await assert.rejects(running, /已取消/)
    assert.equal(manager.activeCount(), 0)
  } finally {
    manager.cancelAll()
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('搜索工具清单固定版本与校验和并拒绝路径穿越压缩包', () => {
  assert.equal(TOOL_MANIFEST.rg.version, '14.1.1')
  assert.equal(TOOL_MANIFEST.fd.version, '10.2.0')
  assert.match(TOOL_MANIFEST.rg.assets['darwin-arm64'][1], /^[a-f0-9]{64}$/)
  assert.throws(() => validateArchiveEntries(['safe/rg', '../outside']), /不安全路径/)
})

test('文件服务元数据必须与客户端固定文件名和 SHA-256 一致', async () => {
  const content = Buffer.from('managed-search-binary')
  const sha256 = createHash('sha256').update(content).digest('hex')
  const server = http.createServer((request, response) => {
    const base = `http://127.0.0.1:${server.address().port}`
    response.setHeader('content-type', 'application/json')
    response.end(JSON.stringify({
      fileName: 'tool.tar.gz',
      fileSize: content.length,
      sha256,
      downloadUrl: `${base}/api/files/1/download`,
    }))
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}`

  try {
    const metadata = await resolveManagedAsset(base, 'tool.tar.gz', sha256)
    assert.equal(metadata.fileSize, content.length)
    assert.equal(metadata.sha256, sha256)
    await assert.rejects(
      resolveManagedAsset(base, 'tool.tar.gz', '0'.repeat(64)),
      /SHA-256 与客户端清单不一致/,
    )
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})

test('带失效临时令牌下载遇到 401 时匿名重试并校验完整内容', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'zvc-managed-download-'))
  const destination = path.join(root, 'asset.part')
  const content = Buffer.from('anonymous-download-fallback')
  let authenticatedRequests = 0
  let anonymousRequests = 0
  const server = http.createServer((request, response) => {
    if (request.headers.authorization) {
      authenticatedRequests += 1
      response.statusCode = 401
      response.end('expired')
      return
    }
    anonymousRequests += 1
    response.setHeader('content-length', String(content.length))
    response.end(content)
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const downloadUrl = `http://127.0.0.1:${server.address().port}/download`

  try {
    const result = await downloadAsset(downloadUrl, destination, () => {}, undefined, {
      token: 'expired-token',
      retryAnonymous: true,
      expectedBytes: content.length,
    })
    assert.equal(authenticatedRequests, 1)
    assert.equal(anonymousRequests, 1)
    assert.equal(result.sha256, createHash('sha256').update(content).digest('hex'))
    assert.deepEqual(await fs.readFile(destination), content)
  } finally {
    await new Promise((resolve) => server.close(resolve))
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('grep 和 find 在非 Git 工作区中仍启用 ignore 规则', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'zvc-search-ignore-'))
  const binaryRoot = path.join(root, 'bin')
  const platformKey = resolvePlatformKey()
  const calls = []
  for (const toolName of ['rg', 'fd']) {
    const binaryName = `${TOOL_MANIFEST[toolName].binary}${process.platform === 'win32' ? '.exe' : ''}`
    const binaryPath = path.join(binaryRoot, platformKey, `${toolName}-${TOOL_MANIFEST[toolName].version}`, binaryName)
    await fs.mkdir(path.dirname(binaryPath), { recursive: true })
    await fs.writeFile(binaryPath, '')
  }
  const tools = createSearchTools({
    resolvePath: (_workspace, input) => path.resolve(root, String(input)),
    processManager: {
      run: async (command, args) => {
        calls.push({ command, args })
        return path.basename(command).startsWith('rg')
          ? { code: 0, stdout: '', stderr: '' }
          : { code: 0, stdout: '', stderr: '' }
      },
    },
    getEnvironment: () => process.env,
    toolRoot: binaryRoot,
  })

  try {
    await tools.execute('grep', { pattern: 'needle', path: '.' }, null, {})
    await tools.execute('find', { pattern: '*.txt', path: '.' }, null, {})
    assert.equal(calls.length, 2)
    assert.ok(calls.every((call) => call.args.includes('--no-require-git')))
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})
