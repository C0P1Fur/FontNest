import { create } from 'zustand'
import type {
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
  toggleEnabled: (id: string) => Promise<void>
  toggleFavorite: (id: string) => void
  reveal: (id: string) => void
  toggleTheme: () => void
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

  query: '',
  scope: 'all',
  categories: [],
  sort: 'name',

  view: 'grid',
  size: 24,
  sample: 'The quick brown fox 敏捷的棕色狐狸',
  theme: readTheme(),

  selectedId: null,
  pendingId: null,
  toast: null,

  bootstrap: async () => {
    if (get().status !== 'idle') return
    set({ status: 'loading' })
    try {
      const fonts = await api.listFonts()
      set((state) => ({
        fonts,
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
      get().showToast(`索引已刷新 · ${fonts.length} 个字体`)
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
      console.error('[fontnest] 切换启用状态失败', error)
      set({ pendingId: null })
      get().showToast('操作失败，已回滚')
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
