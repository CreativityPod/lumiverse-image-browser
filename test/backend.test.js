import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

async function createHarness(permission = true, listImplementation = null, stored = new Map()) {
  const source = await readFile(new URL('../dist/backend.js', import.meta.url), 'utf8')
  let frontendHandler
  const sent = []
  const listCalls = []
  const getCalls = []
  const eventHandlers = new Map()
  const storageCalls = []
  const storageErrors = { read: false, write: false }
  const spindle = {
    permissions: {
      has: (name) => name === 'images' && permission,
      onChanged: () => undefined,
    },
    onFrontendMessage: (handler) => { frontendHandler = handler },
    sendToFrontend: (payload, userId) => sent.push({ payload, userId }),
    images: {
      list: async (options) => {
        listCalls.push(options)
        return listImplementation
          ? listImplementation(options)
          : { data: [{ id: 'image-1' }], total: 1 }
      },
      get: async (id, options) => {
        getCalls.push({ id, options })
        return { id, url: `/api/v1/images/${id}` }
      },
    },
    userStorage: {
      exists: async (path, userId) => {
        storageCalls.push({ method: 'exists', path, userId })
        if (storageErrors.read) throw new Error('Storage unavailable')
        return stored.has(`${userId}/${path}`)
      },
      getJson: async (path, { userId }) => {
        storageCalls.push({ method: 'getJson', path, userId })
        return JSON.parse(stored.get(`${userId}/${path}`))
      },
      setJson: async (path, value, { userId }) => {
        storageCalls.push({ method: 'setJson', path, userId })
        if (storageErrors.write) throw new Error('Storage write failed')
        stored.set(`${userId}/${path}`, JSON.stringify(value))
      },
    },
    on: (eventName, handler) => eventHandlers.set(eventName, handler),
    log: { info: () => undefined },
  }
  vm.runInNewContext(source, { spindle, Error, Number, Math, String })
  return { frontendHandler, sent, listCalls, getCalls, eventHandlers, stored, storageCalls, storageErrors }
}

test('state persists across backend restarts and is isolated by authenticated account', async () => {
  const harness = await createHarness()
  await harness.frontendHandler({ type: 'image_browser_state_patch', userId: 'bob', patch: {
    lastPage: 4, imageFilter: 'generated', protectedIds: ['alice-image'],
  } }, 'alice')
  assert.ok(harness.storageCalls.every((call) => call.userId === 'alice'))
  const restarted = await createHarness(true, null, harness.stored)
  await restarted.frontendHandler({ type: 'image_browser_state_get' }, 'bob')
  assert.deepEqual(JSON.parse(JSON.stringify(restarted.sent[0].payload.result)), {
    version: 1, lastPage: 1, imageFilter: 'all', references: {},
  })
  await restarted.frontendHandler({ type: 'image_browser_state_get' }, 'alice')
  const state = restarted.sent[1].payload.result
  assert.equal(state.lastPage, 4)
  assert.equal(state.imageFilter, 'generated')
  assert.equal(typeof state.references['alice-image'], 'number')
  assert.equal(restarted.sent[1].userId, 'alice')
})

test('concurrent incremental updates preserve other tabs preferences and references', async () => {
  const harness = await createHarness()
  await Promise.all([
    { lastPage: 3 },
    { imageFilter: 'non-generated' },
    { protectedIds: ['image-a'] },
    { protectedIds: ['image-b'] },
    { deletedIds: ['image-a'] },
  ].map((patch) => harness.frontendHandler({ type: 'image_browser_state_patch', patch }, 'alice')))
  const state = JSON.parse(harness.stored.get('alice/state.json'))
  assert.equal(state.lastPage, 3)
  assert.equal(state.imageFilter, 'non-generated')
  assert.deepEqual(Object.keys(state.references), ['image-b'])
})

test('reference cache expires and stays bounded while invalid preferences use defaults', async () => {
  const now = Date.now()
  const references = Object.fromEntries(Array.from({ length: 2001 }, (_, i) => [`image-${i}`, now - i]))
  references.expired = now - 91 * 24 * 60 * 60 * 1000
  references.future = now + 100_000
  references.invalid = 'yesterday'
  const stored = new Map([['alice/state.json', JSON.stringify({
    version: 1, lastPage: -4, imageFilter: 'bad', references,
  })]])
  const harness = await createHarness(true, null, stored)
  await harness.frontendHandler({ type: 'image_browser_state_get' }, 'alice')
  const state = harness.sent[0].payload.result
  assert.equal(state.lastPage, 1)
  assert.equal(state.imageFilter, 'all')
  assert.equal(Object.keys(state.references).length, 2000)
  for (const key of ['expired', 'future', 'invalid', 'image-2000']) assert.equal(state.references[key], undefined)
})

test('failed reads, corrupt JSON, invalid patches and failed writes do not overwrite saved state', async () => {
  const stored = new Map([['alice/state.json', '{broken']])
  const harness = await createHarness(true, null, stored)
  await harness.frontendHandler({ type: 'image_browser_state_patch', patch: { lastPage: 2 } }, 'alice')
  assert.equal(harness.sent.at(-1).payload.ok, false)
  assert.equal(stored.get('alice/state.json'), '{broken')
  stored.delete('alice/state.json')
  harness.storageErrors.read = true
  await harness.frontendHandler({ type: 'image_browser_state_get' }, 'alice')
  assert.equal(harness.sent.at(-1).payload.ok, false)
  harness.storageErrors.read = false
  harness.storageErrors.write = true
  await harness.frontendHandler({ type: 'image_browser_state_patch', patch: { lastPage: 2 } }, 'alice')
  assert.equal(harness.sent.at(-1).payload.ok, false)
  harness.storageErrors.write = false
  for (const patch of [{ lastPage: 0 }, { imageFilter: 'bad' }, { protectedIds: [null] }]) {
    await harness.frontendHandler({ type: 'image_browser_state_patch', patch }, 'alice')
    assert.equal(harness.sent.at(-1).payload.ok, false)
  }
  assert.equal(stored.size, 0)
  await harness.frontendHandler({ type: 'image_browser_state_patch', patch: { lastPage: 2 } }, 'alice')
  assert.equal(harness.sent.at(-1).payload.ok, true)
  assert.equal(JSON.parse(stored.get('alice/state.json')).lastPage, 2)
})

test('state access requires a user identity and the Images permission', async () => {
  const harness = await createHarness(false)
  await harness.frontendHandler({ type: 'image_browser_state_get' }, 'alice')
  assert.equal(harness.sent.at(-1).payload.code, 'IMAGES_PERMISSION_REQUIRED')
  await harness.frontendHandler({ type: 'image_browser_state_patch', patch: { lastPage: 2 } }, undefined)
  assert.equal(harness.storageCalls.length, 0)
})

test('lists small thumbnails for the requesting user', async () => {
  const harness = await createHarness(true)
  await harness.frontendHandler({ type: 'image_browser_list', requestId: 'r1', limit: 60, offset: 0 }, 'user-1')
  assert.deepEqual(
    JSON.parse(JSON.stringify(harness.listCalls[0])),
    { limit: 60, offset: 0, specificity: 'sm', userId: 'user-1' },
  )
  assert.equal(harness.sent[0].payload.ok, true)
  assert.equal(harness.sent[0].payload.result.total, 1)
})

test('gets a full image for preview', async () => {
  const harness = await createHarness(true)
  await harness.frontendHandler({ type: 'image_browser_get', requestId: 'r2', imageId: 'image-1' }, 'user-1')
  assert.deepEqual(
    JSON.parse(JSON.stringify(harness.getCalls[0])),
    { id: 'image-1', options: { specificity: 'full', userId: 'user-1' } },
  )
  assert.equal(harness.sent[0].payload.result.url, '/api/v1/images/image-1')
})

test('paginates generated and non-generated images from one invalidated classification cache', async () => {
  const allImages = [
    { id: 'regular-1', original_filename: 'portrait.png' },
    { id: 'generated-1', original_filename: 'image-gen-first.png' },
    { id: 'regular-2', original_filename: 'photo.webp' },
    { id: 'generated-2', original_filename: 'IMAGE-GEN-second.png' },
  ]
  const harness = await createHarness(true, (options) => ({
    data: allImages.slice(options.offset, options.offset + options.limit),
    total: allImages.length,
  }))

  await harness.frontendHandler({
    type: 'image_browser_list',
    requestId: 'generated-1',
    limit: 1,
    offset: 1,
    imageFilter: 'generated',
  }, 'user-1')

  assert.equal(harness.listCalls.length, 1)
  assert.equal(harness.listCalls[0].limit, 200)
  assert.equal(harness.sent[0].payload.result.total, 2)
  assert.deepEqual(
    JSON.parse(JSON.stringify(harness.sent[0].payload.result.data)),
    [allImages[3]],
  )

  await harness.frontendHandler({
    type: 'image_browser_list',
    requestId: 'non-generated-1',
    limit: 1,
    offset: 0,
    imageFilter: 'non-generated',
  }, 'user-1')
  assert.equal(harness.listCalls.length, 1)
  assert.equal(harness.sent[1].payload.result.total, 2)
  assert.deepEqual(
    JSON.parse(JSON.stringify(harness.sent[1].payload.result.data)),
    [allImages[0]],
  )

  harness.eventHandlers.get('IMAGE_UPLOADED')({}, 'user-1')
  await harness.frontendHandler({
    type: 'image_browser_list',
    requestId: 'generated-3',
    imageFilter: 'generated',
  }, 'user-1')
  assert.equal(harness.listCalls.length, 2)
})

test('refuses image reads when permission is absent', async () => {
  const harness = await createHarness(false)
  await harness.frontendHandler({ type: 'image_browser_list', requestId: 'r3' }, 'user-1')
  assert.equal(harness.listCalls.length, 0)
  assert.equal(harness.sent[0].payload.code, 'IMAGES_PERMISSION_REQUIRED')
})
