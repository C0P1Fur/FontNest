/** 展示层的纯格式化函数，不做任何 IO */

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const kb = bytes / 1024
  if (kb < 1024) return `${kb.toFixed(0)} KB`
  return `${(kb / 1024).toFixed(1)} MB`
}

export function formatCount(n: number): string {
  return n.toLocaleString('en-US')
}

export function formatTime(epochMs: number): string {
  const d = new Date(epochMs)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${hh}:${mm}`
}

/** 字重数值 → 常用叫法，用于辅标题 */
export function weightName(weight: number): string {
  if (weight <= 150) return 'Thin'
  if (weight <= 250) return 'ExtraLight'
  if (weight <= 350) return 'Light'
  if (weight <= 450) return 'Regular'
  if (weight <= 550) return 'Medium'
  if (weight <= 650) return 'SemiBold'
  if (weight <= 750) return 'Bold'
  if (weight <= 850) return 'ExtraBold'
  return 'Black'
}
