# helpdo.it browser extension

Cross-browser extension (WXT + React). In-page help widget injected via a
content script into a Shadow DOM, with page-context capture and screenshot.

## Load it in your normal Chrome (unpacked)

The manifest is **generated into `dist/`, not this folder** — so point Chrome
at the built output, not the project root.

```bash
make load-ext        # from repo root: builds and prints the exact path
# or: cd extension && npm run build
```

Then in Chrome:

1. Open `chrome://extensions`
2. Enable **Developer mode** (top-right)
3. Click **Load unpacked**
4. Select the build output:

   ```
   extension/dist/chrome-mv3
   ```

   (NOT `extension/` — that has no `manifest.json`.)

After a code change: `make build-ext`, then click **↻** on the extension card
and reload the page.

## Fast iteration (separate clean profile)

```bash
make dev-ext          # WXT dev + HMR, launches its own Chrome profile
make dev-ext-firefox  # same, in Firefox
```

## Build outputs

- Chrome (MV3): `dist/chrome-mv3/`
- Firefox (MV2): `dist/firefox-mv2/`
