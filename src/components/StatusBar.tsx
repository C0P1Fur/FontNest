interface StatusBarProps {
  visible: number
  total: number
  filters: number
}

export function StatusBar({ visible, total, filters }: StatusBarProps) {
  return (
    <footer className="statusbar">
      <span>
        <b>{visible}</b> / {total} 个字体
        {filters > 0 ? ` · ${filters} 个筛选` : ''}
      </span>
      <span className="status-hints">
        <kbd>↑↓</kbd> 浏览 <i /> <kbd>Space</kbd> 启用 <i /> <kbd>F</kbd> 收藏 <i />{' '}
        <kbd>1–5</kbd> 字号 <i /> <kbd>T</kbd> 样张
      </span>
      <span className="status-right">本地运行 · 零遥测</span>
    </footer>
  )
}
