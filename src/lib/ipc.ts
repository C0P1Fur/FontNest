import type { Font, FontQuery } from '../types/font'
import { mockFonts } from '../data/mockFonts'

/**
 * 前端与 Rust 之间唯一的接缝。
 *
 * 浏览器里跑（`pnpm dev`）时走 mock，Tauri 里跑时走 `invoke`。
 * 组件永远只依赖这个模块导出的 `api`，不直接碰 `@tauri-apps/api`，
 * 这样"去掉后端也能开发界面"和"换上真后端不用改组件"同时成立。
 */

export const isTauriRuntime =
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

/** mock 下模拟一次落盘耗时，让 pending 态有机会被看到 */
const MOCK_LATENCY = { scan: 900, install: 620, quick: 120 }

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

async function invokeTauri<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<T>(cmd, args)
}

export interface ScanResult {
  count: number
  finishedAt: number
}

/**
 * v0.1 一次性取回整个字体库，筛选在客户端做（10k 条实测 1–2ms）。
 * 索引与 FTS5 落地后，这里改成 `list_fonts(query)`，其余代码不动。
 */
async function listFonts(_query?: FontQuery): Promise<Font[]> {
  if (isTauriRuntime) {
    return invokeTauri<Font[]>('list_fonts')
  }
  await delay(MOCK_LATENCY.quick)
  return mockFonts.map((font) => ({ ...font }))
}

/** 启用 / 停用。真后端会写注册表并广播 WM_FONTCHANGE。 */
async function setEnabled(ids: string[], enabled: boolean): Promise<void> {
  if (isTauriRuntime) {
    await invokeTauri<void>('set_enabled', { ids, enabled })
    return
  }
  await delay(MOCK_LATENCY.install)
}

async function setFavorite(id: string, favorite: boolean): Promise<void> {
  if (isTauriRuntime) {
    await invokeTauri<void>('set_favorite', { id, favorite })
    return
  }
  await delay(MOCK_LATENCY.quick)
}

async function scan(): Promise<ScanResult> {
  if (isTauriRuntime) {
    return invokeTauri<ScanResult>('scan_fonts')
  }
  await delay(MOCK_LATENCY.scan)
  return { count: mockFonts.length, finishedAt: Date.now() }
}

async function revealInFolder(id: string): Promise<void> {
  if (isTauriRuntime) {
    await invokeTauri<void>('reveal_font', { id })
    return
  }
  await delay(60)
}

export const api = {
  listFonts,
  setEnabled,
  setFavorite,
  scan,
  revealInFolder,
}
