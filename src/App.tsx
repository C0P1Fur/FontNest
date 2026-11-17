import { useEffect, useMemo } from 'react'
import type { CSSProperties } from 'react'
import { TopBar } from './components/TopBar'
import { Rail } from './components/Rail'
import { ControlBar } from './components/ControlBar'
import { FontGrid } from './components/FontGrid'
import { Inspector } from './components/Inspector'
import { StatusBar } from './components/StatusBar'
import { Toast } from './components/Toast'
import { SettingsPanel } from './components/SettingsPanel'
import { RecognizePanel } from './components/RecognizePanel'
import { Tour } from './components/Tour'
import { applyQuery } from './lib/filter'
import { api } from './lib/ipc'
import { RIPPLE_SELECTOR, rippleFrom, tactile } from './lib/motion'
import { SAMPLES, SIZES } from './lib/samples'
import { useApp } from './state/store'

/**
 * 这三个处理器定义在模块作用域，而不是组件内联。
 *
 * 内联箭头函数每次渲染都是新对象，`FontCard` 的 memo 浅比较必然失败，
 * 401 张卡会在每次选中/改字号时全部重渲染 —— 这是卡顿的主因之一。
 * 放在模块层，函数身份永久稳定，memo 才真正生效。
 */
const handleSelect = (id: string) => useApp.getState().select(id)
const handleToggleFavorite = (id: string) => useApp.getState().toggleFavorite(id)
const handleToggleEnabled = (id: string) => {
  void useApp.getState().toggleEnabled(id)
}

export default function App() {
  const fonts = useApp((state) => state.fonts)
  const status = useApp((state) => state.status)
  const query = useApp((state) => state.query)
  const scope = useApp((state) => state.scope)
  const categories = useApp((state) => state.categories)
  const sort = useApp((state) => state.sort)
  const view = useApp((state) => state.view)
  const size = useApp((state) => state.size)
  const sample = useApp((state) => state.sample)
  const theme = useApp((state) => state.theme)
  const selectedId = useApp((state) => state.selectedId)
  const collections = useApp((state) => state.collections)
  const activeCollectionId = useApp((state) => state.activeCollectionId)

  const visible = useMemo(() => {
    const base = applyQuery(fonts, { query, scope, categories, sort })
    if (!activeCollectionId) return base

    const collection = collections.find((item) => item.id === activeCollectionId)
    if (!collection) return base

    const members = new Set(collection.fontIds)
    return base.filter((font) => members.has(font.id))
  }, [fonts, query, scope, categories, sort, collections, activeCollectionId])

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

  /* 键盘：全部读取 store 快照，避免闭包过期 */
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const state = useApp.getState()
      const target = event.target as HTMLElement | null
      const tag = target?.tagName.toLowerCase() ?? ''
      const typing = tag === 'input' || tag === 'textarea' || tag === 'select'

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        document.getElementById('search-input')?.focus()
        return
      }

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

      const list = applyQuery(state.fonts, {
        query: state.query,
        scope: state.scope,
        categories: state.categories,
        sort: state.sort,
      })
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

      switch (event.key) {
        case 'ArrowDown':
        case 'j':
          event.preventDefault()
          moveTo(list[Math.min(index + 1, list.length - 1)].id)
          return
        case 'ArrowUp':
        case 'k':
          event.preventDefault()
          moveTo(list[Math.max(index - 1, 0)].id)
          return
        case ' ':
          event.preventDefault()
          void state.toggleEnabled(currentId)
          return
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
              fonts={visible}
              sample={sample}
              selectedId={selected?.id ?? null}
              view={view}
              onSelect={handleSelect}
              onToggleFavorite={handleToggleFavorite}
              onToggleEnabled={handleToggleEnabled}
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
      <SettingsPanel />
      <RecognizePanel />
      <Tour />
      <Toast />
    </div>
  )
}
