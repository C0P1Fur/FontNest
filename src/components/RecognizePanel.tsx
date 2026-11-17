import { useEffect, useRef, useState } from 'react'
import type { RecognizeReport } from '../types/font'
import { ensureFace, faceFamily } from '../lib/fontFaces'
import { api, isTauriRuntime } from '../lib/ipc'
import { useApp } from '../state/store'

/**
 * 字体识别面板。
 *
 * 图片有两个来源：全局热键抓的剪贴板，或手动选一个文件。
 * 文字仍然必须由用户输入 —— 模板匹配的前提就是知道画的是什么字，
 * 少这一项整个算法都不成立。所以这条链路上真正的成本是"打几个字"，
 * 不是"点按钮"，焦点一进来就该落在输入框上。
 */
export function RecognizePanel() {
  const open = useApp((state) => state.recognizeOpen)
  const close = useApp((state) => state.closeRecognize)
  const focusFont = useApp((state) => state.focusFont)
  const fonts = useApp((state) => state.fonts)
  const capture = useApp((state) => state.capture)
  const clearCapture = useApp((state) => state.clearCapture)
  const appStatus = useApp((state) => state.appStatus)

  const [image, setImage] = useState('')
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [report, setReport] = useState<RecognizeReport | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // 结果里每个字体都要有可用的 @font-face，才能用它自己的字形展示名字
  useEffect(() => {
    if (!report) return
    for (const candidate of report.candidates.slice(0, 8)) {
      const font = fonts.find((item) => item.id === candidate.fontId)
      if (font) ensureFace(font)
    }
  }, [report, fonts])

  // 关闭即清空：下次打开不该还挂着上一次的图和结果
  useEffect(() => {
    if (open) return
    setImage('')
    setText('')
    setReport(null)
    setError(null)
  }, [open])

  // 焦点直接进输入框。热键流程下用户的手还在键盘上，
  // 任何一次"再点一下"都会把 200ms 的捷径变成 2 秒的往返。
  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open, capture])

  const hasSource = Boolean(capture) || Boolean(image)
  const fileName = image.split(/[\\/]/).pop() ?? ''
  const hotkeyReady = appStatus?.hotkeyReady ?? false

  if (!open) {
    return null
  }

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
        // 选了文件就把剪贴板那张丢掉：否则 run() 仍然优先用 capture，
        // 用户换了图却发现结果没变。
        clearCapture()
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
    if (!trimmed || !hasSource || busy) return

    setBusy(true)
    setError(null)
    setReport(null)
    try {
      // 有剪贴板截图就优先用它：那是用户刚刚按热键抓的那一张，
      // 而 image 里可能还留着上一轮选的文件。
      const result = capture
        ? await api.recognizeFontsFromClipboard(trimmed, 8)
        : await api.recognizeFonts(image, trimmed, 8)
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
          {capture
            ? '已从剪贴板读到截图。输入图里显示的文字，FontNest 会在'
            : '选一张截图，输入图里显示的文字，FontNest 会在'}
          <b>本机全部字体</b>
          （包括还没安装的）里找出最像的几款。文字必须输对 —— 比对的前提就是知道画的是什么。
        </p>

        {capture ? (
          <div className="capture-row">
            {capture.preview ? (
              <img
                className="capture-preview"
                src={capture.preview}
                alt="剪贴板里的截图"
                title={`${capture.width} × ${capture.height}`}
              />
            ) : (
              <span className="capture-meta">
                {capture.width} × {capture.height}
              </span>
            )}
            <button
              type="button"
              className="dir-browse"
              onClick={() => {
                void pick()
              }}
              disabled={busy || !isTauriRuntime}
              title="换一张，改用文件里的图"
            >
              换成文件…
            </button>
          </div>
        ) : (
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
        )}

        {/* 快捷键无效时必须说出来。静默失联会让用户以为功能坏了。 */}
        {hotkeyReady ? (
          <p className="hotkey-hint">
            随时可以截图后按 <kbd>{appStatus?.hotkey}</kbd> 直接打开这里
          </p>
        ) : null}

        <form
          className="dir-form"
          onSubmit={(event) => {
            event.preventDefault()
            void run()
          }}
        >
          <input
            ref={inputRef}
            type="text"
            value={text}
            placeholder="图里写的是什么？例如 Rag 8g"
            aria-label="截图中的文字"
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => setText(event.target.value)}
          />
          <button type="submit" disabled={busy || !hasSource || !text.trim()}>
            {busy ? '识别中…' : '开始识别'}
          </button>
        </form>

        {busy ? <p className="match-hint">正在比对本机全部字体…</p> : null}

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
