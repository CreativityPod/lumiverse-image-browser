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
  scrollIntoView(options) { this.scrollOptions = options }
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

test('QuickGen picker replaces selection, excludes videos, and sends one confirmed image', async (t) => {
  const h = browserHarness(t)
  h.items = [
    { id: 'one', original_filename: 'first.png', mime_type: 'image/png', url: '/first.png' },
    { id: 'two', original_filename: 'second.png', mime_type: 'image/png', url: '/second.png' },
    { id: 'clip', original_filename: 'video.png', mime_type: 'video/mp4', url: '/poster.png' },
  ]
  await h.pickerOpen()
  assert.ok(h.find((el) => el.textContent === 'Choose one image.'))
  assert.equal(h.find((el) => el.textContent === 'Select visible'), undefined)
  assert.equal(h.find((el) => el.textContent.startsWith('Delete unused (')), undefined)
  assert.equal(h.find((el) => el.textContent === 'video.png'), undefined)
  assert.equal(h.find((el) => el.textContent === 'Use image').disabled, true)
  for (const filename of ['first.png', 'second.png']) {
    const radio = h.find((el) => el.attributes?.get('aria-label') === `Select ${filename}`)
    radio.checked = true
    radio.dispatch('change')
  }
  assert.ok(h.find((el) => el.textContent === 'Selected: second.png'))
  assert.equal(h.find((el) => el.textContent === '1 selected').textContent, '1 selected')
  assert.equal(h.find((el) => el.type === 'radio' && el.name === 'image-browser-picker-selection').checked, false)
  h.find((el) => el.textContent === 'Next').dispatch('click')
  await flush()
  assert.ok(h.find((el) => el.textContent === 'Selected: second.png'))
  h.find((el) => el.textContent === 'Use image').dispatch('click')
  await flush()
  const selected = h.eventMessages.filter(({ payload }) => payload.status === 'selected')
  assert.equal(selected.length, 1)
  assert.equal(selected[0].payload.imageId, 'two')
  assert.equal(selected[0].payload.requestId, 'pick-1')
  assert.equal(h.eventMessages.filter(({ payload }) => payload.status === 'cancelled').length, 0)
  assert.ok(h.requests.filter((request) => request.type === 'image_browser_list').every((request) => request.picker === true))
  assert.equal(h.requests.filter((request) => request.type === 'image_browser_state_patch').length, 0)
})

test('picker cancel and dismiss each report cancellation without selecting an image', async (t) => {
  const h = browserHarness(t)
  await h.pickerOpen('cancel-button')
  h.find((el) => el.textContent === 'Cancel').dispatch('click')
  await h.pickerOpen('dismiss')
  h.modal.dismiss()
  const cancelled = h.eventMessages.filter(({ payload }) => payload.status === 'cancelled')
  assert.deepEqual(cancelled.map(({ payload }) => payload.requestId), ['cancel-button', 'dismiss'])
  assert.equal(h.eventMessages.filter(({ payload }) => payload.status === 'selected').length, 0)
})

test('picker thumbnails use the shared preview and navigation without changing selection', async (t) => {
  const h = browserHarness(t)
  h.items = [
    { id: 'one', original_filename: 'image-gen-first.png', mime_type: 'image/png', url: '/first.png' },
    { id: 'two', original_filename: 'image-gen-second.png', mime_type: 'image/png', url: '/second.png' },
  ]
  h.fullImages.set('one', { ...h.items[0], url: '/first-full.png' })
  h.fullImages.set('two', { ...h.items[1], url: '/second-full.png' })
  await h.pickerOpen()
  const picker = h.modal
  const findInPicker = (predicate) => findElement(picker.root, predicate)
  assert.equal(findInPicker((el) => el.textContent === 'Preview'), undefined)
  const radio = findInPicker((el) => el.attributes?.get('aria-label') === 'Select image-gen-second.png')
  radio.checked = true
  radio.dispatch('change')
  const thumbnail = findInPicker((el) => el.attributes?.get('aria-label') === 'Preview image-gen-first.png')
  assert.equal(thumbnail.title, 'Open full image')
  thumbnail.dispatch('click')
  await flush()
  const preview = h.modal
  assert.notEqual(preview, picker)
  assert.equal(h.find((el) => el.className === 'lib-full-media').src, '/first-full.png')
  h.find((el) => el.attributes?.get('aria-label') === 'Next image').dispatch('click')
  await flush()
  assert.equal(h.find((el) => el.className === 'lib-full-media').src, '/second-full.png')
  preview.dismiss()
  assert.ok(findInPicker((el) => el.textContent === 'Selected: image-gen-second.png'))
  findInPicker((el) => el.textContent === 'Use image').dispatch('click')
  await flush()
  assert.equal(h.eventMessages.filter(({ payload }) => payload.status === 'selected').at(-1).payload.imageId, 'two')
})

for (const loadError of [false, true]) {
  test(`picker defaults to generated images when saved preferences ${loadError ? 'fail to load' : 'use All'}`, async (t) => {
    const h = browserHarness(t)
    h.account = 'bob'
    h.accounts.get('bob').lastPage = 3
    h.loadError = loadError
    await h.pickerOpen()
    let request = h.requests.filter((request) => request.type === 'image_browser_list').at(-1)
    assert.equal(request.imageFilter, 'generated')
    assert.equal(request.offset, 0)
    assert.equal(h.find((el) => el.name === 'image-browser-type-filter' && el.value === 'generated').checked, true)
    const all = h.find((el) => el.name === 'image-browser-type-filter' && el.value === 'all')
    all.checked = true
    all.dispatch('change')
    await flush()
    request = h.requests.filter((request) => request.type === 'image_browser_list').at(-1)
    assert.equal(request.imageFilter, 'all')
    assert.equal(request.offset, 0)
    assert.equal(h.requests.filter((request) => request.type === 'image_browser_state_patch').length, 0)
    h.find((el) => el.textContent === 'Cancel').dispatch('click')
    await h.pickerOpen('reopened')
    request = h.requests.filter((request) => request.type === 'image_browser_list').at(-1)
    assert.equal(request.imageFilter, 'generated')
    assert.equal(request.offset, 0)
    assert.equal(h.accounts.get('bob').imageFilter, 'all')
    assert.equal(h.accounts.get('bob').lastPage, 3)
  })
}

test('picker search requests library-wide matches from the first page', async (t) => {
  const h = browserHarness(t)
  await h.pickerOpen()
  h.find((el) => el.textContent === 'Next').dispatch('click')
  await flush()
  const search = h.find((el) => el.className === 'lib-search')
  search.value = 'older image'
  search.dispatch('input')
  await new Promise((resolve) => setTimeout(resolve, 270))
  const request = h.requests.filter((request) => request.type === 'image_browser_list').at(-1)
  assert.equal(request.picker, true)
  assert.equal(request.imageFilter, 'generated')
  assert.equal(request.query, 'older image')
  assert.equal(request.offset, 0)
})

for (const imageFilter of ['generated', 'non-generated']) {
  test(`picker restores and reveals a selected ${imageFilter} image, then allows ordinary navigation`, async (t) => {
    const h = browserHarness(t)
    h.loadError = true
    const selected = { id: 'selected', original_filename: imageFilter === 'generated' ? 'image-gen-selected.png' : 'portrait.png', mime_type: 'image/png', url: '/selected.png' }
    const other = { id: 'other', original_filename: 'other.png', mime_type: 'image/png', url: '/other.png' }
    h.items = [other, selected]
    h.listResult = (request) => request.selectedImageId
      ? { data: h.items, total: 200, offset: 120, imageFilter }
      : { data: [other], total: 200 }
    await h.pickerOpen('restore', selected.id)
    const request = h.requests.filter((request) => request.type === 'image_browser_list').at(-1)
    assert.equal(request.selectedImageId, selected.id)
    assert.equal(request.query, '')
    assert.equal(h.find((el) => el.className === 'lib-page-input').value, '3')
    assert.equal(h.find((el) => el.name === 'image-browser-type-filter' && el.value === imageFilter).checked, true)
    assert.equal(h.find((el) => el.attributes?.get('aria-label') === `Select ${selected.original_filename}`).checked, true)
    const card = h.find((el) => el.className === 'lib-card' && el.dataset.selected === 'true')
    assert.deepEqual(card.scrollOptions, { block: 'nearest', inline: 'nearest' })
    assert.ok(h.find((el) => el.textContent === `Selected: ${selected.original_filename}`))
    assert.equal(h.find((el) => el.textContent === 'Use image').disabled, false)
    h.find((el) => el.textContent === 'Next').dispatch('click')
    await flush()
    const next = h.requests.filter((request) => request.type === 'image_browser_list').at(-1)
    assert.equal(next.offset, 180)
    assert.equal(next.imageFilter, imageFilter)
    assert.equal(next.selectedImageId, undefined)
    assert.ok(h.find((el) => el.textContent === `Selected: ${selected.original_filename}`))
    assert.equal(h.requests.filter((request) => request.type === 'image_browser_state_patch').length, 0)
    h.find((el) => el.textContent === 'Use image').dispatch('click')
    await flush()
    assert.equal(h.eventMessages.filter(({ payload }) => payload.status === 'selected').at(-1).payload.imageId, selected.id)
  })
}

test('unavailable selected image reopens Generated page one with a notice and no selection', async (t) => {
  const h = browserHarness(t)
  h.account = 'bob'
  h.listResult = () => ({ data: h.items, total: 200, offset: 0, imageFilter: 'generated' })
  await h.pickerOpen('missing', 'missing-image')
  assert.equal(h.find((el) => el.className === 'lib-page-input').value, '1')
  assert.equal(h.find((el) => el.name === 'image-browser-type-filter' && el.value === 'generated').checked, true)
  assert.ok(h.find((el) => el.textContent === 'Choose one image.'))
  assert.ok(h.find((el) => el.className === 'lib-status').textContent.includes('previously selected image is unavailable'))
  assert.equal(h.find((el) => el.className === 'lib-status').dataset.tone, 'warning')
  assert.equal(h.find((el) => el.textContent === 'Use image').disabled, true)
  assert.equal(h.find((el) => el.className === 'lib-card' && el.dataset.selected === 'true'), undefined)
  h.find((el) => el.textContent === 'Next').dispatch('click')
  await flush()
  assert.equal(h.find((el) => el.className === 'lib-status').textContent.includes('unavailable'), false)
  assert.equal(h.accounts.get('bob').imageFilter, 'all')
  assert.equal(h.eventMessages.filter(({ payload }) => payload.status === 'selected').length, 0)
})

test('late restoration after cancelling cannot select or scroll an image in a new picker', async (t) => {
  const h = browserHarness(t)
  h.deferList = true
  h.listResult = () => ({ data: h.items, total: 200, offset: 60, imageFilter: 'generated' })
  await h.pickerOpen('old', 'image-1')
  const respond = h.deferredLists.shift()
  h.find((el) => el.textContent === 'Cancel').dispatch('click')
  h.deferList = false
  await h.pickerOpen('new')
  respond()
  await flush()
  assert.ok(h.find((el) => el.textContent === 'Choose one image.'))
  assert.equal(h.find((el) => el.className === 'lib-page-input').value, '1')
  assert.equal(h.find((el) => el.className === 'lib-card').scrollOptions, undefined)
  assert.equal(h.eventMessages.filter(({ payload }) => payload.status === 'selected').length, 0)
})

test('picker refuses deleted or video sources at confirmation and handles requester cancellation', async (t) => {
  const h = browserHarness(t)
  await h.pickerOpen()
  const radio = h.find((el) => el.name === 'image-browser-picker-selection')
  radio.checked = true
  radio.dispatch('change')
  h.fullImages.set('image-1', { id: 'image-1', mime_type: 'video/mp4' })
  h.find((el) => el.textContent === 'Use image').dispatch('click')
  await flush()
  assert.ok(h.find((el) => el.textContent.includes('This image is unavailable.')))
  assert.equal(h.eventMessages.filter(({ payload }) => payload.status === 'selected').length, 0)
  h.emit('image_browser:picker:cancel', { version: 1, requester: 'quick_gen', requestId: 'pick-1' })
  assert.equal(h.eventMessages.filter(({ payload }) => payload.status === 'cancelled').length, 1)
})

test('picker advertises readiness and rejects requests while management is open', async (t) => {
  const h = browserHarness(t)
  await h.open()
  h.emit('image_browser:picker:probe', { version: 1, requester: 'quick_gen' })
  assert.equal(h.eventMessages.at(-1).payload.available, true)
  h.emit('image_browser:picker:request', { version: 1, requester: 'quick_gen', requestId: 'busy' })
  assert.equal(h.eventMessages.at(-1).payload.status, 'error')
  assert.match(h.eventMessages.at(-1).payload.error, /already open/)
  h.teardown()
  assert.equal(h.eventMessages.filter(({ name }) => name === 'image_browser:picker:availability').at(-1).payload.available, false)
})

function browserHarness(t, { widgets = false, nativeSwitch = false, widgetDenied = false, deferState = false, savedWidget = true } = {}) {
  const originals = Object.fromEntries(['window', 'document', 'fetch'].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  const drawer = new FakeElement()
  const requests = []
  const accounts = new Map([
    ['alice', { lastPage: 3, imageFilter: 'generated', showWidget: savedWidget, references: { 'image-1': Date.now() } }],
    ['bob', { lastPage: 1, imageFilter: 'all', showWidget: true, references: {} }],
  ])
  const harness = { account: 'alice', loadError: false, saveError: false, deleted: false, modal: null, requests, accounts, drawer, widgets: [], deferred: [], widgetDenied, deferState }
  harness.items = [{ id: 'image-1', original_filename: 'image-gen-test.png', mime_type: 'image/png', url: '/image.png' }]
  harness.deferredLists = []
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
  const eventHandlers = new Map()
  const eventMessages = []
  const emit = (name, payload) => {
    eventMessages.push({ name, payload })
    for (const handler of [...(eventHandlers.get(name) || [])]) handler(payload)
  }
  const teardown = setup({
    events: {
      on(name, handler) {
        if (!eventHandlers.has(name)) eventHandlers.set(name, new Set())
        eventHandlers.get(name).add(handler)
        return () => eventHandlers.get(name).delete(handler)
      },
      emit,
    },
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
      if (payload.type === 'image_browser_list') {
        response.result = harness.listResult ? harness.listResult(payload) : { data: harness.items, total: 400 }
        if (harness.deferList) {
          harness.deferredLists.push(() => receive({ requestId: payload.requestId, ...response }))
          return
        }
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
  harness.emit = emit
  harness.eventMessages = eventMessages
  harness.pickerOpen = async (requestId = 'pick-1', selectedImageId) => {
    await flush()
    emit('image_browser:picker:request', { version: 1, requester: 'quick_gen', requestId, ...(selectedImageId ? { selectedImageId } : {}) })
    await flush()
  }
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
