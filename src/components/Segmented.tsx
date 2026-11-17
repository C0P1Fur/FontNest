import type { ReactNode } from 'react'
import { useIndicator } from '../lib/useIndicator'

export interface SegmentedOption<T extends string | number> {
  value: T
  label: ReactNode
  ariaLabel?: string
}

interface SegmentedProps<T extends string | number> {
  options: readonly SegmentedOption<T>[]
  value: T
  onChange: (value: T) => void
  ariaLabel: string
  className?: string
}

/**
 * 分段控件。激活态由一个绝对定位的黑色滑块表达，
 * 切换时滑块用弹簧曲线滑过去 —— 这是界面上最常被触发的 L2 动效。
 */
export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  ariaLabel,
  className,
}: SegmentedProps<T>) {
  const { wrapRef, indicatorRef } = useIndicator<T>(value, 1)

  return (
    <div
      ref={wrapRef}
      className={className ? `seg ${className}` : 'seg'}
      role="group"
      aria-label={ariaLabel}
    >
      <span ref={indicatorRef} className="seg-ind" aria-hidden="true" />
      {options.map((option) => {
        const active = option.value === value
        return (
          <button
            key={String(option.value)}
            type="button"
            data-active={active}
            className={active ? 'is-active' : undefined}
            aria-pressed={active}
            aria-label={option.ariaLabel}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
