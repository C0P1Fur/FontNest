import type { VariableAxis } from '../types/font'

/**
 * 可变字体轴的取值辅助。
 *
 * 为什么不直接用默认的 `step=1`：对 `wght 100–900` 这种宽轴，
 * 1 的步长正好（用户就想取整数）；但对 `ital` / `CASL` / `MONO`
 * 这类**归一化到 0–1 的轴**，1 的步长只剩 0 和 1 两档，
 * 滑块看着是能拖的，实际上只有两个位置。
 */

/** f32 经过 JSON 序列化会带出 0.30000001192092896 这种噪声 */
export function roundAxisValue(value: number): number {
  return Math.round(value * 1000) / 1000
}

/**
 * 按量程决定滑块步长。
 *
 * 判据是量程而不是轴标签：自定义轴（厂商私有的四个大写字母）名字无法穷举，
 * 但设计约定是固定的 —— 归一化轴（ital / CASL / SOFT / MONO / WONK）
 * 一律落在 0–1，其余参与排版的轴量程都有几十到几百。
 *
 * 阈值取 5：`ital 0–1`、`CASL 0–1` 走细步长；连 `slnt -10–0` 这种
 * 最窄的常规轴（量程 10）也还在整数步长一侧。
 */
export function axisStep(axis: VariableAxis): number {
  const span = axis.max - axis.min
  if (!(span > 0)) return 1
  return span < 5 ? span / 100 : 1
}
