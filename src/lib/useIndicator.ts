import { useCallback, useEffect, useLayoutEffect, useRef } from 'react'

/**
 * 让一个绝对定位的"指示器"滑到当前激活项下方。
 *
 * 用测量而不是纯 CSS，是因为按钮宽度由内容决定（字号 14/18/24…、
 * tab 文案长度都不同）。只在 value 变化和窗口尺寸变化时重算，
 * 其余时间纯 transform 合成，不进主线程。
 *
 * offset 用于抵消容器的 1px 边框（绝对定位的 left:0 从 padding 边起算）。
 */
export function useIndicator<T>(value: T, offset = 0) {
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const indicatorRef = useRef<HTMLSpanElement | null>(null)

  const place = useCallback(() => {
    const wrap = wrapRef.current
    const indicator = indicatorRef.current
    if (!wrap || !indicator) return

    const active = wrap.querySelector<HTMLElement>('[data-active="true"]')
    if (!active) return

    const wrapRect = wrap.getBoundingClientRect()
    const activeRect = active.getBoundingClientRect()
    if (!activeRect.width) return

    indicator.style.width = `${activeRect.width}px`
    indicator.style.transform = `translateX(${activeRect.left - wrapRect.left - offset}px)`
  }, [offset])

  useLayoutEffect(() => {
    place()
  }, [place, value])

  useEffect(() => {
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [place])

  return { wrapRef, indicatorRef, place }
}
