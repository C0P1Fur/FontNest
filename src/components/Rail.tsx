import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { FontCategory, LibraryScope } from '../types/font'
import { CATEGORY_LABEL, CATEGORY_ORDER, countLibrary } from '../lib/filter'
import { useApp } from '../state/store'
import {
  CircleCheckIcon,
  CircleDashedIcon,
  FolderIcon,
  LayersIcon,
  LibraryIcon,
  RefreshIcon,
  StarOutlineIcon,
  VariableIcon,
} from './Icons'

const SCOPE_META: Record<LibraryScope, { label: string; icon: ReactNode }> = {
  all: { label: '全部字体', icon: <LayersIcon /> },
  enabled: { label: '已安装', icon: <CircleCheckIcon /> },
  disabled: { label: '未安装', icon: <CircleDashedIcon /> },
  variable: { label: '可变字体', icon: <VariableIcon /> },
  favorite: { label: '收藏', icon: <StarOutlineIcon /> },
}

const SCOPE_ORDER: LibraryScope[] = ['all', 'enabled', 'disabled', 'variable', 'favorite']

export function Rail() {
  const fonts = useApp((state) => state.fonts)
  const container = useApp((state) => state.container)
  const setContainer = useApp((state) => state.setContainer)
  const categories = useApp((state) => state.categories)
  const toggleCategory = useApp((state) => state.toggleCategory)
  const rescan = useApp((state) => state.rescan)
  const scanPhase = useApp((state) => state.scanPhase)
  const openCatalog = useApp((state) => state.openCatalog)

  const collections = useApp((state) => state.collections)
  const createCollection = useApp((state) => state.createCollection)
  const deleteCollection = useApp((state) => state.deleteCollection)

  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const counts = useMemo(() => countLibrary(fonts), [fonts])

  const viewActive = (scope: LibraryScope) =>
    container.kind === 'view' && container.scope === scope
  const collectionActive = (id: string) =>
    container.kind === 'collection' && container.id === id

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    const name = draft.trim()
    if (!name || busy) return
    setBusy(true)
    setError(null)
    const message = await createCollection(name)
    setBusy(false)
    if (message) {
      setError(message)
    } else {
      setDraft('')
    }
  }

  return (
    <aside className="rail">
      {/*
        内置视图和用户分类夹在同一个列表里、用同一种行样式 —— 它们是同一层级的
        同类对象：都是"一次只看一坨字体"的容器，互斥单选。

        以前它们分处两个区块，且状态是两个独立字段、同时生效，
        于是分类夹退化成了"贴在视图上的标签"：选中收藏再点某个分类夹会得到交集，
        左栏还会两行同时高亮。
      */}
      <nav aria-label="浏览容器" data-tour="filters">
        <h2 className="rail-title">字体库</h2>

        {SCOPE_ORDER.map((key) => (
          <button
            key={key}
            type="button"
            className={viewActive(key) ? 'rail-item is-active' : 'rail-item'}
            aria-pressed={viewActive(key)}
            data-scope={key}
            onClick={() => setContainer({ kind: 'view', scope: key })}
          >
            {SCOPE_META[key].icon}
            <span className="rail-label">{SCOPE_META[key].label}</span>
            <span className="count">{counts[key]}</span>
          </button>
        ))}

        {collections.length > 0 ? <span className="rail-sep" aria-hidden="true" /> : null}

        {collections.map((collection) => {
          const active = collectionActive(collection.id)
          return (
            <div key={collection.id} className="coll-row">
              <button
                type="button"
                className={active ? 'rail-item is-active' : 'rail-item'}
                aria-pressed={active}
                onClick={() => setContainer({ kind: 'collection', id: collection.id })}
              >
                <FolderIcon />
                <span className="rail-label">{collection.name}</span>
                <span className="count">{collection.fontIds.length}</span>
              </button>

              <button
                type="button"
                className="coll-remove"
                title="删除分类夹"
                aria-label={`删除分类夹 ${collection.name}`}
                onClick={() => {
                  void deleteCollection(collection.id)
                }}
              >
                ✕
              </button>
            </div>
          )
        })}

        <form className="coll-form" onSubmit={submit}>
          <input
            type="text"
            value={draft}
            placeholder={collections.length > 0 ? '新建分类夹…' : '还没有分类夹，新建一个…'}
            aria-label="新建分类夹"
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => setDraft(event.target.value)}
          />
          <button type="submit" disabled={busy} aria-label="创建分类夹">
            +
          </button>
        </form>
        {error ? <p className="coll-error">{error}</p> : null}
      </nav>

      {/* 类型是过滤器，不是容器：可以多选，叠加在当前容器之上 */}
      <div className="rail-block" data-tour="filters">
        <h2 className="rail-title">类型</h2>
        {CATEGORY_ORDER.map((category: FontCategory) => (
          <label key={category} className="check">
            <input
              type="checkbox"
              value={category}
              checked={categories.includes(category)}
              onChange={() => toggleCategory(category)}
            />
            <span className="box">
              <svg viewBox="0 0 12 12" aria-hidden="true">
                <path
                  d="M2.4 6.2l2.4 2.4 4.8-5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.9"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
            <span className="rail-label">{CATEGORY_LABEL[category]}</span>
            <span className="count">{counts.categories[category]}</span>
          </label>
        ))}
      </div>

      <div className="rail-foot">
        <button
          type="button"
          className="ghost-btn"
          onClick={() => {
            void openCatalog()
          }}
        >
          <span className="btn-lede">
            <LibraryIcon />
          </span>
          <span className="btn-text">推荐下载字体</span>
        </button>

        <button
          type="button"
          className={
            scanPhase === 'scanning'
              ? 'ghost-btn is-pending'
              : scanPhase === 'done'
                ? 'ghost-btn is-done'
                : 'ghost-btn'
          }
          onClick={() => {
            void rescan()
          }}
        >
          <span className="btn-lede">
            <RefreshIcon />
          </span>
          <span className="btn-text">{scanPhase === 'scanning' ? '扫描中…' : '刷新索引'}</span>
        </button>
      </div>
    </aside>
  )
}
