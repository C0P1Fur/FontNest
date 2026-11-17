import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useApp } from '../state/store'

/**
 * 首次引导 · 聚光灯分步导览。
 *
 * 设计稿见 docs/ONBOARDING.md，这里的每一步都能在那边找到对应小节。
 *
 * 两个实现上的取舍：
 *
 * 1. **遮罩用四块挡板，不是纯外阴影。** 外阴影（box-shadow: 0 0 0 9999px）
 *    画得出镂空，但挡不住点击——而 ②③④ 必须拦截。四块挡板同时负责压暗和拦截，
 *    被框住的那一块天然是"洞"，点击可以穿透到被高亮的元素。
 *
 * 2. **锚点找不到就静默跳过**，不报错。用户不该知道引导内部有分支。
 */

type Placement = 'bottom-start' | 'bottom-end' | 'right' | 'left'

interface StepDef {
  key: string
  /** 主锚点，多个选择器时矩形取并集 */
  selectors: string[]
  /** 主锚点不存在时的降级锚点 */
  fallbackSelectors?: string[]
  fallbackBody?: string
  placement: Placement
  /** 是否拦截点击 */
  blocking: boolean
  title: string
  body: string
  cta?: string
  /** 满足条件就不展示这一步 */
  skipWhen?: (ctx: { fontCount: number }) => boolean
}

const STEPS: StepDef[] = [
  {
    key: 'search',
    selectors: ['[data-tour="search"]'],
    placement: 'bottom-start',
    blocking: false,
    title: '搜你想找的',
    body: '输入字体名、厂商，或「变量」「中文」这类词都能命中。',
  },
  {
    key: 'filters',
    selectors: ['[data-tour="filters"]'],
    placement: 'right',
    blocking: true,
    title: '快速缩小范围',
    body: '上面按状态分（已启用 / 未启用 / 可变），下面按字形分（衬线 / 等宽 / 手写…）。',
  },
  {
    key: 'card',
    selectors: ['.grid .card[aria-selected="true"]'],
    fallbackSelectors: ['.grid .card'],
    placement: 'right',
    blocking: true,
    title: '每张卡都是真的',
    body: '名字和样张都用这款字体本身渲染。没装的字体也能看清它长什么样——大部分字体管理器做不到。',
    skipWhen: ({ fontCount }) => fontCount === 0,
  },
  {
    key: 'inspector',
    selectors: ['.inspector'],
    placement: 'left',
    blocking: true,
    title: '看清一款字体',
    body: '点样张可以换字号；下面能看字符集和授权。底部那个按钮会把它装进系统——随时可以再撤回来。',
  },
  {
    key: 'recognize',
    selectors: ['[data-tour="recognize"]'],
    placement: 'bottom-end',
    blocking: false,
    title: '还有一招：截图找字体',
    body: '看到一段好看的字，截个图、把文字打进去，它会从你本机全部字体里找最像的。',
    cta: '现在就试',
  },
]

function queryAll(list: string[]): HTMLElement[] {
  const found: HTMLElement[] = []
  for (const selector of list) {
    document.querySelectorAll<HTMLElement>(selector).forEach((el) => found.push(el))
  }
  return found
}

interface Hole {
  left: number
  top: number
  width: number
  height: number
}

export function Tour() {
  const open = useApp((state) => state.tourOpen)
  const fonts = useApp((state) => state.fonts)
  const query = useApp((state) => state.query)
  const finishTour = useApp((state) => state.finishTour)
  const openRecognize = useApp((state) => state.openRecognize)

  const [steps, setSteps] = useState<StepDef[]>([])
  const [index, setIndex] = useState(0)
  const [hole, setHole] = useState<Hole | null>(null)
  const [body, setBody] = useState('')
  const [position, setPosition] = useState({ left: 0, top: 0 })
  const [size, setSize] = useState({ width: 300, height: 130 })
  const [viewport, setViewport] = useState({
    width: typeof window === 'undefined' ? 1200 : window.innerWidth,
    height: typeof window === 'undefined' ? 800 : window.innerHeight,
  })

  const bubbleRef = useRef<HTMLDivElement | null>(null)
  const anchorRef = useRef<HTMLElement | null>(null)

  const step = steps[index]

  // 开始引导时筛掉锚点不存在的步骤。刻意只依赖 open：
  // 中途布局变化不应该让步骤数跳变。
  useEffect(() => {
    if (!open) return
    const available = STEPS.filter((item) => {
      if (item.skipWhen?.({ fontCount: fonts.length })) return false
      if (queryAll(item.selectors).length > 0) return true
      return item.fallbackSelectors ? queryAll(item.fallbackSelectors).length > 0 : false
    })
    setSteps(available)
    setIndex(0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const measure = useCallback(() => {
    const current = steps[index]
    if (!current) return

    let elements = queryAll(current.selectors)
    let text = current.body
    if (elements.length === 0 && current.fallbackSelectors) {
      elements = queryAll(current.fallbackSelectors)
      text = current.fallbackBody ?? current.body
    }
    if (elements.length === 0) {
      setHole(null)
      return
    }

    anchorRef.current = elements[0]
    const rects = elements.map((el) => el.getBoundingClientRect())
    const left = Math.min(...rects.map((rect) => rect.left))
    const top = Math.min(...rects.map((rect) => rect.top))
    const right = Math.max(...rects.map((rect) => rect.right))
    const bottom = Math.max(...rects.map((rect) => rect.bottom))

    setHole({ left, top, width: right - left, height: bottom - top })
    setBody(text)
  }, [steps, index])

  // 定位 + 重排。窗口尺寸、布局变化、以及滚动都要重算，否则高亮框会歪。
  useEffect(() => {
    if (!open || steps.length === 0) return

    // 目标在视口外时先滚进来 —— 否则高亮框会框在屏幕外
    const current = steps[index]
    const elements = current ? queryAll(current.selectors) : []
    const anchor = elements[0]
    if (anchor) {
      const rect = anchor.getBoundingClientRect()
      const offscreen =
        rect.bottom < 0 ||
        rect.top > window.innerHeight ||
        rect.right < 0 ||
        rect.left > window.innerWidth
      if (offscreen) {
        anchor.scrollIntoView({ block: 'center', behavior: 'auto' })
      }
    }

    measure()

    const onResize = () => {
      setViewport({ width: window.innerWidth, height: window.innerHeight })
      measure()
    }
    const onScroll = () => measure()

    window.addEventListener('resize', onResize)
    window.addEventListener('scroll', onScroll, true)

    const observer = new ResizeObserver(() => measure())
    observer.observe(document.body)

    return () => {
      window.removeEventListener('resize', onResize)
      window.removeEventListener('scroll', onScroll, true)
      observer.disconnect()
    }
  }, [open, steps, index, measure])

  // 量气泡实际尺寸，再做翻转与夹取
  useLayoutEffect(() => {
    const element = bubbleRef.current
    if (!element) return
    const rect = element.getBoundingClientRect()
    if (Math.abs(rect.width - size.width) > 0.5 || Math.abs(rect.height - size.height) > 0.5) {
      setSize({ width: rect.width, height: rect.height })
    }
  }, [index, body, size])

  useLayoutEffect(() => {
    if (!hole || !step) return
    const gap = 16
    const edge = 16
    const { width: bubbleWidth, height: bubbleHeight } = size
    const { width: viewWidth, height: viewHeight } = viewport

    let left: number
    let top: number

    if (step.placement === 'right' || step.placement === 'left') {
      left =
        step.placement === 'right'
          ? hole.left + hole.width + gap
          : hole.left - bubbleWidth - gap
      // 放不下就翻到另一侧（详情栏在右，气泡默认在它左边）
      if (left < edge) {
        left = hole.left + hole.width + gap
      }
      if (left + bubbleWidth > viewWidth - edge) {
        left = hole.left - bubbleWidth - gap
      }
      top = hole.top + hole.height / 2 - bubbleHeight / 2
    } else {
      top = hole.top + hole.height + gap
      if (top + bubbleHeight > viewHeight - edge) {
        top = hole.top - bubbleHeight - gap
      }
      left =
        step.placement === 'bottom-end'
          ? hole.left + hole.width - bubbleWidth
          : hole.left
    }

    setPosition({
      left: Math.min(Math.max(edge, left), Math.max(edge, viewWidth - bubbleWidth - edge)),
      top: Math.min(Math.max(edge, top), Math.max(edge, viewHeight - bubbleHeight - edge)),
    })
  }, [hole, size, step, viewport])

  const finish = useCallback(
    (stepIndex: number) => {
      void finishTour(stepIndex)
    },
    [finishTour],
  )

  const next = useCallback(() => {
    if (index + 1 >= steps.length) {
      finish(steps.length)
      return
    }
    setIndex(index + 1)
  }, [index, steps.length, finish])

  const prev = useCallback(() => setIndex((current) => Math.max(0, current - 1)), [])

  // 键盘：→ / Enter 前进，← 后退，Esc 结束
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const typing = target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA'

      if (event.key === 'Escape') {
        event.preventDefault()
        finish(index)
      } else if (event.key === 'ArrowRight' || (event.key === 'Enter' && !typing)) {
        event.preventDefault()
        next()
      } else if (event.key === 'ArrowLeft' && !typing) {
        event.preventDefault()
        prev()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open, index, next, prev, finish])

  // 第 1 步：开始输入即视为完成
  useEffect(() => {
    if (!open || step?.key !== 'search' || query.length === 0) return
    const timer = window.setTimeout(next, 450)
    return () => window.clearTimeout(timer)
  }, [query, open, step, next])

  // 焦点：拦截步聚焦气泡按钮，穿透步聚焦被高亮的元素（用户要能直接输入）
  useEffect(() => {
    if (!open || !step) return
    const target = step.blocking
      ? bubbleRef.current?.querySelector<HTMLElement>('.tour-next')
      : anchorRef.current
    target?.focus({ preventScroll: true })
  }, [open, index, step, hole])

  const strips = useMemo(() => {
    if (!hole) return []
    const { width: viewWidth, height: viewHeight } = viewport
    return [
      { left: 0, top: 0, width: viewWidth, height: Math.max(0, hole.top) },
      {
        left: 0,
        top: hole.top + hole.height,
        width: viewWidth,
        height: Math.max(0, viewHeight - hole.top - hole.height),
      },
      { left: 0, top: hole.top, width: Math.max(0, hole.left), height: hole.height },
      {
        left: hole.left + hole.width,
        top: hole.top,
        width: Math.max(0, viewWidth - hole.left - hole.width),
        height: hole.height,
      },
    ]
  }, [hole, viewport])

  if (!open || !step || !hole) return null

  const pad = 6
  const ring = {
    left: hole.left - pad,
    top: hole.top - pad,
    width: hole.width + pad * 2,
    height: hole.height + pad * 2,
  }

  const primary = () => {
    if (step.cta) {
      finish(steps.length)
      openRecognize()
      return
    }
    next()
  }

  return (
    <div className="tour" role="dialog" aria-modal="true" aria-label="上手引导">
      {strips.map((strip, stripIndex) => (
        <div
          key={stripIndex}
          className={step.blocking ? 'tour-strip is-blocking' : 'tour-strip'}
          style={strip}
        />
      ))}

      <div className="tour-ring" style={ring} aria-hidden="true" />

      <div
        className="tour-bubble"
        style={{ left: position.left, top: position.top }}
        ref={bubbleRef}
      >
        <div className="tour-count">
          {index + 1} / {steps.length}
        </div>
        <h3 className="tour-title">{step.title}</h3>
        <p className="tour-body" aria-live="polite">
          {body}
        </p>
        <div className="tour-actions">
          {index > 0 ? (
            <button type="button" className="tour-prev" onClick={prev}>
              上一步
            </button>
          ) : null}
          <button
            type="button"
            className="tour-skip"
            onClick={() => {
              finish(index)
            }}
          >
            跳过引导
          </button>
          <button type="button" className="tour-next" onClick={primary}>
            {step.cta ?? '下一步'}
          </button>
        </div>
      </div>
    </div>
  )
}
