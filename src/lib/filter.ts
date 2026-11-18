import type {
  BrowseContainer,
  Collection,
  Font,
  FontCategory,
  FontQuery,
  LibraryScope,
} from '../types/font'

export const CATEGORY_LABEL: Record<FontCategory, string> = {
  sans: '无衬线',
  serif: '衬线',
  mono: '等宽',
  script: '手写体',
  display: '展示体',
  cjk: '中日韩',
}

export const CATEGORY_ORDER: FontCategory[] = [
  'sans',
  'serif',
  'mono',
  'script',
  'display',
  'cjk',
]

/** 每个分类的兜底栈：字体缺失时至少维持"这是一款衬线/等宽"的观感 */
export const CATEGORY_FALLBACK: Record<FontCategory, string> = {
  sans: "'Segoe UI', system-ui, sans-serif",
  serif: "Georgia, 'Times New Roman', serif",
  mono: "Consolas, 'Courier New', monospace",
  script: "'Segoe Script', cursive",
  display: "Impact, 'Arial Black', sans-serif",
  cjk: "'Microsoft YaHei', 'PingFang SC', sans-serif",
}

export function fontStack(font: Font): string {
  return `'${font.family}', ${CATEGORY_FALLBACK[font.category]}`
}

/** 子序列匹配：`intr` 能命中 `Inter`，用来兜住手快的输入 */
function isSubsequence(needle: string, haystack: string): boolean {
  let i = 0
  for (let j = 0; j < haystack.length && i < needle.length; j += 1) {
    if (haystack[j] === needle[i]) i += 1
  }
  return i === needle.length
}

function matchesScope(font: Font, scope: LibraryScope): boolean {
  switch (scope) {
    case 'enabled':
      return font.enabled
    case 'disabled':
      return !font.enabled
    case 'variable':
      return font.variable
    case 'favorite':
      return font.favorite
    default:
      return true
  }
}

/** 两个容器是否指向同一个浏览目标。用于判断"切换"是否真的发生了 */
export function sameContainer(a: BrowseContainer, b: BrowseContainer): boolean {
  if (a.kind === 'view') return b.kind === 'view' && a.scope === b.scope
  return b.kind === 'collection' && a.id === b.id
}

/**
 * 容器判定：内置视图与分类夹走同一条路径。
 *
 * 这是这次重构的核心 —— 以前视图和分类夹是两层过滤同时生效，
 * 选中"收藏"再点某个分类夹，得到的是交集，左栏两行同时高亮。
 * 现在只有一个容器，两者天然互斥。
 */
export function inContainer(
  font: Font,
  container: BrowseContainer,
  collections: Collection[],
): boolean {
  if (container.kind === 'view') return matchesScope(font, container.scope)

  const collection = collections.find((item) => item.id === container.id)
  // 容器不存在（刚被删）时不能把所有字体都藏起来 —— 当作"全部"处理
  if (!collection) return true
  return collection.fontIds.includes(font.id)
}

export function applyQuery(fonts: Font[], query: FontQuery): Font[] {
  const needle = query.query.trim().toLowerCase()
  const categories = query.categories

  const filtered = fonts.filter((font) => {
    if (!inContainer(font, query.container, query.collections)) return false
    if (categories.length > 0 && !categories.includes(font.category)) return false
    if (!needle) return true

    const haystack = [
      font.family,
      font.fullName,
      font.psName,
      font.foundry,
      font.designer,
      CATEGORY_LABEL[font.category],
    ]
      .join(' ')
      .toLowerCase()

    if (haystack.includes(needle)) return true
    return isSubsequence(needle, font.family.toLowerCase())
  })

  return filtered.sort((a, b) => {
    switch (query.sort) {
      case 'styles':
        return b.instanceCount - a.instanceCount || a.family.localeCompare(b.family)
      case 'year':
        return a.year - b.year || a.family.localeCompare(b.family)
      case 'state':
        return Number(b.enabled) - Number(a.enabled) || a.family.localeCompare(b.family)
      default:
        return a.family.localeCompare(b.family, 'en')
    }
  })
}

export interface LibraryCounts {
  all: number
  enabled: number
  disabled: number
  variable: number
  favorite: number
  categories: Record<FontCategory, number>
}

export function countLibrary(fonts: Font[]): LibraryCounts {
  const categories: Record<FontCategory, number> = {
    sans: 0,
    serif: 0,
    mono: 0,
    script: 0,
    display: 0,
    cjk: 0,
  }

  let enabled = 0
  let variable = 0
  let favorite = 0

  for (const font of fonts) {
    if (font.enabled) enabled += 1
    if (font.variable) variable += 1
    if (font.favorite) favorite += 1
    categories[font.category] += 1
  }

  return {
    all: fonts.length,
    enabled,
    disabled: fonts.length - enabled,
    variable,
    favorite,
    categories,
  }
}
