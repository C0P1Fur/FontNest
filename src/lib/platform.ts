/**
 * 平台判断与快捷键写法。
 *
 * 为什么需要这个：界面里原本写死 `⌘K`，但那是 macOS 的 Command 键。
 * Windows 上既没有这个键（实际要按 Ctrl），而且 `⌘`(U+2318) 在中文
 * 字体里常常缺字，浏览器回退到别的字体后画出来是歪的。
 */

interface UserAgentData {
  platform?: string
}

function detectPlatform(): string {
  if (typeof navigator === 'undefined') return ''
  const data = (navigator as Navigator & { userAgentData?: UserAgentData }).userAgentData
  // userAgentData 是新接口，取不到时退回已废弃但仍普遍可用的 platform
  return data?.platform ?? navigator.platform ?? ''
}

export const isMacOS = /mac/i.test(detectPlatform())

/**
 * 修饰键的界面写法：macOS 用符号，其余平台用文字。
 * @param key 主键，如 'K'
 */
export function modShortcut(key: string): string {
  return isMacOS ? `⌘${key}` : `Ctrl ${key}`
}
