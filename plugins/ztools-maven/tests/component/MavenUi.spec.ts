import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { installZtoolsStub, uninstallZtoolsStub } from '../helpers/ztools-stub'
import MavenUi from '../../src/MavenUi/index.vue'

describe('MavenUiPanel', () => {
  beforeEach(() => {
    uninstallZtoolsStub()
    installZtoolsStub()
  })

  it('renders empty state initially', () => {
    const w = mount(MavenUi, { props: { enterAction: {} } })
    // Sub-input placeholder is the panel's empty-state label.
    expect((window as any).ztools.setSubInput).toHaveBeenCalledWith(
      expect.any(Function),
      expect.stringContaining('搜索 Maven 包'),
      true,
    )
  })

  it('shows error box with structured details when search fails', async () => {
    const err = Object.assign(new Error('HTTP 500'), { url: 'https://x', status: 500, durationMs: 100, body: 'oops' })
    installZtoolsStub({
      services: {
        mavenSearch: vi.fn().mockRejectedValue(err),
      } as any,
    })
    const w = mount(MavenUi, { props: { enterAction: {} } })
    const cb = (window as any).ztools.setSubInput.mock.calls[0][0]
    cb('spring-core')
    await new Promise(r => setTimeout(r, 1600))
    await w.vm.$nextTick()
    expect(w.text()).toContain('搜索失败')
    expect(w.text()).toContain('HTTP 500')
  })

  it('opens action menu on Enter/c/p in version list (Mode A)', async () => {
    const stubs = installZtoolsStub({
      services: {
        mavenSearch: vi.fn().mockResolvedValue({
          data: [{ id: 'g:a', g: 'g', a: 'a', latestVersion: '1.0', timestamp: 1000 }],
          source: 'solr',
        }),
        mavenVersions: vi.fn().mockResolvedValue({
          data: [{ v: '1.0.0', timestamp: 1000 }],
          source: 'solr',
        }),
      } as any,
    })
    const w = mount(MavenUi, { props: { enterAction: {} } })
    // Trigger search via the setSubInput callback (debounced 300ms).
    const cb = (window as any).ztools.setSubInput.mock.calls[0][0]
    cb('g')
    await new Promise(r => setTimeout(r, 1600))
    await w.vm.$nextTick()
    await w.find('.results li').trigger('click')
    await new Promise(r => setTimeout(r, 50))
    await w.vm.$nextTick()
    // Copy keys are handled globally (onGlobalKey) — dispatch on window.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    await w.vm.$nextTick()
    expect(w.text()).toContain('POM')
    expect(w.text()).toContain('XML')
    expect(w.text()).toContain('Android')
    expect(w.text()).toContain('Gradle')
  })

  it('Tab cycles menu focus (Mode A)', async () => {
    installZtoolsStub({
      services: {
        mavenSearch: vi.fn().mockResolvedValue({ data: [{ id: 'g:a', g: 'g', a: 'a', latestVersion: '1.0', timestamp: 1000 }], source: 'solr' }),
        mavenVersions: vi.fn().mockResolvedValue({ data: [{ v: '1.0.0', timestamp: 1000 }], source: 'solr' }),
      } as any,
    })
    const w = mount(MavenUi, { props: { enterAction: {} } })
    const cb = (window as any).ztools.setSubInput.mock.calls[0][0]
    cb('g')
    await new Promise(r => setTimeout(r, 1600))
    await w.vm.$nextTick()
    await w.find('.results li').trigger('click')
    await new Promise(r => setTimeout(r, 50))
    await w.vm.$nextTick()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    await w.vm.$nextTick()
    await w.find('.menu-overlay').trigger('keydown', { key: 'Tab' })
    await w.find('.menu-overlay').trigger('keydown', { key: 'Enter' })
    expect((window as any).ztools.clipboard.writeContent).toHaveBeenCalled()
  })

  it('g shortcut copies Gradle directly (Mode A)', async () => {
    installZtoolsStub({
      services: {
        mavenSearch: vi.fn().mockResolvedValue({ data: [{ id: 'g:a', g: 'g', a: 'a', latestVersion: '1.0', timestamp: 1000, source: 'aliyun' }], source: 'aggregated' }),
        mavenVersions: vi.fn().mockResolvedValue({ data: [{ v: '1.0.0', timestamp: 1000 }], source: 'solr' }),
      } as any,
    })
    const w = mount(MavenUi, { props: { enterAction: {} } })
    const cb = (window as any).ztools.setSubInput.mock.calls[0][0]
    cb('g')
    await new Promise(r => setTimeout(r, 1600))
    await w.vm.$nextTick()
    await w.find('.results li').trigger('click')
    await new Promise(r => setTimeout(r, 50))
    await w.vm.$nextTick()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'g' }))
    const calls = (window as any).ztools.clipboard.writeContent.mock.calls
    expect(calls[0][0].content).toBe("implementation 'g:a:1.0.0'")
  })

  it('Cmd/Ctrl+K toggles help overlay', async () => {
    const w = mount(MavenUi, { props: { enterAction: {} } })
    expect(w.find('.help-overlay').exists()).toBe(false)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true }))
    await w.vm.$nextTick()
    expect(w.find('.help-overlay').exists()).toBe(true)
  })

  it('ArrowLeft/Right switches source tab even when results are empty', async () => {
    installZtoolsStub({
      services: {
        mavenSearch: vi.fn().mockResolvedValue({
          data: [], source: 'aggregated',
          sources: { solr: [], aliyun: [], coderead: [] },
        }),
      } as any,
    })
    const w = mount(MavenUi, { props: { enterAction: {} } })
    const cb = (window as any).ztools.setSubInput.mock.calls[0][0]
    cb('nothing')
    await new Promise(r => setTimeout(r, 800))
    await w.vm.$nextTick()
    expect(w.text()).toContain('没找到相关包')
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }))
    await w.vm.$nextTick()
    const central = w.findAll('.tab').find(b => b.text().includes('Central'))
    expect(central?.classes()).toContain('active')
  })

  it('Android category filters results', async () => {
    installZtoolsStub({
      services: {
        mavenSearch: vi.fn().mockResolvedValue({
          data: [
            { id: 'androidx.core:core', g: 'androidx.core', a: 'core', latestVersion: '1.13.0', timestamp: 1, source: 'solr' },
            { id: 'com.squareup:okhttp', g: 'com.squareup', a: 'okhttp', latestVersion: '4.12.0', timestamp: 1, source: 'solr' },
          ],
          source: 'aggregated',
          sources: { solr: [
            { id: 'androidx.core:core', g: 'androidx.core', a: 'core', latestVersion: '1.13.0', timestamp: 1, source: 'solr' },
            { id: 'com.squareup:okhttp', g: 'com.squareup', a: 'okhttp', latestVersion: '4.12.0', timestamp: 1, source: 'solr' },
          ], aliyun: [], coderead: [] },
        }),
      } as any,
    })
    const w = mount(MavenUi, { props: { enterAction: {} } })
    const cb = (window as any).ztools.setSubInput.mock.calls[0][0]
    cb('core')
    await new Promise(r => setTimeout(r, 800))
    await w.vm.$nextTick()
    // Both rows visible initially.
    expect(w.text()).toContain('androidx.core:core')
    expect(w.text()).toContain('com.squareup:okhttp')
    // Click Android category.
    const androidCat = w.findAll('.cat').find(b => b.text().includes('Android'))
    await androidCat?.trigger('click')
    await w.vm.$nextTick()
    expect(w.text()).toContain('androidx.core:core')
    expect(w.text()).not.toContain('com.squareup:okhttp')
  })

  it('非安卓 (java) category filters out Android artifacts', async () => {
    installZtoolsStub({
      services: {
        mavenSearch: vi.fn().mockResolvedValue({
          data: [
            { id: 'androidx.core:core', g: 'androidx.core', a: 'core', latestVersion: '1.13.0', timestamp: 1, source: 'solr' },
            { id: 'com.squareup:okhttp', g: 'com.squareup', a: 'okhttp', latestVersion: '4.12.0', timestamp: 1, source: 'solr' },
          ],
          source: 'aggregated',
          sources: { solr: [
            { id: 'androidx.core:core', g: 'androidx.core', a: 'core', latestVersion: '1.13.0', timestamp: 1, source: 'solr' },
            { id: 'com.squareup:okhttp', g: 'com.squareup', a: 'okhttp', latestVersion: '4.12.0', timestamp: 1, source: 'solr' },
          ], aliyun: [], coderead: [] },
        }),
      } as any,
    })
    const w = mount(MavenUi, { props: { enterAction: {} } })
    const cb = (window as any).ztools.setSubInput.mock.calls[0][0]
    cb('core')
    await new Promise(r => setTimeout(r, 800))
    await w.vm.$nextTick()
    const javaCat = w.findAll('.cat').find(b => b.text().includes('非安卓'))
    await javaCat?.trigger('click')
    await w.vm.$nextTick()
    expect(w.text()).not.toContain('androidx.core:core')
    expect(w.text()).toContain('com.squareup:okhttp')
  })

  it('version panel Android category filters versions', async () => {
    installZtoolsStub({
      services: {
        mavenSearch: vi.fn().mockResolvedValue({
          data: [{ id: 'g:a', g: 'g', a: 'a', latestVersion: '2.0.0', timestamp: 1, source: 'solr' }],
          source: 'aggregated',
          sources: { solr: [{ id: 'g:a', g: 'g', a: 'a', latestVersion: '2.0.0', timestamp: 1, source: 'solr' }], aliyun: [], coderead: [] },
        }),
        mavenVersions: vi.fn().mockResolvedValue({
          data: [
            { v: '2.0.0', timestamp: 1000 },
            { v: '2.0.60.android8', timestamp: 900 },
          ],
          source: 'solr',
        }),
      } as any,
    })
    const w = mount(MavenUi, { props: { enterAction: {} } })
    const cb = (window as any).ztools.setSubInput.mock.calls[0][0]
    cb('g')
    await new Promise(r => setTimeout(r, 800))
    await w.vm.$nextTick()
    await w.find('.results li').trigger('click')
    await new Promise(r => setTimeout(r, 50))
    await w.vm.$nextTick()
    // Both versions listed before filtering.
    expect(w.text()).toContain('2.0.60.android8')
    expect(w.text()).toContain('2.0.0')
    const androidCat = w.findAll('.cat').find(b => b.text().includes('Android'))
    await androidCat?.trigger('click')
    await w.vm.$nextTick()
    expect(w.text()).toContain('2.0.60.android8')
    expect(w.text()).not.toContain('2.0.0')
  })
})
