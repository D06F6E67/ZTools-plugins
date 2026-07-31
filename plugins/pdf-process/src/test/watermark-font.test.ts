import { describe, it, expect } from 'vitest'

/**
 * Tests for CJK font detection logic.
 * Mirrors the logic in public/preload/services.js selectFontForText()
 */

// Copy of CJK_REGEX from services.js
const CJK_REGEX = /[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]/

// Simulates the pdfcpu font mapping: Windows name → pdfcpu name
const PDFCPU_FONT_MAP: Record<string, string> = {
  'Microsoft YaHei': 'MicrosoftYaHei',
}

function selectFontForText(text: string): string {
  if (CJK_REGEX.test(text)) {
    const windowsFont = 'Microsoft YaHei'
    return PDFCPU_FONT_MAP[windowsFont] || windowsFont
  }
  return 'Helvetica'
}

describe('CJK font detection', () => {
  it('detects Chinese characters', () => {
    expect(selectFontForText('机密文件')).toBe('MicrosoftYaHei')
    expect(selectFontForText('水印测试')).toBe('MicrosoftYaHei')
    expect(selectFontForText('中文')).toBe('MicrosoftYaHei')
  })

  it('detects Japanese characters', () => {
    expect(selectFontForText('こんにちは')).toBe('MicrosoftYaHei')
    expect(selectFontForText('テスト')).toBe('MicrosoftYaHei')
  })

  it('detects Korean characters', () => {
    expect(selectFontForText('안녕하세요')).toBe('MicrosoftYaHei')
  })

  it('uses Helvetica for non-CJK text', () => {
    expect(selectFontForText('Hello World')).toBe('Helvetica')
    expect(selectFontForText('Watermark')).toBe('Helvetica')
    expect(selectFontForText('123 ABC')).toBe('Helvetica')
  })

  it('detects mixed CJK and Latin text', () => {
    expect(selectFontForText('Hello 世界')).toBe('MicrosoftYaHei')
    expect(selectFontForText('PDF水印')).toBe('MicrosoftYaHei')
  })

  it('handles empty text', () => {
    expect(selectFontForText('')).toBe('Helvetica')
  })
})

describe('CJK_REGEX pattern', () => {
  it('matches CJK Unified Ideographs', () => {
    expect(CJK_REGEX.test('中')).toBe(true)
    expect(CJK_REGEX.test('国')).toBe(true)
    expect(CJK_REGEX.test('文')).toBe(true)
  })

  it('matches Hiragana and Katakana', () => {
    expect(CJK_REGEX.test('あ')).toBe(true) // Hiragana
    expect(CJK_REGEX.test('ア')).toBe(true) // Katakana
  })

  it('matches Hangul', () => {
    expect(CJK_REGEX.test('가')).toBe(true)
    expect(CJK_REGEX.test('힣')).toBe(true)
  })

  it('does not match Latin or digits', () => {
    expect(CJK_REGEX.test('A')).toBe(false)
    expect(CJK_REGEX.test('Z')).toBe(false)
    expect(CJK_REGEX.test('0')).toBe(false)
    expect(CJK_REGEX.test('9')).toBe(false)
    expect(CJK_REGEX.test('!')).toBe(false)
    expect(CJK_REGEX.test(' ')).toBe(false)
  })
})
