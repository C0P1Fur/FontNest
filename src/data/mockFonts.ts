import type { Font, FontCategory } from '../types/font'

/**
 * 开发期假数据。
 *
 * 用途仅限"没有 Rust 侧时也能把界面跑起来"：
 * 布局、密度、筛选、快捷键都靠它验证。
 * 真实数据由 `fontnest-core` 扫描后经 `list_fonts` 返回，本文件在
 * `lib/ipc.ts` 检测不到 Tauri 环境时才会被用到。
 *
 * 字体名全部取自 Windows 常见系统字体，因此预览是真实字形。
 */

const LICENSE_BY_FOUNDRY: Record<string, string> = {
  Microsoft: 'Microsoft EULA',
  Monotype: 'Monotype EULA',
  ITC: 'Monotype EULA',
  Linotype: 'Monotype EULA',
  'Bigelow & Holmes': 'Bigelow & Holmes EULA',
  Founder: '方正字库授权',
  Zhongyi: '中易字库授权',
  Sandoll: 'Sandoll EULA',
}

let seq = 0

function make(
  family: string,
  category: FontCategory,
  instanceCount: number,
  year: number,
  foundry: string,
  designer: string,
  extra: Partial<Font> = {},
): Font {
  seq += 1
  const compact = family.replace(/[^A-Za-z0-9]/g, '')

  return {
    id: family.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    family,
    subfamily: 'Regular',
    fullName: family,
    psName: `${compact}-Regular`,
    category,
    format: 'ttf',
    weight: 400,
    italic: false,
    variable: false,
    axes: [],
    instanceCount,
    glyphCount: category === 'cjk' ? 28000 + seq * 37 : 1200 + seq * 41,
    scripts: category === 'cjk' ? ['Latn', 'Hani'] : ['Latn'],
    version: '2.00',
    designer,
    foundry,
    year,
    license: LICENSE_BY_FOUNDRY[foundry] ?? 'SIL OFL 1.1',
    source: 'system',
    enabled: true,
    favorite: false,
    filePath: `C:\\Windows\\Fonts\\${compact}.ttf`,
    sizeBytes: 180_000 + seq * 17_000,
    collectionIndex: 0,
    ...extra,
  }
}

export const mockFonts: Font[] = [
  make('Segoe UI', 'sans', 12, 2004, 'Microsoft', 'Steve Matteson'),
  make('Segoe UI Variable Display', 'sans', 9, 2021, 'Microsoft', 'Microsoft Type', {
    variable: true,
    axes: [
      { tag: 'wght', min: 300, max: 700, defaultValue: 400 },
      { tag: 'opsz', min: 8, max: 72, defaultValue: 24 },
    ],
  }),
  make('Arial', 'sans', 4, 1982, 'Monotype', 'Robin Nicholas'),
  make('Calibri', 'sans', 8, 2005, 'Microsoft', 'Lucas de Groot'),
  make('Verdana', 'sans', 4, 1996, 'Microsoft', 'Matthew Carter', { favorite: true }),
  make('Tahoma', 'sans', 4, 1995, 'Microsoft', 'Matthew Carter'),
  make('Trebuchet MS', 'sans', 4, 1996, 'Microsoft', 'Vincent Connare'),
  make('Century Gothic', 'sans', 2, 1991, 'Monotype', 'Monotype Studio'),
  make('Corbel', 'sans', 4, 2005, 'Microsoft', 'Jeremy Tankard'),
  make('Candara', 'sans', 4, 2005, 'Microsoft', 'Gary Munch'),
  make('Gill Sans MT', 'sans', 4, 1928, 'Monotype', 'Eric Gill'),
  make('Bahnschrift', 'sans', 15, 2017, 'Microsoft', 'Microsoft Type', {
    variable: true,
    axes: [
      { tag: 'wght', min: 100, max: 900, defaultValue: 400 },
      { tag: 'wdth', min: 75, max: 100, defaultValue: 100 },
    ],
  }),

  make('Georgia', 'serif', 4, 1996, 'Microsoft', 'Matthew Carter', { favorite: true }),
  make('Times New Roman', 'serif', 4, 1932, 'Monotype', 'Stanley Morison'),
  make('Cambria', 'serif', 8, 2005, 'Microsoft', 'Jelle Bosma'),
  make('Constantia', 'serif', 4, 2005, 'Microsoft', 'John Hudson'),
  make('Palatino Linotype', 'serif', 4, 1999, 'Linotype', 'Hermann Zapf'),
  make('Book Antiqua', 'serif', 4, 1992, 'Monotype', 'Monotype Studio'),
  make('Rockwell', 'serif', 4, 1934, 'Monotype', 'Monotype Studio'),
  make('Bodoni MT', 'serif', 4, 1798, 'Monotype', 'Giambattista Bodoni'),
  make('Perpetua', 'serif', 2, 1925, 'Monotype', 'Eric Gill'),
  make('Sitka', 'serif', 24, 2015, 'Microsoft', 'Matthew Carter', {
    variable: true,
    axes: [
      { tag: 'wght', min: 400, max: 700, defaultValue: 400 },
      { tag: 'opsz', min: 6, max: 96, defaultValue: 18 },
    ],
  }),

  make('Consolas', 'mono', 4, 2006, 'Microsoft', 'Lucas de Groot'),
  make('Courier New', 'mono', 4, 1955, 'Monotype', 'Howard Kettler'),
  make('Cascadia Code', 'mono', 10, 2019, 'Microsoft', 'Aaron Bell', {
    variable: true,
    axes: [{ tag: 'wght', min: 200, max: 700, defaultValue: 400 }],
  }),
  make('OCR A Extended', 'mono', 1, 1968, 'Monotype', 'American Type Founders', { enabled: false }),

  make('Segoe Script', 'script', 1, 2004, 'Microsoft', 'Carl Crossgrove'),
  make('Comic Sans MS', 'script', 2, 1994, 'Microsoft', 'Vincent Connare', { enabled: false }),
  make('Ink Free', 'script', 1, 2016, 'Microsoft', 'Microsoft Type'),

  make('Impact', 'display', 1, 1965, 'Monotype', 'Geoffrey Lee'),
  make('Cooper Black', 'display', 1, 1922, 'ITC', 'Oswald Bruce Cooper'),
  make('Papyrus', 'display', 1, 1982, 'ITC', 'Chris Costello', { enabled: false }),
  make('Stencil', 'display', 1, 1937, 'ITC', 'Gerry Powell', { enabled: false }),

  make('Microsoft YaHei', 'cjk', 6, 2006, 'Founder', 'Founder Type', { favorite: true }),
  make('DengXian', 'cjk', 4, 2012, 'Founder', 'Founder Type'),
  make('SimSun', 'cjk', 1, 1995, 'Zhongyi', 'Zhongyi'),
  make('KaiTi', 'cjk', 1, 1995, 'Zhongyi', 'Zhongyi'),
  make('Microsoft JhengHei', 'cjk', 4, 2006, 'Microsoft', 'Microsoft Type'),
]
