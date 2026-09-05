import assert from 'node:assert/strict'
import test from 'node:test'

import { setup } from '../src/frontend.js'

class FakeElement {
  constructor(tagName = 'div') {
    this.tagName = tagName
    this.children = []
    this.className = ''
    this.textContent = ''
    this.style = {}
    this.dataset = {}
    this.classList = { add() {} }
    this.listeners = new Map()
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

  addEventListener(name, handler) { this.listeners.set(name, handler) }
  dispatch(name) { return this.listeners.get(name)?.({}) }
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

function findElement(root, predicate) {
  if (predicate(root)) return root
  for (const child of root.children || []) {
    const match = findElement(child, predicate)
    if (match) return match
  }
}

const flush = () => new Promise((resolve) => setImmediate(resolve))

function browserHarness(t) {
  const originals = Object.fromEntries(['window', 'document', 'fetch'].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  const drawer = new FakeElement()
  const requests = []
  const accounts = new Map([
    ['alice', { lastPage: 3, imageFilter: 'generated', references: { 'image-1': Date.now() } }],
    ['bob', { lastPage: 1, imageFilter: 'all', references: {} }],
  ])
  const harness = { account: 'alice', loadError: false, saveError: false, deleted: false, modal: null, requests, accounts }
  Object.defineProperties(globalThis, {
    window: { configurable: true, value: {
      setTimeout, clearTimeout, innerHeight: 800,
      get localStorage() { assert.fail('Browser storage must not be accessed') },
    } },
    document: { configurable: true, value: {
      createElement: (tag) => new FakeElement(tag), createTextNode: (text) => ({ textContent: text }),
    } },
    fetch: { configurable: true, value: async (url) => {
      assert.match(url, /\?unused=true$/)
      return { ok: true, json: async () => ({ deleted: harness.deleted }) }
    } },
  })
  let receive
  const teardown = setup({
    deferReady() {}, ready() {}, dom: { addStyle: () => () => {} },
    onBackendMessage(handler) { receive = handler; return () => {} },
    sendToBackend(payload) {
      requests.push(payload)
      const state = accounts.get(harness.account)
      let response = { ok: true }
      if (payload.type === 'image_browser_permission') response.granted = true
      if (payload.type === 'image_browser_state_get') {
        response = harness.loadError ? { ok: false, error: 'Storage unavailable' } : { ok: true, result: structuredClone(state) }
      }
      if (payload.type === 'image_browser_list') response.result = {
        data: [{ id: 'image-1', original_filename: 'image-gen-test.png', url: '/image.png' }], total: 400,
      }
      if (payload.type === 'image_browser_state_patch') {
        if (harness.saveError) response = { ok: false, error: 'Storage write failed' }
        else {
          const { patch } = payload
          if ('lastPage' in patch) state.lastPage = patch.lastPage
          if ('imageFilter' in patch) state.imageFilter = patch.imageFilter
          for (const id of patch.protectedIds || []) state.references[id] = Date.now()
          for (const id of patch.deletedIds || []) delete state.references[id]
        }
      }
      receive({ requestId: payload.requestId, ...response })
    },
    ui: {
      registerDrawerTab: () => ({ root: drawer, destroy() {} }),
      showConfirm: async () => ({ confirmed: true }),
      showModal() {
        let dismiss
        harness.modal = { root: new FakeElement(), onDismiss(handler) { dismiss = handler }, dismiss() { dismiss?.() } }
        return harness.modal
      },
    },
  })
  harness.find = (predicate) => findElement(harness.modal.root, predicate)
  harness.open = async () => {
    await findElement(drawer, (el) => el.textContent === 'Open Image Browser').dispatch('click')
    await flush()
  }
  harness.selectAndDelete = async () => {
    const checkbox = harness.find((el) => el.className === 'lib-check').children[0]
    checkbox.checked = true
    checkbox.dispatch('change')
    harness.find((el) => el.textContent.startsWith('Delete unused (')).dispatch('click')
    await flush()
  }
  t.after(() => {
    teardown()
    for (const [key, descriptor] of Object.entries(originals)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else delete globalThis[key]
    }
  })
  return harness
}

test('opening restores account state before listing, saves navigation, and reloads on account switch', async (t) => {
  const h = browserHarness(t)
  await h.open()
  assert.equal(h.requests.find((r) => r.type === 'image_browser_list').offset, 120)
  assert.ok(h.find((el) => el.className === 'lib-reference-badge'))
  h.find((el) => el.textContent === 'Next').dispatch('click')
  await flush()
  assert.equal(h.accounts.get('alice').lastPage, 4)
  const filter = h.find((el) => el.type === 'radio' && el.value === 'all')
  filter.checked = true
  filter.dispatch('change')
  await flush()
  assert.equal(h.accounts.get('alice').lastPage, 1)
  assert.equal(h.accounts.get('alice').imageFilter, 'all')
  h.modal.dismiss()
  h.account = 'bob'
  await h.open()
  assert.equal(h.find((el) => el.className === 'lib-reference-badge'), undefined)
  assert.equal(h.requests.filter((r) => r.type === 'image_browser_list').at(-1).offset, 0)
  h.modal.dismiss()
  h.account = 'alice'
  await h.open()
  assert.ok(h.find((el) => el.className === 'lib-reference-badge'))
})

test('safe deletion saves reference deltas and removes deleted IDs from the account cache', async (t) => {
  const h = browserHarness(t)
  h.account = 'bob'
  await h.open()
  await h.selectAndDelete()
  assert.ok(h.accounts.get('bob').references['image-1'])
  assert.ok(h.find((el) => el.className === 'lib-reference-badge'))
  h.deleted = true
  await h.selectAndDelete()
  assert.equal(h.accounts.get('bob').references['image-1'], undefined)
  assert.equal(h.find((el) => el.className === 'lib-card'), undefined)
  assert.deepEqual(h.requests.filter((r) => r.type === 'image_browser_state_patch').at(-1).patch, {
    protectedIds: [], deletedIds: ['image-1'],
  })
})

test('failed preference load allows browsing without overwriting saved state and reopening retries', async (t) => {
  const h = browserHarness(t)
  h.loadError = true
  await h.open()
  assert.ok(h.requests.some((r) => r.type === 'image_browser_list'))
  assert.equal(h.requests.some((r) => r.type === 'image_browser_state_patch'), false)
  assert.match(h.find((el) => el.className === 'lib-status').textContent, /Could not load saved preferences/)
  h.modal.dismiss()
  h.loadError = false
  await h.open()
  assert.equal(h.requests.filter((r) => r.type === 'image_browser_list').at(-1).offset, 120)
})

test('failed preference saves show a warning while images remain usable', async (t) => {
  const h = browserHarness(t)
  h.saveError = true
  await h.open()
  assert.ok(h.find((el) => el.className === 'lib-card'))
  assert.match(h.find((el) => el.className === 'lib-status').textContent, /Could not save Image Browser preferences/)
  h.saveError = false
  h.find((el) => el.textContent === 'Refresh').dispatch('click')
  await flush()
  assert.doesNotMatch(h.find((el) => el.className === 'lib-status').textContent, /Could not save/)
})
