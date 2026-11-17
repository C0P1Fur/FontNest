import { useEffect, useState } from 'react'
import type { RecognizeReport } from '../types/font'
import { ensureFace, faceFamily } from '../lib/fontFaces'
import { api, isTauriRuntime } from '../lib/ipc'
import { useApp } from '../state/store'

/**
 * 字体识别面板。
 *
 * 交互被刻意压到三个输入：一张截图、图里的文字、一个按钮。
 * 少一个都不行 —— 模板匹配的前提就是知道画的是什么字。
 */
export function RecognizePanel() {
  const open = useApp((state) => state.recognizeOpen)
  const close = useApp((state) => state.closeRecognize)
  const focusFont = useApp((state) => state.focusFont)
  const fonts = useApp((state) => state.fonts)

  const [image, setImage] = useState('')
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [report, setReport] = useState<RecognizeReport | null>(null)

  // 结果里每个字体都要有可用的 @font-face，才能用它自己的字形展示名字
  useEffect(() => {
    if (!report) return
    for (const candidate of report.candidates.slice(0, 8)) {
      const font = fonts.find((item) => item.id === candidate.fontId)
      if (font) ensureFace(font)
    }
  }, [report, fonts])

  if (!open) {
    return null
  }

  const fileName = image.split(/[\\/]/).pop() ?? ''

  async function pick() {
    if (!isTauriRuntime) return
    try {
      const { open: openDialog } = await import('@tauri-apps/plugin-dialog')
      const picked = await openDialog({
        multiple: false,
        directory: false,
        title: '选择包含文字的截图',
        filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp'] }],
      })
      if (typeof picked === 'string' && picked) {
        setImage(picked)
        setReport(null)
        setError(null)
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  async function run() {
    const trimmed = text.trim()
    if (!image || !trimmed || busy) return

    setBusy(true)
    setError(null)
    setReport(null)
    try {
      const result = await api.recognizeFonts(image, trimmed, 8)
      setReport(result)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
    setBusy(false)
  }

  return (
    <div className="overlay" onMouseDown={close}>
      <div
        className="modal modal-wide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="recognize-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="modal-head">
          <h2 id="recognize-title">字体识别</h2>
          <button type="button" className="modal-close" aria-label="关闭" onClick={close}>
            ✕
          </button>
        </header>

        <p className="modal-note">
          选一张截图，输入图里显示的文字，FontNest 会在<b>本机全部字体</b>
          （包括还没安装的）里找出最像的几款。文字必须输对 —— 比对的前提就是知道画的是什么。
        </p>

        <div className="pick-row">
          <button
            type="button"
            className="dir-browse"
            onClick={() => {
              void pick()
            }}
            disabled={busy || !isTauriRuntime}
            title={isTauriRuntime ? '选择图片文件' : '浏览器预览不支持'}
          >
            选择截图…
          </button>
          <span className="pick-path" title={image}>
            {fileName || '还没有选择图片'}
          </span>
        </div>

        <form
          className="dir-form"
          onSubmit={(event) => {
            event.preventDefault()
            void run()
          }}
        >
          <input
            type="text"
            value={text}
            placeholder="图里写的是什么？例如 Rag 8g"
            aria-label="截图中的文字"
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => setText(event.target.value)}
          />
          <button type="submit" disabled={busy || !image || !text.trim()}>
            {busy ? '识别中…' : '开始识别'}
          </button>
        </form>

        {busy ? (
          <p className="match-hint">正在比对本机全部字体，首次约 5 秒…</p>
        ) : null}

        {error ? (
          <p className="field-error" role="alert">
            {error}
          </p>
        ) : null}

        {report ? (
          <>
            <p className="match-hint">
              比对了 {report.considered} 个字体（跳过 {report.skipped} 个不含所需字形），
              耗时 {report.elapsedMs}ms
            </p>

            {report.candidates.length === 0 ? (
              <p className="dir-empty">没有找到候选，换个更大的截图或核对文字试试。</p>
            ) : (
              <ol className="match-list">
                {report.candidates.map((candidate, index) => {
                  const font = fonts.find((item) => item.id === candidate.fontId)
                  const percent = Math.round(candidate.score * 100)
                  return (
                    <li key={candidate.fontId} className="match-row">
                      <span className="match-rank">{index + 1}</span>
                      <span
                        className="match-name"
                        style={font ? { fontFamily: faceFamily(font) } : undefined}
                        title={font?.family ?? candidate.fontId}
                      >
                        {font?.family ?? candidate.fontId}
                      </span>
                      <span className="match-score">
                        <span className="match-bar">
                          <i style={{ width: `${percent}%` }} />
                        </span>
                        <b>{percent}</b>
                      </span>
                      <button
                        type="button"
                        className="dir-remove"
                        onClick={() => {
                          // 必须清筛选：否则该字体可能不在可见集合里，
                          // 右侧详情会回落到列表第一个，用户看到的就不是识别结果
                          focusFont(candidate.fontId)
                          close()
                        }}
                      >
                        查看
                      </button>
                    </li>
                  )
                })}
              </ol>
            )}
          </>
        ) : null}
      </div>
    </div>
  )
}
