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
  addToCollection: '添加到分类夹',
  removeFromCollection: '从分类夹删除',
} as const

/**
 * 多选操作条。
 *
 * 意图是进多选时在下拉里定下来的，所以这里**只出一个主按钮** ——
 * 不会再出现"勾完了一排按钮全是灰的，不知道哪儿不对"。
 *
 * 五个意图共用同一套"全选 / 取消全选 / 数量提示"，只有主按钮各不相同：
 * 装/卸看还有多少个目标字体，对比看族数是否落在 2–6，
 * 加到分类夹要先挑一个目标分类夹。
 */
export function SelectionBar({ pickableFamilies }: SelectionBarProps) {
  const mode = useApp((state) => state.selectionMode)
  const selectedFamilies = useApp((state) => state.selectedFamilies)
  const fonts = useApp((state) => state.fonts)
  const collections = useApp((state) => state.collections)
  const container = useApp((state) => state.container)
  const busy = useApp((state) => state.selectionBusy)
  const exitSelection = useApp((state) => state.exitSelection)
  const setSelectedFamilies = useApp((state) => state.setSelectedFamilies)
  const batch = useApp((state) => state.batchSetEnabled)
  const openCompare = useApp((state) => state.openCompare)
  const removeFamiliesFromCollection = useApp((state) => state.removeFamiliesFromCollection)
  const openCollectionPicker = useApp((state) => state.openCollectionPicker)

  if (!mode) return null

  const picked = new Set(selectedFamilies)
  const summary = summarizeSelection(fonts, selectedFamilies)
  const allPicked =
    pickableFamilies.length > 0 && pickableFamilies.every((key) => picked.has(key))
  const nothingPicked = busy || summary.families === 0

  const currentCollection =
    container.kind === 'collection'
      ? collections.find((item) => item.id === container.id)
      : undefined

  let targets = summary.families
  let enabled = false
  let hint: string | null = null
  let action = () => {}

  if (mode === 'install' || mode === 'uninstall') {
    const installing = mode === 'install'
    targets = installing ? summary.installTargets : summary.uninstallTargets
    enabled = installing ? summary.canInstall : summary.canUninstall
    hint = summary.reason
    action = () => {
      void batch(installing)
    }
  } else if (mode === 'compare') {
    enabled = summary.canCompare
    hint =
      summary.families < MIN_COMPARE
        ? `再选 ${MIN_COMPARE - summary.families} 个`
        : summary.families > MAX_COMPARE
          ? `最多对比 ${MAX_COMPARE} 个`
          : null
    action = openCompare
  } else if (mode === 'addToCollection') {
    // 目标分类夹这时候还没定 —— 点主按钮才弹框问
    enabled = summary.families > 0
    hint = collections.length === 0 ? '还没有分类夹' : null
    action = openCollectionPicker
  } else {
    // removeFromCollection
    enabled = Boolean(currentCollection) && summary.families > 0
    hint = currentCollection ? null : '请先进入一个分类夹'
    action = () => {
      if (currentCollection) void removeFamiliesFromCollection(currentCollection.id, selectedFamilies)
    }
  }

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

      <button
        type="button"
        className="selection-ghost"
        disabled={nothingPicked}
        onClick={() => setSelectedFamilies([])}
      >
        取消全选
      </button>

      <button
        type="button"
        className="selection-primary"
        disabled={busy || !enabled}
        onClick={action}
      >
        {busy ? '处理中…' : `${ACTION_LABEL[mode]}${targets > 0 ? ` ${targets} 个` : ''}`}
      </button>

      <button type="button" className="selection-exit" onClick={exitSelection} disabled={busy}>
        取消
      </button>
    </div>
  )
}
