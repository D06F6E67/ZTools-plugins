import test from 'node:test'
import assert from 'node:assert/strict'
import { computed, nextTick, ref } from 'vue'
import { useSelection } from '../src/composables/useSelection.js'

const createSelection = (items) => {
  const data = ref(items)
  const activeTab = ref('all')
  const writes = []
  const selection = useSelection(
    computed(() => data.value),
    computed(() => [{ key: 'all' }]),
    activeTab,
    async (selectedItems, shouldPaste) => writes.push({ selectedItems, shouldPaste })
  )
  return { data, selection, writes }
}

const clickEvent = (overrides = {}) => ({
  shiftKey: false,
  metaKey: false,
  ctrlKey: false,
  ...overrides
})

test('keeps selected items in click order', async () => {
  const first = { type: 'text', content: 'first' }
  const second = { type: 'text', content: 'second' }
  const third = { type: 'text', content: 'third' }
  const { selection, writes } = createSelection([first, second, third])

  selection.handleItemClick(clickEvent(), 2)
  selection.handleItemClick(clickEvent({ metaKey: true }), 0)
  await selection.copySelected()

  assert.deepEqual(writes[0], {
    selectedItems: [third, first],
    shouldPaste: false
  })
})

test('copies the current selection with Ctrl+C', () => {
  const first = { type: 'text', content: 'first' }
  const second = { type: 'text', content: 'second' }
  const { selection, writes } = createSelection([first, second])
  let prevented = false

  selection.toggleItem(1)
  selection.handleKeydown({
    key: 'c',
    ctrlKey: true,
    metaKey: false,
    preventDefault: () => { prevented = true }
  })

  assert.equal(prevented, true)
  assert.deepEqual(writes[0], {
    selectedItems: [first, second],
    shouldPaste: false
  })
})

test('switches to a single selection when the type changes', () => {
  const textItem = { type: 'text', content: 'text' }
  const imageItem = { type: 'image', imagePath: '/tmp/image.png' }
  const { selection } = createSelection([textItem, imageItem])

  selection.toggleItem(1)

  assert.equal(selection.selectedCount.value, 1)
  assert.deepEqual(selection.selectedItems.value[0], imageItem)
})

test('moves the active item back into the selection when an item is unchecked', () => {
  const first = { type: 'text', content: 'first' }
  const second = { type: 'text', content: 'second' }
  const { selection } = createSelection([first, second])

  selection.toggleItem(1)
  selection.toggleItem(1)

  assert.equal(selection.selectedCount.value, 1)
  assert.equal(selection.activeIndex.value, 0)
  assert.deepEqual(selection.selectedItems.value, [first])
})

test('allows the last checked item to be cleared', () => {
  const item = { type: 'text', content: 'only' }
  const { selection } = createSelection([item])

  selection.toggleItem(0)

  assert.equal(selection.selectedCount.value, 0)
  assert.equal(selection.activeIndex.value, -1)
  assert.deepEqual(selection.selectedItems.value, [])
})

test('selects matching items in a shift range', () => {
  const first = { type: 'text', content: 'first' }
  const image = { type: 'image', imagePath: '/tmp/image.png' }
  const third = { type: 'text', content: 'third' }
  const { selection } = createSelection([first, image, third])

  selection.handleItemClick(clickEvent({ shiftKey: true }), 2)

  assert.deepEqual(selection.selectedItems.value, [first, third])
})

test('orders a reverse shift range from the anchor to the clicked item', () => {
  const first = { type: 'text', content: 'first' }
  const second = { type: 'text', content: 'second' }
  const third = { type: 'text', content: 'third' }
  const { selection } = createSelection([first, second, third])

  selection.handleItemClick(clickEvent(), 2)
  selection.handleItemClick(clickEvent({ shiftKey: true }), 0)

  assert.deepEqual(selection.selectedItems.value, [third, second, first])
})

test('preserves click order when the list is reordered', async () => {
  const first = { type: 'text', content: 'first' }
  const second = { type: 'text', content: 'second' }
  const { data, selection } = createSelection([first, second])

  selection.toggleItem(1)
  data.value.splice(0, 2, second, first)
  await nextTick()

  assert.deepEqual(selection.selectedItems.value, [first, second])
})
