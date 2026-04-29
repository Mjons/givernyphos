# Future ideas

Parking lot for features that aren't in a current plan doc. Each entry
is a one-line description + rough scope so we can pick one up between
larger initiatives. Sorted by what feels most impactful first; reorder
freely.

## Bookmarks / scene presets

> "Save current camera + scene + density + mood as a returnable preset."

Cheap, orthogonal, real user-visible win. The data is already
serializable (camera pose is a vec3 + quat, scene is a string key,
density is a string key, director state is partially in `localStorage`
already via [DENSITY_TIERS.md](DENSITY_TIERS.md) work).

**Sketch:**

- A new `bookmarks` array in `localStorage` keyed by user-supplied
  name + auto-generated thumbnail (canvas readback, JPEG-encoded data
  URL).
- UI: a "bookmark" button in the rail that opens a panel listing saved
  bookmarks. Click → restore. Long-press / context menu → delete.
- Optional: serialize as a URL hash so bookmarks are shareable
  (`#scene=event-horizon&pos=...&density=lush&flavour=oracle`).

**Source:** [NOTES_SCALESPACE_REDDIT.md §4.4](NOTES_SCALESPACE_REDDIT.md#L176-L182)
notes that competing tools have this and it's a real differentiator.
Independent of all WebGPU work.

**Effort:** ~half a day. Mostly UI and the thumbnail capture.

---

## (Add new ideas above this line, oldest at the bottom)
