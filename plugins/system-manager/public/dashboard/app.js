'use strict'

function currentPlatform() {
  const value = `${navigator.userAgentData && navigator.userAgentData.platform || ''} ${navigator.platform || ''} ${navigator.userAgent || ''}`.toLowerCase()
  if (value.includes('mac')) return { id: 'darwin', label: 'macOS' }
  if (value.includes('win')) return { id: 'win32', label: 'Windows' }
  if (value.includes('linux')) return { id: 'linux', label: 'Linux' }
  return null
}

const platform = currentPlatform()
const status = document.querySelector('.current-platform')

if (platform) {
  document.querySelectorAll(`[data-platform="${platform.id}"]`).forEach((element) => element.classList.add('is-current'))
  if (status) status.textContent = `当前平台：${platform.label} · 5 项能力可用`
} else if (status) {
  status.textContent = '当前平台未识别 · 请查看各模块支持范围'
}

document.querySelectorAll('[data-feature]').forEach((card) => {
  const openInCurrentView = (event) => {
    if (event.defaultPrevented || (event.button !== 0 && event.button !== 1)) return
    event.preventDefault()
    const fallback = card.href
    const suite = window.systemManagerSuite
    if (!suite || typeof suite.openFeature !== 'function') {
      window.location.assign(fallback)
      return
    }
    try {
      const result = suite.openFeature(card.dataset.feature)
      if (result === false) window.location.assign(fallback)
      else if (result && typeof result.then === 'function') result.then((opened) => {
        if (opened === false) window.location.assign(fallback)
      }).catch(() => window.location.assign(fallback))
    } catch {
      window.location.assign(fallback)
    }
  }
  card.addEventListener('click', openInCurrentView)
  card.addEventListener('auxclick', openInCurrentView)
})
