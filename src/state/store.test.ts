import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Font } from '../types/font'
import { ALL_VIEW, useApp } from '../state/store'

/**
 * 这一条行为用 store 测而不是纯函数测：清空发生在 action 内部，
 * 只有真的调用一次才知道"切容器会不会把搜索清掉"。
 */
/**
 * store 里的 toast 用 window.setTimeout 自动消失，node 环境没有 window。
 * 这里给个最小 shim —— 注意不能带 __TAURI_INTERNALS__，
 * 那个标记会让 api 走真实的 Tauri 调用。
 */
beforeAll(() => {
  vi.stubGlobal('window', { setTimeout, clearTimeout })
})

afterAll(() => {
  vi.unstubAllGlobals()
})

describe('setContainer', () => {
  beforeEach(() => {
    useApp.setState({
      container: ALL_VIEW,
      query: '',
      categories: [],
    })
  })

  it('切换到另一个容器时清空搜索关键词与类型勾选', () => {
    useApp.setState({ query: 'inter', categories: ['serif', 'mono'] })

    useApp.getState().setContainer({ kind: 'view', scope: 'favorite' })

    const state = useApp.getState()
    expect(state.container).toEqual({ kind: 'view', scope: 'favorite' })
    expect(state.query).toBe('')
    expect(state.categories).toEqual([])
  })

  it('点当前已高亮的容器也算一次切换，筛选照样清空', () => {
    useApp.setState({ query: 'georgia', categories: ['serif'] })

    useApp.getState().setContainer({ kind: 'view', scope: 'all' })

    const state = useApp.getState()
    expect(state.query).toBe('')
    expect(state.categories).toEqual([])
    // 容器本身没动
    expect(state.container).toEqual({ kind: 'view', scope: 'all' })
  })

  it('切到分类夹同样会清空', () => {
    useApp.setState({ query: 'noto', categories: ['cjk'] })

    useApp.getState().setContainer({ kind: 'collection', id: 'c1' })

    const state = useApp.getState()
    expect(state.container).toEqual({ kind: 'collection', id: 'c1' })
    expect(state.query).toBe('')
    expect(state.categories).toEqual([])
  })

  it('视图与分类夹之间来回切也互不干扰', () => {
    useApp.getState().setContainer({ kind: 'collection', id: 'c9' })
    useApp.setState({ query: 'kaiti' })

    useApp.getState().setContainer({ kind: 'view', scope: 'variable' })

    expect(useApp.getState().query).toBe('')
    expect(useApp.getState().container).toEqual({ kind: 'view', scope: 'variable' })
  })
  it('新建分类夹会落到新容器并清空筛选', async () => {
    useApp.setState({ query: 'inter', categories: ['serif'] })

    await useApp.getState().createCollection('测试分类')

    const state = useApp.getState()
    expect(state.container.kind).toBe('collection')
    expect(state.query).toBe('')
    expect(state.categories).toEqual([])
  })

  it('删掉正在浏览的分类夹会回退到「全部」并清空筛选', async () => {
    const created = await useApp.getState().createCollection('待删除')
    const id = useApp.getState().collections.at(-1)?.id
    expect(created).toBeNull()
    expect(id).toBeDefined()

    useApp.setState({ query: 'noto', categories: ['cjk'] })
    await useApp.getState().deleteCollection(id as string)

    const state = useApp.getState()
    expect(state.container).toEqual({ kind: 'view', scope: 'all' })
    expect(state.query).toBe('')
    expect(state.categories).toEqual([])
  })

  it('删掉别的分类夹不会动当前视图和筛选', async () => {
    await useApp.getState().createCollection('别的分类')
    const other = useApp.getState().collections.at(-1)?.id

    useApp.getState().setContainer({ kind: 'view', scope: 'favorite' })
    useApp.setState({ query: 'georgia', categories: ['serif'] })

    await useApp.getState().deleteCollection(other as string)

    const state = useApp.getState()
    expect(state.container).toEqual({ kind: 'view', scope: 'favorite' })
    expect(state.query).toBe('georgia')
    expect(state.categories).toEqual(['serif'])
  })
})

describe('勾选数量：装卸不设限，对比卡 6 个', () => {
  // startSelection 是"再选同一项等于退出"，所以每个用例前必须把模式清干净
  beforeEach(() => {
    useApp.setState({ selectionMode: null, selectedFamilies: [], selectionBusy: false })
  })

  it('安装通道可以勾选超过 6 个族', () => {
    useApp.getState().startSelection('install')
    const keys = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']
    for (const key of keys) useApp.getState().toggleSelected(key)

    expect(useApp.getState().selectedFamilies).toEqual(keys)
  })

  it('安装通道全选不截断', () => {
    useApp.getState().startSelection('install')
    const keys = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j']
    useApp.getState().setSelectedFamilies(keys)
    expect(useApp.getState().selectedFamilies).toEqual(keys)
  })

  it('对比通道第 7 个被拒绝，保留前 6 个', () => {
    useApp.getState().startSelection('compare')
    const keys = ['a', 'b', 'c', 'd', 'e', 'f']
    for (const key of keys) useApp.getState().toggleSelected(key)

    useApp.getState().toggleSelected('g')

    const picked = useApp.getState().selectedFamilies
    expect(picked).toHaveLength(6)
    expect(picked).not.toContain('g')
  })

  it('对比通道全选会截断到 6 个', () => {
    useApp.getState().startSelection('compare')
    const keys = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']
    useApp.getState().setSelectedFamilies(keys)
    expect(useApp.getState().selectedFamilies).toHaveLength(6)
  })

  it('退出多选会清空已选', () => {
    useApp.getState().startSelection('install')
    useApp.getState().toggleSelected('a')
    useApp.getState().exitSelection()
    expect(useApp.getState().selectionMode).toBeNull()
    expect(useApp.getState().selectedFamilies).toEqual([])
  })
})
describe('批量分类夹操作', () => {
  function face(id: string, family: string): Font {
    return { id, family, source: 'system', enabled: true } as Font
  }

  beforeEach(() => {
    useApp.setState({
      fonts: [face('f1', 'Arial'), face('f2', 'Arial'), face('f3', 'Georgia')],
      selectedFamilies: [],
      selectionMode: null,
    })
  })

  it('加入分类夹会把整族的所有字重都放进去', async () => {
    await useApp.getState().createCollection('批量加入')
    const id = useApp.getState().collections.at(-1)?.id as string

    useApp.setState({ selectedFamilies: ['arial'] })
    await useApp.getState().addFamiliesToCollection(id, useApp.getState().selectedFamilies)

    const target = useApp.getState().collections.find((item) => item.id === id)
    expect(target?.fontIds).toEqual(['f1', 'f2'])
  })

  it('加入成功后会退出多选态', async () => {
    await useApp.getState().createCollection('退出多选')
    const id = useApp.getState().collections.at(-1)?.id as string

    useApp.getState().startSelection('addToCollection')
    useApp.setState({ selectedFamilies: ['arial'] })
    await useApp.getState().addFamiliesToCollection(id, useApp.getState().selectedFamilies)

    const state = useApp.getState()
    expect(state.selectionMode).toBeNull()
    expect(state.selectedFamilies).toEqual([])
  })

  it('重复加入不会产生重复项', async () => {
    await useApp.getState().createCollection('重复加入')
    const id = useApp.getState().collections.at(-1)?.id as string

    useApp.setState({ selectedFamilies: ['arial'] })
    await useApp.getState().addFamiliesToCollection(id, useApp.getState().selectedFamilies)
    await useApp.getState().addFamiliesToCollection(id, useApp.getState().selectedFamilies)

    const target = useApp.getState().collections.find((item) => item.id === id)
    expect(target?.fontIds).toEqual(['f1', 'f2'])
  })

  it('从分类夹移出会删掉整族的全部字重', async () => {
    await useApp.getState().createCollection('批量移出')
    const id = useApp.getState().collections.at(-1)?.id as string

    useApp.setState({ selectedFamilies: ['arial', 'georgia'] })
    await useApp.getState().addFamiliesToCollection(id, useApp.getState().selectedFamilies)
    expect(useApp.getState().collections.find((item) => item.id === id)?.fontIds).toHaveLength(3)

    useApp.setState({ selectedFamilies: ['arial'] })
    await useApp.getState().removeFamiliesFromCollection(id, useApp.getState().selectedFamilies)

    const target = useApp.getState().collections.find((item) => item.id === id)
    expect(target?.fontIds).toEqual(['f3'])
  })
})
describe('添加到分类夹：先选后问', () => {
  beforeEach(() => {
    useApp.setState({
      collectionPickerOpen: false,
      selectionMode: null,
      selectedFamilies: [],
    })
  })

  it('选「添加到分类夹」直接进入多选，不弹框', () => {
    useApp.getState().startSelection('addToCollection')

    const state = useApp.getState()
    expect(state.selectionMode).toBe('addToCollection')
    expect(state.collectionPickerOpen).toBe(false)
  })

  it('勾完之后点主按钮才弹框', () => {
    useApp.getState().startSelection('addToCollection')
    useApp.setState({ selectedFamilies: ['arial'] })
    useApp.getState().openCollectionPicker()

    expect(useApp.getState().collectionPickerOpen).toBe(true)
    // 弹框打开时仍然停在这个多选意图里，勾选不丢
    expect(useApp.getState().selectionMode).toBe('addToCollection')
    expect(useApp.getState().selectedFamilies).toEqual(['arial'])
  })

  it('关掉弹框不影响已勾选的内容', () => {
    useApp.getState().startSelection('addToCollection')
    useApp.setState({ selectedFamilies: ['arial'] })
    useApp.getState().openCollectionPicker()
    useApp.getState().closeCollectionPicker()

    expect(useApp.getState().collectionPickerOpen).toBe(false)
    expect(useApp.getState().selectedFamilies).toEqual(['arial'])
  })
})
describe('卡片上的分类夹按钮', () => {
  beforeEach(() => {
    useApp.setState({
      collectionPickerOpen: false,
      collectionPickerFamily: null,
      selectedFamilies: [],
    })
  })

  it('从卡片打开弹框时记住是哪一族，不依赖多选的已选集合', () => {
    useApp.setState({ selectedFamilies: ['完全无关的族'] })
    useApp.getState().openCollectionPickerForFamily('arial')

    const state = useApp.getState()
    expect(state.collectionPickerOpen).toBe(true)
    expect(state.collectionPickerFamily).toBe('arial')
  })

  it('从多选条打开时没有指定族，走已选集合', () => {
    useApp.getState().openCollectionPicker()
    expect(useApp.getState().collectionPickerFamily).toBeNull()
  })

  it('关闭弹框会清掉指定的族，避免影响下一次打开', () => {
    useApp.getState().openCollectionPickerForFamily('arial')
    useApp.getState().closeCollectionPicker()
    expect(useApp.getState().collectionPickerFamily).toBeNull()
  })
})