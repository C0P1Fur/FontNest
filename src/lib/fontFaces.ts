import { convertFileSrc } from '@tauri-apps/api/core'
import type { Font } from '../types/font'
import { CATEGORY_FALLBACK } from './filter'
import { isTauriRuntime } from './ipc'

/**
 * 字体预览的真实来源。
 *
 * 系统已安装的字体本来可以直接写 `font-family`，零成本。
 * 但有两类字体必须通过 `font://` 协议把字节喂给 `@font-face`：
 *
 * 1. 自定义目录里的字体 —— 系统根本不认识它们
 * 2. **可变字体** —— 走系统家族名时，WebView 把渲染交给系统字体后端
 *    （Windows 上是 DirectWrite），那里的 `font-variation-settings`
 *    会被忽略。实测：同一个 bahnschrift.ttf，按系统名引用时 wdth 轴从
 *    75 拖到 100 字形宽度一像素不变（336.6px → 336.6px）；改成
 *    @font-face 注入后立刻生效（246.3px）。wght 同理。
 *
 * 两条路径都收在 `faceFamily()` 一个函数里。
 */

/** 同时存活的 @font-face 上限。全量注入会把 WebView 内存打爆。 */
const MAX_LIVE = 120

const mounted = new Map<string, HTMLStyleElement>()
const order: string[] = []

function needsFileFace(font: Font): boolean {
  if (!isTauriRuntime) return false
  // 自定义目录的字体系统不认识，必须注入
  if (font.source === 'custom') return true
  // TTC/OTC 是多 face 集合，@font-face 只能拿到 face 0。
  // 宁可按老办法渲染出正确字形，也不要为了轴而显示成另一个 face。
  if (font.format === 'ttc' || font.format === 'otc') return false
  return font.variable
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

/** 轴值可能是 14.0 这种，直接拼进 CSS 会变成 "14" 也没问题，但统一一下更好读 */
function num(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 100) / 100)
}

function axis(font: Font, tag: string) {
  return font.axes.find((item) => item.tag === tag)
}

/**
 * 构造 @font-face 的规则体。
 *
 * 描述符（font-weight / font-stretch）不是"我想用什么"，而是
 * **告诉浏览器这个文件支持哪些范围**。可变字体必须写区间：
 * 写成单值 `font-weight: 400` 时，浏览器把这个 face 当成静态的 400 号，
 * 不仅丢掉整条轴的调节能力，连 `font-weight: 700` 都匹配不上。
 *
 * 抽成纯函数是为了能单测 —— 写错一个字符，整条 face 会静默失效，
 * 表现是"字体变成兜底字体"，在界面上很难和别的问题区分开。
 */
export function faceRule(font: Font, url: string): string {
  const wght = axis(font, 'wght')
  const wdth = axis(font, 'wdth')

  // 权重：有 wght 轴就声明整段区间，否则保持单值（静态字体只能这样）
  const weight =
    font.variable && wght && wght.max > wght.min
      ? `${num(wght.min)} ${num(wght.max)}`
      : `${font.weight}`

  // 宽度：只在真的有 wdth 轴时才写，否则会被当成静态 face
  const stretch =
    font.variable && wdth && wdth.max > wdth.min
      ? `font-stretch:${num(wdth.min)}% ${num(wdth.max)}%;`
      : ''

  return (
    `@font-face{` +
    `font-family:'${familyOf(font)}';` +
    `src:url("${url}") format('${formatHint(font)}');` +
    `font-weight:${weight};` +
    `font-style:${font.italic ? 'italic' : 'normal'};` +
    stretch +
    `font-display:swap;` +
    `}`
  )
}

function mount(font: Font): void {
  const url = convertFileSrc(font.id, 'font')
  const style = document.createElement('style')
  style.dataset.fontId = font.id
  style.textContent = faceRule(font, url)
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
