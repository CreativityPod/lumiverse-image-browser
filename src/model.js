export const PAGE_SIZE = 60

export function clampPageSize(value) {
  const parsed = Number.isFinite(Number(value)) ? Math.trunc(Number(value)) : PAGE_SIZE
  return Math.max(1, Math.min(200, parsed))
}

export function getPageWindow(offset, itemCount, total, pageSize = PAGE_SIZE) {
  const size = clampPageSize(pageSize)
  const normalizedOffset = Math.max(0, Math.trunc(Number(offset)) || 0)
  const normalizedCount = Math.max(0, Math.trunc(Number(itemCount)) || 0)
  const normalizedTotal = Math.max(0, Math.trunc(Number(total)) || 0)
  const pageCount = Math.max(1, Math.ceil(normalizedTotal / size))
  const pageNumber = Math.min(pageCount, Math.floor(normalizedOffset / size) + 1)

  return {
    start: normalizedCount > 0 ? Math.min(normalizedOffset + 1, normalizedTotal) : 0,
    end: normalizedCount > 0
      ? Math.min(normalizedOffset + normalizedCount, normalizedTotal)
      : 0,
    pageNumber,
    pageCount,
    previousOffset: Math.max(0, normalizedOffset - size),
    nextOffset: normalizedOffset + size,
    hasPrevious: normalizedOffset > 0,
    hasNext: normalizedOffset + size < normalizedTotal,
  }
}

export function pageNumberToOffset(value, pageCount, pageSize = PAGE_SIZE) {
  const text = String(value ?? '').trim()
  if (!/^\d+$/.test(text)) return null
  const pageNumber = Number(text)
  const normalizedPageCount = Math.max(1, Math.trunc(Number(pageCount)) || 1)
  if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > normalizedPageCount) return null
  return (pageNumber - 1) * clampPageSize(pageSize)
}

export function isGeneratedImage(image) {
  return typeof image?.original_filename === 'string'
    && image.original_filename.toLowerCase().startsWith('image-gen-')
}

export function filterImages(images, query, imageFilter = 'all') {
  const needle = String(query || '').trim().toLowerCase()
  return images.filter((image) => {
    const generated = isGeneratedImage(image)
    if (imageFilter === 'generated' && !generated) return false
    if (imageFilter === 'non-generated' && generated) return false
    if (!needle) return true
    return [
      image.id,
      image.original_filename,
      image.mime_type,
      image.owner_character_id,
      image.owner_chat_id,
      image.owner_extension_identifier,
    ].some((value) => typeof value === 'string' && value.toLowerCase().includes(needle))
  })
}

export function formatDimensions(image) {
  return Number.isFinite(image?.width) && Number.isFinite(image?.height)
    ? `${image.width} × ${image.height}`
    : 'Dimensions unavailable'
}

export function summarizeDeleteResults(results) {
  return results.reduce(
    (summary, result) => {
      if (result.status === 'deleted') summary.deleted += 1
      else if (result.status === 'protected') summary.protected += 1
      else summary.failed += 1
      return summary
    },
    { deleted: 0, protected: 0, failed: 0 },
  )
}

export async function mapWithConcurrency(items, concurrency, worker) {
  const limit = Math.max(1, Math.min(items.length || 1, Math.trunc(concurrency) || 1))
  const results = new Array(items.length)
  let nextIndex = 0

  async function run() {
    while (nextIndex < items.length) {
      const index = nextIndex
      nextIndex += 1
      results[index] = await worker(items[index], index)
    }
  }

  await Promise.all(Array.from({ length: limit }, () => run()))
  return results
}
