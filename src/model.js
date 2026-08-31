export const PAGE_SIZE = 60

export function clampPageSize(value) {
  const parsed = Number.isFinite(Number(value)) ? Math.trunc(Number(value)) : PAGE_SIZE
  return Math.max(1, Math.min(200, parsed))
}

export function isGeneratedImage(image) {
  return typeof image?.original_filename === 'string'
    && image.original_filename.toLowerCase().startsWith('image-gen-')
}

export function filterImages(images, query, generatedOnly) {
  const needle = String(query || '').trim().toLowerCase()
  return images.filter((image) => {
    if (generatedOnly && !isGeneratedImage(image)) return false
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
