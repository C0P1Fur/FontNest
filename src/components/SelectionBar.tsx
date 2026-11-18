import { useApp } from '../state/store'

interface SelectionBarProps {
  /** 当前通道下可选、且可见的字体族 key */
  pickableFamilies: string[]
}

/**
 * 多选操作条。
 *
 * 安装和卸载是两条独立通道，所以这里只有一个主按钮 —— 进哪个通道就做什么事，
 * 不需要再让用户选一次。粒度是**字体族**：装一个字体从来都是装一族
 * （Regular + Bold + Italic…），只装其中一个字重会让系统里出现半套字体。
 */
export function SelectionBar({ pickableFamilies }: SelectionBarProps) {
  const mode = useApp((state) => state.selectionMode)
  const selectedFamilies = useApp((state) => state.selectedFamilies)
  const fonts = useApp((state) => state.fonts)
  const busy = useApp((state) => state.selectionBusy)
  const exitSelection = useApp((state) => state.exitSelection)
  const setSelectedFamilies = useApp((state) => state.setSelectedFamilies)
  const batch = useApp((state) => state.batchSetEnabled)

  if (!mode) return null

  const installing = mode === 'install'
  const picked = new Set(selectedFamilies)

  const pickable = new Set(pickableFamilies)
  const allPicked = pickable.size > 0 && pickableFamilies.every((key) => picked.has(key))

  // 只统计「真的会被改动」的字体：通道本身已经按状态过滤过，
  // 但选中的族里可能混着已经就位的字重（半装状态）
  const targets = new Set(selectedFamilies)
  const changed = fonts.filter(
    (font) =>
      font.source === 'custom' &&
      targets.has(font.family.toLowerCase()) &&
      font.enabled !== installing,
  ).length

  return (
    <div
      className={installing ? 'selection-bar is-install' : 'selection-bar is-uninstall'}
      role="region"
      aria-label={installing ? '批量安装' : '批量卸载'}
    >
      <span className="selection-count">
        {installing ? '待安装' : '待卸载'} <b>{picked.size}</b> 个字体族
        {picked.size === 0 ? (
          <em>{installing ? '灰色字体已装好' : '灰色字体未安装'}</em>
        ) : null}
      </span>

      <button
        type="button"
        className="selection-ghost"
        disabled={busy || pickable.size === 0}
        onClick={() => setSelectedFamilies(allPicked ? [] : pickableFamilies)}
      >
        {allPicked ? '取消全选' : '全选'}
      </button>

      <button
        type="button"
        className="selection-primary"
        disabled={busy || targets.size === 0}
        onClick={() => {
          void batch()
        }}
      >
        {busy
          ? '处理中…'
          : `${installing ? '安装' : '卸载'}${targets.size > 0 ? ` ${targets.size} 个` : ''}`}
      </button>

      {changed === 0 && targets.size > 0 ? (
        <span className="selection-note">所选字重已就位</span>
      ) : null}

      <button type="button" className="selection-exit" onClick={exitSelection} disabled={busy}>
        取消
      </button>
    </div>
  )
}
