import { useState } from 'react'
import { modShortcut } from '../lib/platform'
import { useApp } from '../state/store'
import { KeyboardIcon, SearchIcon, SunIcon, FolderPlusIcon, ScanTextIcon } from './Icons'

export function TopBar() {
  const query = useApp((state) => state.query)
  const setQuery = useApp((state) => state.setQuery)
  const theme = useApp((state) => state.theme)
  const toggleTheme = useApp((state) => state.toggleTheme)
  const openSettings = useApp((state) => state.openSettings)
  const openRecognize = useApp((state) => state.openRecognize)
  const openTour = useApp((state) => state.openTour)

  const [keysOpen, setKeysOpen] = useState(false)

  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-mark" aria-hidden="true">
          {/*
            探头喵。黑色部分用 currentColor（跟随主题的 --ink），
            白色部分用 --surface（正好等于顶栏背景色），于是深色主题下自动反相——
            否则写死 #000 的黑猫在深色顶栏上会整只消失。
          */}
          {/*
            viewBox 收紧到图形边界（原图 0–128 里图形只占 27–101 / 22–107，
            直接塞进 24px 容器，可见部分只有 14px）。
          */}
          <svg viewBox="24 19 80 91" fill="none">
            <path
              d="M35 53V27Q35 22 40 25L51 34Q64 29 77 34L88 25Q93 22 93 27V53Q93 70 64 70Q35 70 35 53Z"
              fill="currentColor"
            />
            <path
              d="M49 44V47M79 44V47"
              stroke="var(--surface)"
              strokeWidth="5"
              strokeLinecap="round"
            />
            <path
              d="M61 51Q64 54 67 51"
              stroke="var(--surface)"
              strokeWidth="3.5"
              strokeLinecap="round"
            />
            <rect x="27" y="58" width="74" height="49" rx="13" fill="currentColor" />
            <rect x="32" y="63" width="64" height="39" rx="9" fill="var(--surface)" />
            <rect
              x="39"
              y="54"
              width="14"
              height="15"
              rx="7"
              fill="var(--surface)"
              stroke="currentColor"
              strokeWidth="2"
            />
            <rect
              x="75"
              y="54"
              width="14"
              height="15"
              rx="7"
              fill="var(--surface)"
              stroke="currentColor"
              strokeWidth="2"
            />
            <path
              d="M51 94V73H57L70 85V73H77V94H71L58 82V94Z"
              fill="currentColor"
            />
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
        <kbd>{modShortcut('K')}</kbd>
      </div>

      <div className="top-actions">
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
              <kbd>{modShortcut('K')}</kbd> / <kbd>/</kbd>
            </dt>
            <dd>聚焦搜索</dd>
            <dt>
              <kbd>←</kbd> <kbd>→</kbd>
            </dt>
            <dd>在结果间移动</dd>
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
