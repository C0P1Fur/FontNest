import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Tauri 期望一个固定端口的 dev server；它自己会接管窗口，所以不清屏。
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      // Rust 侧改动由 cargo watch 管，Vite 不必跟着重启
      ignored: ['**/src-tauri/**'],
    },
  },
  build: {
    target: 'es2022',
    // 桌面应用不需要为老浏览器降级
    sourcemap: false,
  },
})
