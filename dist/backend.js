const MAX_PAGE_SIZE = 200
const classifiedImageCache = new Map()
const stateOperations = new Map()
const STATE_PATH = 'state.json'
const REFERENCE_TTL_MS = 90 * 24 * 60 * 60 * 1000
const MAX_REFERENCES = 2_000

function validImageId(id) {
  return typeof id === 'string' && id.length > 0 && id.length <= 256
}

function normalizeState(value, now = Date.now()) {
  const state = value?.version === 1 ? value : {}
  const references = state.references && typeof state.references === 'object' && !Array.isArray(state.references)
    ? Object.entries(state.references)
    : []
  return {
    version: 1,
    lastPage: Number.isSafeInteger(state.lastPage) && state.lastPage > 0 ? state.lastPage : 1,
    imageFilter: ['all', 'generated', 'non-generated'].includes(state.imageFilter) ? state.imageFilter : 'all',
    references: Object.fromEntries(references
      .filter(([id, time]) => validImageId(id) && Number.isFinite(time) && time >= now - REFERENCE_TTL_MS && time <= now)
      .sort((a, b) => b[1] - a[1])
      .slice(0, MAX_REFERENCES)),
  }
}

// Queue reads and incremental writes together so tabs cannot lose each other's updates.
function withUserState(userId, operation) {
  const previous = stateOperations.get(userId) || Promise.resolve()
  const pending = previous.catch(() => {}).then(operation)
  stateOperations.set(userId, pending)
  return pending.finally(() => {
    if (stateOperations.get(userId) === pending) stateOperations.delete(userId)
  })
}

async function loadUserState(userId) {
  if (!await spindle.userStorage.exists(STATE_PATH, userId)) return normalizeState(null)
  return normalizeState(await spindle.userStorage.getJson(STATE_PATH, { userId }))
}

async function updateUserState(userId, patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('Invalid state update')
  if ('lastPage' in patch && (!Number.isSafeInteger(patch.lastPage) || patch.lastPage < 1)) {
    throw new Error('Invalid page number')
  }
  if ('imageFilter' in patch && !['all', 'generated', 'non-generated'].includes(patch.imageFilter)) {
    throw new Error('Invalid image filter')
  }
  for (const key of ['protectedIds', 'deletedIds']) {
    if (key in patch && (!Array.isArray(patch[key]) || !patch[key].every(validImageId))) {
      throw new Error('Invalid image IDs')
    }
  }
  const state = await loadUserState(userId)
  if ('lastPage' in patch) state.lastPage = patch.lastPage
  if ('imageFilter' in patch) state.imageFilter = patch.imageFilter
  const references = new Map(Object.entries(state.references))
  const now = Date.now()
  for (const id of patch.protectedIds || []) references.set(id, now)
  for (const id of patch.deletedIds || []) references.delete(id)
  state.references = Object.fromEntries(references)
  const result = normalizeState(state, now)
  await spindle.userStorage.setJson(STATE_PATH, result, { userId })
  return result
}

function isGeneratedImage(image) {
  return typeof image?.original_filename === 'string'
    && image.original_filename.toLowerCase().startsWith('image-gen-')
}

async function listClassifiedImages(userId) {
  const cached = classifiedImageCache.get(userId)
  if (cached) return cached

  const pending = (async () => {
    const generatedImages = []
    const nonGeneratedImages = []
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
      for (const image of images) {
        if (isGeneratedImage(image)) generatedImages.push(image)
        else nonGeneratedImages.push(image)
      }
      offset += images.length
      if (images.length === 0) break
    } while (offset < total)
    return { generated: generatedImages, nonGenerated: nonGeneratedImages }
  })()

  classifiedImageCache.set(userId, pending)
  try {
    return await pending
  } catch (error) {
    classifiedImageCache.delete(userId)
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

  if (!['image_browser_list', 'image_browser_get', 'image_browser_state_get', 'image_browser_state_patch'].includes(payload.type)) return
  if (typeof userId !== 'string' || !userId.trim()) {
    return
  }
  if (!hasImagesPermission()) {
    rejectPermission(userId, requestId)
    return
  }

  try {
    if (payload.type === 'image_browser_state_get' || payload.type === 'image_browser_state_patch') {
      const result = await withUserState(userId, () => payload.type === 'image_browser_state_get'
        ? loadUserState(userId)
        : updateUserState(userId, payload.patch))
      respond(userId, requestId, { ok: true, result })
      return
    }
    if (payload.type === 'image_browser_list') {
      const limit = Math.max(1, Math.min(MAX_PAGE_SIZE, Math.trunc(Number(payload.limit)) || 60))
      const offset = Math.max(0, Math.trunc(Number(payload.offset)) || 0)
      const imageFilter = payload.imageFilter === 'generated' || payload.generatedOnly === true
        ? 'generated'
        : payload.imageFilter === 'non-generated'
          ? 'nonGenerated'
          : 'all'
      const result = imageFilter !== 'all'
        ? await listClassifiedImages(userId).then((imagesByType) => {
            const images = imagesByType[imageFilter]
            return {
              data: images.slice(offset, offset + limit),
              total: images.length,
            }
          })
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
    classifiedImageCache.delete(userId)
    spindle.sendToFrontend({ type: 'image_browser_assets_changed' }, userId)
  })
}

spindle.log.info('Image Browser loaded.')
