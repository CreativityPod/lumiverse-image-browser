import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

async function createHarness(permission = true, listImplementation = null) {
  const source = await readFile(new URL('../dist/backend.js', import.meta.url), 'utf8')
  let frontendHandler
  const sent = []
  const listCalls = []
  const getCalls = []
  const eventHandlers = new Map()
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
    on: (eventName, handler) => eventHandlers.set(eventName, handler),
    log: { info: () => undefined },
  }
  vm.runInNewContext(source, { spindle, Error, Number, Math, String })
  return { frontendHandler, sent, listCalls, getCalls, eventHandlers }
}

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
