import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { isTauriRuntime } from './lib/ipc'
import { isMacOS } from './lib/platform'
import './styles/tokens.css'
import './styles/app.css'

// macOS 桌面版用 Overlay 标题栏：红绿灯直接叠在顶栏上，CSS 需要据此让位。
// 浏览器预览没有红绿灯，所以只在 Tauri 里加。
if (isMacOS && isTauriRuntime) {
  document.documentElement.classList.add('platform-mac')
}

const container = document.getElementById('root')
if (!container) {
  throw new Error('找不到 #root 挂载点')
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
