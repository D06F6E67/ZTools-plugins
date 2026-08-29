import assert from 'node:assert/strict'
import test from 'node:test'
import { getToolExecutionMode, TOOL_GROUPS } from '../../src/tools.js'

test('Bash 超时参数明确使用毫秒并提供有界的前台执行时间', () => {
  const shellGroup = TOOL_GROUPS.find((group) => group.id === 'shell')
  const shellTool = shellGroup?.tools.find((tool) => tool.function.name === 'bash')
  const properties = shellTool?.function.parameters.properties || {}

  assert.equal(properties.timeout, undefined)
  assert.deepEqual(properties.timeoutMs, {
    type: 'integer',
    description: '前台命令超时时间，单位毫秒。默认 120000（120 秒），最大 600000（10 分钟）。不要传入秒数。',
    minimum: 1000,
    maximum: 600000,
    default: 120000,
  })
})

test('文件与搜索工具使用 Pi 风格的精简协议', () => {
  const fileNames = TOOL_GROUPS.find((group) => group.id === 'files')?.tools.map((tool) => tool.function.name)
  const searchNames = TOOL_GROUPS.find((group) => group.id === 'search')?.tools.map((tool) => tool.function.name)

  assert.deepEqual(fileNames, ['read', 'write', 'edit'])
  assert.deepEqual(searchNames, ['grep', 'find', 'ls'])
})

test('Python 执行统一通过 Bash 提供', () => {
  const groupIds = TOOL_GROUPS.map((group) => group.id)
  const toolNames = TOOL_GROUPS.flatMap((group) => group.tools.map((tool) => tool.function.name))

  assert.equal(groupIds.includes('python'), false)
  assert.equal(toolNames.some((name) => name.includes('python')), false)
  assert.equal(toolNames.includes('bash'), true)
})

test('当前时间统一通过 Bash 提供', () => {
  const groupIds = TOOL_GROUPS.map((group) => group.id)
  const toolNames = TOOL_GROUPS.flatMap((group) => group.tools.map((tool) => tool.function.name))

  assert.equal(groupIds.includes('time'), false)
  assert.equal(toolNames.includes('get_current_time'), false)
  assert.equal(toolNames.includes('bash'), true)
})

test('工具并发策略只放行无副作用的读取调用', () => {
  assert.equal(getToolExecutionMode('read'), 'parallel')
  assert.equal(getToolExecutionMode('grep'), 'parallel')
  assert.equal(getToolExecutionMode('builtin_web_search'), 'parallel')
  assert.equal(getToolExecutionMode('task_read'), 'parallel')
  assert.equal(getToolExecutionMode('write'), 'exclusive')
  assert.equal(getToolExecutionMode('edit'), 'exclusive')
  assert.equal(getToolExecutionMode('bash'), 'exclusive')
  assert.equal(getToolExecutionMode('unknown-tool'), 'exclusive')
})
