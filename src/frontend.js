import {
  PAGE_SIZE,
  filterImages,
  formatDimensions,
  getPageWindow,
  isGeneratedImage,
  mapWithConcurrency,
  pageNumberToOffset,
  summarizeDeleteResults,
} from './model.js'

const ICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/></svg>'
const ACTION_ICON_SVG = ICON_SVG.replace('width="20" height="20"', 'width="14" height="14"')
const STYLES = `
  .lib-launcher { display:grid; gap:14px; padding:18px; color:var(--lumiverse-text); }
  .lib-launcher-card { padding:16px; border:1px solid var(--lumiverse-border); border-radius:14px; background:var(--lumiverse-fill-subtle); }
  .lib-launcher h3 { margin:0 0 6px; font-size:16px; }
  .lib-launcher p { margin:0; color:var(--lumiverse-text-muted); font-size:13px; line-height:1.5; }
  .lib-button { appearance:none; border:1px solid color-mix(in srgb, var(--lumiverse-primary) 48%, var(--lumiverse-border)); border-radius:10px; padding:9px 13px; background:color-mix(in srgb, var(--lumiverse-primary) 14%, var(--lumiverse-fill)); color:var(--lumiverse-text); font:inherit; font-weight:650; cursor:pointer; }
  .lib-button:hover { background:color-mix(in srgb, var(--lumiverse-primary) 22%, var(--lumiverse-fill)); }
  .lib-button:disabled { cursor:not-allowed; opacity:.5; }
  .lib-button-danger { border-color:color-mix(in srgb, #ef4444 55%, var(--lumiverse-border)); background:color-mix(in srgb, #ef4444 13%, var(--lumiverse-fill)); }
  .lib-button-quiet { background:var(--lumiverse-fill-subtle); border-color:var(--lumiverse-border); font-weight:550; }
  .lib-shell { display:flex; flex-direction:column; width:100%; height:min(760px, calc(100vh - 128px)); min-height:min(540px, calc(100vh - 128px)); color:var(--lumiverse-text); overflow:hidden; }
  .lib-summary { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:0 0 12px; color:var(--lumiverse-text-muted); font-size:12px; }
  .lib-toolbar { display:grid; grid-template-columns:minmax(180px, 1fr) auto auto; align-items:center; gap:10px; padding-bottom:12px; border-bottom:1px solid var(--lumiverse-border); }
  .lib-search { width:100%; min-width:0; box-sizing:border-box; border:1px solid var(--lumiverse-border); border-radius:10px; padding:9px 11px; background:var(--lumiverse-fill); color:var(--lumiverse-text); font:inherit; }
  .lib-filter-group { display:inline-flex; align-items:center; padding:2px; border:1px solid var(--lumiverse-border); border-radius:10px; background:var(--lumiverse-fill-subtle); }
  .lib-filter-option { position:relative; cursor:pointer; }
  .lib-filter-option input { position:absolute; width:1px; height:1px; opacity:0; pointer-events:none; }
  .lib-filter-segment { display:block; padding:7px 10px; border-radius:7px; color:var(--lumiverse-text-muted); font-size:12px; font-weight:600; line-height:1; white-space:nowrap; transition:background .16s ease, color .16s ease; }
  .lib-filter-option input:checked + .lib-filter-segment { background:color-mix(in srgb, var(--lumiverse-primary) 18%, var(--lumiverse-fill)); color:var(--lumiverse-text); box-shadow:0 0 0 1px color-mix(in srgb, var(--lumiverse-primary) 40%, transparent); }
  .lib-filter-option input:focus-visible + .lib-filter-segment { outline:2px solid color-mix(in srgb, var(--lumiverse-primary) 45%, transparent); outline-offset:1px; }
  .lib-filter-option input:disabled + .lib-filter-segment { cursor:not-allowed; opacity:.5; }
  .lib-select-all { display:inline-flex; align-items:center; gap:7px; color:var(--lumiverse-text-muted); font-size:12px; white-space:nowrap; }
  .lib-status { min-height:20px; padding:9px 2px 7px; color:var(--lumiverse-text-muted); font-size:12px; }
  .lib-status[data-tone="error"] { color:#ff9d9d; }
  .lib-status[data-tone="warning"] { color:#f6c56f; }
  .lib-status[data-tone="success"] { color:#8be0b0; }
  .lib-grid { flex:1 1 0; min-height:0; overflow-x:hidden; overflow-y:auto; scrollbar-gutter:stable; display:grid; grid-template-columns:repeat(auto-fill, minmax(190px, 1fr)); grid-auto-rows:max-content; align-items:start; align-content:start; gap:14px; padding:4px 4px 14px 0; }
  .lib-empty { grid-column:1/-1; display:grid; place-items:center; min-height:220px; padding:24px; border:1px dashed var(--lumiverse-border); border-radius:14px; color:var(--lumiverse-text-muted); text-align:center; }
  .lib-card { position:relative; align-self:start; min-width:0; height:max-content; overflow:hidden; border:1px solid var(--lumiverse-border); border-radius:14px; background:var(--lumiverse-fill-subtle); transition:border-color .16s ease, transform .16s ease; }
  .lib-card:hover { border-color:color-mix(in srgb, var(--lumiverse-primary) 55%, var(--lumiverse-border)); transform:translateY(-1px); }
  .lib-card[data-selected="true"] { border-color:var(--lumiverse-primary); box-shadow:0 0 0 1px var(--lumiverse-primary); }
  .lib-reference-badge { position:absolute; z-index:2; right:8px; top:8px; padding:4px 7px; border-radius:999px; background:rgba(30,41,59,.88); color:#fff; font-size:10px; font-weight:750; cursor:help; }
  .lib-check { position:absolute; z-index:2; left:9px; top:9px; display:grid; place-items:center; width:26px; height:26px; border-radius:8px; background:rgba(15,23,42,.78); backdrop-filter:blur(5px); }
  .lib-check input { width:16px; height:16px; accent-color:var(--lumiverse-primary); cursor:pointer; }
  .lib-preview-button { display:grid; place-items:center; width:100%; aspect-ratio:1/1; min-height:0; overflow:hidden; padding:0; border:0; background:color-mix(in srgb, var(--lumiverse-fill-subtle) 78%, #000 22%); cursor:zoom-in; }
  .lib-thumb { display:block; width:100%; height:100%; object-fit:contain; color:transparent; }
  .lib-thumb-fallback { display:none; place-items:center; width:100%; height:100%; color:var(--lumiverse-text-muted); font-size:12px; }
  .lib-meta { display:grid; gap:5px; padding:10px 11px 12px; }
  .lib-filename { overflow:hidden; color:var(--lumiverse-text); font-size:12px; font-weight:700; text-overflow:ellipsis; white-space:nowrap; }
  .lib-detail { display:flex; justify-content:space-between; gap:8px; color:var(--lumiverse-text-dim); font-size:10px; }
  .lib-kind { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .lib-generated { color:var(--lumiverse-primary); font-weight:700; }
  .lib-footer { display:flex; align-items:center; justify-content:space-between; gap:12px; padding-top:12px; border-top:1px solid var(--lumiverse-border); }
  .lib-footer-actions { display:flex; align-items:center; gap:9px; }
  .lib-page-jump { display:inline-flex; align-items:center; gap:6px; color:var(--lumiverse-text-muted); font-size:12px; white-space:nowrap; }
  .lib-page-input { width:58px; box-sizing:border-box; border:1px solid var(--lumiverse-border); border-radius:8px; padding:7px 6px; background:var(--lumiverse-fill); color:var(--lumiverse-text); font:inherit; text-align:center; }
  .lib-page-input:focus { border-color:var(--lumiverse-primary); outline:2px solid color-mix(in srgb, var(--lumiverse-primary) 26%, transparent); outline-offset:1px; }
  .lib-preview-shell { display:grid; grid-template-rows:minmax(0, 1fr) auto; width:100%; height:min(800px, calc(100vh - 128px)); min-height:280px; gap:12px; }
  .lib-preview-stage { position:relative; display:grid; min-height:0; overflow:hidden; border-radius:10px; background:color-mix(in srgb, var(--lumiverse-fill-subtle) 72%, #000 28%); }
  .lib-preview-media { display:grid; place-items:center; width:100%; height:100%; min-height:0; overflow:hidden; }
  .lib-full-media { display:block; width:100%; height:100%; min-height:0; object-fit:contain; border-radius:10px; background:color-mix(in srgb, var(--lumiverse-fill-subtle) 72%, #000 28%); }
  .lib-preview-loading, .lib-preview-error { display:grid; place-items:center; width:100%; height:100%; min-height:220px; padding:24px; box-sizing:border-box; color:var(--lumiverse-text-muted); text-align:center; }
  .lib-preview-error { color:#ff9d9d; }
  .lib-preview-nav { position:absolute; z-index:2; top:50%; display:grid; place-items:center; width:46px; height:64px; border:1px solid rgba(255,255,255,.2); border-radius:12px; background:rgba(15,23,42,.72); color:#fff; font:inherit; font-size:34px; line-height:1; cursor:pointer; transform:translateY(-50%); backdrop-filter:blur(6px); }
  .lib-preview-nav:hover:not(:disabled) { background:rgba(15,23,42,.9); }
  .lib-preview-nav:disabled { cursor:default; opacity:.28; }
  .lib-preview-nav-previous { left:12px; }
  .lib-preview-nav-next { right:12px; }
  .lib-preview-meta { display:flex; flex-wrap:wrap; justify-content:space-between; gap:8px 16px; color:var(--lumiverse-text-muted); font-size:11px; }
  .lib-preview-name { flex:1 1 100%; overflow:hidden; color:var(--lumiverse-text); font-weight:700; text-overflow:ellipsis; white-space:nowrap; }
  @media (max-width:700px) {
    .lib-shell { height:calc(100vh - 112px); min-height:360px; }
    .lib-toolbar { grid-template-columns:1fr auto; }
    .lib-filter-group { grid-column:1/-1; display:grid; grid-template-columns:repeat(3, 1fr); }
    .lib-filter-segment { text-align:center; }
    .lib-grid { grid-template-columns:repeat(2, minmax(0, 1fr)); gap:9px; }
    .lib-footer { align-items:stretch; flex-direction:column; }
    .lib-footer-actions { flex-wrap:wrap; justify-content:space-between; }
  }
`

function createElement(tag, className, text) {
  const element = document.createElement(tag)
  if (className) element.className = className
  if (text !== undefined) element.textContent = text
  return element
}

function relativeDate(unixSeconds) {
  if (!Number.isFinite(Number(unixSeconds))) return 'Unknown date'
  return new Date(Number(unixSeconds) * 1000).toLocaleString()
}

async function safeDeleteImage(imageId) {
  const response = await fetch(`/api/v1/images/${encodeURIComponent(imageId)}?unused=true`, {
    method: 'DELETE',
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(body.error || `Delete failed with status ${response.status}`)
  return body.deleted === true
}

export function setup(ctx) {
  ctx.deferReady()
  const removeStyle = ctx.dom.addStyle(STYLES)
  const pending = new Map()
  let requestSequence = 0
  let browserModal = null
  let browserState = null
  let permissionGranted = null
  let disposed = false

  function rpc(type, payload = {}) {
    requestSequence += 1
    const requestId = `image-browser-${Date.now().toString(36)}-${requestSequence.toString(36)}`
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => {
        pending.delete(requestId)
        reject(new Error('Image Browser request timed out.'))
      }, 20_000)
      pending.set(requestId, { resolve, reject, timer })
      ctx.sendToBackend({ type, requestId, ...payload })
    })
  }

  async function saveState(state, patch) {
    if (disposed || !state.storageReady) return
    try {
      await rpc('image_browser_state_patch', { patch })
      state.storageError = ''
    } catch (error) {
      state.storageError = `Could not save Image Browser preferences: ${error instanceof Error ? error.message : String(error)}`
    }
    if (browserState === state) renderBrowser()
  }

  const unsubscribeBackend = ctx.onBackendMessage((payload) => {
    if (!payload || typeof payload !== 'object') return
    if (payload.type === 'image_browser_permission_changed') {
      permissionGranted = Boolean(payload.granted)
      renderLauncher()
      if (browserState) {
        browserState.permissionGranted = permissionGranted
        renderBrowser()
      }
      return
    }
    if (payload.type === 'image_browser_assets_changed') return
    const entry = pending.get(payload.requestId)
    if (!entry) return
    window.clearTimeout(entry.timer)
    pending.delete(payload.requestId)
    if (payload.ok) entry.resolve(payload)
    else entry.reject(new Error(payload.error || 'Image Browser request failed.'))
  })

  const drawer = ctx.ui.registerDrawerTab({
    id: 'image-browser',
    title: 'Image Browser',
    shortName: 'Images',
    headerTitle: 'Image Browser',
    description: 'Browse, preview, and safely remove unused image assets',
    keywords: ['images', 'gallery', 'assets', 'cleanup', 'orphaned'],
    iconSvg: ICON_SVG,
  })
  drawer.root.classList.add('lib-launcher')

  function renderLauncher() {
    drawer.root.replaceChildren()
    const card = createElement('div', 'lib-launcher-card')
    card.append(
      createElement('h3', '', 'Stored image assets'),
      createElement(
        'p',
        '',
        permissionGranted === false
          ? 'Grant the Images permission in the Extensions panel to browse your assets.'
          : 'Open a wide, paginated thumbnail browser. Safe deletion keeps every referenced image protected.',
      ),
    )
    const openButton = createElement('button', 'lib-button', 'Open Image Browser')
    openButton.type = 'button'
    openButton.disabled = permissionGranted === false
    openButton.addEventListener('click', openBrowser)
    drawer.root.append(card, openButton)
  }

  let inputAction = null
  let unsubscribeAction = () => {}
  if (typeof ctx.ui.registerInputBarAction === 'function') {
    try {
      inputAction = ctx.ui.registerInputBarAction({
        id: 'open-image-browser',
        label: 'Open Image Browser',
        iconSvg: ACTION_ICON_SVG,
        enabled: true,
      })
      if (typeof inputAction?.onClick === 'function') {
        unsubscribeAction = inputAction.onClick(openBrowser)
      }
    } catch (error) {
      try { inputAction?.destroy?.() } catch { /* best-effort cleanup */ }
      inputAction = null
      console.warn('[Image Browser] Input bar action is unavailable:', error)
    }
  }

  async function loadPage(offset = 0) {
    const state = browserState
    if (!state || state.loading) return
    const requestedOffset = Math.max(0, Math.trunc(Number(offset)) || 0)
    state.loading = true
    state.status = `Loading images ${requestedOffset + 1}–${requestedOffset + PAGE_SIZE}…`
    state.tone = ''
    renderBrowser()
    try {
      let resolvedOffset = requestedOffset
      let response = await rpc('image_browser_list', {
        limit: PAGE_SIZE,
        offset: resolvedOffset,
        imageFilter: state.imageFilter,
      })
      if (browserState !== state) return
      let result = response.result || { data: [], total: 0 }
      const resultItems = Array.isArray(result.data) ? result.data : []
      const resultTotal = Math.max(0, Number(result.total) || 0)

      if (resultItems.length === 0 && resultTotal > 0 && resolvedOffset >= resultTotal) {
        resolvedOffset = Math.max(0, (Math.ceil(resultTotal / PAGE_SIZE) - 1) * PAGE_SIZE)
        response = await rpc('image_browser_list', {
          limit: PAGE_SIZE,
          offset: resolvedOffset,
          imageFilter: state.imageFilter,
        })
        if (browserState !== state) return
        result = response.result || { data: [], total: 0 }
      }

      state.items = Array.isArray(result.data) ? result.data : []
      state.total = Math.max(0, Number(result.total) || 0)
      state.offset = resolvedOffset
      state.permissionGranted = true
      permissionGranted = true
      const page = getPageWindow(state.offset, state.items.length, state.total)
      await saveState(state, { lastPage: page.pageNumber, imageFilter: state.imageFilter })
      if (browserState !== state) return
      state.status = state.items.length
        ? `Showing ${page.start}–${page.end} of ${state.total} images.`
        : state.total === 0
          ? state.imageFilter === 'generated'
            ? 'No generated images were found.'
            : state.imageFilter === 'non-generated'
              ? 'No non-generated images were found.'
              : 'No stored images were found.'
          : 'No images were found on this page.'
    } catch (error) {
      if (browserState !== state) return
      state.status = error instanceof Error ? error.message : String(error)
      state.tone = 'error'
      if (String(state.status).includes('Images permission')) {
        state.permissionGranted = false
        permissionGranted = false
      }
    } finally {
      if (browserState !== state) return
      state.loading = false
      renderLauncher()
      renderBrowser()
    }
  }

  async function openBrowser() {
    if (disposed || browserModal) return
    browserModal = ctx.ui.showModal({
      title: 'Image Browser',
      width: 1120,
      maxHeight: Math.min(900, Math.max(520, window.innerHeight - 40)),
    })
    browserState = {
      root: browserModal.root,
      items: [],
      offset: 0,
      total: 0,
      selected: new Set(),
      protectedImages: new Map(),
      query: '',
      imageFilter: 'all',
      loading: true,
      storageReady: false,
      storageError: '',
      deleting: false,
      permissionGranted,
      status: 'Loading images…',
      tone: '',
    }
    browserState.root.classList.add('lib-shell')
    browserModal.onDismiss(() => {
      browserModal = null
      browserState = null
    })
    renderBrowser()
    const state = browserState
    try {
      const { result } = await rpc('image_browser_state_get')
      if (browserState !== state) return
      const offset = (result.lastPage - 1) * PAGE_SIZE
      state.offset = Number.isSafeInteger(offset) && offset >= 0 ? offset : 0
      state.imageFilter = result.imageFilter
      state.protectedImages = new Map(Object.entries(result.references))
      state.storageReady = true
    } catch (error) {
      if (browserState !== state) return
      state.storageError = `Could not load saved preferences; changes will not be saved. Reopen Image Browser to retry. ${error instanceof Error ? error.message : String(error)}`
    }
    state.loading = false
    void loadPage(state.offset)
  }

  function openPreview(image, previewImages) {
    if (!browserState) return
    const candidates = Array.isArray(previewImages) && previewImages.length > 0
      ? [...previewImages]
      : [image]
    let currentIndex = Math.max(0, candidates.findIndex((candidate) => candidate.id === image.id))
    let loading = false
    let dismissed = false
    let loadSequence = 0

    const preview = ctx.ui.showModal({
      title: 'Image preview',
      width: 1200,
      maxHeight: Math.min(940, Math.max(420, window.innerHeight - 40)),
    })
    const shell = createElement('div', 'lib-preview-shell')
    const stage = createElement('div', 'lib-preview-stage')
    const mediaHost = createElement('div', 'lib-preview-media')
    const previousButton = createElement('button', 'lib-preview-nav lib-preview-nav-previous', '‹')
    previousButton.type = 'button'
    previousButton.title = 'Previous image'
    previousButton.setAttribute('aria-label', 'Previous image')
    const nextButton = createElement('button', 'lib-preview-nav lib-preview-nav-next', '›')
    nextButton.type = 'button'
    nextButton.title = 'Next image'
    nextButton.setAttribute('aria-label', 'Next image')
    const meta = createElement('div', 'lib-preview-meta')

    function updateNavigation() {
      previousButton.disabled = loading || currentIndex <= 0
      nextButton.disabled = loading || currentIndex >= candidates.length - 1
    }

    async function showImage(index) {
      if (dismissed || loading || index < 0 || index >= candidates.length) return
      currentIndex = index
      loading = true
      loadSequence += 1
      const sequence = loadSequence
      const target = candidates[currentIndex]
      updateNavigation()
      mediaHost.replaceChildren(createElement('div', 'lib-preview-loading', `Loading ${target.original_filename || target.id}…`))
      meta.replaceChildren(
        createElement('span', 'lib-preview-name', target.original_filename || target.id),
        createElement('span', '', `${currentIndex + 1} of ${candidates.length}`),
      )

      try {
        const response = await rpc('image_browser_get', { imageId: target.id })
        if (dismissed || sequence !== loadSequence) return
        const fullImage = response.result
        if (!fullImage) throw new Error('The image is no longer available.')
        const isVideo = String(fullImage.mime_type || '').startsWith('video/')
        const media = createElement(isVideo ? 'video' : 'img', 'lib-full-media')
        media.src = fullImage.url
        if (isVideo) {
          media.controls = true
          media.preload = 'metadata'
        } else {
          media.alt = fullImage.original_filename || 'Full image preview'
        }
        mediaHost.replaceChildren(media)
        meta.replaceChildren(
          createElement('span', 'lib-preview-name', fullImage.original_filename || fullImage.id),
          createElement('span', '', formatDimensions(fullImage)),
          createElement('span', '', fullImage.mime_type || 'Unknown media type'),
          createElement('span', '', relativeDate(fullImage.created_at)),
          createElement('span', '', `${currentIndex + 1} of ${candidates.length}`),
        )
      } catch (error) {
        if (dismissed || sequence !== loadSequence) return
        mediaHost.replaceChildren(createElement('div', 'lib-preview-error', error instanceof Error ? error.message : String(error)))
      } finally {
        if (!dismissed && sequence === loadSequence) {
          loading = false
          updateNavigation()
        }
      }
    }

    previousButton.addEventListener('click', () => void showImage(currentIndex - 1))
    nextButton.addEventListener('click', () => void showImage(currentIndex + 1))
    shell.tabIndex = 0
    shell.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowLeft' && !previousButton.disabled) {
        event.preventDefault()
        void showImage(currentIndex - 1)
      } else if (event.key === 'ArrowRight' && !nextButton.disabled) {
        event.preventDefault()
        void showImage(currentIndex + 1)
      }
    })
    preview.onDismiss(() => {
      dismissed = true
      loadSequence += 1
    })
    stage.append(mediaHost, previousButton, nextButton)
    shell.append(stage, meta)
    preview.root.appendChild(shell)
    window.setTimeout(() => shell.focus(), 0)
    void showImage(currentIndex)
  }

  async function deleteSelected() {
    if (!browserState || browserState.deleting || browserState.selected.size === 0) return
    const state = browserState
    const ids = [...browserState.selected]
    const knownProtectedCount = ids.filter((id) => browserState.protectedImages.has(id)).length
    const uncheckedCount = ids.length - knownProtectedCount
    const title = knownProtectedCount > 0
      ? `${knownProtectedCount} selected image${knownProtectedCount === 1 ? ' appears' : 's appear'} protected`
      : `Safely delete ${ids.length} selected image${ids.length === 1 ? '' : 's'}?`
    const knownProtectionWarning = knownProtectedCount > 0
      ? `${knownProtectedCount} selected image${knownProtectedCount === 1 ? ' is' : 's are'} already known to be referenced and will probably remain. `
      : ''
    const deletionWarning = uncheckedCount > 0
      ? `${uncheckedCount}${knownProtectedCount > 0 ? ' other' : ''} selected image${uncheckedCount === 1 ? '' : 's'} will be checked and permanently deleted only if unused. `
      : 'Lumiverse can check again in case the references have since been removed. '
    const { confirmed } = await ctx.ui.showConfirm({
      title,
      message: `${knownProtectionWarning}${deletionWarning}Any referenced images will stay visible and be labeled Referenced afterward. Deletion cannot be undone.`,
      variant: knownProtectedCount > 0 ? 'warning' : 'danger',
      confirmLabel: uncheckedCount === 0 ? 'Check again' : 'Delete unused',
    })
    if (!confirmed || browserState !== state) return

    browserState.deleting = true
    browserState.status = `Checking ${ids.length} selected image${ids.length === 1 ? '' : 's'}…`
    browserState.tone = ''
    renderBrowser()

    const results = await mapWithConcurrency(ids, 3, async (id) => {
      try {
        return await safeDeleteImage(id)
          ? { id, status: 'deleted' }
          : { id, status: 'protected' }
      } catch (error) {
        return { id, status: 'failed', error: error instanceof Error ? error.message : String(error) }
      }
    })

    const summary = summarizeDeleteResults(results)
    const deletedIds = new Set(results.filter((result) => result.status === 'deleted').map((result) => result.id))
    const protectedIds = results.filter((result) => result.status === 'protected').map((result) => result.id)
    await saveState(state, { protectedIds, deletedIds: [...deletedIds] })
    if (browserState !== state) return
    browserState.items = browserState.items.filter((image) => !deletedIds.has(image.id))
    browserState.total = Math.max(0, browserState.total - summary.deleted)
    browserState.selected.clear()
    for (const id of deletedIds) browserState.protectedImages.delete(id)
    const confirmedAt = Date.now()
    for (const id of protectedIds) browserState.protectedImages.set(id, confirmedAt)
    browserState.deleting = false
    browserState.status = [
      `${summary.deleted} deleted`,
      summary.protected
        ? `${summary.protected} kept because ${summary.protected === 1 ? 'it is' : 'they are'} referenced (still shown)`
        : null,
      summary.failed ? `${summary.failed} failed` : null,
    ].filter(Boolean).join(' · ')
    browserState.tone = summary.failed ? 'error' : summary.protected ? 'warning' : 'success'
    renderBrowser()
  }

  function renderCard(image, previewImages) {
    const card = createElement('article', 'lib-card')
    card.dataset.selected = String(browserState.selected.has(image.id))
    const referencedAt = browserState.protectedImages.get(image.id)
    card.dataset.protected = String(Number.isFinite(referencedAt))

    const checkboxLabel = createElement('label', 'lib-check')
    checkboxLabel.title = 'Select image'
    const checkbox = document.createElement('input')
    checkbox.type = 'checkbox'
    checkbox.checked = browserState.selected.has(image.id)
    checkbox.setAttribute('aria-label', `Select ${image.original_filename || image.id}`)
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) browserState.selected.add(image.id)
      else browserState.selected.delete(image.id)
      renderBrowser({ preserveGridScroll: true })
    })
    checkboxLabel.appendChild(checkbox)

    const previewButton = createElement('button', 'lib-preview-button')
    previewButton.type = 'button'
    previewButton.title = 'Open full image'
    previewButton.setAttribute('aria-label', `Preview ${image.original_filename || image.id}`)
    const thumbnail = createElement('img', 'lib-thumb')
    thumbnail.src = image.url
    thumbnail.alt = image.original_filename || 'Image thumbnail'
    thumbnail.loading = 'lazy'
    const fallback = createElement('span', 'lib-thumb-fallback', 'Preview unavailable')
    thumbnail.addEventListener('error', () => {
      thumbnail.style.display = 'none'
      fallback.style.display = 'grid'
    })
    previewButton.append(thumbnail, fallback)
    previewButton.addEventListener('click', () => openPreview(image, previewImages))

    const meta = createElement('div', 'lib-meta')
    const filename = createElement('div', 'lib-filename', image.original_filename || image.id)
    filename.title = image.original_filename || image.id
    const details = createElement('div', 'lib-detail')
    const kind = createElement('span', `lib-kind${isGeneratedImage(image) ? ' lib-generated' : ''}`, isGeneratedImage(image) ? 'Generated' : (image.mime_type || 'Unknown'))
    const dimensions = createElement('span', '', formatDimensions(image))
    details.append(kind, dimensions)
    meta.append(filename, details)
    card.append(checkboxLabel, previewButton, meta)
    if (Number.isFinite(referencedAt)) {
      const badge = createElement('span', 'lib-reference-badge', 'Referenced')
      badge.title = `Previously confirmed as referenced on ${new Date(referencedAt).toLocaleString()}. This cached status may have changed; select it and run the deletion check again to recheck.`
      card.appendChild(badge)
    }
    return card
  }

  function renderBrowser({ preserveGridScroll = false } = {}) {
    if (!browserState?.root) return
    const state = browserState
    const previousGridScrollTop = preserveGridScroll
      ? Math.max(0, Number(state.root.querySelector('.lib-grid')?.scrollTop) || 0)
      : 0
    const visibleImages = filterImages(state.items, state.query, state.imageFilter)
    const page = getPageWindow(state.offset, state.items.length, state.total)
    state.root.replaceChildren()

    const summary = createElement('div', 'lib-summary')
    summary.append(
      createElement('span', '', state.total > 0
        ? `Page ${page.pageNumber} of ${page.pageCount} · ${page.start}–${page.end} of ${state.total}`
        : state.imageFilter === 'generated'
          ? '0 generated images'
          : state.imageFilter === 'non-generated'
            ? '0 non-generated images'
            : '0 stored images'),
      createElement('span', '', `${state.selected.size} selected`),
    )

    const toolbar = createElement('div', 'lib-toolbar')
    const search = createElement('input', 'lib-search')
    search.type = 'search'
    search.placeholder = 'Filter loaded images by filename, ID, or owner…'
    search.value = state.query
    search.addEventListener('input', () => {
      state.query = search.value
      renderBrowser({ preserveGridScroll: true })
      const replacement = state.root.querySelector('.lib-search')
      replacement?.focus()
      replacement?.setSelectionRange(state.query.length, state.query.length)
    })
    const imageFilterGroup = createElement('div', 'lib-filter-group')
    imageFilterGroup.setAttribute('role', 'radiogroup')
    imageFilterGroup.setAttribute('aria-label', 'Image type')
    for (const option of [
      { value: 'all', label: 'All' },
      { value: 'generated', label: 'Generated' },
      { value: 'non-generated', label: 'Non-generated' },
    ]) {
      const optionLabel = createElement('label', 'lib-filter-option')
      if (option.value === 'non-generated') {
        optionLabel.title = 'Images not recognized as generated'
      }
      const radio = document.createElement('input')
      radio.type = 'radio'
      radio.name = 'image-browser-type-filter'
      radio.value = option.value
      radio.checked = state.imageFilter === option.value
      radio.disabled = state.loading || state.deleting
      radio.addEventListener('change', () => {
        if (!radio.checked || state.imageFilter === option.value) return
        state.imageFilter = option.value
        void loadPage(0)
      })
      optionLabel.append(radio, createElement('span', 'lib-filter-segment', option.label))
      imageFilterGroup.appendChild(optionLabel)
    }
    const refreshButton = createElement('button', 'lib-button lib-button-quiet', 'Refresh')
    refreshButton.type = 'button'
    refreshButton.disabled = state.loading || state.deleting
    refreshButton.addEventListener('click', () => void loadPage(state.offset))
    toolbar.append(search, imageFilterGroup, refreshButton)

    const status = createElement('div', 'lib-status', state.permissionGranted === false
      ? 'Grant the Images permission in the Extensions panel, then refresh.'
      : [state.status, state.storageError].filter(Boolean).join(' '))
    status.dataset.tone = state.permissionGranted === false || state.storageError ? 'error' : state.tone

    const grid = createElement('div', 'lib-grid')
    if (visibleImages.length === 0) {
      grid.appendChild(createElement('div', 'lib-empty', state.loading ? 'Loading…' : 'No loaded images match this view.'))
    } else {
      for (const image of visibleImages) grid.appendChild(renderCard(image, visibleImages))
    }

    const footer = createElement('div', 'lib-footer')
    const selectAllLabel = createElement('label', 'lib-select-all')
    const selectAll = document.createElement('input')
    selectAll.type = 'checkbox'
    selectAll.checked = visibleImages.length > 0 && visibleImages.every((image) => state.selected.has(image.id))
    selectAll.indeterminate = !selectAll.checked && visibleImages.some((image) => state.selected.has(image.id))
    selectAll.addEventListener('change', () => {
      for (const image of visibleImages) {
        if (selectAll.checked) state.selected.add(image.id)
        else state.selected.delete(image.id)
      }
      renderBrowser({ preserveGridScroll: true })
    })
    selectAllLabel.append(selectAll, document.createTextNode('Select visible'))

    const footerActions = createElement('div', 'lib-footer-actions')
    const previousButton = createElement('button', 'lib-button lib-button-quiet', 'Previous')
    previousButton.type = 'button'
    previousButton.disabled = !page.hasPrevious || state.loading || state.deleting
    previousButton.addEventListener('click', () => void loadPage(page.previousOffset))
    const pageJump = createElement('label', 'lib-page-jump')
    pageJump.appendChild(document.createTextNode('Page'))
    const pageInput = createElement('input', 'lib-page-input')
    pageInput.type = 'number'
    pageInput.inputMode = 'numeric'
    pageInput.min = '1'
    pageInput.max = String(page.pageCount)
    pageInput.step = '1'
    pageInput.value = String(page.pageNumber)
    pageInput.disabled = state.loading || state.deleting
    pageInput.setAttribute('aria-label', `Page number, 1 to ${page.pageCount}`)
    const goToEnteredPage = () => {
      const requestedOffset = pageNumberToOffset(pageInput.value, page.pageCount)
      if (requestedOffset === null) {
        pageInput.setCustomValidity(`Enter a whole page number from 1 to ${page.pageCount}.`)
        pageInput.reportValidity()
        return
      }
      pageInput.setCustomValidity('')
      if (requestedOffset !== state.offset) void loadPage(requestedOffset)
    }
    pageInput.addEventListener('input', () => pageInput.setCustomValidity(''))
    pageInput.addEventListener('change', goToEnteredPage)
    pageInput.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return
      event.preventDefault()
      goToEnteredPage()
    })
    pageJump.append(pageInput, document.createTextNode(`of ${page.pageCount}`))
    const nextButton = createElement('button', 'lib-button lib-button-quiet', 'Next')
    nextButton.type = 'button'
    nextButton.disabled = !page.hasNext || state.loading || state.deleting
    nextButton.addEventListener('click', () => void loadPage(page.nextOffset))
    const deleteButton = createElement('button', 'lib-button lib-button-danger', state.deleting ? 'Checking…' : `Delete unused (${state.selected.size})`)
    deleteButton.type = 'button'
    deleteButton.disabled = state.selected.size === 0 || state.loading || state.deleting || state.permissionGranted === false
    deleteButton.addEventListener('click', () => void deleteSelected())
    footerActions.append(previousButton, pageJump, nextButton, deleteButton)
    footer.append(selectAllLabel, footerActions)

    state.root.append(summary, toolbar, status, grid, footer)
    if (preserveGridScroll) grid.scrollTop = previousGridScrollTop
  }

  renderLauncher()
  void rpc('image_browser_permission')
    .then((response) => {
      permissionGranted = Boolean(response.granted)
      renderLauncher()
    })
    .catch(() => {
      permissionGranted = false
      renderLauncher()
    })

  ctx.ready()

  return () => {
    disposed = true
    browserModal?.dismiss()
    browserModal = null
    browserState = null
    for (const entry of pending.values()) {
      window.clearTimeout(entry.timer)
      entry.reject(new Error('Image Browser was unloaded.'))
    }
    pending.clear()
    unsubscribeBackend()
    unsubscribeAction()
    inputAction?.destroy?.()
    drawer.destroy()
    removeStyle()
  }
}
