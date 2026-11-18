import { useEffect, useMemo } from 'react'
import { ensureFace, faceFamily } from '../lib/fontFaces'
import { pickPrimary } from '../lib/group'
import { useApp } from '../state/store'

/**
 * 字体对比面板。
 *
 * 行内展示而不是并排成列：中文字体名很长，且对比文本一旦换行，
 * 分列会让两侧行高错位，反而看不出差异。上下堆叠时每一行都用同一份
 * 样张文本、同一个字号，视线横扫就能比对。
 *
 * 每个族只取主面（Regular 优先）—— 对比的是设计语言，不是字重。
 */
export function ComparePanel() {
  const open = useApp((state) => state.compareOpen)
  const families = useApp((state) => state.compareFamilies)
  const fonts = useApp((state) => state.fonts)
  const sample = useApp((state) => state.sample)
  const size = useApp((state) => state.size)
  const close = useApp((state) => state.closeCompare)

  // 参与对比的字体可能不在当前网格里（比如被搜索过滤掉了），
  // 自定义/可变字体的 @font-face 得自己挂上。
  // useMemo 是必要的：每次渲染都新建数组会让下面的 effect 每次重跑。
  const rows = useMemo(
    () =>
      families
        .map((key) => {
          const faces = fonts.filter((font) => font.family.toLowerCase() === key)
          return faces.length > 0 ? pickPrimary(faces) : null
        })
        .filter((font): font is NonNullable<typeof font> => font !== null),
    [families, fonts],
  )

  useEffect(() => {
    if (!open) return
    for (const font of rows) ensureFace(font)
  }, [open, rows])

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, close])

  if (!open || rows.length === 0) return null

  return (
    <div className="compare-layer" role="dialog" aria-modal="true" aria-label="字体对比">
      <div className="compare-scrim" onClick={close} />

      <div className="compare-panel">
        <header className="compare-head">
          <span className="compare-title">字体对比</span>
          <span className="compare-count">{rows.length} 个字体</span>
          <button type="button" className="compare-close" onClick={close} aria-label="关闭对比">
            <svg viewBox="0 0 12 12" aria-hidden="true">
              <path
                d="M3 3l6 6M9 3l-6 6"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </header>

        <div className="compare-body">
          {rows.map((font) => (
            <div className="compare-row" key={font.family}>
              <div className="compare-meta">
                <span className="compare-name">{font.family}</span>
                <span className="compare-tag">
                  {font.subfamily} · {font.category}
                </span>
              </div>
              <p
                className="compare-sample"
                style={{
                  fontFamily: faceFamily(font),
                  fontWeight: font.weight,
                  fontStyle: font.italic ? 'italic' : 'normal',
                  fontSize: `${size}px`,
                }}
              >
                {sample}
              </p>
            </div>
          ))}
        </div>

        <footer className="compare-foot">按 Esc 关闭</footer>
      </div>
    </div>
  )
}
