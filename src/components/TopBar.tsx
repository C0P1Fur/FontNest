import { useState } from 'react'
import { useApp } from '../state/store'
import { KeyboardIcon, SearchIcon, SunIcon, FolderPlusIcon, ScanTextIcon } from './Icons'

export function TopBar() {
  const query = useApp((state) => state.query)
  const setQuery = useApp((state) => state.setQuery)
  const theme = useApp((state) => state.theme)
  const toggleTheme = useApp((state) => state.toggleTheme)
  const scanPhase = useApp((state) => state.scanPhase)
  const openSettings = useApp((state) => state.openSettings)
  const openRecognize = useApp((state) => state.openRecognize)
  const openTour = useApp((state) => state.openTour)

  const [keysOpen, setKeysOpen] = useState(false)

  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-mark" aria-hidden="true">
          <svg viewBox="0 0 24 24">
            <path
              d="M3.2 9.4c0 6.1 3.9 9.8 8.8 9.8s8.8-3.7 8.8-9.8"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
            />
            <path
              d="M6.9 7.6c0 4.7 2.3 7.4 5.1 7.4s5.1-2.7 5.1-7.4"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
            />
            <circle cx="12" cy="4.3" r="1.7" fill="currentColor" />
          </svg>
        </span>
        <span className="brand-text">
          <b>FontNest</b>
          <i>LOCAL TYPE LIBRARY</i>
        </span>
      </div>

      <div className="search" data-state={query ? 'active' : 'idle'} data-tour="search">
        <SearchIcon />
        <input
          id="search-input"
          type="search"
          value={query}
          placeholder="搜索字体、厂商、设计师…"
          aria-label="搜索字体"
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => setQuery(event.target.value)}
        />
        <kbd>⌘K</kbd>
      </div>

      <div className="top-actions">
        <div className={scanPhase === 'scanning' ? 'sync is-scanning' : 'sync'}>
          <span className="pulse" />
          <span>{scanPhase === 'scanning' ? '扫描中' : '已同步'}</span>
        </div>

        <button
          type="button"
          className="icon-btn"
          aria-label="字体识别"
          title="字体识别（用截图找字体）"
          data-tour="recognize"
          onClick={openRecognize}
        >
          <ScanTextIcon />
        </button>

        <button
          type="button"
          className="icon-btn"
          aria-label="添加扫描目录"
          title="添加扫描目录"
          onClick={openSettings}
        >
          <FolderPlusIcon />
        </button>

        <button
          type="button"
          className="icon-btn"
          aria-label={theme === 'dark' ? '切换浅色模式' : '切换深色模式'}
          title="切换深浅色"
          onClick={toggleTheme}
        >
          <SunIcon />
        </button>

        <button
          type="button"
          className="icon-btn"
          aria-label="键盘快捷键"
          title="键盘快捷键"
          aria-expanded={keysOpen}
          onClick={() => setKeysOpen((open) => !open)}
        >
          <KeyboardIcon />
        </button>
      </div>

      {keysOpen ? (
        <div className="keys-panel" role="dialog" aria-label="键盘快捷键">
          <h3>键盘</h3>
          <dl>
            <dt>
              <kbd>⌘K</kbd> / <kbd>/</kbd>
            </dt>
            <dd>聚焦搜索</dd>
            <dt>
              <kbd>↑</kbd> <kbd>↓</kbd>
            </dt>
            <dd>在结果间移动</dd>
            <dt>
              <kbd>Space</kbd>
            </dt>
            <dd>启用 / 停用当前字体</dd>
            <dt>
              <kbd>F</kbd>
            </dt>
            <dd>收藏 / 取消收藏</dd>
            <dt>
              <kbd>1</kbd>–<kbd>5</kbd>
            </dt>
            <dd>切换预览字号</dd>
            <dt>
              <kbd>T</kbd>
            </dt>
            <dd>切换样张文本</dd>
            <dt>
              <kbd>G</kbd> / <kbd>L</kbd>
            </dt>
            <dd>网格 / 列表视图</dd>
            <dt>
              <kbd>Esc</kbd>
            </dt>
            <dd>清空搜索</dd>
          </dl>

          <button
            type="button"
            className="keys-replay"
            onClick={() => {
              setKeysOpen(false)
              openTour()
            }}
          >
            重新查看上手引导
          </button>
        </div>
      ) : null}
    </header>
  )
}
