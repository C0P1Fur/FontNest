import { memo, useEffect } from 'react'
import type { Font } from '../types/font'
import type { GroupInfo } from './FontGrid'
import { faceFamily, ensureFace } from '../lib/fontFaces'
import { spawnSparks } from '../lib/motion'
import { StarIcon } from './Icons'

interface FontCardProps {
  font: Font
  index: number
  /** 所属字体族信息；族里只有它自己时 undefined */
  group?: GroupInfo
  sample: string
  selected: boolean
  onSelect: (id: string) => void
  onToggleFavorite: (id: string) => void
  onToggleEnabled: (id: string) => void
  onToggleGroup: (key: string) => void
}

/**
 * 一张字体卡：名字和样张都用该字体自身渲染。
 *
 * 已安装字体直接用系统字体栈；自定义目录的字体在这里注入 @font-face
 * （走 font:// 协议读文件），否则会整屏退化成同一个兜底字体。
 *
 * 同族多个字重默认只显示主面（Regular），卡片底部给出「N 个字重」的入口，
 * 展开后其余字重才作为独立卡片出现 —— 展开/收起是全局状态，见 store。
 */
export const FontCard = memo(function FontCard({
  font,
  index,
  group,
  sample,
  selected,
  onSelect,
  onToggleFavorite,
  onToggleEnabled,
  onToggleGroup,
}: FontCardProps) {
  useEffect(() => {
    ensureFace(font)
  }, [font])

  // 同一 family 的 Regular / Bold / Italic 是不同记录，
  // 卡片必须把字重与倾斜也带上，否则几条 Arial 会长得一模一样。
  const face = {
    fontFamily: faceFamily(font),
    fontWeight: font.weight,
    fontStyle: font.italic ? 'italic' : 'normal',
  }
  // 首屏错开进场，避免几十张卡同时闪一下
  const delay = { animationDelay: `${Math.min(index * 14, 220)}ms` }

  // 只有族里的主面负责显示「N 个字重」和展开按钮，其余字重保持干净
  const isGroupPrimary = Boolean(group && group.primaryId === font.id && group.size > 1)
  const expanded = Boolean(group?.expanded)

  return (
    <li
      className={font.enabled ? 'card' : 'card is-off'}
      role="option"
      aria-selected={selected}
      tabIndex={selected ? 0 : -1}
      data-id={font.id}
      data-subfamily={font.subfamily}
      style={delay}
      onClick={() => onSelect(font.id)}
      onDoubleClick={() => onToggleEnabled(font.id)}
      onKeyDown={(event) => {
        // Space 留给全局快捷键（装进系统 / 卸载），这里只接管 Enter
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
        // 卡片上双击 = 装进系统。按钮必须把 dblclick 也挡掉，
        // 否则连点两下星星会顺手把字体卸载掉。
        onDoubleClick={(event) => event.stopPropagation()}
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
        {group && group.size > 1 ? (
          // 展开时显示字重名（Bold / Italic）比「N styles」有用
          <span className="card-subfamily">{font.subfamily}</span>
        ) : (
          <span>{font.instanceCount} styles</span>
        )}

        {font.variable ? (
          <>
            <span className="sep">·</span>
            <span className="tag-v">VAR</span>
          </>
        ) : null}

        {isGroupPrimary ? (
          <button
            type="button"
            className={expanded ? 'card-group is-open' : 'card-group'}
            aria-expanded={expanded}
            aria-label={`${expanded ? '收起' : '展开'} ${font.family} 的 ${group?.size} 个字重`}
            onClick={(event) => {
              event.stopPropagation()
              if (group) onToggleGroup(group.key)
            }}
            // 展开/收起常常是连点两下，不挡住 dblclick 会掉进卡片的
            // 「双击装进系统」里 —— 系统字体没有安装记录，后端会报
            // 「这个字体不是本工具安装的」，用户完全看不懂。
            onDoubleClick={(event) => event.stopPropagation()}
          >
            {group?.size} 个字重
            <svg className="chev" viewBox="0 0 10 10" aria-hidden="true">
              <path
                d="M2.4 3.6L5 6.2l2.6-2.6"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        ) : null}
      </span>
    </li>
  )
})
