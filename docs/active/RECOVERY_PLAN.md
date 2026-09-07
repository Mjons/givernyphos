---
status: plan, 2026-09-06 — launch board p7-recovery
last-updated: 2026-09-06
---

# Recovery plan — what can and cannot change after the mint

The collection is a hundred seeds and one bundle. Once a token is
minted its _identity_ is fixed; its _rendering_ can still be repaired.
This page says which is which, what we keep where, and the steps for
each kind of trouble.

## 1. What is immutable once minted

| thing                        | where it lives                                      | why it cannot change                                                  |
| ---------------------------- | --------------------------------------------------- | --------------------------------------------------------------------- |
| `TOKEN_RECIPE_V = 1`         | `index.html` (token section)                        | the draw order and weights that turn `salt:id` into a recipe          |
| `TOKEN_ID_SALT`              | `index.html`                                        | the string every id is hashed with                                    |
| `TOKEN_PLAN` (family per id) | `index.html` + `docs/active/token-metadata-v1.json` | the identity table; the archive is the committed, human-readable copy |
| traits per id                | `docs/active/token-metadata-v1.json`                | what the metadata says the token is                                   |
| the minted bundle's hash     | `dist/token.manifest.json` → CHANGELOG at freeze    | proves what was pinned; a rebuild is checked against it               |

A recipe change (weights, draw order, a family in or out) is
**recipe v2**: it applies to new tokens only. Minted ids keep v1
forever — the code keeps the v1 path and picks by the id's version.

## 2. What may change

- **Rendering and physics fixes** that keep the same recipe: the bloom
  clamp, the lattice generator, a shader bug, a performance lever. These
  change how a token _looks_, not what it _is_. They ship as a new
  pinned bundle (§4).
- **The tier a device gets**, the watchdog's levers, the UI chrome.
- **Copy** in the marketplace description (metadata JSON is regenerated
  from the archive; the traits do not move).

## 3. What we keep, and where (before the mint)

1. Two pins of the bundle folder (IPFS or Arweave) — board p7-pins.
2. An offline copy: `dist/token.zip`, `dist/token.manifest.json`,
   `docs/active/token-metadata-v1.json`, the salt, this file.
3. The metadata folder as pinned (`dist/metadata/`), with its
   `summary.csv`.
4. The git tag of the commit the bundle was built from (the manifest
   records the commit hash).

## 4. If a family looks wrong after the mint

1. Reproduce with the harness on the pinned bundle:
   `python3 tools/health-check.py --base <gateway>/<cid> --ids <the ids>`
   and `tools/build-metadata.py --ids … --source <a local copy>`.
2. Fix it in `index.html` **without touching the recipe** (no change to
   `deriveTokenRecipe`, the plan, the salt, the draw order). Run the
   determinism check: the identity archive regenerated from the fixed
   build must be byte-identical (`build-metadata.py --archive`, then
   `git diff docs/active/token-metadata-v1.json` is empty).
3. Rebuild (`node tools/build-token.mjs`), record the new manifest hash
   in the CHANGELOG next to the old one, pin the new folder twice.
4. Point the contract at it. With a self-hosted ERC-721 the `tokenURI`
   base is updatable by the owner: regenerate the JSON with
   `build-metadata.py --no-render --base <new bundle> --images <previews>`
   and pin the metadata folder; update the base URI once. The old bundle
   stays pinned — nothing that was minted ever 404s.
5. Re-run the health check from the gateway; note the date and the two
   hashes in the CHANGELOG.

If the wrongness _is_ the recipe (a family reads badly by design), the
answer is a recipe v2 for future editions and, for the minted ids, a
rendering-side adjustment per family (`TOKEN_EXPOSURE_MUL`,
`TOKEN_CAM_DIST`, `TOKEN_PREROLL` — all outside the recipe).

## 5. If the gateway or a pin dies

- The second pin serves the same CID; nothing to do but re-pin a third.
- If both are gone, re-pin from the offline copy: the CID is content-
  addressed, so the original `animation_url` resolves again unchanged.
- A marketplace that cached a broken preview: refresh its metadata
  (they all expose a refresh) once the pin is back.

## 6. Weekly

`python3 tools/health-check.py --base <gateway>/<cid>` — ten ids per
ISO week, flags errors, black or blown frames, exit 1 on any. Keep the
printed table in the CHANGELOG's ops log or a `docs/ops/` note.
