/** Feature codes matching plugin.json */
export type CaseFeatureCode = 'smart' | 'upper' | 'lower' | 'invert'

const ENGLISH_LETTER = /[A-Za-z]/

/** 是否包含至少一个英文字母 */
export function hasEnglishLetter(text: string): boolean {
  return ENGLISH_LETTER.test(text)
}

/**
 * 智能转换：仅统计英文字母。
 * - 大写字母多于小写字母 → 转为小写
 * - 否则（包括相等） → 转为大写
 */
export function smartConvert(text: string): string {
  let upper = 0
  let lower = 0
  for (const ch of text) {
    if (ch >= 'A' && ch <= 'Z') upper++
    else if (ch >= 'a' && ch <= 'z') lower++
  }
  return upper > lower ? text.toLowerCase() : text.toUpperCase()
}

export function toUpper(text: string): string {
  return text.toUpperCase()
}

export function toLower(text: string): string {
  return text.toLowerCase()
}

/** 大小写反转 */
export function invertCase(text: string): string {
  let result = ''
  for (const ch of text) {
    if (ch >= 'A' && ch <= 'Z') result += ch.toLowerCase()
    else if (ch >= 'a' && ch <= 'z') result += ch.toUpperCase()
    else result += ch
  }
  return result
}

export function convertByCode(code: string, text: string): string | null {
  switch (code as CaseFeatureCode) {
    case 'smart':
      return smartConvert(text)
    case 'upper':
      return toUpper(text)
    case 'lower':
      return toLower(text)
    case 'invert':
      return invertCase(text)
    default:
      return null
  }
}

export function successMessage(code: string): string {
  switch (code as CaseFeatureCode) {
    case 'smart':
      return '已智能转换大小写'
    case 'upper':
      return '已转为大写'
    case 'lower':
      return '已转为小写'
    case 'invert':
      return '已反转大小写'
    default:
      return '转换完成'
  }
}
