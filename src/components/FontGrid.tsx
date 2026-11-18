import { memo } from 'react'
import type { Font, SelectionMode, ViewMode } from '../types/font'
import { FontCard } from './FontCard'

/** 卡片所属分组的信息，由 App 一次性算好，避免每张卡各算一遍 */
export interface GroupInfo {
  key: string
  size: number
  expanded: boolean
  primaryId: string
}

interface FontGridProps {
  fonts: Font[]
  groupInfo: Map<string, GroupInfo>
  sample: string
  selectedId: string | null
  view: ViewMode
  selectionMode: SelectionMode | null
  /** 已勾选的字体族 key。用 Set 而不是数组：几百张卡每次渲染都要查一次 */
  pickedFamilies: Set<string>
  onSelect: (id: string) => void
  onToggleFavorite: (id: string) => void
  onToggleGroup: (key: string) => void
  /** 参数是字体族 key —— 多选以族为粒度 */
  onToggleSelected: (familyKey: string) => void
}

/**
 * 网格本身也 memo 化。
 *
 * App 因为字号、主题、Toast 之类的状态重渲染时，只要 fonts / selectedId
 * 没变，这里就整棵跳过 —— 不做 401 次 createElement。
 */
export const FontGrid = memo(function FontGrid({  fonts,
  groupInfo,
  sample,
  selectedId,
  view,
  selectionMode,
  pickedFamilies,
  onSelect,
  onToggleFavorite,
  onToggleGroup,
  onToggleSelected,
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
      aria-multiselectable={selectionMode !== null || undefined}
    >
      {fonts.map((font, index) => {
        const group = groupInfo.get(font.id)
        // 每个通道只放行"真能操作"的字体：
        // 装的时候灰掉已装的，卸的时候灰掉没装的；
        // 对比通道对所有字体开放 —— 系统字体也值得拿来比。
        const selectable =
          selectionMode === 'compare'
            ? true
            : font.source === 'custom' &&
              (selectionMode === 'install' ? !font.enabled : font.enabled)
        return (
          <FontCard
            key={font.id}
            font={font}
            index={index}
            group={group}
            sample={sample}
            selected={font.id === selectedId}
            selectionMode={selectionMode !== null}
            picked={pickedFamilies.has(font.family.toLowerCase())}
            selectable={selectable}
            onSelect={onSelect}
            onToggleFavorite={onToggleFavorite}
            onToggleGroup={onToggleGroup}
            onToggleSelected={onToggleSelected}
          />
        )
      })}
    </ul>
  )
})
