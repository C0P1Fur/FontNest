import type { Font } from '../types/font'

/**
 * 对比的上下限。
 *
 * 注意这只是**对比按钮能不能点的判据**，不是勾选数量的约束：
 * 想批量装 50 个字体是合理需求，勾选本身不设上限。
 */
export const MIN_COMPARE = 2
export const MAX_COMPARE = 6

export interface SelectionSummary {
  /** 选中的族总数 */
  families: number
  /** 其中归 FontNest 管理的族数（系统字体族不算） */
  managed: number
  /** 真正会被安装的字体数：custom 且尚未安装 */
  installTargets: number
  /** 真正会被卸载的字体数：custom 且已经安装 */
  uninstallTargets: number
  canInstall: boolean
  canUninstall: boolean
  canCompare: boolean
  /** 按钮不可用或需要解释时给人看的一句话 */
  reason: string | null
}

/**
 * 根据当前勾选算出三个动作能否执行。
 *
 * 意图已经在进多选时声明过了，所以这里算的是"这个动作有多少东西可做"：
 *
 * - 安装：选中里还有多少个未安装的自定义字体
 * - 卸载：选中里还有多少个已安装的自定义字体
 * - 对比：2–6 个族
 *
 * 系统字体族对安装/卸载是**中性**的：它们既不是"本工具装的"，也不该被本工具
 * 装卸。选中里只有系统字体时两个动作都没有目标，但对比照常可用。
 */
export function summarizeSelection(fonts: Font[], families: string[]): SelectionSummary {
  const byFamily = new Map<string, Font[]>()
  for (const font of fonts) {
    const key = font.family.toLowerCase()
    const bucket = byFamily.get(key)
    if (bucket) bucket.push(font)
    else byFamily.set(key, [font])
  }

  let managed = 0
  let installTargets = 0
  let uninstallTargets = 0

  for (const key of families) {
    const faces = (byFamily.get(key) ?? []).filter((font) => font.source === 'custom')
    if (faces.length === 0) continue

    managed += 1
    for (const face of faces) {
      if (face.enabled) uninstallTargets += 1
      else installTargets += 1
    }
  }

  const canInstall = installTargets > 0
  const canUninstall = uninstallTargets > 0
  const canCompare = families.length >= MIN_COMPARE && families.length <= MAX_COMPARE

  let reason: string | null = null
  if (families.length === 0) {
    reason = null
  } else if (managed === 0) {
    reason = '系统字体由操作系统管理'
  } else if (families.length > MAX_COMPARE) {
    reason = `对比最多 ${MAX_COMPARE} 个`
  }

  return {
    families: families.length,
    managed,
    installTargets,
    uninstallTargets,
    canInstall,
    canUninstall,
    canCompare,
    reason,
  }
}
