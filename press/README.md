# Press kit

Drop point for hero clips, stills, and anything a journalist or curator
might need without asking. If you're writing about Giverny Phos, take
what you need from here — no permission required, attribution
appreciated.

## What goes here

- **`hero.gif`** — the 20-second cinematic loop that lives at the top
  of the README. Three scenes, one transition. Capped at ~6 MB.
- **`hero.webm`** — the same loop, higher quality, for video embeds.
  ~1080p, ~5 Mbps.
- **`hero-90s.webm`** — the long pinned-tweet hero. Cinematic mode
  holding, breathing, transitioning, holding again.
- **`scene-clips/`** — eight 10–20 second WEBMs, one per scene. Music
  baked in.
- **`transitions/`** — three 4-second WEBMs of scene-to-scene
  transitions. The "whoa" clips.
- **`stills/`** — six 2560×1440 PNGs from cinematic mode. Same crops
  as `screenshots/` in the repo root, double-duty.
- **`logo/`** — the wordmark in SVG and PNG, on dark and on transparent.

## Naming convention

```
givernyphos_<scene>_<variant>.<ext>
```

Examples:

- `givernyphos_filament_clip.webm`
- `givernyphos_two-galaxies_still.png`
- `givernyphos_cinematic_hero90s.webm`

`<scene>` matches the scene id in `index.html`. `<variant>` is one of:
`hero`, `hero90s`, `clip`, `still`, `transition`.

## Recording settings

- 1920×1080 (or 2560×1440 if you can spare the encode time)
- 60 fps
- WEBM/VP9 for clips, GIF for the README hero only
- Music: route via OBS, baked into the file (don't ship silent video —
  the soundtrack is half the product)
- No UI overlay. Hide labels (`L`), close all panels (`Esc`), full-bleed
  the canvas

## Licence

Everything in this folder is **CC BY 4.0**. Use it in articles, posts,
videos, mood boards, presentations. Attribution: "Giverny Phos by
@unrealape, givernyphos.app."

## Contact

For interviews or anything that needs a human:
[@unrealape](https://x.com/unrealape) on X.
