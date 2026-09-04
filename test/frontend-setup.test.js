import assert from 'node:assert/strict'
import test from 'node:test'

import {
  GENERATED_ONLY_STORAGE_KEY,
  IMAGE_FILTER_STORAGE_KEY,
  LAST_PAGE_STORAGE_KEY,
  REFERENCED_IMAGES_STORAGE_KEY,
  REFERENCED_IMAGE_CACHE_TTL_MS,
  readImageFilter,
  readLastPageNumber,
  readReferencedImageCache,
  setup,
  writeImageFilter,
  writeLastPageNumber,
  writeReferencedImageCache,
} from '../src/frontend.js'

class FakeElement {
  constructor(tagName = 'div') {
    this.tagName = tagName
    this.children = []
    this.className = ''
    this.textContent = ''
    this.style = {}
    this.dataset = {}
    this.classList = { add() {} }
  }

  append(...children) {
    this.children.push(...children)
  }

  appendChild(child) {
    this.children.push(child)
    return child
  }

  replaceChildren(...children) {
    this.children = [...children]
  }

  addEventListener() {}
  setAttribute() {}
  querySelector() { return null }
}

test('frontend setup survives without secure-context UUIDs or an input bar action', async () => {
  const originalDescriptors = Object.fromEntries(
    ['crypto', 'document', 'window'].map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]),
  )
  const drawerRoot = new FakeElement()
  const sentMessages = []
  let backendHandler = null
  let readyCalls = 0
  let drawerDestroyed = false

  Object.defineProperties(globalThis, {
    crypto: {
      configurable: true,
      value: { randomUUID() { throw new Error('randomUUID requires a secure context') } },
    },
    document: {
      configurable: true,
      value: {
        createElement: (tagName) => new FakeElement(tagName),
        createTextNode: (text) => ({ textContent: text }),
      },
    },
    window: {
      configurable: true,
      value: { setTimeout, clearTimeout, innerHeight: 800 },
    },
  })

  try {
    const teardown = setup({
      deferReady() {},
      ready() { readyCalls += 1 },
      dom: { addStyle: () => () => {} },
      onBackendMessage(handler) {
        backendHandler = handler
        return () => { backendHandler = null }
      },
      sendToBackend(payload) {
        sentMessages.push(payload)
        backendHandler?.({ requestId: payload.requestId, ok: true, granted: true })
      },
      ui: {
        registerDrawerTab() {
          return {
            root: drawerRoot,
            destroy() { drawerDestroyed = true },
          }
        },
      },
    })

    await Promise.resolve()

    assert.equal(readyCalls, 1)
    assert.equal(sentMessages.length, 1)
    assert.equal(sentMessages[0].type, 'image_browser_permission')
    assert.match(sentMessages[0].requestId, /^image-browser-[a-z0-9]+-1$/)
    assert.ok(drawerRoot.children.length > 0)

    teardown()
    assert.equal(drawerDestroyed, true)
  } finally {
    for (const [name, descriptor] of Object.entries(originalDescriptors)) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor)
      else delete globalThis[name]
    }
  }
})

test('last page preference persists safely in local storage', () => {
  const values = new Map()
  const storage = {
    getItem(key) { return values.get(key) ?? null },
    setItem(key, value) { values.set(key, value) },
  }

  assert.equal(readLastPageNumber(storage), 1)
  assert.equal(writeLastPageNumber(storage, 4), true)
  assert.equal(values.get(LAST_PAGE_STORAGE_KEY), '4')
  assert.equal(readLastPageNumber(storage), 4)

  values.set(LAST_PAGE_STORAGE_KEY, '0')
  assert.equal(readLastPageNumber(storage), 1)
  values.set(LAST_PAGE_STORAGE_KEY, '2.5')
  assert.equal(readLastPageNumber(storage), 1)
  values.set(LAST_PAGE_STORAGE_KEY, 'not-a-page')
  assert.equal(readLastPageNumber(storage), 1)
  assert.equal(writeLastPageNumber(storage, 0), false)
})

test('last page preference falls back when local storage is unavailable', () => {
  const unavailableStorage = {
    getItem() { throw new Error('Storage is blocked') },
    setItem() { throw new Error('Storage is blocked') },
  }

  assert.equal(readLastPageNumber(unavailableStorage), 1)
  assert.equal(writeLastPageNumber(unavailableStorage, 3), false)
})

test('image filter preference persists and migrates generated-only local storage', () => {
  const values = new Map()
  const storage = {
    getItem(key) { return values.get(key) ?? null },
    setItem(key, value) { values.set(key, value) },
    removeItem(key) { values.delete(key) },
  }

  assert.equal(readImageFilter(storage), 'all')
  values.set(GENERATED_ONLY_STORAGE_KEY, 'true')
  assert.equal(readImageFilter(storage), 'generated')

  assert.equal(writeImageFilter(storage, 'non-generated'), true)
  assert.equal(values.get(IMAGE_FILTER_STORAGE_KEY), 'non-generated')
  assert.equal(values.has(GENERATED_ONLY_STORAGE_KEY), false)
  assert.equal(readImageFilter(storage), 'non-generated')
  assert.equal(writeImageFilter(storage, 'invalid'), false)
})

test('referenced image cache persists UUID records and expires stale observations', () => {
  const now = Date.UTC(2026, 8, 1)
  const values = new Map()
  const storage = {
    getItem(key) { return values.get(key) ?? null },
    setItem(key, value) { values.set(key, value) },
  }
  const records = new Map([
    ['image-current', now],
    ['image-expired', now - REFERENCED_IMAGE_CACHE_TTL_MS - 1],
  ])

  assert.equal(writeReferencedImageCache(storage, records), true)
  assert.ok(values.has(REFERENCED_IMAGES_STORAGE_KEY))
  assert.deepEqual([...readReferencedImageCache(storage, now)], [['image-current', now]])

  values.set(REFERENCED_IMAGES_STORAGE_KEY, '{not-json')
  assert.equal(readReferencedImageCache(storage, now).size, 0)
})
