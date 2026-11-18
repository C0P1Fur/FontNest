import type { ReactNode } from 'react'
import type { SortKey, ViewMode } from '../types/font'
import { SIZES } from '../lib/samples'
import { useApp } from '../state/store'
import { Segmented } from './Segmented'
import { GridIcon, ListIcon } from './Icons'
import { SelectionMenu } from './SelectionMenu'

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'name', label: '按名称' },
  { value: 'styles', label: '按字重数' },
  { value: 'year', label: '按年代' },
  { value: 'state', label: '按安装状态' },
]

const SIZE_OPTIONS = SIZES.map((size) => ({
  value: size,
  label: String(size),
  ariaLabel: `${size} 像素`,
}))

const VIEW_OPTIONS: { value: ViewMode; label: ReactNode; ariaLabel: string }[] = [
  { value: 'grid', label: <GridIcon />, ariaLabel: '网格视图' },
  { value: 'list', label: <ListIcon />, ariaLabel: '列表视图' },
]

export function ControlBar() {
  const sample = useApp((state) => state.sample)
  const setSample = useApp((state) => state.setSample)
  const size = useApp((state) => state.size)
  const setSize = useApp((state) => state.setSize)
  const sort = useApp((state) => state.sort)
  const setSort = useApp((state) => state.setSort)
  const view = useApp((state) => state.view)
  const setView = useApp((state) => state.setView)

  return (
    <div className="controlbar">
      <div className="sample-ctl">
        <label htmlFor="sample-input">预览文本</label>
        <input
          id="sample-input"
          type="text"
          value={sample}
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => setSample(event.target.value)}
        />
      </div>

      <div className="control-right">
        <Segmented
          options={SIZE_OPTIONS}
          value={size}
          onChange={setSize}
          ariaLabel="预览字号"
          className="sizes"
        />

        <div className="seg">
          <select
            id="sort"
            value={sort}
            aria-label="排序方式"
            onChange={(event) => setSort(event.target.value as SortKey)}
          >
            {SORT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <Segmented
          options={VIEW_OPTIONS}
          value={view}
          onChange={setView}
          ariaLabel="视图"
          className="view-toggle"
        />

        {/* 多选入口：下拉里先选"要干什么"，因为三个动作的可选范围完全不同 */}
        <SelectionMenu />
      </div>
    </div>
  )
}
