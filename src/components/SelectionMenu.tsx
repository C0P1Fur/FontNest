import { useApp } from '../state/store'
import type { SelectionMode } from '../types/font'

/**
 * 多选入口：和"排序"同款的 `<select>`。
 *
 * 用原生下拉而不是自绘菜单，是为了和排序、字号这些控件保持一致的观感 ——
 * 顺带白拿键盘操作、屏幕阅读器支持和点击外部自动收起。
 *
 * 先选动作再进入多选：三个动作的可选范围完全不同（装只放行没装的、
 * 卸只放行已装的、对比谁都能选），先问一句才能把"哪些卡片能点"说清楚。
 */
export function SelectionMenu() {
  const mode = useApp((state) => state.selectionMode)
  const startSelection = useApp((state) => state.startSelection)
  const exitSelection = useApp((state) => state.exitSelection)

  return (
    <div className="seg">
      <select
        id="multi-select"
        aria-label="多选动作"
        value={mode ?? ''}
        onChange={(event) => {
          const next = event.target.value as SelectionMode | ''
          // 选回"多选"就是退出
          if (!next) exitSelection()
          else startSelection(next)
        }}
      >
        <option value="">多选</option>
        <option value="install">安装字体</option>
        <option value="uninstall">卸载字体</option>
        <option value="compare">对比字体</option>
      </select>
    </div>
  )
}
