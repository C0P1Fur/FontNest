import { MAX_COMPARE, MIN_COMPARE, summarizeSelection } from '../lib/selection'
import { useApp } from '../state/store'

interface SelectionBarProps {
  /** 当前意图下可选、且可见的字体族 key。全选时用 */
  pickableFamilies: string[]
}

const ACTION_LABEL = {
  install: '安装',
  uninstall: '卸载',
  compare: '对比',
} as const

/**
 * 多选操作条。
 *
 * 意图是进多选时在下拉里定下来的，所以这里**只出一个主按钮** ——
 * 不会再出现"勾完了三个按钮全是灰的，不知道哪儿不对"。
 *
 * 按钮可不可点由 `summarizeSelection` 算：装/卸看还有多少个目标字体，
 * 对比看族数是否落在 2–6。
 */
export function SelectionBar({ pickableFamilies }: SelectionBarProps) {
  const mode = useApp((state) => state.selectionMode)
  const selectedFamilies = useApp((state) => state.selectedFamilies)
  const fonts = useApp((state) => state.fonts)
  const busy = useApp((state) => state.selectionBusy)
  const exitSelection = useApp((state) => state.exitSelection)
  const setSelectedFamilies = useApp((state) => state.setSelectedFamilies)
  const batch = useApp((state) => state.batchSetEnabled)
  const openCompare = useApp((state) => state.openCompare)

  if (!mode) return null

  const picked = new Set(selectedFamilies)
  const summary = summarizeSelection(fonts, selectedFamilies)
  const allPicked =
    pickableFamilies.length > 0 && pickableFamilies.every((key) => picked.has(key))

  const targets =
    mode === 'install'
      ? summary.installTargets
      : mode === 'uninstall'
        ? summary.uninstallTargets
        : summary.families

  const enabled =
    mode === 'compare' ? summary.canCompare : mode === 'install' ? summary.canInstall : summary.canUninstall

  const hint =
    mode === 'compare'
      ? summary.families < MIN_COMPARE
        ? `再选 ${MIN_COMPARE - summary.families} 个`
        : summary.families > MAX_COMPARE
          ? `最多对比 ${MAX_COMPARE} 个`
          : null
      : summary.reason

  return (
    <div className="selection-bar" role="region" aria-label={`批量${ACTION_LABEL[mode]}`}>
      <span className="selection-count">
        已选 <b>{summary.families}</b> 个字体族
        {hint ? <em>{hint}</em> : null}
      </span>

      <button
        type="button"
        className="selection-ghost"
        disabled={busy || pickableFamilies.length === 0 || allPicked}
        onClick={() => setSelectedFamilies(pickableFamilies)}
      >
        全选
      </button>

      {/* 与"全选"拆成两个按钮：全选只是一个方向，勾了一部分之后再点它
          只会追加，用户没法一步清空 */}
      <button
        type="button"
        className="selection-ghost"
        disabled={busy || summary.families === 0}
        onClick={() => setSelectedFamilies([])}
      >
        取消全选
      </button>

      <button
        type="button"
        className="selection-primary"
        disabled={busy || !enabled}
        onClick={() => {
          if (mode === 'compare') openCompare()
          else void batch(mode === 'install')
        }}
      >
        {busy ? '处理中…' : `${ACTION_LABEL[mode]}${targets > 0 ? ` ${targets} 个` : ''}`}
      </button>

      <button type="button" className="selection-exit" onClick={exitSelection} disabled={busy}>
        取消
      </button>
    </div>
  )
}
