import { useEffect, useMemo, useState } from 'react'
import { useApp } from '../state/store'
import type { CatalogItem } from '../lib/ipc'

/**
 * 可选字体库。
 *
 * 两类字体在这里是**两个 Tab**，而不是混在一张表里加个标记——
 * 因为它们对用户的承诺完全不同：
 *
 * - 可下载：我们替你搞定，点一下就装
 * - 需自行获取：许可禁止我们转发文件，只能指路
 *
 * 混排会让用户以为后者也能一键下载，然后困惑于按钮为什么没反应。
 */

function humanSize(bytes: number): string {
  if (!bytes) return '—'
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export function CatalogPanel() {
  const open = useApp((state) => state.catalogOpen)
  const close = useApp((state) => state.closeCatalog)
  const items = useApp((state) => state.catalogItems)
  const busy = useApp((state) => state.catalogBusy)
  const error = useApp((state) => state.catalogError)
  const download = useApp((state) => state.downloadCatalogFont)
  const remove = useApp((state) => state.removeCatalogFont)
  const toggleEnabled = useApp((state) => state.toggleEnabled)
  const openCatalog = useApp((state) => state.openCatalog)

  const [tab, setTab] = useState<'downloadable' | 'link'>('downloadable')
  const [filter, setFilter] = useState('')
  const [copied, setCopied] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, close])

  const downloadable = useMemo(
    () => items.filter((item) => item.redistributable),
    [items],
  )
  const linkOnly = useMemo(() => items.filter((item) => !item.redistributable), [items])

  const visible = useMemo(() => {
    const pool = tab === 'downloadable' ? downloadable : linkOnly
    const query = filter.trim().toLowerCase()
    if (!query) return pool
    return pool.filter((item) =>
      [item.family, item.nameZh, item.id, ...item.aliases].some((text) =>
        text.toLowerCase().includes(query),
      ),
    )
  }, [tab, downloadable, linkOnly, filter])

  if (!open) return null

  /** 外链：先试 window.open，被拦截就退回剪贴板——总有一条路能走通 */
  function openHomepage(item: CatalogItem) {
    const url = item.homepage
    if (!url) return
    const win = window.open(url, '_blank', 'noopener,noreferrer')
    if (!win) {
      void navigator.clipboard?.writeText(url)
      setCopied(item.id)
      window.setTimeout(() => setCopied(null), 2000)
    }
  }

  return (
    <div className="overlay" onMouseDown={close}>
      <div
        className="modal catalog-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="catalog-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="modal-head">
          <h2 id="catalog-title">字体库</h2>
          <button type="button" className="modal-close" aria-label="关闭" onClick={close}>
            ✕
          </button>
        </header>

        <p className="modal-note">
          可下载的字体由本项目直接获取并校验，装进系统后可随时卸载。
          其余字体受厂商许可限制，只能从官网获取后拖进窗口导入。
        </p>

        <div className="catalog-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'downloadable'}
            className={tab === 'downloadable' ? 'catalog-tab is-active' : 'catalog-tab'}
            onClick={() => setTab('downloadable')}
          >
            可直接下载
            <span className="catalog-count">{downloadable.length}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'link'}
            className={tab === 'link' ? 'catalog-tab is-active' : 'catalog-tab'}
            onClick={() => setTab('link')}
          >
            需自行获取
            <span className="catalog-count">{linkOnly.length}</span>
          </button>
          <input
            type="search"
            className="catalog-filter"
            value={filter}
            placeholder="筛选…"
            aria-label="筛选字体"
            onChange={(event) => setFilter(event.target.value)}
          />
        </div>

        {error ? (
          <p className="field-error" role="alert">
            {error}
          </p>
        ) : null}

        <ul className="catalog-list">
          {visible.map((item) => (
            <li key={item.id} className="catalog-row">
              <div className="catalog-main">
                <span className="catalog-name">{item.nameZh || item.family}</span>
                {item.nameZh && item.nameZh !== item.family ? (
                  <span className="catalog-family">{item.family}</span>
                ) : null}
                <span className="catalog-meta">
                  {item.coverage ? <span className="catalog-chip">{item.coverage}</span> : null}
                  {item.redistributable ? (
                    <span className="catalog-size">{humanSize(item.size)}</span>
                  ) : null}
                  <span className="catalog-license">{item.license}</span>
                </span>
              </div>

              <div className="catalog-actions">
                {item.installed ? (
                  <span className="catalog-badge">已装进系统</span>
                ) : item.downloaded && item.fontId ? (
                  <button
                    type="button"
                    className="catalog-primary"
                    disabled={busy !== null}
                    onClick={() => {
                      // 启用之后必须重新拉一次目录，否则按钮不会变成「已装进系统」
                      void toggleEnabled(item.fontId as string).then(() => openCatalog())
                    }}
                  >
                    装进系统
                  </button>
                ) : item.redistributable ? (
                  <button
                    type="button"
                    className="catalog-primary"
                    disabled={busy !== null}
                    onClick={() => {
                      void download(item.id)
                    }}
                  >
                    {busy === item.id ? '下载中…' : '下载'}
                  </button>
                ) : (
                  <button
                    type="button"
                    className="catalog-primary"
                    disabled={!item.homepage}
                    onClick={() => openHomepage(item)}
                  >
                    {copied === item.id ? '链接已复制' : '去官网下载'}
                  </button>
                )}

                {item.downloaded && !item.installed ? (
                  <button
                    type="button"
                    className="catalog-ghost"
                    disabled={busy !== null}
                    onClick={() => {
                      void remove(item.id)
                    }}
                  >
                    删除
                  </button>
                ) : null}
              </div>
            </li>
          ))}

          {visible.length === 0 ? (
            <li className="catalog-empty">
              {items.length === 0 ? '字体目录为空' : '没有匹配的字体'}
            </li>
          ) : null}
        </ul>

        <p className="modal-note catalog-foot">
          下载的字体先进本地库，不会影响其他软件；点「装进系统」后才进入系统字体列表。
        </p>
      </div>
    </div>
  )
}
