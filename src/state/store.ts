import { create } from 'zustand'
import type {
  AppStatus,
  ClipboardCapture,
  Collection,
  Font,
  FontCategory,
  LibraryScope,
  ScanPhase,
  SortKey,
  ViewMode,
} from '../types/font'
import { api } from '../lib/ipc'
import type { CatalogItem } from '../lib/ipc'

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
  /** 当前作为筛选条件的分类；null 表示不按分类过滤 */
  activeCollectionId: string | null

  /* 查询 */
  query: string
  scope: LibraryScope
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

  /* 选中与瞬时态 */
  selectedId: string | null
  pendingId: string | null
  toast: ToastPayload | null

  /* 动作 */
  bootstrap: () => Promise<void>
  rescan: () => Promise<void>
  setQuery: (query: string) => void
  setScope: (scope: LibraryScope) => void
  toggleCategory: (category: FontCategory) => void
  setSort: (sort: SortKey) => void
  setView: (view: ViewMode) => void
  setSize: (size: number) => void
  setSample: (sample: string) => void
  select: (id: string) => void
  /** 清掉所有筛选并选中某个字体 —— 保证它在网格和详情里都看得见 */
  focusFont: (id: string) => void
  toggleEnabled: (id: string) => Promise<void>
  toggleFavorite: (id: string) => void
  reveal: (id: string) => void
  toggleTheme: () => void
  openSettings: () => void
  closeSettings: () => void
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
  setActiveCollection: (id: string) => void
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
  activeCollectionId: null,

  query: '',
  scope: 'all',
  categories: [],
  sort: 'name',

  view: 'grid',
  size: 24,
  sample: 'The quick brown fox 敏捷的棕色狐狸',
  theme: readTheme(),
  settingsOpen: false,
  recognizeOpen: false,
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
  pendingId: null,
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
  setScope: (scope) => set({ scope }),
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

  toggleEnabled: async (id) => {
    if (get().pendingId) return
    const font = get().fonts.find((item) => item.id === id)
    if (!font) return

    const next = !font.enabled
    set({ pendingId: id })

    try {
      await api.setEnabled([id], next)
      set((state) => ({
        fonts: state.fonts.map((item) =>
          item.id === id ? { ...item, enabled: next } : item,
        ),
        pendingId: null,
      }))
      get().showToast(
        next ? `已启用 · ${font.family}` : `已停用 · ${font.family}`,
        () => {
          void get().toggleEnabled(id)
        },
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error('[fontnest] 切换启用状态失败', error)
      set({ pendingId: null })
      // 把后端的原话透出来：M2 未实现时要让用户知道是"还没做"，不是"出错了"
      get().showToast(`操作失败：${message}`)
    }
  },

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
    set({ query: '', scope: 'all', categories: [], selectedId: id }),

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

  /* ───────────── 分类 ───────────── */

  setActiveCollection: (id) =>
    set((state) => ({ activeCollectionId: state.activeCollectionId === id ? null : id })),

  createCollection: async (name) => {
    try {
      const created = await api.createCollection(name)
      set((state) => ({
        collections: [...state.collections, created],
        activeCollectionId: created.id,
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
      set((state) => ({
        collections: state.collections.filter((item) => item.id !== id),
        activeCollectionId:
          state.activeCollectionId === id ? null : state.activeCollectionId,
      }))
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
