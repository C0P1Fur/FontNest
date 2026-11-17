import { memo } from 'react'
import type { Font } from '../types/font'
import { fontStack } from '../lib/filter'
import { spawnSparks } from '../lib/motion'
import { StarIcon } from './Icons'

interface FontCardProps {
  font: Font
  index: number
  sample: string
  selected: boolean
  onSelect: (id: string) => void
  onToggleFavorite: (id: string) => void
  onToggleEnabled: (id: string) => void
}

/**
 * 一张字体卡：名字和样张都用该字体自身渲染。
 * 未启用的字体整体降透明度，但保留可读性，避免"看不出是禁用还是加载中"。
 */
export const FontCard = memo(function FontCard({
  font,
  index,
  sample,
  selected,
  onSelect,
  onToggleFavorite,
  onToggleEnabled,
}: FontCardProps) {
  // 同一个 family 的 Regular / Bold / Italic 是不同记录，
  // 卡片必须把字重与倾斜也带上，否则四条 Arial 会长得一模一样。
  const face = {
    fontFamily: fontStack(font),
    fontWeight: font.weight,
    fontStyle: font.italic ? 'italic' : 'normal',
  }
  // 首屏错开进场，避免 58 张卡同时闪一下
  const delay = { animationDelay: `${Math.min(index * 14, 220)}ms` }

  return (
    <li
      className={font.enabled ? 'card' : 'card is-off'}
      role="option"
      aria-selected={selected}
      tabIndex={selected ? 0 : -1}
      data-id={font.id}
      style={delay}
      onClick={() => onSelect(font.id)}
      onDoubleClick={() => onToggleEnabled(font.id)}
      onKeyDown={(event) => {
        // Space 留给全局快捷键（启用/停用），这里只接管 Enter
        if (event.key === 'Enter') {
          event.preventDefault()
          onSelect(font.id)
        }
      }}
    >
      <span className="card-bar" aria-hidden="true" />

      <button
        type="button"
        className="fav"
        aria-label={`收藏 ${font.family}`}
        aria-pressed={font.favorite}
        onClick={(event) => {
          event.stopPropagation()
          if (!font.favorite) spawnSparks(event.currentTarget)
          onToggleFavorite(font.id)
        }}
      >
        <StarIcon filled={font.favorite} />
      </button>

      <span className="card-name" style={face}>
        {font.family}
      </span>

      <span className="card-sample" style={face}>
        {sample}
      </span>

      <span className="card-foot">
        <span className="dot-state" title={font.enabled ? '已启用' : '未启用'} />
        <span>{font.instanceCount} styles</span>
        {font.variable ? (
          <>
            <span className="sep">·</span>
            <span className="tag-v">VAR</span>
          </>
        ) : null}
      </span>
    </li>
  )
})
