const MAX_PAGE_SIZE = 200
const generatedImageCache = new Map()

function isGeneratedImage(image) {
  return typeof image?.original_filename === 'string'
    && image.original_filename.toLowerCase().startsWith('image-gen-')
}

async function listGeneratedImages(userId) {
  const cached = generatedImageCache.get(userId)
  if (cached) return cached

  const pending = (async () => {
    const generatedImages = []
    let offset = 0
    let total = 0
    do {
      const result = await spindle.images.list({
        limit: MAX_PAGE_SIZE,
        offset,
        specificity: 'sm',
        userId,
      })
      const images = Array.isArray(result.data) ? result.data : []
      total = Math.max(0, Number(result.total) || 0)
      generatedImages.push(...images.filter(isGeneratedImage))
      offset += images.length
      if (images.length === 0) break
    } while (offset < total)
    return generatedImages
  })()

  generatedImageCache.set(userId, pending)
  try {
    return await pending
  } catch (error) {
    generatedImageCache.delete(userId)
    throw error
  }
}

function hasImagesPermission() {
  return spindle.permissions.has('images')
}

function respond(userId, requestId, payload) {
  spindle.sendToFrontend({ requestId, ...payload }, userId)
}

function rejectPermission(userId, requestId) {
  respond(userId, requestId, {
    ok: false,
    error: 'The Image Browser extension needs the Images permission.',
    code: 'IMAGES_PERMISSION_REQUIRED',
  })
}

spindle.onFrontendMessage(async (payload, userId) => {
  if (!payload || typeof payload !== 'object') return
  const requestId = typeof payload.requestId === 'string' ? payload.requestId : undefined

  if (payload.type === 'image_browser_permission') {
    respond(userId, requestId, { ok: true, granted: hasImagesPermission() })
    return
  }

  if (payload.type !== 'image_browser_list' && payload.type !== 'image_browser_get') return
  if (!hasImagesPermission()) {
    rejectPermission(userId, requestId)
    return
  }

  try {
    if (payload.type === 'image_browser_list') {
      const limit = Math.max(1, Math.min(MAX_PAGE_SIZE, Math.trunc(Number(payload.limit)) || 60))
      const offset = Math.max(0, Math.trunc(Number(payload.offset)) || 0)
      const result = payload.generatedOnly === true
        ? await listGeneratedImages(userId).then((images) => ({
            data: images.slice(offset, offset + limit),
            total: images.length,
          }))
        : await spindle.images.list({
            limit,
            offset,
            specificity: 'sm',
            userId,
          })
      respond(userId, requestId, { ok: true, result })
      return
    }

    const imageId = typeof payload.imageId === 'string' ? payload.imageId.trim() : ''
    if (!imageId) throw new Error('imageId is required')
    const image = await spindle.images.get(imageId, { specificity: 'full', userId })
    respond(userId, requestId, { ok: true, result: image })
  } catch (error) {
    respond(userId, requestId, {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    })
  }
})

spindle.permissions.onChanged(({ permission, granted }) => {
  if (permission !== 'images') return
  spindle.sendToFrontend({ type: 'image_browser_permission_changed', granted })
})

for (const eventName of ['IMAGE_UPLOADED', 'IMAGE_DELETED']) {
  spindle.on(eventName, (_payload, userId) => {
    generatedImageCache.delete(userId)
    spindle.sendToFrontend({ type: 'image_browser_assets_changed' }, userId)
  })
}

spindle.log.info('Image Browser loaded.')
