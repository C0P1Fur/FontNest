import { useEffect, useState } from 'react'
import { useApp } from '../state/store'

/**
 * 扫描目录设置。
 *
 * 只负责"把路径交给 store"，校验全部在 Rust 侧做（目录是否存在、是否
 * 重复、是否已在系统范围内）—— 前端不重复实现规则，也就不存在两套真相。
 */
export function SettingsPanel() {
  const open = useApp((state) => state.settingsOpen)
  const close = useApp((state) => state.closeSettings)
  const dirs = useApp((state) => state.customDirs)
  const addDir = useApp((state) => state.addDir)
  const removeDir = useApp((state) => state.removeDir)

  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, close])

  if (!open) return null

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
    const message = await addDir(value)
    setBusy(false)
    if (message) {
      setError(message)
    } else {
      setValue('')
    }
  }

  async function remove(dir: string) {
    setError(null)
    const message = await removeDir(dir)
    if (message) setError(message)
  }

  return (
    <div className="overlay" onMouseDown={close}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="modal-head">
          <h2 id="settings-title">扫描目录</h2>
          <button type="button" className="modal-close" aria-label="关闭" onClick={close}>
            ✕
          </button>
        </header>

        <p className="modal-note">
          系统与用户字体目录会自动扫描。这里可以再加入任意存放字体的文件夹 ——
          里面的文件不会被改动，只是列进库里。
        </p>

        <ul className="dir-list">
          {dirs.map((dir) => (
            <li key={dir} className="dir-row">
              <span className="dir-path" title={dir}>
                {dir}
              </span>
              <button
                type="button"
                className="dir-remove"
                onClick={() => {
                  void remove(dir)
                }}
              >
                移除
              </button>
            </li>
          ))}
          {dirs.length === 0 ? <li className="dir-empty">还没有添加任何目录</li> : null}
        </ul>

        <form className="dir-form" onSubmit={submit}>
          <input
            type="text"
            value={value}
            placeholder="D:\\Fonts"
            aria-label="字体目录路径"
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => setValue(event.target.value)}
          />
          <button type="submit" disabled={busy}>
            {busy ? '添加中…' : '添加'}
          </button>
        </form>

        {error ? (
          <p className="field-error" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </div>
  )
}
