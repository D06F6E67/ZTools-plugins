import { clipboard } from 'electron'
import {
  convertByCode,
  hasEnglishLetter,
  successMessage,
} from './case-convert.js'

/** 计划退出插件的时长 */
const IDLE_KILL_MS = 3 * 60 * 1000

let idleKillTimer: ReturnType<typeof setTimeout> | null = null

function clearIdleKillTimer(): void {
  if (idleKillTimer !== null) {
    clearTimeout(idleKillTimer)
    idleKillTimer = null
  }
}

/** 隐藏窗口，如果3分钟内没有使用则退出插件 */
function scheduleIdleKill(): void {
  clearIdleKillTimer()
  idleKillTimer = setTimeout(() => {
    idleKillTimer = null
    window.ztools.outPlugin(true)
  }, IDLE_KILL_MS)
}

function resolvePayloadText(payload: unknown): string {
  if (typeof payload === 'string') return payload
  if (payload && typeof payload === 'object' && 'text' in payload) {
    const text = (payload as { text: unknown }).text
    if (typeof text === 'string') return text
  }
  return ''
}

function resolveInputText(type: string, payload: unknown): string {
  if (type === 'regex' || type === 'over') {
    return resolvePayloadText(payload)
  }
  return clipboard.readText()
}

/** 隐藏窗口，计划退出 */
function exitPlugin(): void {
  window.ztools.outPlugin(false)
  scheduleIdleKill()
}

window.ztools.onPluginEnter(({ code, type, payload }: { code: string; type: string; payload: unknown }) => {
  clearIdleKillTimer()

  const text = resolveInputText(type, payload)

  if (!hasEnglishLetter(text)) {
    window.ztools.showNotification('未检测到有效英文字母')
    window.ztools.hideMainWindow()
    exitPlugin()
    return
  }

  const result = convertByCode(code, text)
  if (result === null) {
    window.ztools.showNotification('未知功能')
    window.ztools.hideMainWindow()
    exitPlugin()
    return
  }

  const fromSelection = type === 'regex' || type === 'over'
  if (fromSelection) {
    window.ztools.hideMainWindowPasteText(result)
  } else {
    window.ztools.copyText(result)
    window.ztools.hideMainWindow()
  }

  // window.ztools.showNotification(successMessage(code))
  exitPlugin()
})

window.ztools.onPluginOut((processExit) => {
  if (processExit) clearIdleKillTimer()
})
