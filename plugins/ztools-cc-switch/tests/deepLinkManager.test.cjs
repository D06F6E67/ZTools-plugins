'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { parseDeepLink, createDeepLinkManager } = require('../preload/deepLinkManager')

function encoded(value) { return Buffer.from(value).toString('base64url') }

test('解析上游 v1 Provider、Prompt、MCP 与 Skill Deep Link', () => {
  const provider = parseDeepLink('ccswitch://v1/import?resource=provider&app=claude&name=Deep%20Claude&endpoint=https%3A%2F%2Fapi.example.com%2Fv1&apiKey=sk-secret&model=claude-sonnet&enabled=true')
  assert.equal(provider.resource, 'provider'); assert.equal(provider.app, 'claude'); assert.equal(provider.apiKey, 'sk-secret'); assert.equal(provider.enabled, true)
  const prompt = parseDeepLink(`ccswitch://v1/import?resource=prompt&app=codex&name=Review&content=${encoded('# Review\nBe strict.')}`)
  assert.equal(prompt.content, '# Review\nBe strict.')
  const mcp = parseDeepLink(`ccswitch://v1/import?resource=mcp&apps=claude,codex&config=${encoded(JSON.stringify({ mcpServers: { demo: { command: 'demo-mcp', args: ['--stdio'] } } }))}&enabled=true`)
  assert.deepEqual(mcp.apps, ['claude', 'codex']); assert.equal(mcp.mcpServers.demo.command, 'demo-mcp')
  const skill = parseDeepLink('ccswitch://v1/import?resource=skill&repo=anthropics%2Fskills&branch=main')
  assert.equal(skill.repo, 'anthropics/skills'); assert.equal(skill.enabled, true)
})

test('Preload 只返回脱敏预览并以一次性 ID 确认导入', async () => {
  const calls = []
  const usageCode = `({request:{url:'https://api.example.com/quota',method:'GET'},extractor:function(response){return response}})`
  const manager = createDeepLinkManager({
    configManager: {
      saveProvider: async (provider) => { calls.push(['provider', provider]); return provider },
      switchProvider: async (app, id) => calls.push(['switch', app, id])
    },
    extensionManager: {}, skillManager: {}, saveUsageScript: async (id, config) => calls.push(['usage', id, config])
  })
  const prepared = await manager.prepare(`ccswitch://v1/import?resource=provider&app=codex&name=Private&endpoint=https%3A%2F%2Fapi.example.com%2Fv1&apiKey=sk-private-token&model=gpt-5&enabled=true&usageEnabled=true&usageScript=${encoded(usageCode)}&usageApiKey=sk-private-token&usageAccessToken=usage-secret&usageAutoInterval=30`)
  assert.equal(JSON.stringify(prepared).includes('sk-private-token'), false)
  assert.equal(JSON.stringify(prepared).includes('usage-secret'), false)
  assert.equal(prepared.preview.usageEnabled, true)
  assert.match(prepared.preview.maskedApiKey, /^sk-p/)
  const result = await manager.confirm(prepared.pendingId)
  assert.equal(result.type, 'provider'); assert.equal(calls[0][1].apiKey, 'sk-private-token'); assert.equal(calls[1][0], 'usage'); assert.equal(calls[1][2].code, usageCode); assert.equal(calls[1][2].apiKey, ''); assert.equal(calls[1][2].accessToken, 'usage-secret'); assert.equal(calls[2][0], 'switch')
  await assert.rejects(() => manager.confirm(prepared.pendingId), /过期/)
})

test('导入 MCP、Prompt 和 Skill 时复用现有管理器并保留逐项失败', async () => {
  const saved = []
  const manager = createDeepLinkManager({
    configManager: {},
    extensionManager: {
      savePrompt: async (item) => { saved.push(['prompt', item]); return item },
      setPromptEnabled: async (id, app) => saved.push(['prompt-enable', id, app]),
      saveMcp: async (item) => { if (item.id === 'broken') throw new Error('invalid'); saved.push(['mcp', item]); return item },
      setMcpEnabled: async (id, app) => saved.push(['mcp-enable', id, app])
    },
    skillManager: { addSkillRepo: async (repo) => saved.push(['skill', repo]) }
  })
  const prompt = await manager.prepare(`ccswitch://v1/import?resource=prompt&app=claude&name=Plan&content=${encoded('Plan first')}&enabled=true`)
  assert.equal((await manager.confirm(prompt.pendingId)).type, 'prompt')
  const config = encoded(JSON.stringify({ mcpServers: { good: { command: 'mcp' }, broken: { command: '' } } }))
  const mcp = await manager.prepare(`ccswitch://v1/import?resource=mcp&apps=claude&config=${config}&enabled=true`)
  const mcpResult = await manager.confirm(mcp.pendingId); assert.equal(mcpResult.importedCount, 1); assert.equal(mcpResult.failed.length, 1)
  const skill = await manager.prepare('ccswitch://v1/import?resource=skill&repo=owner%2Frepo&branch=develop')
  assert.equal((await manager.confirm(skill.pendingId)).type, 'skill')
  assert.ok(saved.some(([type]) => type === 'skill'))
})

test('拒绝未知协议、URL 凭据、非法应用和超大内容', () => {
  assert.throws(() => parseDeepLink('https://v1/import?resource=skill&repo=a%2Fb'), /仅支持/)
  assert.throws(() => parseDeepLink('ccswitch://v1/import?resource=provider&app=unknown&name=x&endpoint=https%3A%2F%2Fa.com&apiKey=x'), /不支持/)
  assert.throws(() => parseDeepLink('ccswitch://v1/import?resource=provider&app=claude&name=x&endpoint=https%3A%2F%2Fu%3Ap%40a.com&apiKey=x'), /凭据/)
  assert.throws(() => parseDeepLink(`ccswitch://v1/import?resource=prompt&app=claude&name=x&content=${'A'.repeat(1500000)}`), /过长|Base64/)
})
