interface StatusBarProps {
  visible: number
  total: number
}

export function StatusBar({ visible, total }: StatusBarProps) {
  return (
    <footer className="statusbar">
      <span>
        <b>{visible}</b> / {total} 个字体
      </span>
      <span className="status-hints">
        <kbd>←→</kbd> 浏览 <i /> <kbd>F</kbd> 收藏 <i /> <kbd>1–5</kbd> 字号 <i />{' '}
        <kbd>T</kbd> 样张
      </span>
    </footer>
  )
}
