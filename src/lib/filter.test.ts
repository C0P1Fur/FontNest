import { describe, expect, it } from 'vitest'
import type { Font } from '../types/font'
import { applyQuery, countLibrary, fontStack } from './filter'
import { mockFonts } from '../data/mockFonts'

/**
 * applyQuery 是每次敲键都会跑的纯函数，也是唯一"错了用户立刻能感觉到"的逻辑。
 * 这里只测行为契约，不测实现细节。
 */

function query(overrides: Partial<Parameters<typeof applyQuery>[1]> = {}) {
  return {
    query: '',
    scope: 'all' as const,
    categories: [] as Font['category'][],
    sort: 'name' as const,
    ...overrides,
  }
}

describe('applyQuery', () => {
  it('空条件返回全量，且按名称排序', () => {
    const result = applyQuery(mockFonts, query())
    expect(result).toHaveLength(mockFonts.length)

    const names = result.map((font) => font.family)
    const sorted = [...names].sort((a, b) => a.localeCompare(b, 'en'))
    expect(names).toEqual(sorted)
  })

  it('子串匹配家族名', () => {
    const result = applyQuery(mockFonts, query({ query: 'georgia' }))
    expect(result.length).toBeGreaterThan(0)
    expect(result.every((font) => font.family.toLowerCase().includes('georgia'))).toBe(true)
  })

  it('子序列匹配（gorg → Georgia）', () => {
    const result = applyQuery(mockFonts, query({ query: 'gorg' }))
    expect(result.some((font) => font.family === 'Georgia')).toBe(true)
  })

  it('可以按厂商与设计师搜索', () => {
    const byFoundry = applyQuery(mockFonts, query({ query: 'monotype' }))
    expect(byFoundry.length).toBeGreaterThan(0)
    expect(byFoundry.every((font) => font.foundry.toLowerCase().includes('monotype'))).toBe(true)
  })

  it('scope 过滤只返回符合条件的记录', () => {
    const enabled = applyQuery(mockFonts, query({ scope: 'enabled' }))
    expect(enabled.every((font) => font.enabled)).toBe(true)

    const disabled = applyQuery(mockFonts, query({ scope: 'disabled' }))
    expect(disabled.every((font) => !font.enabled)).toBe(true)
    expect(disabled.length + enabled.length).toBe(mockFonts.length)

    const variable = applyQuery(mockFonts, query({ scope: 'variable' }))
    expect(variable.every((font) => font.variable)).toBe(true)

    const favorite = applyQuery(mockFonts, query({ scope: 'favorite' }))
    expect(favorite.every((font) => font.favorite)).toBe(true)
  })

  it('分类是多选并集', () => {
    const result = applyQuery(mockFonts, query({ categories: ['mono', 'script'] }))
    expect(result.length).toBeGreaterThan(0)
    expect(result.every((font) => font.category === 'mono' || font.category === 'script')).toBe(true)
  })

  it('条件叠加时是交集', () => {
    const result = applyQuery(mockFonts, query({ query: 'a', categories: ['serif'] }))
    expect(result.every((font) => font.category === 'serif')).toBe(true)
  })

  it('无匹配时返回空数组而不是抛错', () => {
    expect(applyQuery(mockFonts, query({ query: 'zzzzzz-not-a-font' }))).toEqual([])
  })

  it('排序不会破坏原始数据', () => {
    const before = mockFonts.map((font) => font.id)
    applyQuery(mockFonts, query({ sort: 'year' }))
    expect(mockFonts.map((font) => font.id)).toEqual(before)
  })

  it('按字重数排序是降序', () => {
    const result = applyQuery(mockFonts, query({ sort: 'styles' }))
    for (let i = 1; i < result.length; i += 1) {
      expect(result[i - 1].instanceCount).toBeGreaterThanOrEqual(result[i].instanceCount)
    }
  })
})

describe('countLibrary', () => {
  it('各项计数自洽', () => {
    const counts = countLibrary(mockFonts)
    expect(counts.all).toBe(mockFonts.length)
    expect(counts.enabled + counts.disabled).toBe(counts.all)

    const categorySum = Object.values(counts.categories).reduce((sum, value) => sum + value, 0)
    expect(categorySum).toBe(counts.all)
  })

  it('空库不炸', () => {
    const counts = countLibrary([])
    expect(counts.all).toBe(0)
    expect(counts.enabled).toBe(0)
  })
})

describe('fontStack', () => {
  it('字体名带引号并追加分类兜底', () => {
    const georgia = mockFonts.find((font) => font.family === 'Georgia')
    expect(georgia).toBeDefined()
    const stack = fontStack(georgia as Font)
    expect(stack.startsWith("'Georgia',")).toBe(true)
    expect(stack).toContain('serif')
  })
})
