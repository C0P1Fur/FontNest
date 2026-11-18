import { useEffect } from 'react'
import { useApp } from '../state/store'

/**
 * 「添加到分类夹」的目标选择弹框。
 *
 * 出现在**多选之后**：用户先勾好要加的字体，点主按钮时才问"加到哪个"。
 * 这个顺序更像"选中 → 确认 → 指定去处"：勾选阶段不用先想好目标，
 * 而且目标可以等看到实际选中了什么再决定。
 */
export function CollectionPicker() {
  const open = useApp((state) => state.collectionPickerOpen)
  const collections = useApp((state) => state.collections)
  const selectedFamilies = useApp((state) => state.selectedFamilies)
  const pendingFamily = useApp((state) => state.collectionPickerFamily)
  const close = useApp((state) => state.closeCollectionPicker)
  const addFamiliesToCollection = useApp((state) => state.addFamiliesToCollection)

  // 从卡片按钮打开时只加那一族；从多选条打开时加已选的那批
  const families = pendingFamily ? [pendingFamily] : selectedFamilies

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, close])

  if (!open) return null

  return (
    <div className="overlay" onMouseDown={close}>
      <div
        className="modal coll-picker"
        role="dialog"
        aria-modal="true"
        aria-labelledby="coll-picker-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="modal-head">
          <h2 id="coll-picker-title">添加到哪个分类夹</h2>
          <button type="button" className="modal-close" aria-label="关闭" onClick={close}>
            ✕
          </button>
        </header>

        <p className="modal-note">
          {pendingFamily ? `将加入 1 个字体族。` : `已选 ${families.length} 个字体族。`}
        </p>

        {collections.length === 0 ? (
          <p className="modal-note">
            还没有分类夹。先在左栏底部新建一个，再回来。
          </p>
        ) : (
          <ul className="coll-pick-list">
            {collections.map((collection) => (
              <li key={collection.id}>
                <button
                  type="button"
                  onClick={() => {
                    close()
                    void addFamiliesToCollection(collection.id, families)
                  }}
                >
                  <span className="coll-pick-name">{collection.name}</span>
                  <span className="count">{collection.fontIds.length}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
