import { useApp } from '../state/store'

/**
 * 带撤销的 Toast。
 * 进度条靠 `key` 换元素重挂，从而每次弹出都重新走一遍 2.6s 的收缩动画。
 */
export function Toast() {
  const toast = useApp((state) => state.toast)
  const dismiss = useApp((state) => state.dismissToast)

  return (
    <div
      className={toast ? 'toast is-show' : 'toast'}
      role="status"
      aria-live="polite"
    >
      <span className="toast-msg">{toast?.message ?? ''}</span>
      {toast?.undo ? (
        <button
          type="button"
          className="toast-undo"
          onClick={() => {
            toast.undo?.()
            dismiss()
          }}
        >
          撤销
        </button>
      ) : null}
      <i className="toast-bar" key={toast?.id ?? 0} aria-hidden="true" />
    </div>
  )
}
