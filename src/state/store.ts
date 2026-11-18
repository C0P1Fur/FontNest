import { create } from 'zustand'
import type {
  AppStatus,
  BrowseContainer,
  ClipboardCapture,
  Collection,
  Font,
  FontCategory,
  LibraryScope,
  ScanPhase,
  SelectionMode,
  SortKey,
  ViewMode,
} from '../types/font'
import { api } from '../lib/ipc'
import type { CatalogItem } from '../lib/ipc'
import { sameContainer } from '../lib/filter'
import { MAX_COMPARE, MIN_COMPARE } from '../lib/selection'

/**
 * 多选态：单一入口。
 *
 * 进入后任意勾选字体族，安装 / 卸载 / 对比三个动作在同一处完成。
 * 早先拆成三条独立通道（多选安装 / 多选卸载 / 字体对比），用户得先选对通道
 * 才能开始勾选 —— 而三条通道的可选范围还不一样，等于让用户先猜意图。
 */


/** "全部字体"这个内置视图的容器值，作为默认容器与各类回退目标 */
export const ALL_VIEW: BrowseContainer = { kind: 'view', scope: 'all' }

/**
 * 进入某个容器时要一起重置的筛选条件。
 *
 * 抽成一个函数，是因为切容器的入口不止 setContainer：新建分类夹会直接
 * 落到新容器、删掉当前分类夹会回退到「全部」。三处各写一遍迟早会漏。
 */
function switchTo(container: BrowseContainer) {
  return { container, query: '', categories: [] }
}

export type Theme = 'light' | 'dark'

export interface ToastPayload {
  id: number
  message: string
  undo?: () => void
}

export interface AppState {
  /* 数据 */
  fonts: Font[]
  status: 'idle' | 'loading' | 'ready' | 'error'
  scanPhase: ScanPhase
  lastScanAt: number | null
  customDirs: string[]
  collections: Collection[]
  /**
   * 当前浏览的容器 —— 内置视图和用户分类夹是**同一层级的同类对象**，
   * 用同一个字段表达，天然互斥单选。
   *
   * 以前这里是 `scope` + `activeCollectionId` 两个字段，两者会被**同时**
   * 应用（先用 scope 过滤，再叠一层分类夹），于是分类夹变成了"贴在视图上的
   * 标签"：选中收藏再点某个分类夹，得到的是两者的交集，左栏还会有两行同时高亮。
   */
  container: BrowseContainer

  /* 查询 */
  query: string
  categories: FontCategory[]
  sort: SortKey

  /* 视图 */
  view: ViewMode
  size: number
  sample: string
  theme: Theme
  settingsOpen: boolean
  recognizeOpen: boolean
  /** 可选字体库面板 */
  catalogOpen: boolean
  catalogItems: CatalogItem[]
  catalogBusy: string | null
  catalogError: string | null
  /** 批量下载进度；null 表示没有在批量下载 */
  catalogAllProgress: { done: number; total: number; current: string } | null
  /** 批量下载里失败的条目，结束后展示 */
  catalogAllFailed: string[]
  /** 用户点了取消：当前这一款下完就停 */
  catalogCancel: boolean
  /** 上手引导是否显示 */
  tourOpen: boolean
  /** 引导是否已完成或跳过（来自 ui.json） */
  tourSeen: boolean
  /** 热键抓到的截图；null 表示这次识别要从文件里选图 */
  capture: ClipboardCapture | null
  /** 启动时问到的快捷键状态，用来决定要不要劝用户按热键 */
  appStatus: AppStatus | null
  /**
   * 已展开的字体族（小写族名）。
   *
   * 收起的族只显示主面（Regular），展开后露出全部字重。
   * 会话级状态，不落盘：用户下次打开大概率还是想先看全局。
   */
  expandedFamilies: string[]

  /* 多选：先在下拉里声明意图，再勾选 */
  selectionMode: SelectionMode | null
  selectedFamilies: string[]
  selectionBusy: boolean

  /* 字体对比 */
  compareOpen: boolean
  /** 参与对比的族名（小写），顺序即展示顺序 */
  compareFamilies: string[]

  /* 选中与瞬时态 */
  selectedId: string | null
  toast: ToastPayload | null

  /* 动作 */
  bootstrap: () => Promise<void>
  rescan: () => Promise<void>
  setQuery: (query: string) => void
  /** 切换浏览容器（内置视图或分类夹），互斥 */
  setContainer: (container: BrowseContainer) => void
  toggleCategory: (category: FontCategory) => void
  setSort: (sort: SortKey) => void
  setView: (view: ViewMode) => void
  setSize: (size: number) => void
  setSample: (sample: string) => void
  select: (id: string) => void
  /** 清掉所有筛选并选中某个字体 —— 保证它在网格和详情里都看得见 */
  focusFont: (id: string) => void
  toggleFavorite: (id: string) => void
  reveal: (id: string) => void
  toggleTheme: () => void
  openSettings: () => void
  closeSettings: () => void
  /** 展开/收起一个字体族 */
  toggleFamily: (key: string) => void
  /** 进入某个多选意图；重复选同一项等于退出。退出时清空已选 */
  startSelection: (mode: SelectionMode) => void
  exitSelection: () => void
  /** 勾选/取消一整个字体族（小写族名） */
  toggleSelected: (familyKey: string) => void
  /** 整体替换已选集合。全选/清空都走它，避免再开两个动作 */
  setSelectedFamilies: (keys: string[]) => void
  /** 底层：对一组字体 id 执行安装/卸载，返回是否真的改动过 */
  applyEnabled: (ids: string[], enabled: boolean) => Promise<boolean>
  /** 按字体族安装 / 卸载。全软件的统一粒度 */
  setFamilyEnabled: (family: string, enabled: boolean) => Promise<void>
  /** 对当前勾选的族批量安装或卸载 */
  batchSetEnabled: (enabled: boolean) => Promise<void>
  /** 用已选的族打开对比面板 */
  openCompare: () => void
  closeCompare: () => void
  openCatalog: () => Promise<void>
  closeCatalog: () => void
  downloadCatalogFont: (id: string) => Promise<void>
  removeCatalogFont: (id: string) => Promise<void>
  downloadAllCatalog: () => Promise<void>
  cancelDownloadAll: () => void
  /** 手动导入（B 类）。返回一句给用户看的结果摘要 */
  importFonts: (paths: string[]) => Promise<string>
  openTour: () => void
  /** 完成或跳过引导：关掉并落盘 */
  finishTour: (step: number) => Promise<void>
  openRecognize: () => void
  closeRecognize: () => void
  /** 热键抓到了图：直接带着它打开面板 */
  showCapture: (capture: ClipboardCapture) => void
  /** 改用文件时要清掉它，否则两路输入会打架，识别的还是剪贴板那张 */
  clearCapture: () => void
  /** 返回 null 表示成功，否则返回给用户看的错误文案 */
  addDir: (path: string) => Promise<string | null>
  removeDir: (path: string) => Promise<string | null>
  /** 新建分类夹。成功返回 null，失败返回给用户看的错误文案 */
  createCollection: (name: string) => Promise<string | null>
  deleteCollection: (id: string) => Promise<string | null>
  toggleInCollection: (collectionId: string, fontId: string) => Promise<void>
  showToast: (message: string, undo?: () => void) => void
  dismissToast: () => void
}

const THEME_KEY = 'fontnest.theme'

function readTheme(): Theme {
  try {
    const value = window.localStorage.getItem(THEME_KEY)
    if (value === 'dark' || value === 'light') return value
  } catch {
    /* 隐私模式下 localStorage 可能抛错 */
  }
  return 'light'
}

function writeTheme(theme: Theme): void {
  try {
    window.localStorage.setItem(THEME_KEY, theme)
  } catch {
    /* noop */
  }
}

let toastTimer: number | undefined

export const useApp = create<AppState>()((set, get) => ({
  fonts: [],
  status: 'idle',
  scanPhase: 'idle',
  lastScanAt: null,
  customDirs: [],
  collections: [],
  container: ALL_VIEW,
  query: '',
  categories: [],
  sort: 'name',

  view: 'grid',
  size: 24,
  sample: 'The quick brown fox 敏捷的棕色狐狸',
  theme: readTheme(),
  settingsOpen: false,
  recognizeOpen: false,
  expandedFamilies: [],
  selectionMode: null,
  selectedFamilies: [],
  selectionBusy: false,
  compareOpen: false,
  compareFamilies: [],
  catalogOpen: false,
  catalogItems: [],
  catalogBusy: null,
  catalogError: null,
  catalogAllProgress: null,
  catalogAllFailed: [],
  catalogCancel: false,
  tourOpen: false,
  tourSeen: true,
  capture: null,
  appStatus: null,

  selectedId: null,
  toast: null,

  bootstrap: async () => {
    if (get().status !== 'idle') return
    set({ status: 'loading' })
    try {
      const [fonts, dirs, collections, appStatus, ui] = await Promise.all([
        api.listFonts(),
        api.getCustomDirs(),
        api.listCollections(),
        api.getAppStatus(),
        api.getUiState(),
      ])
      set((state) => ({
        fonts,
        customDirs: dirs,
        collections,
        appStatus,
        status: 'ready',
        lastScanAt: Date.now(),
        selectedId: state.selectedId ?? fonts[0]?.id ?? null,
        // 首次启动（或从未看过）→ 自动开始引导。
        // 字体先加载完再开，否则锚点还不在 DOM 里。
        tourOpen: !ui.tourSeen,
        tourSeen: ui.tourSeen,
      }))
    } catch (error) {
      console.error('[fontnest] 加载字体失败', error)
      set({ status: 'error' })
    }
  },

  rescan: async () => {
    if (get().scanPhase === 'scanning') return
    set({ scanPhase: 'scanning' })
    try {
      const result = await api.scan()
      const fonts = await api.listFonts()
      set({
        fonts,
        scanPhase: 'done',
        lastScanAt: result.finishedAt,
        selectedId: get().selectedId ?? fonts[0]?.id ?? null,
      })
      // 格式不受支持的文件必须说出来。否则用户加了含 woff 的文件夹，
      // 只会看到"字体数没怎么变"，没有任何线索。
      const skipped = result.unsupported.reduce((sum, item) => sum + item.count, 0)
      if (skipped > 0) {
        const detail = result.unsupported.map((item) => `.${item.ext} × ${item.count}`).join('、')
        get().showToast(`已刷新 · ${fonts.length} 个字体（${skipped} 个文件格式不支持：${detail}）`)
      } else {
        get().showToast(`索引已刷新 · ${fonts.length} 个字体`)
      }
      window.setTimeout(() => set({ scanPhase: 'idle' }), 1500)
    } catch (error) {
      console.error('[fontnest] 扫描失败', error)
      set({ scanPhase: 'idle' })
      get().showToast('扫描失败，请查看日志')
    }
  },

  setQuery: (query) => set({ query }),

  /**
   * 切换浏览容器 —— 无条件重置筛选。
   *
   * 搜索关键词和类型勾选都是**相对当前容器**的收窄条件：把"inter"带进
   * 「收藏」或某个分类夹，往往一条都不匹配，网格会空着 —— 看起来像
   * "这个容器里没有字体"，而不是"你的搜索没命中"。
   *
   * 不区分"是否真的换了容器"：点当前高亮的那行也算一次切换，
   * 等于给用户一个"清掉筛选、回到干净视图"的手势。
   */
  setContainer: (container) => set(switchTo(container)),
  toggleCategory: (category) =>
    set((state) => ({
      categories: state.categories.includes(category)
        ? state.categories.filter((c) => c !== category)
        : [...state.categories, category],
    })),
  setSort: (sort) => set({ sort }),
  setView: (view) => set({ view }),
  setSize: (size) => set({ size }),
  setSample: (sample) => set({ sample }),
  select: (id) => set({ selectedId: id }),

  toggleFavorite: (id) => {
    const font = get().fonts.find((item) => item.id === id)
    if (!font) return

    const next = !font.favorite
    set((state) => ({
      fonts: state.fonts.map((item) =>
        item.id === id ? { ...item, favorite: next } : item,
      ),
    }))
    void api.setFavorite(id, next).catch((error: unknown) => {
      console.error('[fontnest] 收藏写入失败', error)
    })

    get().showToast(
      next ? `已收藏 · ${font.family}` : `已取消收藏 · ${font.family}`,
      () => {
        get().toggleFavorite(id)
      },
    )
  },

  reveal: (id) => {
    void api.revealInFolder(id).catch((error: unknown) => {
      console.error('[fontnest] 无法打开文件位置', error)
    })
  },

  toggleTheme: () => {
    const next: Theme = get().theme === 'light' ? 'dark' : 'light'
    writeTheme(next)
    set({ theme: next })
  },

  openSettings: () => set({ settingsOpen: true }),
  closeSettings: () => set({ settingsOpen: false }),

  toggleFamily: (key) =>
    set((state) => ({
      expandedFamilies: state.expandedFamilies.includes(key)
        ? state.expandedFamilies.filter((item) => item !== key)
        : [...state.expandedFamilies, key],
    })),

  startSelection: (mode) =>
    set((state) => ({
      // 再选同一项等于退出；换一项则直接切换并清空已选
      selectionMode: state.selectionMode === mode ? null : mode,
      selectedFamilies: [],
      selectionBusy: false,
    })),

  exitSelection: () =>
    set({ selectionMode: null, selectedFamilies: [], selectionBusy: false }),

  toggleSelected: (familyKey) => {
    const state = get()
    const picked = state.selectedFamilies

    if (picked.includes(familyKey)) {
      set({ selectedFamilies: picked.filter((item) => item !== familyKey) })
      return
    }

    // 只有对比卡上限：一次能分辨的样式就那么几个，第 7 个选了也看不过来。
    // 装卸不设上限 —— 批量装 50 个字体是合理需求。
    if (state.selectionMode === 'compare' && picked.length >= MAX_COMPARE) {
      state.showToast(`对比最多选 ${MAX_COMPARE} 个字体`)
      return
    }

    set({ selectedFamilies: [...picked, familyKey] })
  },

  setSelectedFamilies: (keys) =>
    set((state) => ({
      // 全选同样守对比的上限；装卸通道照旧选多少是多少
      selectedFamilies:
        state.selectionMode === 'compare' ? keys.slice(0, MAX_COMPARE) : keys,
    })),

  openCompare: () => {
    const state = get()
    const picked = state.selectedFamilies

    if (picked.length < MIN_COMPARE) {
      state.showToast(`至少选 ${MIN_COMPARE} 个字体才能对比`)
      return
    }
    if (picked.length > MAX_COMPARE) {
      state.showToast(`最多同时对比 ${MAX_COMPARE} 个字体`)
      return
    }

    set({
      compareFamilies: [...picked],
      compareOpen: true,
      selectionMode: null,
      selectedFamilies: [],
    })
  },

  closeCompare: () => set({ compareOpen: false }),

  /**
   * 单条批量操作的公共实现。
   *
   * 三道过滤，缺一不可：
   * 1. 调用方只传 `source === 'custom'` 的 id —— 系统字体不在安装清单里
   * 2. 只处理状态不匹配的 —— 已经在目标状态再点一次是白做功
   * 3. 结果逐条统计 —— 20 个里挂 1 个，剩下 19 个仍要生效
   *
   * 返回是否真的改动过，调用方据此决定要不要重置界面状态。
   */
  applyEnabled: async (ids, enabled) => {
    if (get().selectionBusy) return false
    if (ids.length === 0) {
      get().showToast(enabled ? '没有需要安装的字体' : '没有需要卸载的字体')
      return false
    }

    set({ selectionBusy: true })
    try {
      const report = await api.setEnabled(ids, enabled)
      // set_enabled 内部会重扫，本地 fonts 已经过期，重新拉一次
      const fonts = await api.listFonts()
      set({ fonts, selectionBusy: false })

      const verb = enabled ? '安装' : '卸载'
      if (report.failed.length === 0) {
        get().showToast(`已${verb} ${report.changed} 个字体`)
      } else {
        get().showToast(
          `已${verb} ${report.changed} 个，${report.failed.length} 个失败：${report.failed[0]}`,
        )
      }
      return report.changed > 0
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error('[fontnest] 字体安装状态切换失败', error)
      set({ selectionBusy: false })
      get().showToast(`操作失败：${message}`)
      return false
    }
  },

  /**
   * 按字体族安装 / 卸载。
   *
   * 这是全软件的统一粒度：字体管理器里"装一个字体"从来都是装一族
   * （Regular + Bold + Italic…），只装其中一个字重反而会让系统里出现
   * 半套字体，加粗时字体突然变样。
   */
  setFamilyEnabled: async (family, enabled) => {
    const key = family.toLowerCase()
    const targets = get()
      .fonts.filter(
        (font) =>
          font.family.toLowerCase() === key &&
          font.source === 'custom' &&
          font.enabled !== enabled,
      )
      .map((font) => font.id)
    await get().applyEnabled(targets, enabled)
  },

  /** 对当前勾选的族批量安装或卸载。是否允许由 SelectionBar 依据规则禁用 */
  batchSetEnabled: async (enabled) => {
    const state = get()
    if (!state.selectionMode) return

    const keys = new Set(state.selectedFamilies)
    const targets = state.fonts
      .filter(
        (font) =>
          font.source === 'custom' &&
          keys.has(font.family.toLowerCase()) &&
          font.enabled !== enabled,
      )
      .map((font) => font.id)

    const changed = await get().applyEnabled(targets, enabled)
    if (changed) set({ selectedFamilies: [], selectionMode: null })
  },

  openCatalog: async () => {
    set({ catalogOpen: true, catalogError: null })
    try {
      const listing = await api.listCatalog()
      set({ catalogItems: listing.items, catalogError: listing.issues[0] ?? null })
    } catch (error) {
      console.error('[fontnest] 加载字体目录失败', error)
      set({ catalogError: String(error) })
    }
  },
  closeCatalog: () => set({ catalogOpen: false, catalogBusy: null }),

  downloadCatalogFont: async (id) => {
    if (get().catalogBusy) return
    set({ catalogBusy: id, catalogError: null })
    try {
      await api.fetchCatalogFont(id)
      // 下载完必须重扫：库里的新文件要经过解析才会出现在字体列表里。
      // 不重扫的话用户会看到"下载成功"但列表里什么都没有。
      await get().rescan()
      const listing = await api.listCatalog()
      set({ catalogItems: listing.items })
    } catch (error) {
      set({ catalogError: String(error) })
    } finally {
      set({ catalogBusy: null })
    }
  },

  removeCatalogFont: async (id) => {
    if (get().catalogBusy) return
    set({ catalogBusy: id, catalogError: null })
    try {
      await api.removeCatalogFont(id)
      await get().rescan()
      const listing = await api.listCatalog()
      set({ catalogItems: listing.items })
    } catch (error) {
      set({ catalogError: String(error) })
    } finally {
      set({ catalogBusy: null })
    }
  },

  /**
   * 批量下载全部可下载字体。
   *
   * 三个刻意的设计：
   * 1. **串行**：并发会同时压满代理和磁盘，而且进度没法线性显示
   * 2. **最后只重扫一次**：每下一款就重扫会让 32 款变成 32 次全盘扫描
   * 3. **单款失败不中断**：238 MB 里某一个源挂了，不该让其余 31 款白下
   */
  downloadAllCatalog: async () => {
    if (get().catalogAllProgress) return

    const pending = get().catalogItems.filter((item) => item.redistributable && !item.downloaded)
    if (pending.length === 0) return

    set({
      catalogAllFailed: [],
      catalogCancel: false,
      catalogAllProgress: { done: 0, total: pending.length, current: '' },
    })

    const failed: string[] = []
    let done = 0

    for (const item of pending) {
      if (get().catalogCancel) break
      set({
        catalogAllProgress: {
          done,
          total: pending.length,
          current: item.nameZh || item.family,
        },
      })
      try {
        await api.fetchCatalogFont(item.id)
        done += 1
      } catch (error) {
        failed.push(`${item.nameZh || item.family}：${String(error)}`)
      }
      set({
        catalogAllProgress: { done, total: pending.length, current: '' },
      })
    }

    // 无论中途取消还是全下完，都重扫一次——
    // 已经下好的那些必须出现在字体列表里，否则用户会以为白下了
    try {
      await get().rescan()
      const listing = await api.listCatalog()
      set({ catalogItems: listing.items })
    } catch (error) {
      set({ catalogError: String(error) })
    }

    set({
      catalogAllProgress: null,
      catalogAllFailed: failed,
      catalogCancel: false,
    })
  },

  cancelDownloadAll: () => set({ catalogCancel: true }),

  /**
   * 手动导入。B 类字体只能这么进来——用户自己去官网下载，再拖进来。
   *
   * 导入成功后必须重扫：文件进了库目录，但没经过解析就不会出现在列表里。
   */
  importFonts: async (paths) => {
    if (paths.length === 0) return ''
    try {
      const summary = await api.importFontFiles(paths)
      await get().rescan()
      const listing = await api.listCatalog()
      set({ catalogItems: listing.items })

      const parts: string[] = []
      if (summary.imported.length > 0) parts.push(`已导入 ${summary.imported.length} 个`)
      if (summary.skipped.length > 0) parts.push(`已存在 ${summary.skipped.length} 个`)
      if (summary.failed.length > 0) {
        parts.push(`${summary.failed.length} 个失败：${summary.failed[0]}`)
      }
      return parts.join('，') || '没有可导入的文件'
    } catch (error) {
      return `导入失败：${String(error)}`
    }
  },

  openTour: () => set({ tourOpen: true }),

  finishTour: async (step) => {
    set({ tourOpen: false, tourSeen: true })
    try {
      await api.saveUiState({ tourSeen: true, tourStep: step, tourSeenAt: Date.now() })
    } catch (error) {
      // 落盘失败不该让引导卡住；用户下次启动会再看到一次，可接受
      console.error('[fontnest] 保存引导状态失败', error)
    }
  },
  // 从顶栏进来是"重新开始"：上一次抓的图必须丢掉，
  // 否则用户会对着旧截图输新文字。
  openRecognize: () => set({ recognizeOpen: true, capture: null }),
  closeRecognize: () => set({ recognizeOpen: false, capture: null }),
  showCapture: (capture) => set({ recognizeOpen: true, capture }),
  clearCapture: () => set({ capture: null }),

  focusFont: (id) =>
    set({ query: '', container: ALL_VIEW, categories: [], selectedId: id }),

  addDir: async (path) => {
    try {
      const dirs = await api.addCustomDir(path)
      const fonts = await api.listFonts()
      set({
        customDirs: dirs,
        fonts,
        status: 'ready',
        selectedId: get().selectedId ?? fonts[0]?.id ?? null,
      })
      get().showToast('目录已添加，索引已刷新')
      return null
    } catch (error) {
      return error instanceof Error ? error.message : String(error)
    }
  },

  removeDir: async (path) => {
    try {
      const dirs = await api.removeCustomDir(path)
      const fonts = await api.listFonts()
      const stillThere = fonts.some((font) => font.id === get().selectedId)
      set({
        customDirs: dirs,
        fonts,
        selectedId: stillThere ? get().selectedId : (fonts[0]?.id ?? null),
      })
      get().showToast('目录已移除，索引已刷新')
      return null
    } catch (error) {
      return error instanceof Error ? error.message : String(error)
    }
  },

  /* ───────────── 分类夹 ───────────── */

  createCollection: async (name) => {
    try {
      const created = await api.createCollection(name)
      set((state) => ({
        collections: [...state.collections, created],
        // 新建后直接进入它 —— 分类夹是容器不是标签，进来同样清掉旧筛选
        ...switchTo({ kind: 'collection', id: created.id }),
      }))
      get().showToast(`已新建集合 · ${created.name}`)
      return null
    } catch (error) {
      return error instanceof Error ? error.message : String(error)
    }
  },

  deleteCollection: async (id) => {
    try {
      await api.deleteCollection(id)
      set((state) => {
        const wasActive = sameContainer(state.container, { kind: 'collection', id })
        const collections = state.collections.filter((item) => item.id !== id)
        // 删掉的正是当前容器时回退到"全部"，否则会停在一个不存在的容器上
        return wasActive
          ? { collections, ...switchTo(ALL_VIEW) }
          : { collections }
      })
      get().showToast('集合已删除')
      return null
    } catch (error) {
      return error instanceof Error ? error.message : String(error)
    }
  },

  toggleInCollection: async (collectionId, fontId) => {
    const collection = get().collections.find((item) => item.id === collectionId)
    if (!collection) return

    const has = collection.fontIds.includes(fontId)
    const next = has
      ? collection.fontIds.filter((id) => id !== fontId)
      : [...collection.fontIds, fontId]

    // 先改本地：勾选要立刻有反馈
    set((state) => ({
      collections: state.collections.map((item) =>
        item.id === collectionId ? { ...item, fontIds: next } : item,
      ),
    }))

    try {
      await api.setCollectionFonts(collectionId, next)
    } catch (error) {
      console.error('[fontnest] 更新集合失败', error)
      get().showToast('集合保存失败')
    }
  },

  showToast: (message, undo) => {
    const payload: ToastPayload = { id: Date.now(), message, undo }
    set({ toast: payload })
    window.clearTimeout(toastTimer)
    toastTimer = window.setTimeout(() => {
      set({ toast: null })
    }, 2600)
  },

  dismissToast: () => {
    window.clearTimeout(toastTimer)
    set({ toast: null })
  },
}))
