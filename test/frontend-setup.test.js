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
    this.attributes = new Map()
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
  dispatch(name, event = {}) { return this.listeners.get(name)?.(event) }
  removeEventListener(name, handler) {
    if (this.listeners.get(name) === handler) this.listeners.delete(name)
  }
  setAttribute(name, value) { this.attributes.set(name, value) }
  focus() {}
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

    await flush()

    assert.equal(readyCalls, 1)
    assert.equal(sentMessages.length, 2)
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

function browserHarness(t, { widgets = false, nativeSwitch = false, widgetDenied = false, deferState = false, savedWidget = true } = {}) {
  const originals = Object.fromEntries(['window', 'document', 'fetch'].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  const drawer = new FakeElement()
  const requests = []
  const accounts = new Map([
    ['alice', { lastPage: 3, imageFilter: 'generated', showWidget: savedWidget, references: { 'image-1': Date.now() } }],
    ['bob', { lastPage: 1, imageFilter: 'all', showWidget: true, references: {} }],
  ])
  const harness = { account: 'alice', loadError: false, saveError: false, deleted: false, modal: null, requests, accounts, drawer, widgets: [], deferred: [], widgetDenied, deferState }
  harness.items = [{ id: 'image-1', original_filename: 'image-gen-test.png', url: '/image.png' }]
  harness.fullImages = new Map()
  harness.modals = []
  const pointerTarget = new FakeElement()
  Object.defineProperties(globalThis, {
    window: { configurable: true, value: {
      setTimeout, clearTimeout, innerHeight: 800,
      addEventListener: pointerTarget.addEventListener.bind(pointerTarget),
      removeEventListener: pointerTarget.removeEventListener.bind(pointerTarget),
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
        if (harness.deferState) {
          harness.deferred.push(() => receive({ requestId: payload.requestId, ...response }))
          return
        }
      }
      if (payload.type === 'image_browser_list') response.result = {
        data: harness.items, total: 400,
      }
      if (payload.type === 'image_browser_get') response.result = harness.fullImages.get(payload.imageId) || harness.items.find((image) => image.id === payload.imageId)
      if (payload.type === 'image_browser_state_patch') {
        if (harness.saveError) response = { ok: false, error: 'Storage write failed' }
        else {
          const { patch } = payload
          if ('lastPage' in patch) state.lastPage = patch.lastPage
          if ('imageFilter' in patch) state.imageFilter = patch.imageFilter
          if ('showWidget' in patch) state.showWidget = patch.showWidget
          for (const id of patch.protectedIds || []) state.references[id] = Date.now()
          for (const id of patch.deletedIds || []) delete state.references[id]
        }
      }
      receive({ requestId: payload.requestId, ...response })
    },
    ui: {
      ...(widgets ? { createFloatWidget(options) {
        if (harness.widgetDenied) throw new Error('UI panels permission required')
        let dragEnd
        const widget = {
          options, root: new FakeElement(), destroyed: false,
          onDragEnd(handler) { dragEnd = handler; return () => { dragEnd = null } },
          drag() { dragEnd?.() },
          destroy() { this.destroyed = true },
        }
        harness.widgets.push(widget)
        return widget
      } } : {}),
      registerDrawerTab: () => ({ root: drawer, destroy() {} }),
      showConfirm: async () => ({ confirmed: true }),
      showModal() {
        let dismiss
        harness.modal = { root: new FakeElement(), onDismiss(handler) { dismiss = handler }, dismiss() { dismiss?.() } }
        harness.modals.push(harness.modal)
        return harness.modal
      },
    },
    ...(nativeSwitch ? { components: { mountSwitch(_slot, options) {
      const control = { options, update(patch) { Object.assign(this.options, patch) }, destroy() { this.destroyed = true } }
      harness.nativeSwitch = control
      return control
    } } } : {}),
  })
  harness.receive = (payload) => receive(payload)
  harness.teardown = teardown
  harness.pointer = (name, event) => pointerTarget.dispatch(name, event)
  harness.toggle = (checked) => {
    if (harness.nativeSwitch) harness.nativeSwitch.options.onChange(checked)
    else {
      const input = findElement(drawer, (el) => el.type === 'checkbox')
      input.checked = checked
      input.dispatch('change')
    }
  }
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

test('videos show a badge over still thumbnails and real preview metadata updates card dimensions', async (t) => {
  const h = browserHarness(t)
  h.items = [{ id: 'clip', original_filename: 'image-gen-poster.png', mime_type: 'video/mp4', url: '/poster.webp' }]
  h.fullImages.set('clip', { ...h.items[0], url: '/clip.mp4' })
  await h.open()
  const browser = h.modal
  assert.equal(h.find((el) => el.className === 'lib-video-badge').textContent, '▶ Video')
  assert.equal(h.find((el) => el.className === 'lib-thumb').tagName, 'img')
  const button = h.find((el) => el.className === 'lib-preview-button')
  assert.equal(button.title, 'Play video')
  assert.match(button.attributes.get('aria-label'), /video/)
  assert.ok(h.find((el) => el.textContent === 'Dimensions unavailable'))
  button.dispatch('click')
  await flush()
  const video = h.find((el) => el.className === 'lib-full-media')
  assert.equal(video.tagName, 'video')
  assert.equal(video.src, '/clip.mp4')
  assert.equal(video.controls, true)
  assert.equal(video.preload, 'metadata')
  video.videoWidth = 1920
  video.videoHeight = 1080
  video.dispatch('loadedmetadata')
  assert.ok(h.find((el) => el.textContent === '1920 × 1080'))
  assert.ok(findElement(browser.root, (el) => el.textContent === '1920 × 1080'))
  assert.ok(findElement(browser.root, (el) => el.className === 'lib-video-badge'))
})

test('preview uses full media dimensions instead of thumbnail size for images too', async (t) => {
  const h = browserHarness(t)
  await h.open()
  const browser = h.modal
  const thumbnail = h.find((el) => el.className === 'lib-thumb')
  thumbnail.naturalWidth = 200
  thumbnail.naturalHeight = 200
  thumbnail.dispatch('load')
  assert.equal(h.find((el) => el.className === 'lib-video-badge'), undefined)
  assert.equal(h.find((el) => el.textContent === '200 × 200'), undefined)
  h.find((el) => el.className === 'lib-preview-button').dispatch('click')
  await flush()
  const image = h.find((el) => el.className === 'lib-full-media')
  assert.equal(image.tagName, 'img')
  image.naturalWidth = 1200
  image.naturalHeight = 800
  image.dispatch('load')
  assert.ok(findElement(browser.root, (el) => el.textContent === '1200 × 800'))
})

test('late video metadata from previous or dismissed previews cannot change dimensions', async (t) => {
  const h = browserHarness(t)
  h.account = 'bob'
  h.items = [
    { id: 'clip-1', mime_type: 'video/mp4', url: '/one.mp4' },
    { id: 'clip-2', mime_type: 'video/mp4', url: '/two.mp4' },
  ]
  await h.open()
  const browser = h.modal
  h.find((el) => el.className === 'lib-preview-button').dispatch('click')
  await flush()
  const first = h.find((el) => el.className === 'lib-full-media')
  h.find((el) => el.className === 'lib-preview-nav lib-preview-nav-next').dispatch('click')
  await flush()
  first.videoWidth = 1111
  first.videoHeight = 777
  first.dispatch('loadedmetadata')
  assert.equal(findElement(browser.root, (el) => el.textContent === '1111 × 777'), undefined)
  const second = h.find((el) => el.className === 'lib-full-media')
  second.dispatch('loadedmetadata')
  assert.ok(h.find((el) => el.textContent === 'Dimensions unavailable'))
  h.modal.dismiss()
  second.videoWidth = 2222
  second.videoHeight = 888
  second.dispatch('loadedmetadata')
  assert.equal(findElement(browser.root, (el) => el.textContent === '2222 × 888'), undefined)
})

test('stored full dimensions update the card and preview without waiting for playback metadata', async (t) => {
  const h = browserHarness(t)
  h.account = 'bob'
  h.items = [{ id: 'clip', mime_type: 'video/webm', url: '/poster.webp' }]
  h.fullImages.set('clip', { ...h.items[0], url: '/clip.webm', width: 1280, height: 720 })
  await h.open()
  const browser = h.modal
  h.find((el) => el.className === 'lib-preview-button').dispatch('click')
  await flush()
  assert.ok(h.find((el) => el.textContent === '1280 × 720'))
  assert.ok(findElement(browser.root, (el) => el.textContent === '1280 × 720'))
})

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

test('floating image icon opens the browser directly and remembers host geometry', async (t) => {
  const h = browserHarness(t, { widgets: true })
  await flush()
  assert.equal(h.widgets.length, 1)
  const widget = h.widgets[0]
  assert.equal(widget.options.persistGeometry, 'image-browser-launcher')
  assert.equal(widget.options.snapToEdge, true)
  assert.equal(widget.options.chromeless, true)
  const button = widget.root.children[0]
  assert.equal(button.type, 'button')
  assert.match(button.innerHTML, /<svg/)
  await button.dispatch('click')
  await flush()
  assert.ok(h.find((el) => el.className === 'lib-card'))
  const modal = h.modal
  await button.dispatch('click')
  assert.equal(h.modal, modal)
})

test('drag release does not open the browser while pointer and keyboard clicks do', async (t) => {
  const h = browserHarness(t, { widgets: true })
  await flush()
  const widget = h.widgets[0]
  const button = widget.root.children[0]
  let prevented = 0
  const click = { preventDefault() { prevented++ }, stopPropagation() {} }
  button.dispatch('pointerdown', { pointerId: 1, clientX: 12, clientY: 100 })
  h.pointer('pointermove', { pointerId: 1, clientX: 30, clientY: 100 })
  h.pointer('pointerup', { pointerId: 1 })
  button.dispatch('click', click)
  assert.equal(prevented, 1)
  assert.equal(h.modal, null)
  widget.drag()
  button.dispatch('click', click)
  assert.equal(prevented, 2)
  assert.equal(h.modal, null)
  // Native keyboard activation emits a click without a pointerdown.
  await button.dispatch('click')
  assert.ok(h.modal)
  h.modal.dismiss()
  button.dispatch('pointerdown', { pointerId: 2, clientX: 12, clientY: 100 })
  h.pointer('pointermove', { pointerId: 2, clientX: 14, clientY: 101 })
  h.pointer('pointerup', { pointerId: 2 })
  await button.dispatch('click')
  assert.ok(h.modal)
})

test('Show Widget hides immediately and saves only its own preference', async (t) => {
  const h = browserHarness(t, { widgets: true })
  await flush()
  const first = h.widgets[0]
  h.toggle(false)
  assert.equal(first.destroyed, true)
  await flush()
  assert.equal(h.accounts.get('alice').showWidget, false)
  assert.deepEqual(h.requests.filter((r) => r.type === 'image_browser_state_patch').at(-1).patch, { showWidget: false })
  assert.equal(h.accounts.get('alice').lastPage, 3)
  h.toggle(true)
  assert.equal(h.widgets.length, 2)
  await flush()
  assert.equal(h.accounts.get('alice').showWidget, true)
  h.teardown()
  assert.equal(h.widgets[1].destroyed, true)
  assert.equal(first.root.children[0].listeners.size, 0)
})

test('startup waits for saved visibility without briefly showing a disabled widget', async (t) => {
  const h = browserHarness(t, { widgets: true, savedWidget: false, deferState: true })
  await flush()
  assert.equal(h.widgets.length, 0)
  h.deferred.shift()()
  await flush()
  assert.equal(h.widgets.length, 0)
  assert.equal(findElement(h.drawer, (el) => el.type === 'checkbox').checked, false)
  h.toggle(true)
  await flush()
  assert.equal(h.widgets.length, 1)
})

test('native Show Widget switch updates immediately and rapid toggles save in order', async (t) => {
  const h = browserHarness(t, { widgets: true, nativeSwitch: true })
  await flush()
  assert.equal(h.nativeSwitch.options.ariaLabel, 'Show Widget')
  assert.equal(h.nativeSwitch.options.disabled, false)
  h.toggle(false)
  assert.equal(h.nativeSwitch.options.checked, false)
  h.toggle(true)
  h.toggle(false)
  await flush()
  assert.equal(h.accounts.get('alice').showWidget, false)
  assert.deepEqual(h.requests.filter((r) => r.type === 'image_browser_state_patch').map((r) => r.patch), [
    { showWidget: false }, { showWidget: true }, { showWidget: false },
  ])
  h.teardown()
  assert.equal(h.nativeSwitch.destroyed, true)
})

test('denied widget permission keeps browsing usable and can recover on grant', async (t) => {
  const h = browserHarness(t, { widgets: true, widgetDenied: true })
  await flush()
  assert.match(findElement(h.drawer, (el) => el.className === 'lib-widget-hint').textContent, /UI panels permission/)
  await h.open()
  assert.ok(h.find((el) => el.className === 'lib-card'))
  h.widgetDenied = false
  h.receive({ type: 'image_browser_permission_changed', permission: 'ui_panels', granted: true })
  assert.equal(h.widgets.length, 1)
  h.receive({ type: 'image_browser_permission_changed', permission: 'ui_panels', granted: false })
  assert.equal(h.widgets[0].destroyed, true)
  h.receive({ type: 'image_browser_permission_changed', permission: 'ui_panels', granted: true })
  assert.equal(h.widgets.length, 2)
  h.receive({ type: 'image_browser_permission_changed', permission: 'images', granted: false })
  assert.equal(h.widgets[1].destroyed, true)
  assert.equal(findElement(h.drawer, (el) => el.type === 'checkbox').disabled, true)
  h.receive({ type: 'image_browser_permission_changed', permission: 'images', granted: true })
  await flush()
  assert.equal(h.widgets.length, 3)
})

test('late preference reads cannot undo a toggle or create widgets after unloading', async (t) => {
  const h = browserHarness(t, { widgets: true })
  await flush()
  h.deferState = true
  const opening = h.open()
  h.toggle(false)
  await flush()
  h.deferred.shift()()
  await opening
  assert.equal(h.widgets.length, 1)
  assert.equal(h.widgets[0].destroyed, true)
  assert.equal(findElement(h.drawer, (el) => el.type === 'checkbox').checked, false)
  h.receive({ type: 'image_browser_permission_changed', permission: 'images', granted: true })
  await flush()
  h.teardown()
  h.deferred.shift()()
  await flush()
  assert.equal(h.widgets.length, 1)
})

test('failed widget saves show a warning without undoing immediate visibility', async (t) => {
  const h = browserHarness(t, { widgets: true })
  await flush()
  h.saveError = true
  h.toggle(false)
  await flush()
  assert.equal(h.widgets[0].destroyed, true)
  assert.equal(h.accounts.get('alice').showWidget, true)
  assert.match(findElement(h.drawer, (el) => el.className === 'lib-widget-hint').textContent, /Could not save the widget preference/)
  h.saveError = false
  h.toggle(true)
  await flush()
  assert.doesNotMatch(findElement(h.drawer, (el) => el.className === 'lib-widget-hint').textContent, /Could not save/)
})

test('opening while a widget save is queued cannot restore the previously saved visibility', async (t) => {
  const h = browserHarness(t, { widgets: true })
  await flush()
  h.toggle(false)
  await h.open()
  assert.equal(h.widgets.length, 1)
  assert.equal(h.widgets[0].destroyed, true)
  assert.equal(findElement(h.drawer, (el) => el.type === 'checkbox').checked, false)
})
