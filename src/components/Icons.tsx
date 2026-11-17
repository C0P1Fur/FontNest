/** 统一图标：单一线性风格，1.6 描边，20×20 网格 */

interface IconProps {
  className?: string
}

/**
 * 字体识别：四个扫描角 + 一条基线。
 *
 * 不用"放大镜找文字"那种组合 —— 16px 下笔画会糊成一团。
 * 四个角在视觉上就是"框选一块区域"，中间那条线表示"这块是文字"。
 */
export function ScanTextIcon({ className }: IconProps) {
  return (
    <svg className={className ?? 'ico'} viewBox="0 0 20 20" aria-hidden="true">
      <path
        d="M3 7.2V4.9a1.9 1.9 0 011.9-1.9H7.2M12.8 3h2.3A1.9 1.9 0 0117 4.9v2.3M17 12.8v2.3a1.9 1.9 0 01-1.9 1.9h-2.3M7.2 17H4.9A1.9 1.9 0 013 15.1v-2.3"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path d="M7 10h6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}

export function SearchIcon({ className }: IconProps) {
  return (
    <svg className={className ?? 'ico'} viewBox="0 0 20 20" aria-hidden="true">
      <circle cx="9" cy="9" r="5.2" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M13 13l3.6 3.6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}

export function SunIcon({ className }: IconProps) {
  return (
    <svg className={className ?? 'ico'} viewBox="0 0 20 20" aria-hidden="true">
      <circle cx="10" cy="10" r="4" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M10 1.6v2.1M10 16.3v2.1M1.6 10h2.1M16.3 10h2.1M3.9 3.9l1.5 1.5M14.6 14.6l1.5 1.5M16.1 3.9l-1.5 1.5M5.4 14.6l-1.5 1.5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  )
}

export function KeyboardIcon({ className }: IconProps) {
  return (
    <svg className={className ?? 'ico'} viewBox="0 0 20 20" aria-hidden="true">
      <rect x="1.8" y="5.2" width="16.4" height="9.6" rx="2.4" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M5 8.4h.01M8 8.4h.01M11 8.4h.01M14 8.4h.01M6.4 12h7.2"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  )
}

export function GridIcon({ className }: IconProps) {
  return (
    <svg className={className ?? 'ico'} viewBox="0 0 20 20" aria-hidden="true">
      <rect x="2.6" y="2.6" width="6" height="6" rx="1.4" fill="currentColor" />
      <rect x="11.4" y="2.6" width="6" height="6" rx="1.4" fill="currentColor" opacity=".35" />
      <rect x="2.6" y="11.4" width="6" height="6" rx="1.4" fill="currentColor" opacity=".35" />
      <rect x="11.4" y="11.4" width="6" height="6" rx="1.4" fill="currentColor" opacity=".35" />
    </svg>
  )
}

export function ListIcon({ className }: IconProps) {
  return (
    <svg className={className ?? 'ico'} viewBox="0 0 20 20" aria-hidden="true">
      <path d="M3 5.4h14M3 10h14M3 14.6h14" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
    </svg>
  )
}

export function StarIcon({ filled, className }: IconProps & { filled?: boolean }) {
  return (
    <svg className={className ?? 'ico'} viewBox="0 0 20 20" aria-hidden="true">
      <path
        d="M10 2.6l2.3 4.7 5.1.7-3.7 3.6.9 5.1-4.6-2.4-4.6 2.4.9-5.1L2.6 8l5.1-.7z"
        fill={filled ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function FolderIcon({ className }: IconProps) {
  return (
    <svg className={className ?? 'ico'} viewBox="0 0 20 20" aria-hidden="true">
      <path
        d="M2.4 6.2a1.4 1.4 0 011.4-1.4h3.1l1.5 1.8h7.3a1.4 1.4 0 011.4 1.4v6.4a1.4 1.4 0 01-1.4 1.4H3.8a1.4 1.4 0 01-1.4-1.4z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function RefreshIcon({ className }: IconProps) {
  return (
    <svg className={className ?? 'ico'} viewBox="0 0 20 20" aria-hidden="true">
      <path
        d="M16.4 8.2A6.6 6.6 0 003.9 6.6M3.6 11.8a6.6 6.6 0 0012.5 1.6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <path
        d="M16.6 4.2v4h-4M3.4 15.8v-4h4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function CheckIcon({ className }: IconProps) {
  return (
    <svg className={className ?? 'ico'} viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M3.2 8.4l3.1 3.1 6.4-7"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function PlusIcon({ className }: IconProps) {
  return (
    <svg className={className ?? 'ico'} viewBox="0 0 16 16" aria-hidden="true">
      <path d="M8 3v10M3 8h10" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
    </svg>
  )
}

export function LayersIcon({ className }: IconProps) {
  return (
    <svg className={className ?? 'ico'} viewBox="0 0 20 20" aria-hidden="true">
      <rect x="2.6" y="2.6" width="6" height="6" rx="1.6" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <rect x="11.4" y="2.6" width="6" height="6" rx="1.6" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <rect x="2.6" y="11.4" width="6" height="6" rx="1.6" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <rect x="11.4" y="11.4" width="6" height="6" rx="1.6" fill="none" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  )
}

export function CircleCheckIcon({ className }: IconProps) {
  return (
    <svg className={className ?? 'ico'} viewBox="0 0 20 20" aria-hidden="true">
      <circle cx="10" cy="10" r="7" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M6.8 10.2l2.2 2.2 4.2-4.6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function CircleDashedIcon({ className }: IconProps) {
  return (
    <svg className={className ?? 'ico'} viewBox="0 0 20 20" aria-hidden="true">
      <circle cx="10" cy="10" r="7" fill="none" stroke="currentColor" strokeWidth="1.6" strokeDasharray="2.4 2.6" />
    </svg>
  )
}

export function VariableIcon({ className }: IconProps) {
  return (
    <svg className={className ?? 'ico'} viewBox="0 0 20 20" aria-hidden="true">
      <path
        d="M2.8 14.6c2.4 0 3.2-3.2 4.6-6.4S10 4 12 6.4s2.2 6 5.2 6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  )
}

export function StarOutlineIcon({ className }: IconProps) {
  return <StarIcon className={className} />
}

/**
 * 扫描目录：文件夹 + 加号。
 *
 * 早先画的是"三条滑杆 + 三个圆"，16px 下三条线加三个圆会糊成一团，
 * 而且读不出"这里能加文件夹"。现在复用与 FolderIcon 相同的文件夹轮廓，
 * 内部一个加号 —— 形状简单，缩小到 16px 仍然认得出。
 */
export function FolderPlusIcon({ className }: IconProps) {
  return (
    <svg className={className ?? 'ico'} viewBox="0 0 20 20" aria-hidden="true">
      <path
        d="M2.4 6.2a1.4 1.4 0 011.4-1.4h3.1l1.5 1.8h7.3a1.4 1.4 0 011.4 1.4v6.4a1.4 1.4 0 01-1.4 1.4H3.8a1.4 1.4 0 01-1.4-1.4z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path
        d="M10 9.3v4.2M7.9 11.4h4.2"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  )
}
