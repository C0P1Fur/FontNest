import { describe, expect, it } from 'vitest'
import type { Font, VariableAxis } from '../types/font'
import { faceRule } from './fontFaces'

/**
 * `@font-face` 的描述符写错不会报错，只会静默失效 ——
 * 表现是"字体变成兜底字体"或"某个轴拖了没反应"，
 * 在界面上很难和其它问题区分。所以这里逐条钉住生成结果。
 */

function makeFont(overrides: Partial<Font> = {}): Font {
  return {
    id: 'abc123',
    family: 'Test Family',
    subfamily: 'Regular',
    fullName: 'Test Family Regular',
    postscriptName: 'TestFamily-Regular',
    category: 'sans',
    format: 'ttf',
    weight: 400,
    italic: false,
    variable: false,
    axes: [],
    glyphCount: 100,
    version: '1.0',
    designer: '',
    foundry: '',
    year: 0,
    license: '',
    filePath: 'C:/fonts/test.ttf',
    favorite: false,
    enabled: false,
    instanceCount: 1,
    source: 'system',
    ...overrides,
  } as Font
}

function axis(tag: string, min: number, max: number, defaultValue: number): VariableAxis {
  return { tag, min, max, defaultValue }
}

describe('faceRule', () => {
  it('静态字体声明单一字重，不带 font-stretch', () => {
    const rule = faceRule(makeFont(), 'http://font.local/abc123')
    expect(rule).toContain('font-weight:400;')
    expect(rule).not.toContain('font-stretch')
  })

  it('可变字体按 wght 轴的区间声明，而不是单一值', () => {
    const rule = faceRule(
      makeFont({ variable: true, axes: [axis('wght', 100, 900, 400)] }),
      'http://font.local/abc123',
    )
    expect(rule).toContain('font-weight:100 900;')
  })

  it('有 wdth 轴时写出宽度区间', () => {
    const rule = faceRule(
      makeFont({
        variable: true,
        axes: [axis('wght', 300, 700, 400), axis('wdth', 75, 100, 100)],
      }),
      'http://font.local/abc123',
    )
    expect(rule).toContain('font-weight:300 700;')
    expect(rule).toContain('font-stretch:75% 100%;')
  })

  it('轴区间退化（min === max）时退回单一字重，避免声明成空区间', () => {
    const rule = faceRule(
      makeFont({ variable: true, weight: 400, axes: [axis('wght', 400, 400, 400)] }),
      'http://font.local/abc123',
    )
    expect(rule).toContain('font-weight:400;')
    expect(rule).not.toContain('font-weight:400 400')
  })

  it('没有 wdth 轴时不写 font-stretch（否则会被当成静态 face）', () => {
    const rule = faceRule(
      makeFont({ variable: true, axes: [axis('opsz', 14, 32, 14)] }),
      'http://font.local/abc123',
    )
    expect(rule).not.toContain('font-stretch')
  })

  it('小数轴值不会带出多余的零', () => {
    const rule = faceRule(
      makeFont({ variable: true, axes: [axis('wght', 100.5, 900.25, 400)] }),
      'http://font.local/abc123',
    )
    expect(rule).toContain('font-weight:100.5 900.25;')
  })

  it('TTC 用 collection 格式提示', () => {
    const rule = faceRule(makeFont({ format: 'ttc' }), 'http://font.local/abc123')
    expect(rule).toContain("format('collection')")
  })

  it('斜体字体声明 font-style: italic', () => {
    const rule = faceRule(makeFont({ italic: true }), 'http://font.local/abc123')
    expect(rule).toContain('font-style:italic;')
  })

  it('家族名带 fn- 前缀，避免和系统字体重名', () => {
    const rule = faceRule(makeFont({ id: 'deadbeef' }), 'http://font.local/deadbeef')
    expect(rule).toContain("font-family:'fn-deadbeef';")
  })
})
