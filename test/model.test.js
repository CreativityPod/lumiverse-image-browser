import assert from 'node:assert/strict'
import test from 'node:test'
import {
  filterImages,
  formatDimensions,
  getPageWindow,
  isGeneratedImage,
  mapWithConcurrency,
  summarizeDeleteResults,
} from '../src/model.js'

const images = [
  { id: 'a', original_filename: 'image-gen-novelai-1.png', mime_type: 'image/png', width: 1024, height: 1024 },
  { id: 'b', original_filename: 'portrait.webp', mime_type: 'image/webp', owner_chat_id: 'chat-7' },
]

test('filters generated images and searchable ownership metadata', () => {
  assert.equal(isGeneratedImage(images[0]), true)
  assert.equal(isGeneratedImage(images[1]), false)
  assert.deepEqual(filterImages(images, '', true).map((image) => image.id), ['a'])
  assert.deepEqual(filterImages(images, 'CHAT-7', false).map((image) => image.id), ['b'])
  assert.equal(formatDimensions(images[0]), '1024 × 1024')
  assert.equal(formatDimensions(images[1]), 'Dimensions unavailable')
})

test('calculates fixed 60-image page windows without accumulating prior pages', () => {
  assert.deepEqual(getPageWindow(0, 60, 145), {
    start: 1,
    end: 60,
    pageNumber: 1,
    pageCount: 3,
    previousOffset: 0,
    nextOffset: 60,
    hasPrevious: false,
    hasNext: true,
  })
  assert.deepEqual(getPageWindow(60, 60, 145), {
    start: 61,
    end: 120,
    pageNumber: 2,
    pageCount: 3,
    previousOffset: 0,
    nextOffset: 120,
    hasPrevious: true,
    hasNext: true,
  })
  assert.deepEqual(getPageWindow(120, 25, 145), {
    start: 121,
    end: 145,
    pageNumber: 3,
    pageCount: 3,
    previousOffset: 60,
    nextOffset: 180,
    hasPrevious: true,
    hasNext: false,
  })
})

test('summarizes safe-delete outcomes', () => {
  assert.deepEqual(summarizeDeleteResults([
    { status: 'deleted' },
    { status: 'protected' },
    { status: 'protected' },
    { status: 'failed' },
  ]), { deleted: 1, protected: 2, failed: 1 })
})

test('bounded worker preserves result order and concurrency', async () => {
  let active = 0
  let maxActive = 0
  const output = await mapWithConcurrency([1, 2, 3, 4, 5], 2, async (value) => {
    active += 1
    maxActive = Math.max(maxActive, active)
    await new Promise((resolve) => setTimeout(resolve, 2))
    active -= 1
    return value * 10
  })
  assert.deepEqual(output, [10, 20, 30, 40, 50])
  assert.equal(maxActive, 2)
})
