import type { Font } from '../types/font'

/**
 * 同族字重合并。
 *
 * 一个 .ttf 文件可能带多个 face，用户目录里也常有 Arial / Arial Bold / Arial Italic
 * 三个独立文件 —— 扫描出来就是三条记录、三张卡。用户想看到的是「一款字体」，
 * 而不是「一款字体出现了四次」。
 *
 * 合并键用 `family`：这是 OpenType name 表里的族名，同一族的所有字重必然相同。
 */

export interface FontGroup {
  /** 合并键，use 小写族名，避免 Arial / ARIAL 被当成两族 */
  key: string
  family: string
  /** 组内全部 face，已按「主面优先」排序 */
  faces: Font[]
  /** 收起时代表整组显示的那一个 */
  primary: Font
}

/**
 * 挑主面：优先非斜体的 Regular（400），其次最接近 400 的非斜体，最后才退到斜体。
 *
 * 为什么不是直接用第一条：扫描顺序由文件路径决定，
 * 很可能第一条是 Arial Bold 或 Arial Italic —— 用粗体或斜体当封面会误导。
 */
export function pickPrimary(faces: Font[]): Font {
  const score = (font: Font): number => {
    let value = Math.abs(font.weight - 400)
    if (font.italic) value += 1000
    return value
  }
  let best = faces[0]
  for (const font of faces) {
    if (score(font) < score(best)) best = font
    else if (score(font) === score(best) && font.family < best.family) best = font
  }
  return best
}

/** 组内排序：主面第一，其余按字重升序、非斜体在前。 */
function orderFaces(faces: Font[]): Font[] {
  const primary = pickPrimary(faces)
  const rest = faces
    .filter((font) => font !== primary)
    .sort((a, b) => {
      if (a.weight !== b.weight) return a.weight - b.weight
      if (a.italic !== b.italic) return a.italic ? 1 : -1
      return a.subfamily.localeCompare(b.subfamily)
    })
  return [primary, ...rest]
}

/**
 * 按族名分组，**保持输入顺序**：调用方传进来的已经是排好序的列表，
 * 这里再排一次会打乱用户选的「按名称 / 按字重数」排序。
 */
export function groupFonts(fonts: Font[]): FontGroup[] {
  const index = new Map<string, Font[]>()
  const order: string[] = []

  for (const font of fonts) {
    const key = font.family.toLowerCase()
    const bucket = index.get(key)
    if (bucket) {
      bucket.push(font)
    } else {
      index.set(key, [font])
      order.push(key)
    }
  }

  return order.map((key) => {
    const faces = orderFaces(index.get(key) ?? [])
    return {
      key,
      family: faces[0].family,
      faces,
      primary: faces[0],
    }
  })
}

/**
 * 把分组摊平成网格真正要渲染的列表。
 *
 * 展开放行、收起只留主面 —— 这样网格永远是扁平的一层 `<li>`，
 * 不需要在卡片里再嵌一个列表去破坏 grid 布局。
 */
export function flattenGroups(groups: FontGroup[], expanded: readonly string[]): Font[] {
  const open = new Set(expanded)
  const result: Font[] = []
  for (const group of groups) {
    if (open.has(group.key)) result.push(...group.faces)
    else result.push(group.primary)
  }
  return result
}
