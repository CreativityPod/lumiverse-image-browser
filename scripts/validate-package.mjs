import { access, readFile } from 'node:fs/promises'

const root = new URL('../', import.meta.url)
const manifest = JSON.parse(await readFile(new URL('spindle.json', root), 'utf8'))
const failures = []
const check = (condition, message) => { if (!condition) failures.push(message) }

check(/^\d+\.\d+\.\d+$/.test(manifest.version), 'version must be semver')
check(/^[a-z][a-z0-9_]*$/.test(manifest.identifier), 'identifier is invalid')
check(manifest.permissions?.length === 1 && manifest.permissions[0] === 'images', 'only the images permission should be requested')
check(manifest.entry_backend === 'dist/backend.js', 'backend entry is invalid')
check(manifest.entry_frontend === 'dist/frontend.js', 'frontend entry is invalid')
check(/^https:\/\/github\.com\/[^/]+\/[^/]+$/.test(manifest.github), 'GitHub URL is invalid')
check(manifest.minimum_lumiverse_version === '1.1.6', 'minimum Lumiverse version must match the verified host API')

for (const entry of [manifest.entry_backend, manifest.entry_frontend]) {
  try { await access(new URL(entry, root)) } catch { failures.push(`built file is missing: ${entry}`) }
}

const frontend = await readFile(new URL('dist/frontend.js', root), 'utf8')
check(frontend.includes('?unused=true'), 'frontend must use Lumiverse safe deletion')
check(!frontend.includes('spindle.images.delete('), 'frontend must not force-delete images')
check(!frontend.includes("from './model.js'"), 'frontend bundle must be self-contained for Blob URL loading')

if (failures.length) {
  console.error(failures.join('\n'))
  process.exit(1)
}
console.log('Package validation passed.')
