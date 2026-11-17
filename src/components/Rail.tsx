import { useMemo } from 'react'
import type { ReactNode } from 'react'
import type { FontCategory, LibraryScope } from '../types/font'
import { CATEGORY_LABEL, CATEGORY_ORDER, countLibrary } from '../lib/filter'
import { useApp } from '../state/store'
import {
  CircleCheckIcon,
  CircleDashedIcon,
  LayersIcon,
  RefreshIcon,
  StarOutlineIcon,
  VariableIcon,
} from './Icons'

const SCOPE_META: Record<LibraryScope, { label: string; icon: ReactNode }> = {
  all: { label: '全部字体', icon: <LayersIcon /> },
  enabled: { label: '已启用', icon: <CircleCheckIcon /> },
  disabled: { label: '未启用', icon: <CircleDashedIcon /> },
  variable: { label: '可变字体', icon: <VariableIcon /> },
  favorite: { label: '收藏', icon: <StarOutlineIcon /> },
}

const SCOPE_ORDER: LibraryScope[] = ['all', 'enabled', 'disabled', 'variable', 'favorite']

export function Rail() {
  const fonts = useApp((state) => state.fonts)
  const scope = useApp((state) => state.scope)
  const setScope = useApp((state) => state.setScope)
  const categories = useApp((state) => state.categories)
  const toggleCategory = useApp((state) => state.toggleCategory)
  const rescan = useApp((state) => state.rescan)
  const scanPhase = useApp((state) => state.scanPhase)

  const counts = useMemo(() => countLibrary(fonts), [fonts])

  return (
    <aside className="rail">
      <nav aria-label="字体库范围">
        <h2 className="rail-title">库</h2>
        {SCOPE_ORDER.map((key) => (
          <button
            key={key}
            type="button"
            className={key === scope ? 'rail-item is-active' : 'rail-item'}
            aria-pressed={key === scope}
            onClick={() => setScope(key)}
          >
            {SCOPE_META[key].icon}
            <span className="rail-label">{SCOPE_META[key].label}</span>
            <span className="count">{counts[key]}</span>
          </button>
        ))}
      </nav>

      <div className="rail-block">
        <h2 className="rail-title">分类</h2>
        {CATEGORY_ORDER.map((category: FontCategory) => (
          <label key={category} className="check">
            <input
              type="checkbox"
              value={category}
              checked={categories.includes(category)}
              onChange={() => toggleCategory(category)}
            />
            <span className="box">
              <svg viewBox="0 0 12 12" aria-hidden="true">
                <path
                  d="M2.4 6.2l2.4 2.4 4.8-5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.9"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
            <span className="rail-label">{CATEGORY_LABEL[category]}</span>
            <span className="count">{counts.categories[category]}</span>
          </label>
        ))}
      </div>

      <div className="rail-foot">
        <button
          type="button"
          className={
            scanPhase === 'scanning'
              ? 'ghost-btn is-pending'
              : scanPhase === 'done'
                ? 'ghost-btn is-done'
                : 'ghost-btn'
          }
          onClick={() => {
            void rescan()
          }}
        >
          <span className="btn-lede">
            <RefreshIcon />
          </span>
          <span className="btn-text">{scanPhase === 'scanning' ? '扫描中…' : '刷新索引'}</span>
        </button>
        <p className="scan-note">当前用户级 · 只读系统字体目录</p>
      </div>
    </aside>
  )
}
