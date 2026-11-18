import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
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
