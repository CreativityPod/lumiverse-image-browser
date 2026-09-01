# Lumiverse Image Browser

Browse, preview, select, and safely remove unreferenced images stored by Lumiverse without opening a shell in the Docker container.

## Features

- Wide, responsive thumbnail browser in a native Lumiverse modal
- Drawer launcher, command-palette entry, and chat Extras action
- Paginated browsing with search and a generated-image filter with correctly filtered totals
- Remembers the last successfully loaded page in the current browser profile
- Remembers the generated-only preference and recently confirmed reference badges
- Full-resolution, contained image previews; stored videos use native controls
- Multi-selection across loaded pages
- Safe bulk cleanup through Lumiverse's existing `unused=true` deletion path
- Referenced images remain stored and are marked as protected after a cleanup attempt

## Safety boundary

The extension requests only the privileged `images` permission. It never calls the force-delete Spindle methods. A cleanup request is sent separately for each selected asset, and Lumiverse's own `deleteImageIfUnreferenced()` check decides whether the original, thumbnails, and database row may be removed.

Reference status is not currently exposed as a non-destructive Spindle query. Images therefore begin with unknown status; an image that Lumiverse refuses to delete is marked **Referenced** and that observation is cached in the current browser profile for up to 90 days. The badge tooltip explains that the cached status may have changed and the image can be checked again.

## Install

Install the extension from:

```text
https://github.com/CreativityPod/lumiverse-image-browser
```

Then enable it and grant the **Images** permission.

The extension targets Lumiverse **1.1.6 or newer**, matching the host APIs used and verified during development.

For local development, place or clone the repository under Lumiverse's `data/extensions/` directory and use **Extensions → Add Extension → Import Local**.

## Development

The project is dependency-free and uses Node.js 20 or later.

```bash
npm run check
```

`npm run build` emits a self-contained frontend bundle plus the backend entry into `dist/`. Commit the built files before publishing because Lumiverse installs the repository contents directly.

## Known boundaries

- Accurate reference badges cannot be displayed before a safe deletion attempt with the current public Spindle API.
- Search filters the pages loaded into the modal; use **Load more** to expand the searchable set.
- The extension uses Lumiverse's authenticated image URLs and must run inside the signed-in Lumiverse application.
