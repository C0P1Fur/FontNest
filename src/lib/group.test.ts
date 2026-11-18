import { describe, expect, it } from 'vitest'
import type { Font } from '../types/font'
import { flattenGroups, groupFonts, pickPrimary } from './group'

/** 只填分组用得到的字段，其余给安全默认值 */
function face(partial: Partial<Font> & { family: string }): Font {
  return {
    id: partial.id ?? `${partial.family}-${partial.subfamily ?? 'Regular'}-${partial.weight ?? 400}`,
    family: partial.family,
    subfamily: partial.subfamily ?? 'Regular',
    fullName: partial.fullName ?? '',
    psName: partial.psName ?? '',
    category: 'sans',
    format: 'ttf',
    weight: partial.weight ?? 400,
    italic: partial.italic ?? false,
    variable: partial.variable ?? false,
    axes: [],
    instanceCount: 1,
    glyphCount: 0,
    scripts: [],
    version: '',
    designer: '',
    foundry: '',
    year: 0,
    license: '',
    source: partial.source ?? 'system',
    enabled: partial.enabled ?? true,
    favorite: false,
    filePath: partial.filePath ?? '',
    sizeBytes: 0,
    collectionIndex: 0,
  }
}

describe('groupFonts', () => {
  it('把同一族的多个字重合并成一组', () => {
    const fonts = [
      face({ family: 'Arial', subfamily: 'Regular', weight: 400 }),
      face({ family: 'Arial', subfamily: 'Bold', weight: 700 }),
      face({ family: 'Arial', subfamily: 'Italic', weight: 400, italic: true }),
    ]
    const groups = groupFonts(fonts)

    expect(groups).toHaveLength(1)
    expect(groups[0].faces).toHaveLength(3)
    expect(groups[0].primary.subfamily).toBe('Regular')
  })

  it('族名大小写不同也归为同一族', () => {
    const groups = groupFonts([
      face({ family: 'Arial', id: 'a' }),
      face({ family: 'ARIAL', id: 'b', subfamily: 'Bold', weight: 700 }),
    ])
    expect(groups).toHaveLength(1)
  })

  it('不同族保持各自独立', () => {
    const groups = groupFonts([
      face({ family: 'Arial' }),
      face({ family: 'Georgia' }),
    ])
    expect(groups).toHaveLength(2)
    expect(groups.map((group) => group.family)).toEqual(['Arial', 'Georgia'])
  })

  it('组顺序跟随输入，不重排', () => {
    const groups = groupFonts([
      face({ family: 'Zapf' }),
      face({ family: 'Arial' }),
    ])
    expect(groups.map((group) => group.family)).toEqual(['Zapf', 'Arial'])
  })

  it('组内把主面排到第一位', () => {
    const groups = groupFonts([
      face({ family: 'Arial', subfamily: 'Bold', weight: 700 }),
      face({ family: 'Arial', subfamily: 'Regular', weight: 400 }),
    ])
    expect(groups[0].faces[0].weight).toBe(400)
    expect(groups[0].primary.weight).toBe(400)
  })
})

describe('pickPrimary', () => {
  it('优先非斜体的 Regular', () => {
    const fonts = [
      face({ family: 'X', subfamily: 'Italic', weight: 400, italic: true }),
      face({ family: 'X', subfamily: 'Regular', weight: 400 }),
    ]
    expect(pickPrimary(fonts).italic).toBe(false)
  })

  it('全是斜体时也要选一个，不能返回 undefined', () => {
    const fonts = [
      face({ family: 'X', subfamily: 'Italic', weight: 700, italic: true }),
      face({ family: 'X', subfamily: 'Italic', weight: 400, italic: true }),
    ]
    const primary = pickPrimary(fonts)
    expect(primary.weight).toBe(400)
  })

  it('没有 400 时选最接近的', () => {
    const fonts = [
      face({ family: 'X', weight: 300 }),
      face({ family: 'X', weight: 600 }),
    ]
    expect(pickPrimary(fonts).weight).toBe(300)
  })
})

describe('flattenGroups', () => {
  const groups = groupFonts([
    face({ family: 'Arial', subfamily: 'Regular', weight: 400 }),
    face({ family: 'Arial', subfamily: 'Bold', weight: 700 }),
    face({ family: 'Georgia' }),
  ])

  it('全部收起时每族只出一条', () => {
    const flat = flattenGroups(groups, [])
    expect(flat.map((font) => font.family)).toEqual(['Arial', 'Georgia'])
    expect(flat[0].subfamily).toBe('Regular')
  })

  it('展开某族后该族所有字重都出现', () => {
    const flat = flattenGroups(groups, ['arial'])
    expect(flat.map((font) => font.family)).toEqual(['Arial', 'Arial', 'Georgia'])
  })

  it('展开再收起能完整还原', () => {
    const expanded = flattenGroups(groups, ['arial'])
    const collapsed = flattenGroups(groups, [])
    expect(expanded).toHaveLength(3)
    expect(collapsed).toHaveLength(2)
  })

  it('展开不存在的族不会出错', () => {
    expect(flattenGroups(groups, ['没有这个族'])).toHaveLength(2)
  })
})
