// SVG recreation of the stacked-photo concept, with bold shapes for small UI sizes.
export function imageBrowserIconSvg(size = 25, variant = 'drawer') {
  const gradientId = `lib-image-browser-${variant}-gradient`
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 64 64" fill="none" aria-hidden="true" focusable="false" style="width:${size}px;height:${size}px;flex-shrink:0;display:block">
  <defs>
    <linearGradient id="${gradientId}" x1="7" y1="17" x2="61" y2="49" gradientUnits="userSpaceOnUse">
      <stop stop-color="#a447fb"/>
      <stop offset=".5" stop-color="#5861ff"/>
      <stop offset="1" stop-color="#14b9ec"/>
    </linearGradient>
  </defs>
  <path d="M44 3 11 9C5 10 2 14 3 20l5 28c.5 3 2 5 5 6V24c0-6 4-10 10-10h34l-1-3c-1-6-5-9-12-8Z" fill="url(#${gradientId})"/>
  <path d="m45 7-33 6c-4 .7-6 3-5 7l4 23V24c0-5 3-9 8-10l32-4c-1-2-3-3-6-3Z" fill="#e9e4ff"/>
  <rect x="14" y="16" width="46" height="43" rx="8" stroke="url(#${gradientId})" stroke-width="4"/>
  <circle cx="43" cy="29" r="6.5" fill="url(#${gradientId})"/>
  <path d="m42 46 5-5c1.5-1.5 3.5-1.5 5 1l4 8c1.5 3 0 5-3 5h-4Z" fill="url(#${gradientId})"/>
  <path d="m18 49 10-12c1.5-2 3.5-2 5 0l12 15c1 1.5.5 3-2 3H21c-4 0-5-3-3-6Z" fill="url(#${gradientId})"/>
</svg>`
}
