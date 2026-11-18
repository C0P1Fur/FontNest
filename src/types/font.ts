/**
 * 领域模型 —— 与 crates/fontnest-core 的 SQLite schema 一一对应。
 * 改动这里必须同步 docs/ARCHITECTURE.md 与 Rust 侧的 serde 结构。
 */

export type FontCategory =
  | 'sans'
  | 'serif'
  | 'mono'
  | 'script'
  | 'display'
  | 'cjk'

export type FontFormat = 'ttf' | 'otf' | 'ttc' | 'otc' | 'woff' | 'woff2'

/** 字体文件来源，决定它是否可被本工具卸载 */
export type FontSource = 'system' | 'user' | 'custom'

export type LibraryScope =
  | 'all'
  | 'enabled'
  | 'disabled'
  | 'variable'
  | 'favorite'

/**
 * 多选通道。安装和卸载分成两条独立的通道，而不是进一个模式再二选一：
 *
 * - 用户的意图在点按钮那一刻就已经确定了
 * - 每个通道可以只放行"能操作"的字体（装的时候灰掉已装的，卸的时候灰掉没装的），
 *   不需要让用户自己判断哪些能点
 */
export type SelectionMode = 'install' | 'uninstall' | 'compare'

export type SortKey = 'name' | 'styles' | 'year' | 'state'

export type ViewMode = 'grid' | 'list'

export type ScanPhase = 'idle' | 'scanning' | 'done'

export interface VariableAxis {
  /** OpenType 轴标记：wght / wdth / opsz / slnt / ital … */
  tag: string
  min: number
  max: number
  defaultValue: number
}

export interface Font {
  id: string
  family: string
  subfamily: string
  fullName: string
  /** name 表 ID 6，全局唯一性最好的一把钥匙 */
  psName: string
  category: FontCategory
  format: FontFormat
  weight: number
  italic: boolean
  variable: boolean
  axes: VariableAxis[]
  /** 同族样式数量（用于"18 styles"这类元信息） */
  instanceCount: number
  glyphCount: number
  /** ISO 15924 脚本代码，如 Latn / Hani / Kana */
  scripts: string[]
  version: string
  designer: string
  foundry: string
  year: number
  license: string
  source: FontSource
  enabled: boolean
  favorite: boolean
  filePath: string
  sizeBytes: number
  /** .ttc / .otc 集合字体内的序号，非集合字体为 0 */
  collectionIndex: number
}

/** 查询条件。v0.1 在客户端过滤；索引落地后整体下推给 Rust。 */
export interface FontQuery {
  query: string
  scope: LibraryScope
  categories: FontCategory[]
  sort: SortKey
}

export interface ScanStatus {
  phase: ScanPhase
  scanned: number
  total: number
  finishedAt: number | null
}

/** 用户自定义的字体分类：只是把字体圈在一起，用于筛选，不改变任何字体状态 */
export interface Collection {
  id: string
  name: string
  fontIds: string[]
  createdAt: number
}

/** 启动对账的结果 */
export interface ReconcileReport {
  missing: number
  drifted: number
  repaired: number
}

/** 识别候选：score = IoU 扣除宽高比惩罚 */
export interface MatchCandidate {
  fontId: string
  score: number
  iou: number
  aspectDelta: number
}

export interface RecognizeReport {
  candidates: MatchCandidate[]
  considered: number
  /** 因不含所需字形被跳过 */
  skipped: number
  /** 读不懂 cmap（不支持的子表格式/表目录损坏）—— 与 skipped 分开，避免掩盖解析失败 */
  unsupported: number
  failed: number
  elapsedMs: number
}

/**
 * 热键抓到的剪贴板截图。
 *
 * 只带元信息和一张缩略图：像素本体留在 Rust 侧，识别时直接取用。
 * 让几百 KB 的位图往返 IPC 既慢又要多编两遍 base64。
 */
export interface ClipboardCapture {
  hasImage: boolean
  width: number
  height: number
  /** data URL；生成失败时是空串，此时只显示尺寸 */
  preview: string
}

/** 启动信息：快捷键是否真的注册上了 */
export interface AppStatus {
  hotkey: string
  hotkeyReady: boolean
}
