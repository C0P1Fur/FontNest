import { describe, expect, it } from 'vitest'
import type { Collection, Font, FontQuery } from '../types/font'
import { applyQuery, countLibrary, fontStack, inContainer, sameContainer } from './filter'
import { mockFonts } from '../data/mockFonts'

/**
 * applyQuery 是每次敲键都会跑的纯函数，也是唯一"错了用户立刻能感觉到"的逻辑。
 * 这里只测行为契约，不测实现细节。
 */

function query(overrides: Partial<FontQuery> = {}) {
  return {
    query: '',
    container: { kind: 'view', scope: 'all' } as const,
    collections: [] as Collection[],
    categories: [] as Font['category'][],
    sort: 'name' as const,
    ...overrides,
  }
}

function collection(id: string, fontIds: string[]): Collection {
  return { id, name: id, fontIds, createdAt: 0 }
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

  it('视图容器只返回符合条件的记录', () => {
    const enabled = applyQuery(mockFonts, query({ container: { kind: 'view', scope: 'enabled' } }))
    expect(enabled.every((font) => font.enabled)).toBe(true)

    const disabled = applyQuery(mockFonts, query({ container: { kind: 'view', scope: 'disabled' } }))
    expect(disabled.every((font) => !font.enabled)).toBe(true)
    expect(disabled.length + enabled.length).toBe(mockFonts.length)

    const variable = applyQuery(mockFonts, query({ container: { kind: 'view', scope: 'variable' } }))
    expect(variable.every((font) => font.variable)).toBe(true)

    const favorite = applyQuery(mockFonts, query({ container: { kind: 'view', scope: 'favorite' } }))
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

describe('容器：内置视图与分类夹同级互斥', () => {
  const a = mockFonts[0]
  const b = mockFonts[1]
  const bag = [collection('c1', [a.id])]

  it('分类夹容器只返回其成员', () => {
    const result = applyQuery(mockFonts, query({ container: { kind: 'collection', id: 'c1' }, collections: bag }))
    expect(result.map((font) => font.id)).toEqual([a.id])
  })

  it('容器互斥：切到分类夹后，视图条件不再生效', () => {
    // 同一次查询里只认 container 一个条件。
    // 以前 scope 和分类夹会同时生效，选中"收藏"再点分类夹得到的是交集。
    const asCollection = applyQuery(
      mockFonts,
      query({ container: { kind: 'collection', id: 'c1' }, collections: bag }),
    )
    expect(asCollection).toHaveLength(1)

    // 换回视图，分类夹的成员关系完全不参与
    const asView = applyQuery(mockFonts, query({ container: { kind: 'view', scope: 'all' }, collections: bag }))
    expect(asView).toHaveLength(mockFonts.length)
  })

  it('容器之上的关键词与类型筛选照常生效', () => {
    const both = [collection('c2', [a.id, b.id])]
    const result = applyQuery(
      mockFonts,
      query({ container: { kind: 'collection', id: 'c2' }, collections: both, query: a.family.slice(0, 3) }),
    )
    // 至少不能返回集合之外的字体
    expect(result.every((font) => font.id === a.id || font.id === b.id)).toBe(true)
  })

  it('分类夹被删掉后不会把整个库藏空', () => {
    expect(inContainer(a, { kind: 'collection', id: 'gone' }, [])).toBe(true)
  })

  it('inContainer 对视图复用 scope 语义', () => {
    expect(inContainer({ ...a, favorite: true }, { kind: 'view', scope: 'favorite' }, [])).toBe(true)
    expect(inContainer({ ...a, favorite: false }, { kind: 'view', scope: 'favorite' }, [])).toBe(false)
  })
})
describe('sameContainer', () => {
  it('同类型同目标才算同一个容器', () => {
    expect(sameContainer({ kind: 'view', scope: 'all' }, { kind: 'view', scope: 'all' })).toBe(true)
    expect(sameContainer({ kind: 'view', scope: 'all' }, { kind: 'view', scope: 'favorite' })).toBe(false)
    expect(sameContainer({ kind: 'collection', id: 'c1' }, { kind: 'collection', id: 'c1' })).toBe(true)
    expect(sameContainer({ kind: 'collection', id: 'c1' }, { kind: 'collection', id: 'c2' })).toBe(false)
  })

  it('视图和分类夹永不相等（哪怕 id 撞上 scope 名）', () => {
    expect(sameContainer({ kind: 'view', scope: 'all' }, { kind: 'collection', id: 'all' })).toBe(false)
    expect(sameContainer({ kind: 'collection', id: 'all' }, { kind: 'view', scope: 'all' })).toBe(false)
  })
})