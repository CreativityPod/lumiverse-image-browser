import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('manifest requests only the images permission and ships both entries', async () => {
  const manifest = JSON.parse(await readFile(new URL('../spindle.json', import.meta.url), 'utf8'))
  assert.deepEqual(manifest.permissions, ['images'])
  assert.equal(manifest.entry_backend, 'dist/backend.js')
  assert.equal(manifest.entry_frontend, 'dist/frontend.js')
  assert.equal(manifest.author, 'CreativityPod')
  assert.equal(manifest.github, 'https://github.com/CreativityPod/lumiverse-image-browser')
})

test('frontend uses safe deletion and never the force-delete API', async () => {
  const source = await readFile(new URL('../src/frontend.js', import.meta.url), 'utf8')
  assert.match(source, /\?unused=true/)
  assert.doesNotMatch(source, /spindle\.images\.delete\s*\(/)
  assert.match(source, /mapWithConcurrency\(ids, 3/)
  assert.match(source, /knownProtectedCount/)
  assert.match(source, /variant: knownProtectedCount > 0 \? 'warning' : 'danger'/)
  assert.match(source, /referenced \(still shown\)/)
})

test('frontend uses contained square thumbnails and fixed-page navigation', async () => {
  const source = await readFile(new URL('../src/frontend.js', import.meta.url), 'utf8')
  assert.match(source, /grid-auto-rows:max-content/)
  assert.match(source, /aspect-ratio:1\/1/)
  assert.match(source, /object-fit:contain/)
  assert.match(source, /overflow-y:auto/)
  assert.match(source, /'Previous'/)
  assert.match(source, /'Next'/)
  assert.match(source, /pageNumberToOffset/)
  assert.match(source, /'Previous image'/)
  assert.match(source, /'Next image'/)
  assert.doesNotMatch(source, /'Load more'/)
})

test('selection rerenders preserve the image grid scroll position', async () => {
  const source = await readFile(new URL('../src/frontend.js', import.meta.url), 'utf8')
  assert.match(source, /renderBrowser\(\{ preserveGridScroll: true \}\)/)
  assert.match(source, /previousGridScrollTop/)
  assert.match(source, /grid\.scrollTop = previousGridScrollTop/)
})

test('built frontend is self-contained for Lumiverse Blob URL loading', async () => {
  const source = await readFile(new URL('../dist/frontend.js', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /from\s+['"]\.\/model\.js['"]/)
  assert.match(source, /export function setup\(ctx\)/)
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
  const frontendModule = await import(moduleUrl)
  assert.equal(typeof frontendModule.setup, 'function')
})
