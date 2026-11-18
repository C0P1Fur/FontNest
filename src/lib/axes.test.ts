import { describe, expect, it } from 'vitest'
import type { VariableAxis } from '../types/font'
import { axisStep, roundAxisValue } from './axes'

function axis(tag: string, min: number, max: number, defaultValue = min): VariableAxis {
  return { tag, min, max, defaultValue }
}

describe('axisStep', () => {
  it('宽轴保持整数步长（用户要的就是 400 / 700 这种整数）', () => {
    expect(axisStep(axis('wght', 100, 900))).toBe(1)
    expect(axisStep(axis('wdth', 75, 100))).toBe(1)
    expect(axisStep(axis('opsz', 14, 32))).toBe(1)
    expect(axisStep(axis('opsz', 8, 144))).toBe(1)
    expect(axisStep(axis('GRAD', -200, 150))).toBe(1)
  })

  it('最窄的常规轴（slnt 量程 10）仍在整数一侧', () => {
    expect(axisStep(axis('slnt', -10, 0))).toBe(1)
  })

  it('0–1 归一化轴给细步长，否则只剩 0 和 1 两档', () => {
    expect(axisStep(axis('ital', 0, 1))).toBeCloseTo(0.01)
    expect(axisStep(axis('CASL', 0, 1))).toBeCloseTo(0.01)
    expect(axisStep(axis('MONO', 0, 1))).toBeCloseTo(0.01)
  })

  it('量程退化为 0 时不会返回 0（步长 0 会让滑块卡死）', () => {
    expect(axisStep(axis('wght', 400, 400))).toBe(1)
    expect(axisStep(axis('wght', 400, 399))).toBe(1)
  })
})

describe('roundAxisValue', () => {
  it('抹掉 f32 序列化噪声', () => {
    expect(roundAxisValue(0.30000001192092896)).toBe(0.3)
    expect(roundAxisValue(399.99999999999994)).toBe(400)
  })

  it('整数保持整数', () => {
    expect(roundAxisValue(400)).toBe(400)
  })

  it('保留 0.01 级别的精度（归一化轴的步长）', () => {
    expect(roundAxisValue(0.37)).toBe(0.37)
  })
})
