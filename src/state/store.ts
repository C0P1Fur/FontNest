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
  capture: null,
  appStatus: null,

  selectedId: null,
  pendingId: null,
  toast: null,

  bootstrap: async () => {
    if (get().status !== 'idle') return
    set({ status: 'loading' })
    try {
      const [fonts, dirs, collections, appStatus] = await Promise.all([
        api.listFonts(),
        api.getCustomDirs(),
        api.listCollections(),
        api.getAppStatus(),
      ])
      set((state) => ({
        fonts,
        customDirs: dirs,
        collections,
        appStatus,
        status: 'ready',
        lastScanAt: Date.now(),
        selectedId: state.selectedId ?? fonts[0]?.id ?? null,
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
