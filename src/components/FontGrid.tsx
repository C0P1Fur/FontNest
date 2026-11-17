import { memo } from 'react'
import type { Font, ViewMode } from '../types/font'
import { FontCard } from './FontCard'

interface FontGridProps {
  fonts: Font[]
  sample: string
  selectedId: string | null
  view: ViewMode
  onSelect: (id: string) => void
  onToggleFavorite: (id: string) => void
  onToggleEnabled: (id: string) => void
}

/**
 * 网格本身也 memo 化。
 *
 * App 因为字号、主题、Toast 之类的状态重渲染时，只要 fonts / selectedId
 * 没变，这里就整棵跳过 —— 不做 401 次 createElement。
 */
export const FontGrid = memo(function FontGrid({
  fonts,
  sample,
  selectedId,
  view,
  onSelect,
  onToggleFavorite,
  onToggleEnabled,
}: FontGridProps) {
  if (fonts.length === 0) {
    return (
      <div className="empty">
        <p className="empty-title">没有匹配的字体</p>
        <p className="empty-body">试试清空搜索，或换一个分类。</p>
      </div>
    )
  }

  return (
    <ul
      className={view === 'list' ? 'grid is-list' : 'grid'}
      role="listbox"
      aria-label="字体列表"
    >
      {fonts.map((font, index) => (
        <FontCard
          key={font.id}
          font={font}
          index={index}
          sample={sample}
          selected={font.id === selectedId}
          onSelect={onSelect}
          onToggleFavorite={onToggleFavorite}
          onToggleEnabled={onToggleEnabled}
        />
      ))}
    </ul>
  )
})
