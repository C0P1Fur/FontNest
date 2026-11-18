import { describe, expect, it } from 'vitest'
import type { Font } from '../types/font'
import { MAX_COMPARE, summarizeSelection } from './selection'

/**
 * 这些数字决定操作条上按钮的可用性，组合多，必须逐条钉住。
 */

function face(family: string, enabled: boolean, source: Font['source'] = 'custom'): Font {
  return {
    id: `${family}-${enabled}-${source}`,
    family,
    source,
    enabled,
  } as Font
}

describe('summarizeSelection', () => {
  it('全为未安装时：安装有目标，卸载没有', () => {
    const fonts = [face('A', false), face('B', false)]
    const s = summarizeSelection(fonts, ['a', 'b'])
    expect(s.canInstall).toBe(true)
    expect(s.installTargets).toBe(2)
    expect(s.canUninstall).toBe(false)
    expect(s.uninstallTargets).toBe(0)
  })

  it('全为已安装时：卸载有目标，安装没有', () => {
    const fonts = [face('A', true), face('B', true)]
    const s = summarizeSelection(fonts, ['a', 'b'])
    expect(s.canInstall).toBe(false)
    expect(s.canUninstall).toBe(true)
    expect(s.uninstallTargets).toBe(2)
  })

  it('同一族内部半装：两个动作各自都有目标', () => {
    // 安装补上缺的、卸载撤掉装的，都是有效操作
    const fonts = [face('A', true), face('A', false)]
    const s = summarizeSelection(fonts, ['a'])
    expect(s.installTargets).toBe(1)
    expect(s.uninstallTargets).toBe(1)
    expect(s.canInstall).toBe(true)
    expect(s.canUninstall).toBe(true)
  })

  it('系统字体族不参与装卸：全是系统字体时两个都没目标', () => {
    const fonts = [face('Segoe UI', true, 'system'), face('Georgia', true, 'system')]
    const s = summarizeSelection(fonts, ['segoe ui', 'georgia'])
    expect(s.managed).toBe(0)
    expect(s.canInstall).toBe(false)
    expect(s.canUninstall).toBe(false)
    expect(s.reason).toBe('系统字体由操作系统管理')
  })

  it('系统字体与自定义字体混选时，只算自定义那批', () => {
    const fonts = [face('Segoe UI', true, 'system'), face('A', false)]
    const s = summarizeSelection(fonts, ['segoe ui', 'a'])
    expect(s.managed).toBe(1)
    expect(s.installTargets).toBe(1)
    expect(s.uninstallTargets).toBe(0)
  })

  it('对比在 2–6 之间可用', () => {
    const fonts = [face('A', false), face('B', false)]
    expect(summarizeSelection(fonts, ['a']).canCompare).toBe(false)
    expect(summarizeSelection(fonts, ['a', 'b']).canCompare).toBe(true)

    const six = ['a', 'b', 'c', 'd', 'e', 'f']
    expect(summarizeSelection(fonts, six).canCompare).toBe(true)
    expect(summarizeSelection(fonts, [...six, 'g']).canCompare).toBe(false)
    expect(MAX_COMPARE).toBe(6)
  })

  it('超过 6 个时只是对比不可用，安装照样可用', () => {
    // 6 是"对比"这一件事的判据，不是勾选或批量的上限
    const keys = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']
    const fonts = keys.map((key) => face(key, false))
    const s = summarizeSelection(fonts, keys)

    expect(s.canCompare).toBe(false)
    expect(s.canInstall).toBe(true)
    expect(s.installTargets).toBe(8)
    expect(s.reason).toBe('对比最多 6 个')
  })

  it('对比与安装状态无关：全是系统字体也能对比', () => {
    const fonts = [face('A', true, 'system'), face('B', false, 'system')]
    const s = summarizeSelection(fonts, ['a', 'b'])
    expect(s.canCompare).toBe(true)
    expect(s.canInstall).toBe(false)
    expect(s.canUninstall).toBe(false)
  })

  it('空选择什么都不许做', () => {
    const s = summarizeSelection([face('A', false)], [])
    expect(s.canInstall).toBe(false)
    expect(s.canUninstall).toBe(false)
    expect(s.canCompare).toBe(false)
    expect(s.reason).toBeNull()
  })
})
