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
  /** 多选模式：此时点击卡片是勾选，而不是切换右栏 */
  selectionMode: boolean
  /** 是否已被勾选 */
  picked: boolean
  /** 是否可被勾选。系统 / 用户目录的字体不归我们管，一律不可选 */
  selectable: boolean
  onSelect: (id: string) => void
  onToggleFavorite: (id: string) => void
  onToggleGroup: (key: string) => void
  /** 参数是字体族 key —— 多选以族为粒度 */
  onToggleSelected: (familyKey: string) => void
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
  selectionMode,
  picked,
  selectable,
  onSelect,
  onToggleFavorite,
  onToggleGroup,
  onToggleSelected,
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

  // 多选模式下：占位符状态的系统字体变灰且点不动
  const unselectable = selectionMode && !selectable
  const className = [
    'card',
    font.enabled ? '' : 'is-off',
    selectionMode ? 'is-selecting' : '',
    picked ? 'is-picked' : '',
    unselectable ? 'is-unselectable' : '',
  ]
    .filter(Boolean)
    .join(' ')

  function activate() {
    if (!selectionMode) {
      onSelect(font.id)
      return
    }
    if (!selectable) return
    // 以族为粒度：点族里任意一个字重，等于选中整个族
    onToggleSelected(font.family.toLowerCase())
  }

  return (
    <li
      className={className}
      role="option"
      aria-selected={selectionMode ? picked : selected}
      aria-disabled={unselectable || undefined}
      title={
        unselectable
          ? font.source === 'system'
            ? `${font.family} 是系统字体，不归 FontNest 管理，无法批量操作`
            : `${font.family} 已在系统字体目录里，不归 FontNest 管理，无法批量操作`
          : undefined
      }
      tabIndex={selected ? 0 : -1}
      data-id={font.id}
      data-subfamily={font.subfamily}
      style={delay}
      onClick={activate}
      onKeyDown={(event) => {
        // 卡片自己只处理 Enter。装进系统/卸载会改系统目录与注册表，
        // 不给它双击或空格这类"顺手按到"的入口，只留显式按钮。
        if (event.key === 'Enter') {
          event.preventDefault()
          activate()
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
