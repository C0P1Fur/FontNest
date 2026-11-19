import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import { TopBar } from './components/TopBar'
import { Rail } from './components/Rail'
import { ControlBar } from './components/ControlBar'
import { FontGrid } from './components/FontGrid'
import { Inspector } from './components/Inspector'
import { StatusBar } from './components/StatusBar'
import { Toast } from './components/Toast'
import { SettingsPanel } from './components/SettingsPanel'
import { CatalogPanel } from './components/CatalogPanel'
import { RecognizePanel } from './components/RecognizePanel'
import { SelectionBar } from './components/SelectionBar'
import { ComparePanel } from './components/ComparePanel'
import { CollectionPicker } from './components/CollectionPicker'
import { Tour } from './components/Tour'
import { applyQuery } from './lib/filter'
import { flattenGroups, groupFonts, pickPrimary } from './lib/group'
import { api, isTauriRuntime } from './lib/ipc'
import { isMacOS } from './lib/platform'
import { RIPPLE_SELECTOR, rippleFrom, tactile } from './lib/motion'
import { SAMPLES, SIZES } from './lib/samples'
import { useApp } from './state/store'
import type {
  BrowseContainer,
  Collection,
  Font,
  FontCategory,
  SortKey,
} from './types/font'

/**
 * 算出网格里真正显示的字体列表：容器 → 关键词/类型筛选 → 同族合并 → 按展开状态摊平。
 *
 * 渲染和键盘导航必须用同一份结果。两处各算一次的话，收起某个族之后
 * 方向键会跳到屏幕上看不见的字重上 —— 右栏变了，网格里却没有对应高亮。
 */
interface ViewState {
  fonts: Font[]
  query: string
  container: BrowseContainer
  categories: FontCategory[]
  sort: SortKey
  collections: Collection[]
  expandedFamilies: string[]
}

function selectShown(state: ViewState): Font[] {
  // 容器（内置视图或分类夹）与关键词、类型筛选在 applyQuery 里一次算完 ——
  // 以前分类夹是在这里二次 filter 的，等于叠在视图之上的一层
  const filtered = applyQuery(state.fonts, {
    query: state.query,
    container: state.container,
    collections: state.collections,
    categories: state.categories,
    sort: state.sort,
  })

  return flattenGroups(groupFonts(filtered), state.expandedFamilies)
}

/**
 * 这三个处理器定义在模块作用域，而不是组件内联。
 *
 * 内联箭头函数每次渲染都是新对象，`FontCard` 的 memo 浅比较必然失败，
 * 401 张卡会在每次选中/改字号时全部重渲染 —— 这是卡顿的主因之一。
 * 放在模块层，函数身份永久稳定，memo 才真正生效。
 */
const handleSelect = (id: string) => useApp.getState().select(id)
const handleToggleFavorite = (id: string) => useApp.getState().toggleFavorite(id)
const handleToggleSelected = (familyKey: string) =>
  useApp.getState().toggleSelected(familyKey)
const handleAddToCollection = (familyKey: string) =>
  useApp.getState().openCollectionPickerForFamily(familyKey)
const handleRemoveFromCollection = (familyKey: string) => {
  const state = useApp.getState()
  if (state.container.kind !== 'collection') return
  void state.removeFamiliesFromCollection(state.container.id, [familyKey])
}

/**
 * 展开/收起一个字体族。
 *
 * 收起的瞬间，如果当前选中的是本族的非主面，那张卡会从网格里消失；
 * 把选择挪到主面，避免「右栏显示 Bold、网格里却找不到任何高亮」。
 */
const handleToggleFamily = (key: string) => {
  const state = useApp.getState()
  const wasExpanded = state.expandedFamilies.includes(key)
  state.toggleFamily(key)
  if (!wasExpanded) return

  const selected = state.fonts.find((font) => font.id === state.selectedId)
  if (!selected || selected.family.toLowerCase() !== key) return

  const siblings = state.fonts.filter((font) => font.family.toLowerCase() === key)
  const primary = pickPrimary(siblings)
  if (primary.id !== selected.id) state.select(primary.id)
}

/** 拖放时能接受的文件类型。和 Rust 侧的 ALLOWED_EXTENSIONS 保持一致 */
const FONT_FILE = /\.(ttf|otf|ttc)$/i

export default function App() {
  const fonts = useApp((state) => state.fonts)
  const status = useApp((state) => state.status)
  const query = useApp((state) => state.query)
  const categories = useApp((state) => state.categories)
  const sort = useApp((state) => state.sort)
  const view = useApp((state) => state.view)
  const size = useApp((state) => state.size)
  const sample = useApp((state) => state.sample)
  const theme = useApp((state) => state.theme)
  const selectedId = useApp((state) => state.selectedId)
  const collections = useApp((state) => state.collections)
  const container = useApp((state) => state.container)

  /** 拖放提示：null 表示没在拖，`fonts` 可以导入，`invalid` 拖了非字体 */
  const [dropHint, setDropHint] = useState<'fonts' | 'invalid' | null>(null)

  const expandedFamilies = useApp((state) => state.expandedFamilies)
  const selectionMode = useApp((state) => state.selectionMode)
  const selectedFamilies = useApp((state) => state.selectedFamilies)

  /** 已选族的集合，做成 Set 传给网格：几百张卡每张都要查一次 */
  const pickedFamilies = useMemo(() => new Set(selectedFamilies), [selectedFamilies])

  const visible = useMemo(
    () => applyQuery(fonts, { query, container, collections, categories, sort }),
    [fonts, query, container, collections, categories, sort],
  )

  /* 同族字重合并：收起的族只渲染主面，展开的族摊平全部字重 */
  const groups = useMemo(() => groupFonts(visible), [visible])
  const shown = useMemo(
    () =>
      selectShown({
        fonts,
        query,
        container,
        categories,
        sort,
        collections,
        expandedFamilies,
      }),
    [fonts, query, container, categories, sort, collections, expandedFamilies],
  )

  /**
   * 当前通道下可选、且可见的字体族。
   *
   * 安装通道只放行"还有字重没装"的族，卸载通道只放行"还有字重装着"的族；
   * 对比通道对所有字体开放 —— 系统字体也值得拿来比。
   * 其余卡片在多选时变灰 —— 用户不需要自己判断哪些能点。
   */
  const pickableFamilies = useMemo(() => {
    if (!selectionMode) return []
    const keys = new Set<string>()

    // 对比与分类夹动作谁都能选；装卸只放行"这次真的动得了"的那批
    if (
      selectionMode === 'compare' ||
      selectionMode === 'addToCollection' ||
      selectionMode === 'removeFromCollection'
    ) {
      for (const font of shown) keys.add(font.family.toLowerCase())
      return [...keys]
    }

    const installing = selectionMode === 'install'
    for (const font of shown) {
      if (font.source !== 'custom') continue
      if (installing ? !font.enabled : font.enabled) keys.add(font.family.toLowerCase())
    }
    return [...keys]
  }, [shown, selectionMode])

  /**
   * 每个 face 所属分组的信息，交给卡片渲染「N 个字重」和展开按钮。
   * 只在主面上显示计数与按钮，其余字重卡片保持干净。
   */
  const groupInfo = useMemo(() => {
    const open = new Set(expandedFamilies)
    const map = new Map<
      string,
      { key: string; size: number; expanded: boolean; primaryId: string }
    >()
    for (const group of groups) {
      const info = {
        key: group.key,
        size: group.faces.length,
        expanded: open.has(group.key),
        primaryId: group.primary.id,
      }
      for (const font of group.faces) map.set(font.id, info)
    }
    return map
  }, [groups, expandedFamilies])

  const selected = useMemo(() => {
    const found = visible.find((font) => font.id === selectedId)
    return found ?? visible[0] ?? null
  }, [visible, selectedId])

  /* 首次加载 */
  useEffect(() => {
    void useApp.getState().bootstrap()
  }, [])

  /* 全局热键抓到图：带着它打开识别面板 */
  useEffect(() => {
    return api.onClipboardCapture((capture) => {
      const state = useApp.getState()
      if (capture.hasImage) {
        state.showCapture(capture)
        return
      }
      // 剪贴板里没有图是常见路径（按热键前忘了截图）。
      // 提示一句并把面板打开，比什么都不发生更容易自诊。
      state.openRecognize()
      state.showToast('剪贴板里没有图片：先截图，再按快捷键')
    })
  }, [])

  /* 主题写到 <html data-theme>，由 CSS 变量接管 */
  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  /* 全局涟漪：任何被 RIPPLE_SELECTOR 命中的按钮，按下即从落点扩散 */
  useEffect(() => {
    function onPointerDown(event: PointerEvent) {
      if (event.button !== 0) return
      const target = event.target as HTMLElement | null
      if (!target || target.closest('input, textarea, select')) return
      const host = target.closest<HTMLElement>(RIPPLE_SELECTOR)
      if (!host) return
      rippleFrom(event, host)
      tactile()
    }

    document.addEventListener('pointerdown', onPointerDown, true)
    return () => document.removeEventListener('pointerdown', onPointerDown, true)
  }, [])

  /**
   * 拖入字体文件直接导入。
   *
   * 这是 B 类字体唯一的入口场景：许可禁止我们分发文件，用户只能自己
   * 去官网下载，然后拖进来。没有这条路径，"去官网下载"就是死胡同。
   *
   * 全程有全屏提示：拖进来的东西能不能导，进去之前就该知道，
   * 而不是松手之后弹个错误。
   *
   * 监听失败（非 Tauri / 权限不足）时静默跳过——退化成只有「导入字体文件…」
   * 按钮，功能仍在，只是少一条捷径。
   */
  useEffect(() => {
    if (!isTauriRuntime) return
    let unlisten: (() => void) | undefined
    let cancelled = false

    void (async () => {
      try {
        const { getCurrentWebview } = await import('@tauri-apps/api/webview')
        const stop = await getCurrentWebview().onDragDropEvent((event) => {
          const payload = event.payload

          // 进入窗口：先判断拖进来的是不是字体，决定提示的语气
          if (payload.type === 'enter') {
            if (payload.paths.length === 0) {
              setDropHint(null)
              return
            }
            const hasFont = payload.paths.some((path) => FONT_FILE.test(path))
            setDropHint(hasFont ? 'fonts' : 'invalid')
            return
          }

          if (payload.type === 'leave') {
            setDropHint(null)
            return
          }

          if (payload.type === 'drop') {
            setDropHint(null)
            const fonts = payload.paths.filter((path) => FONT_FILE.test(path))
            const state = useApp.getState()

            if (fonts.length === 0) {
              if (payload.paths.length > 0) {
                state.showToast('只支持 .ttf / .otf / .ttc 字体文件')
              }
              return
            }
            if (fonts.length < payload.paths.length) {
              state.showToast(`已跳过 ${payload.paths.length - fonts.length} 个非字体文件`)
            }
            void state.importFonts(fonts).then((note) => {
              if (note) useApp.getState().showToast(note)
            })
          }
        })
        if (cancelled) stop()
        else unlisten = stop
      } catch (error) {
        console.warn('[fontnest] 拖放导入不可用', error)
      }
    })()

    return () => {
      cancelled = true
      unlisten?.()
    }
  }, [])

  /* 键盘：全部读取 store 快照，避免闭包过期 */
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const state = useApp.getState()
      const target = event.target as HTMLElement | null
      const tag = target?.tagName.toLowerCase() ?? ''
      const typing = tag === 'input' || tag === 'textarea' || tag === 'select'

      const mod = isMacOS ? event.metaKey : event.ctrlKey
      if (
        (event.metaKey || event.ctrlKey) &&
        ['k', 'f'].includes(event.key.toLowerCase())
      ) {
        event.preventDefault()
        document.getElementById('search-input')?.focus()
        return
      }

      // macOS 惯例：⌘, 打开偏好设置
      if (mod && event.key === ',') {
        event.preventDefault()
        state.openSettings()
        return
      }

      // 下面的单键操作不能吃掉带修饰键的组合：
      // 否则 ⌘F / ⌘T / ⌘1 这类系统或习惯快捷键会被误当成「收藏」「换样张」「改字号」
      if (event.metaKey || event.ctrlKey || event.altKey) return

      if (event.key === '/' && !typing) {
        event.preventDefault()
        document.getElementById('search-input')?.focus()
        return
      }

      if (event.key === 'Escape') {
        // 设置面板自己处理关闭，避免同时清空搜索
        if (state.settingsOpen) return
        if (state.query) {
          state.setQuery('')
          return
        }
        if (typing) target?.blur()
        return
      }

      if (typing) return

      // 与网格同一份列表：收起某个族后，方向键不该跳到看不见的字重上
      const list = selectShown(state)
      if (list.length === 0) return

      const sel = state.selectedId
      const currentId = sel !== null && list.some((font) => font.id === sel) ? sel : list[0].id
      const index = list.findIndex((font) => font.id === currentId)

      const moveTo = (id: string) => {
        state.select(id)
        document
          .querySelector<HTMLElement>(`[data-id="${id}"]`)
          ?.scrollIntoView({ block: 'nearest' })
      }

      // 移动只保留 ←/→。
      // 网格是流式多列布局，列数随窗口宽度和字号变化，跨行跳 N 个必然算错；
      // 而 ←/→ 在同一行内就等于"前一个/后一个"，一条规则覆盖两个方向。
      // ↑/↓ 与 j/k 一并让出来，不再改选中项 —— 上下方向交给网格自己的滚动。
      switch (event.key) {
        // 引导里 → 是"下一步"、← 是"上一步"。Tour 在 capture 阶段接管了它们，
        // 但它没有 stopPropagation，这里必须让路，否则选中项会跟着一起动。
        case 'ArrowRight':
          if (state.tourOpen) return
          event.preventDefault()
          moveTo(list[Math.min(index + 1, list.length - 1)].id)
          return
        case 'ArrowLeft':
          if (state.tourOpen) return
          event.preventDefault()
          moveTo(list[Math.max(index - 1, 0)].id)
          return
        // 空格不再绑定安装/卸载：装进系统会改系统字体目录与注册表，
        // 这个动作用一个"顺手按到"的键触发太危险，只保留右栏的显式按钮。
        case 'f':
        case 'F':
          state.toggleFavorite(currentId)
          return
        case 't':
        case 'T': {
          const next = SAMPLES.indexOf(state.sample) + 1
          state.setSample(SAMPLES[next % SAMPLES.length] ?? SAMPLES[0])
          return
        }
        case 'g':
        case 'G':
          state.setView('grid')
          return
        case 'l':
        case 'L':
          state.setView('list')
          return
        default:
          break
      }

      if (event.key >= '1' && event.key <= '5') {
        state.setSize(SIZES[Number(event.key) - 1] ?? 24)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  return (
    <div className="app" style={{ '--sample-size': `${size}px` } as CSSProperties}>
      <TopBar />
      <Rail />

      <main className="workspace">
        <ControlBar />
        <div className="scrollarea" id="scroll">
          {status === 'ready' ? (
            <FontGrid
              fonts={shown}
              groupInfo={groupInfo}
              sample={sample}
              selectedId={selected?.id ?? null}
              view={view}
              selectionMode={selectionMode}
              inCollection={container.kind === 'collection'}
              pickedFamilies={pickedFamilies}
              onSelect={handleSelect}
              onToggleFavorite={handleToggleFavorite}
              onToggleGroup={handleToggleFamily}
              onToggleSelected={handleToggleSelected}
              onAddToCollection={handleAddToCollection}
              onRemoveFromCollection={handleRemoveFromCollection}
            />
          ) : (
            <div className="empty">
              <p className="empty-title">
                {status === 'error' ? '字体库读取失败' : '正在读取字体库…'}
              </p>
              <p className="empty-body">
                {status === 'error' ? '请查看日志，或重新扫描索引。' : '首次扫描需要几秒钟。'}
              </p>
            </div>
          )}
        </div>
      </main>

      <Inspector font={selected} />
      <StatusBar visible={visible.length} total={fonts.length} />
      <SelectionBar pickableFamilies={pickableFamilies} />
      <ComparePanel />
      <CollectionPicker />
      <SettingsPanel />
      <CatalogPanel />
      <RecognizePanel />
      <Tour />
      <Toast />

      {dropHint ? (
        <div
          className={dropHint === 'fonts' ? 'drop-overlay' : 'drop-overlay is-invalid'}
          aria-hidden="true"
        >
          <div className="drop-frame">
            <span className="drop-title">
              {dropHint === 'fonts' ? '松开即可导入字体' : '只能导入字体文件'}
            </span>
            <span className="drop-sub">
              {dropHint === 'fonts'
                ? '.ttf / .otf / .ttc · 导入后会出现在字体列表里，不影响其他软件'
                : '拖入 .ttf / .otf / .ttc，其他格式会被拒绝'}
            </span>
          </div>
        </div>
      ) : null}
    </div>
  )
}
