import type {
  AppStatus,
  ClipboardCapture,
  Collection,
  Font,
  FontQuery,
  ReconcileReport,
  RecognizeReport,
} from '../types/font'
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
  failed: number
  /** 看起来是字体但格式不受支持的文件，按扩展名汇总 */
  unsupported: { ext: string; count: number }[]
  finishedAt: number
}

/** 与 Rust 侧 ui.json 对应 */
export interface UiState {
  tourSeen: boolean
  tourStep: number
  tourSeenAt: number
}

/** mock 下的自定义目录，仅用于浏览器里点得动 */
const mockDirs: string[] = []

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
  return { count: mockFonts.length, failed: 0, unsupported: [], finishedAt: Date.now() }
}

async function revealInFolder(id: string): Promise<void> {
  if (isTauriRuntime) {
    await invokeTauri<void>('reveal_font', { id })
    return
  }
  await delay(60)
}

/* ───────────── 自定义扫描目录 ───────────── */

async function getCustomDirs(): Promise<string[]> {
  if (isTauriRuntime) {
    return invokeTauri<string[]>('get_custom_dirs')
  }
  return [...mockDirs]
}

async function addCustomDir(path: string): Promise<string[]> {
  if (isTauriRuntime) {
    return invokeTauri<string[]>('add_custom_dir', { path })
  }
  await delay(MOCK_LATENCY.quick)
  const trimmed = path.trim()
  if (!trimmed) throw new Error('目录路径不能为空')
  if (mockDirs.includes(trimmed)) throw new Error('目录已添加')
  mockDirs.push(trimmed)
  return [...mockDirs]
}

async function removeCustomDir(path: string): Promise<string[]> {
  if (isTauriRuntime) {
    return invokeTauri<string[]>('remove_custom_dir', { path })
  }
  await delay(MOCK_LATENCY.quick)
  const index = mockDirs.indexOf(path)
  if (index >= 0) mockDirs.splice(index, 1)
  return [...mockDirs]
}

/* ───────────── 分类 ───────────── */

const mockCollections: Collection[] = []

async function listCollections(): Promise<Collection[]> {
  if (isTauriRuntime) {
    return invokeTauri<Collection[]>('list_collections')
  }
  return mockCollections.map((item) => ({ ...item, fontIds: [...item.fontIds] }))
}

async function createCollection(name: string): Promise<Collection> {
  if (isTauriRuntime) {
    return invokeTauri<Collection>('create_collection', { name })
  }
  await delay(MOCK_LATENCY.quick)
  const trimmed = name.trim()
  if (!trimmed) throw new Error('集合名称不能为空')
  if (mockCollections.some((item) => item.name === trimmed)) {
    throw new Error(`已存在同名集合：${trimmed}`)
  }
  const created: Collection = {
    id: `c${Date.now()}`,
    name: trimmed,
    fontIds: [],
    createdAt: Date.now(),
  }
  mockCollections.push(created)
  return created
}

async function deleteCollection(id: string): Promise<void> {
  if (isTauriRuntime) {
    await invokeTauri<void>('delete_collection', { id })
    return
  }
  await delay(MOCK_LATENCY.quick)
  const index = mockCollections.findIndex((item) => item.id === id)
  if (index >= 0) mockCollections.splice(index, 1)
}

async function setCollectionFonts(id: string, fonts: string[]): Promise<void> {
  if (isTauriRuntime) {
    await invokeTauri<void>('set_collection_fonts', { id, fonts })
    return
  }
  await delay(MOCK_LATENCY.quick)
  const target = mockCollections.find((item) => item.id === id)
  if (target) target.fontIds = [...new Set(fonts)]
}


/* ───────────── UI 偏好（引导） ───────────── */

const mockUi: UiState = { tourSeen: false, tourStep: 0, tourSeenAt: 0 }

async function getUiState(): Promise<UiState> {
  if (isTauriRuntime) {
    return invokeTauri<UiState>('get_ui_state')
  }
  return { ...mockUi }
}

async function saveUiState(state: UiState): Promise<void> {
  if (isTauriRuntime) {
    await invokeTauri<void>('save_ui_state', { state })
    return
  }
  Object.assign(mockUi, state)
}

/* ───────────── 可选字体库 ───────────── */

export interface CatalogItem {
  id: string
  family: string
  nameZh: string
  aliases: string[]
  category: string
  /** 字符集覆盖，如 "GB18030-2022" / "常用" / "展示" */
  coverage: string
  license: string
  licenseUrl: string
  /** 许可是否允许我们再分发：false 的只能去官网下载 */
  redistributable: boolean
  homepage: string
  note: string
  size: number
  downloaded: boolean
  installed: boolean
  fontId: string | null
}

export interface CatalogListing {
  items: CatalogItem[]
  issues: string[]
}

/** 浏览器预览用的假目录，形状与真后端一致 */
const mockCatalog: CatalogItem[] = [
  {
    id: 'inter',
    family: 'Inter',
    nameZh: 'Inter',
    aliases: ['inter'],
    category: 'sans',
    coverage: 'latin',
    license: 'OFL-1.1',
    licenseUrl: '',
    redistributable: true,
    homepage: 'https://rsms.me/inter/',
    note: '',
    size: 876576,
    downloaded: false,
    installed: false,
    fontId: null,
  },
  {
    id: 'lxgw-wenkai',
    family: 'LXGW WenKai',
    nameZh: '霞鹜文楷',
    aliases: ['霞鹜文楷', '文楷'],
    category: 'kai',
    coverage: '常用',
    license: 'OFL-1.1',
    licenseUrl: '',
    redistributable: true,
    homepage: 'https://github.com/lxgw/LxgwWenKai',
    note: '',
    size: 25928940,
    downloaded: false,
    installed: false,
    fontId: null,
  },
  {
    id: 'alibaba-puhuiti',
    family: 'Alibaba PuHuiTi',
    nameZh: '阿里巴巴普惠体',
    aliases: ['阿里巴巴普惠体', '普惠体'],
    category: 'sans',
    coverage: 'GB18030',
    license: '阿里巴巴字体许可',
    licenseUrl: '',
    redistributable: false,
    homepage: 'https://www.alibabafonts.com/',
    note: '许可禁止第三方转载字体文件，请从官网获取',
    size: 0,
    downloaded: false,
    installed: false,
    fontId: null,
  },
]

async function listCatalog(): Promise<CatalogListing> {
  if (isTauriRuntime) {
    return invokeTauri<CatalogListing>('catalog_list')
  }
  await delay(MOCK_LATENCY.quick)
  return { items: mockCatalog.map((item) => ({ ...item })), issues: [] }
}

async function fetchCatalogFont(id: string): Promise<void> {
  if (isTauriRuntime) {
    await invokeTauri<void>('catalog_fetch', { id })
    return
  }
  await delay(MOCK_LATENCY.install)
  const item = mockCatalog.find((entry) => entry.id === id)
  if (item) item.downloaded = true
}

async function removeCatalogFont(id: string): Promise<void> {
  if (isTauriRuntime) {
    await invokeTauri<void>('catalog_remove', { id })
    return
  }
  await delay(MOCK_LATENCY.quick)
  const item = mockCatalog.find((entry) => entry.id === id)
  if (item) {
    item.downloaded = false
    item.installed = false
  }
}

export interface ImportSummary {
  imported: string[]
  skipped: string[]
  failed: string[]
}

async function importFontFiles(paths: string[]): Promise<ImportSummary> {
  if (isTauriRuntime) {
    return invokeTauri<ImportSummary>('import_font_files', { paths })
  }
  await delay(MOCK_LATENCY.install)
  // 浏览器预览没有真实文件系统，按"第一个成功"造假即可
  return { imported: ['示例字体'], skipped: [], failed: [] }
}

/* ───────────── 字体识别 ───────────── */

async function recognizeFonts(
  image: string,
  text: string,
  limit: number,
): Promise<RecognizeReport> {
  if (isTauriRuntime) {
    return invokeTauri<RecognizeReport>('recognize_fonts', { image, text, limit })
  }
  await delay(MOCK_LATENCY.install)
  return { candidates: [], considered: 0, skipped: 0, unsupported: 0, failed: 0, elapsedMs: 0 }
}

/* ───────────── 热键 + 剪贴板截图 ───────────── */

async function getAppStatus(): Promise<AppStatus> {
  if (isTauriRuntime) {
    return invokeTauri<AppStatus>('app_status')
  }
  await delay(MOCK_LATENCY.quick)
  return { hotkey: '', hotkeyReady: false }
}

/** 用热键抓到的那张图识别。像素留在 Rust 侧，这里只发文字。 */
async function recognizeFontsFromClipboard(
  text: string,
  limit: number,
): Promise<RecognizeReport> {
  if (isTauriRuntime) {
    return invokeTauri<RecognizeReport>('recognize_fonts_from_clipboard', { text, limit })
  }
  await delay(MOCK_LATENCY.install)
  return { candidates: [], considered: 0, skipped: 0, unsupported: 0, failed: 0, elapsedMs: 0 }
}

/**
 * 订阅"热键抓到了图"。返回取消订阅的函数。
 *
 * 浏览器里没有全局热键，直接返回空操作 —— 组件里的 effect 就不用再判一遍
 * 运行环境，也就不会因为条件分支写错而在 Tauri 里漏掉订阅。
 */
function onClipboardCapture(handler: (capture: ClipboardCapture) => void): () => void {
  if (!isTauriRuntime) {
    return () => {}
  }

  let unlisten: (() => void) | null = null
  let cancelled = false

  // listen 是异步的。组件若在注册完成前就卸载了，这里必须能收尾，
  // 否则每次打开/关闭面板都会漏一个监听器。
  void import('@tauri-apps/api/event').then(({ listen }) =>
    listen<ClipboardCapture>('recognize-capture', (event) => {
      handler(event.payload)
    }).then((off) => {
      if (cancelled) off()
      else unlisten = off
    }),
  )

  return () => {
    cancelled = true
    unlisten?.()
  }
}

/* ───────────── 启动对账 ───────────── */

async function reconcileFonts(): Promise<ReconcileReport> {
  if (isTauriRuntime) {
    return invokeTauri<ReconcileReport>('reconcile_fonts')
  }
  return { missing: 0, drifted: 0, repaired: 0 }
}

export const api = {
  listFonts,
  setEnabled,
  setFavorite,
  scan,
  revealInFolder,
  getCustomDirs,
  addCustomDir,
  removeCustomDir,
  listCollections,
  createCollection,
  deleteCollection,
  setCollectionFonts,
  recognizeFonts,
  recognizeFontsFromClipboard,
  getAppStatus,
  onClipboardCapture,
  reconcileFonts,
  getUiState,
  saveUiState,
  listCatalog,
  fetchCatalogFont,
  removeCatalogFont,
  importFontFiles,
}
