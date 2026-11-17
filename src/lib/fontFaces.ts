import { convertFileSrc } from '@tauri-apps/api/core'
import type { Font } from '../types/font'
import { CATEGORY_FALLBACK } from './filter'
import { isTauriRuntime } from './ipc'

/**
 * 字体预览的真实来源。
 *
 * 已安装的字体直接写 `font-family`，WebView 用它自己的字体栈，零成本。
 * 自定义目录里的字体系统不认识，必须通过 `font://` 协议把字节喂给
 * `@font-face` —— 否则整屏会退化成同一个兜底字体。
 *
 * 两条路径都收在 `faceFamily()` 一个函数里，将来若要"统一走协议"
 * （为了让预览严格等于索引到的那份文件），只改这里。
 */

/** 同时存活的 @font-face 上限。3k 个字体全量注入会把 WebView 内存打爆。 */
const MAX_LIVE = 120

const mounted = new Map<string, HTMLStyleElement>()
const order: string[] = []

function needsFileFace(font: Font): boolean {
  return isTauriRuntime && font.source === 'custom'
}

function familyOf(font: Font): string {
  return `fn-${font.id}`
}

function formatHint(font: Font): string {
  switch (font.format) {
    case 'otf':
      return 'opentype'
    case 'ttc':
    case 'otc':
      return 'collection'
    default:
      return 'truetype'
  }
}

function mount(font: Font): void {
  const url = convertFileSrc(font.id, 'font')
  const style = document.createElement('style')
  style.dataset.fontId = font.id
  // 权重与倾斜必须和卡片上的计算值完全一致，否则浏览器会合成假粗体/假斜体
  style.textContent =
    `@font-face{` +
    `font-family:'${familyOf(font)}';` +
    `src:url("${url}") format('${formatHint(font)}');` +
    `font-weight:${font.weight};` +
    `font-style:${font.italic ? 'italic' : 'normal'};` +
    `font-display:swap;` +
    `}`
  document.head.appendChild(style)
  mounted.set(font.id, style)
}

function evict(): void {
  while (order.length > MAX_LIVE) {
    const victim = order.shift()
    if (!victim) break
    mounted.get(victim)?.remove()
    mounted.delete(victim)
  }
}

function touch(id: string): void {
  const index = order.indexOf(id)
  if (index >= 0) order.splice(index, 1)
  order.push(id)
  evict()
}

/**
 * 纯函数：给定字体返回可直接写进 style 的 `font-family` 值。
 * 渲染期调用它是安全的，真正的副作用在 `ensureFace` 里。
 */
export function faceFamily(font: Font): string {
  const fallback = CATEGORY_FALLBACK[font.category]
  if (!needsFileFace(font)) {
    return `'${font.family}', ${fallback}`
  }
  return `'${familyOf(font)}', ${fallback}`
}

/** 幂等地注入 @font-face。请在 effect 里调用，不要在渲染期调用。 */
export function ensureFace(font: Font): void {
  if (!needsFileFace(font)) return
  if (!mounted.has(font.id)) mount(font)
  touch(font.id)
}
