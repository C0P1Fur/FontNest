import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import type { Font } from '../types/font'
import { CATEGORY_LABEL } from '../lib/filter'
import { faceFamily, ensureFace } from '../lib/fontFaces'
import { formatBytes, formatCount } from '../lib/format'
import { spawnSparks } from '../lib/motion'
import { SIZES } from '../lib/samples'
import { useIndicator } from '../lib/useIndicator'
import { useApp } from '../state/store'
import { CheckIcon, FolderIcon, PlusIcon, StarIcon } from './Icons'

type TabKey = 'meta' | 'chars' | 'license'

const TABS: { key: TabKey; label: string }[] = [
  { key: 'meta', label: '元数据' },
  { key: 'chars', label: '字符' },
  { key: 'license', label: '授权' },
]

const LATIN_CHARS =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789&?!@#$%*()[]—…'
const HAN_CHARS = '永東国圖酬謝飄龍'

export function Inspector({ font }: { font: Font | null }) {
  const sample = useApp((state) => state.sample)
  const size = useApp((state) => state.size)
  const setSize = useApp((state) => state.setSize)
  const busy = useApp((state) => state.selectionBusy)
  const allFonts = useApp((state) => state.fonts)
  const setFamilyEnabled = useApp((state) => state.setFamilyEnabled)
  const toggleFavorite = useApp((state) => state.toggleFavorite)
  const reveal = useApp((state) => state.reveal)
  const collections = useApp((state) => state.collections)
  const activeCollectionId = useApp((state) => state.activeCollectionId)
  const toggleInCollection = useApp((state) => state.toggleInCollection)

  const [tab, setTab] = useState<TabKey>('meta')
  const [axes, setAxes] = useState<Record<string, number>>({})

  const fontId = font?.id ?? ''
  useEffect(() => {
    if (!font) {
      setAxes({})
      return
    }
    // 自定义目录的字体要先把 @font-face 挂上去，否则详情区也是兜底字形
    ensureFace(font)
    const next: Record<string, number> = {}
    for (const axis of font.axes) next[axis.tag] = axis.defaultValue
    setAxes(next)
    // 只跟随字体切换重置，编辑轴时不重置
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fontId])

  const { wrapRef, indicatorRef } = useIndicator<TabKey>(tab, 0)

  /**
   * 安装/卸载的粒度是「字体族」，不是单个字重。
   *
   * 只装一个 Regular 会让系统里出现半套字体：用户在 Word 里点加粗，
   * 字形会突然跳成别的字体。所以按钮统计的是整族的状态。
   */
  const familyKey = font ? font.family.toLowerCase() : ''
  const familyFaces = useMemo(
    () =>
      allFonts.filter(
        (item) => item.source === 'custom' && item.family.toLowerCase() === familyKey,
      ),
    [allFonts, familyKey],
  )
  const allInstalled = familyFaces.length > 0 && familyFaces.every((item) => item.enabled)
  const anyInstalled = familyFaces.some((item) => item.enabled)

  const face = useMemo(
    () => (font ? { fontFamily: faceFamily(font) } : undefined),
    [font],
  )

  if (!font) {
    return <aside className="inspector" aria-label="字体详情" />
  }

  const activeCollection = activeCollectionId
    ? collections.find((item) => item.id === activeCollectionId)
    : undefined
  const inCollection = activeCollection?.fontIds.includes(font.id) ?? false
  const weight = axes.wght ?? font.weight
  const variation = font.variable
    ? font.axes.map((axis) => `"${axis.tag}" ${axes[axis.tag] ?? axis.defaultValue}`).join(', ')
    : undefined

  const specimenStyle: CSSProperties = {
    ...face,
    fontWeight: weight,
    fontVariationSettings: variation,
  }

  const chars = font.category === 'cjk' ? LATIN_CHARS + HAN_CHARS : LATIN_CHARS

  function cycleSize() {
    const index = SIZES.indexOf(size)
    setSize(SIZES[(index + 1) % SIZES.length] ?? SIZES[0])
  }

  return (
    <aside className="inspector" aria-label="字体详情">
      {/*
        可滚动区与操作栏必须是两个独立的行：
        早先把操作栏做成 sticky 叠在内容上，内容一长（元数据 10 行）
        就会从 tab-body 里溢出、钻到操作栏底下被遮住。
      */}
      <div className="insp-scroll">
        <div className="insp-head">
          <div className="insp-eyebrow">
            <span>{CATEGORY_LABEL[font.category]}</span>
            {font.variable ? <span className="v-badge">VARIABLE</span> : null}
            <span>·</span>
            <span>{font.year > 0 ? font.year : '—'}</span>
          </div>
          <h2 className="insp-name" style={face}>
            {font.family}
          </h2>
          <p className="insp-sub">
            {font.instanceCount} 个样式 · {font.designer} · {font.foundry}
          </p>
        </div>

        <div className="specimen" onClick={cycleSize} title="点击切换字号">
          <div className="specimen-text" style={specimenStyle}>
            {sample}
          </div>
          <span className="specimen-hint">点击改字号</span>
        </div>

        {font.axes.length > 0 ? (
          <div className="axes" role="group" aria-label="可变字体轴">
            {font.axes.map((axis) => {
              const value = axes[axis.tag] ?? axis.defaultValue
              return (
                <div className="axis" key={axis.tag}>
                  <label htmlFor={`axis-${axis.tag}`}>{axis.tag}</label>
                  <input
                    id={`axis-${axis.tag}`}
                    type="range"
                    min={axis.min}
                    max={axis.max}
                    value={value}
                    onChange={(event) =>
                      setAxes((prev) => ({ ...prev, [axis.tag]: Number(event.target.value) }))
                    }
                  />
                  <output htmlFor={`axis-${axis.tag}`}>{value}</output>
                </div>
              )
            })}
          </div>
        ) : null}

        <div className="tabs" ref={wrapRef} role="tablist" aria-label="详情分栏">
          <span className="tab-ind" ref={indicatorRef} aria-hidden="true" />
          {TABS.map((item) => (
            <button
              key={item.key}
              type="button"
              role="tab"
              aria-selected={tab === item.key}
              data-active={tab === item.key}
              className={tab === item.key ? 'tab is-active' : 'tab'}
              onClick={() => setTab(item.key)}
            >
              {item.label}
            </button>
          ))}
        </div>

        {tab === 'meta' ? (
          <div className="tab-body">
            <dl className="meta-list">
              <MetaRow label="家族名" value={font.family} />
              <MetaRow label="PostScript" value={font.psName} mono />
              <MetaRow label="分类" value={CATEGORY_LABEL[font.category]} />
              <MetaRow
                label="样式数"
                value={`${font.instanceCount} 个${font.variable ? ' · 可变' : ''}`}
              />
              <MetaRow label="字形数" value={formatCount(font.glyphCount)} />
              <MetaRow label="厂商" value={font.foundry} />
              <MetaRow
                label="设计"
                value={font.year > 0 ? `${font.designer} · ${font.year}` : font.designer}
              />
              <MetaRow label="授权" value={font.license} />
              <MetaRow label="文件" value={font.filePath} mono />
              <MetaRow label="大小" value={formatBytes(font.sizeBytes)} />
            </dl>
          </div>
        ) : null}

        {tab === 'chars' ? (
          <div className="tab-body">
            <div className="charmap" style={face}>
              {chars.split('').map((char, index) => (
                <span key={`${char}-${index}`}>{char}</span>
              ))}
            </div>
            <p className="charmap-note">
              缺失字形显示为方框 · 共 {formatCount(font.glyphCount)} 个字形
            </p>
          </div>
        ) : null}

        {tab === 'license' ? (
          <div className="tab-body">
            <div className="license-body">
              <strong>{font.license}</strong>
              <p>
                此字体由 {font.foundry} 提供，嵌入与再分发条款以厂商许可为准。FontNest
                仅索引本机文件，不上传、不解析授权内容。
              </p>
              <p>字体文件位于当前用户目录，卸载时将被移入应用回收站，7 天内可恢复。</p>
            </div>
          </div>
        ) : null}
      </div>

      <div className="insp-actions">
        {font.source === 'custom' ? (
          <button
            type="button"
            className={`btn-primary${allInstalled ? ' is-on' : ''}${busy ? ' is-pending' : ''}`}
            aria-disabled={busy}
            onClick={() => {
              void setFamilyEnabled(font.family, !allInstalled)
            }}
          >
            <span className="btn-lede">
              <PlusIcon className="ico ic-plus" />
              <CheckIcon className="ico ic-check" />
              <span className="spinner" />
            </span>
            <span className="btn-text">
              {busy
                ? allInstalled
                  ? '正在卸载…'
                  : '正在安装…'
                : allInstalled
                  ? '已安装'
                  : anyInstalled
                    ? '安装剩余字重'
                    : familyFaces.length > 1
                      ? `安装整族（${familyFaces.length} 个字重）`
                      : '安装字体'}
            </span>
          </button>
        ) : (
          <div
            className="btn-primary is-managed"
            title="系统字体由操作系统管理，FontNest 不会改动它"
          >
            <span className="btn-text">系统字体 · 只读</span>
          </div>
        )}

        <button
          type="button"
          className="btn-icon"
          aria-label="收藏"
          aria-pressed={font.favorite}
          onClick={(event) => {
            if (!font.favorite) spawnSparks(event.currentTarget)
            toggleFavorite(font.id)
          }}
        >
          <StarIcon filled={font.favorite} />
        </button>

        <button
          type="button"
          className="btn-icon"
          aria-label="在文件管理器中显示"
          onClick={() => reveal(font.id)}
        >
          <FolderIcon />
        </button>

        {/* 只有选中了某个分类时才出现：把当前字体加进去 / 拿出来 */}
        {activeCollection ? (
          <button
            type="button"
            className="btn-icon"
            aria-pressed={inCollection}
            aria-label={inCollection ? '移出分类' : '加入分类'}
            title={`${inCollection ? '移出' : '加入'}「${activeCollection.name}」`}
            onClick={() => {
              void toggleInCollection(activeCollection.id, font.id)
            }}
          >
            <span className="btn-glyph">{inCollection ? '−' : '+'}</span>
          </button>
        ) : null}
      </div>
    </aside>
  )
}

function MetaRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="meta-row">
      <dt>{label}</dt>
      <dd className={mono ? 'mono' : undefined}>{value}</dd>
    </div>
  )
}
