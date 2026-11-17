/**
 * 微交互底座。
 *
 * 全部动效走同一套时长语义（见 docs/FRONTEND.md「动效体系」）：
 *   即时反馈 80–140ms · 状态迁移 200–320ms · 确定性等待 600–900ms
 *
 * 这里只放"必须动 DOM"的三件事：涟漪、火花、触感。
 * 其余（滑块、下划线、按钮三态）都由 CSS 状态 + transform 完成。
 */

export const RIPPLE_SELECTOR = [
  '.btn-primary',
  '.btn-icon',
  '.ghost-btn',
  '.glyph-btn',
  '.icon-btn',
  '.tab',
  '.seg button',
  '.rail-item',
  '.toast-undo',
].join(', ')

let reduceMotionCache: boolean | null = null

export function prefersReducedMotion(): boolean {
  if (reduceMotionCache !== null) return reduceMotionCache
  if (typeof window === 'undefined' || !window.matchMedia) {
    reduceMotionCache = false
    return reduceMotionCache
  }
  reduceMotionCache = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  return reduceMotionCache
}

export function tactile(): void {
  if (typeof navigator === 'undefined') return
  if (typeof navigator.vibrate !== 'function') return
  try {
    navigator.vibrate(8)
  } catch {
    /* 桌面端不支持，静默忽略 */
  }
}

/** 从指针落点扩散一个圆 —— 让"点到了"在 120ms 内有视觉回执 */
export function rippleFrom(event: PointerEvent, el: HTMLElement): void {
  if (prefersReducedMotion()) return
  const rect = el.getBoundingClientRect()
  if (!rect.width || !rect.height) return

  const size = Math.max(rect.width, rect.height) * 1.7
  const span = document.createElement('span')
  span.className = 'ripple'
  span.style.width = `${size}px`
  span.style.height = `${size}px`
  span.style.left = `${event.clientX - rect.left - size / 2}px`
  span.style.top = `${event.clientY - rect.top - size / 2}px`

  el.classList.add('ripple-host')
  el.appendChild(span)
  window.setTimeout(() => {
    span.remove()
  }, 520)
}

/** 收藏的六粒火花：从按钮中心向外抛，420ms 内消失 */
export function spawnSparks(el: HTMLElement): void {
  if (prefersReducedMotion()) return
  const rect = el.getBoundingClientRect()
  if (!rect.width) return

  const cx = rect.left + rect.width / 2
  const cy = rect.top + rect.height / 2

  for (let i = 0; i < 6; i += 1) {
    const angle = (Math.PI * 2 * i) / 6 - Math.PI / 2
    const distance = 13 + Math.random() * 6
    const spark = document.createElement('span')
    spark.className = 'spark'
    spark.style.left = `${cx}px`
    spark.style.top = `${cy}px`
    spark.style.setProperty('--tx', `${Math.cos(angle) * distance}px`)
    spark.style.setProperty('--ty', `${Math.sin(angle) * distance}px`)
    document.body.appendChild(spark)
    window.setTimeout(() => {
      spark.remove()
    }, 460)
  }
}
