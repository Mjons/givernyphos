---
status: draft copy for the interest-list post, 2026-09-07
---

# The mint post

Three cuts of the same message: a thread for X, one long post for
Farcaster / Discord / Paragraph, and a one-liner. Facts only where the
build stands today: 100 tokens, Ethereum, self-hosted ERC-721, no music
in the token, density by device. Price, date and allowlist mechanics are
deliberately absent — the post asks for names, the drop happens when the
list is full.

Attach: the 100-token contact sheet (`screenshots/token-plan-sheet-…png`)
or a 20-second capture of one opening tour. Stills undersell it; a clip
of the camera falling into a merger does the work.

---

## Thread (X)

**1/**
I've spent the summer building a galaxy that runs in your browser. Not a
video of one. Sixty-five thousand stars pulling on each other, sixty
times a second, on your GPU.

I'm making 100 of them. Thread on what that actually means, then a
question.

**2/**
Almost every "generative" piece you've collected is a rendering: the
code draws a picture and stops. This one never stops. It's an N-body
gravity simulation — the same math astrophysicists use — painted as
pointillism instead of plotted as data.

**3/**
Each token is a seed. The seed decides the family (a spiral, a head-on
collision, a lattice of stars that collapses, a black hole's disc), the
palette, the light, the opening film. Then physics takes over.

Gravity is chaotic. Open your token tomorrow and it is a different
performance. Same universe, never the same twice.

**4/**
The hard part wasn't the art. It was making 65k bodies behave on a
gaming GPU (WebGPU, a Barnes–Hut tree) and still open on a phone with a
lighter sky. And proving that id #63 grows the same galaxy on your
machine as on mine — we render every token headless and diff the first
frame.

**5/**
What you get: a self-contained page, no server, no network calls, so it
opens the same way in ten years. An opening tour per token. A director
that keeps watching when you don't, or the camera when you do — orbit,
follow one star through a merger, bend the light.

**6/**
Ethereum, 100 tokens, one hundred seeds, no more.

I'm not setting a date and I'm not taking DMs. I'm opening a list, and
the way onto it is a comment that connects:

Tell me the last time the sky stopped you. Where you were, what you
saw, what it did to you. Two sentences is plenty.

**7/**
Why: these pieces are made to be *watched*, and I'd rather they go to
people who watch. Every comment that answers the question gets a reply
from me and a place on the list. When it reaches 100, it drops.

The still is the token's first moments. The live piece is what it
becomes.

---

## Long post (Farcaster / Discord / Paragraph)

**A hundred living galaxies**

Most generative art you've minted is a rendering: the code runs once,
draws, and stops. What I've been building is different in kind. It's a
gravity simulation — sixty-five thousand bodies pulling on each other
sixty times a second on your own GPU — painted as a pointillist sky
instead of plotted as a chart. Nothing is pre-rendered. Nothing loops.

Each token is a seed. The seed decides which universe you get — a
grand-design spiral grown live from a cold disc, two galaxies on a
head-on course, a crystal of stars at the moment order gives way, an
accretion disc with a photon ring and a shadow — and the palette, the
light, the opening film, the temperament of the camera. Then physics
takes over, and gravity is chaotic: the same seed, opened tomorrow, is a
different performance. Same universe, never the same twice.

The complexity people don't see: making that many bodies behave on a
desktop GPU (WebGPU compute, a Barnes–Hut tree so the work grows with N
log N, not N²), keeping it honest on a phone with a lighter sky, and
proving determinism — id #63 has to grow the same galaxy on your machine
as on mine, so every token is rendered headless and its first frame is
diffed before it ships. The still image on the marketplace is that first
frame: the token's birth certificate. The live piece is what it becomes.

What you hold: one self-contained page — no server, no network requests,
so it opens the same way in ten years — with an opening tour cut for
your token, a director that keeps the camera moving when you don't, and
the controls when you do: orbit, zoom, follow a single star through a
merger, bend the light around the core. Ten families are common, six are
uncommon, two are rare. A hundred seeds, on Ethereum, and no more.

I'm not announcing a date, and there's no form. There's a question.

**Tell me the last time the sky stopped you.** Where you were, what you
saw, what it did to you. Two sentences is plenty; a paragraph is
welcome. If you'd rather, tell me which of the families above you'd want
to live inside and why — a spiral you can fall into, a collision you can
ride, a crystal at the moment it gives way.

These pieces are made to be watched, and I'd rather they go to people
who watch. Every comment that actually answers gets a reply from me and
a place on the list, in the order they arrive. When the list has a
hundred names, it drops. Nothing else gets you on it — not a wallet
address, not "gm", not a repost.

---

## One-liner

A hundred galaxies that actually run — 65k stars under real gravity in
your browser, never the same twice. Ethereum, 100 seeds. Want one? Tell
me the last time the sky stopped you. A hundred real answers, then it
drops.

---

## The ask — prompts that make a comment connect

One prompt per post; rotate if you repost. Each is answerable by anyone,
impossible to answer with "gm", and tied to what the work is.

1. **The sky.** "Tell me the last time the sky stopped you — where you
   were, what you saw, what it did to you." Universal, personal, and it
   is the piece's subject.
2. **The family.** "Which of these would you live inside, and why: a
   spiral you can fall into, a head-on collision you can ride, a
   crystal at the moment it gives way, a black hole's disc?" Makes them
   read the families, and tells you the distribution people want.
3. **The watching.** "What's a piece you've kept open on a second screen
   for an hour? What kept you there?" Selects for the collector this is
   for.
4. **The star.** "You can follow one star through a galaxy merger. Whose
   name does it carry?" Sentimental, short, and it seeds the Follow
   feature's story later.

How to run it, so the list stays honest:

- State the rule once, in the post: one comment that answers the
  question earns a reply and a place; order of arrival; nothing else
  counts (no wallets, no "gm", no reposts).
- Reply to every qualifying comment with one line back — that's the
  receipt, and it doubles the thread's reach.
- Keep the list in a plain sheet: handle, date, the sentence you liked.
  It becomes the allowlist and, later, the mint-day thank-you thread.
- When the count nears 100, say so publicly ("87 answers — 13 to go").
  Close it at 100 and post the drop date within the week.
- If the best answers exceed 100, keep the overflow as the waitlist for
  unclaimed mints.

## Notes for posting

- Say "simulation", never "animation". The whole pitch is the difference.
- Don't quote fps or body counts beyond "sixty-five thousand" and "a
  lighter sky on phones"; the tiers are a device concern, not a trait.
- Petrova / Hail Mary are not in the collection; don't reference them.
- No music in the token; the soundtrack is a separate release.
- The identity table is frozen (recipe v1). If someone asks what "seed"
  means: the token id, salted, hashed, becomes the initial conditions.
