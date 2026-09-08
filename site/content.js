// site/content.js — everything the collection site says and lists.
//
// Plain script: no modules, no fetch — the site opens from file:// for
// review. Shape is the contract in docs/active/SITE_PLAN.md §2; where
// each line comes from is in site/README.md. Assets are built by
// tools/build-site-assets.py.
(function () {
  "use strict";

  var APP_BASE = "../";
  var X = "https://x.com/unrealape";
  var LIVE = "https://six-windows-tym8.vercel.app/work/giverny-phos";

  // Seventeen families in plan order: scene key, the Family trait as it
  // appears in docs/active/token-metadata-v1.json, the family sentence
  // (docs/active/TOKEN_COPY.md), and the ids of the identity table
  // (recipe v1, frozen). Tier follows the count: 8–9 common, 4–6
  // uncommon, 2 rare.
  var FAMILIES = [
    [
      "quiet-drift",
      "Quiet Drift",
      "A cold, diffuse field settling into threads under its own weight",
      [23, 41, 47, 50, 59, 73, 85, 94, 97],
    ],
    [
      "dust-storm",
      "Dust Storm",
      "Eight heavy attractors and a sky of dust learning where to fall",
      [4, 12, 35, 39, 42, 51, 58, 86, 95],
    ],
    [
      "coma",
      "Coma Cluster",
      "A cluster of galaxies, each a knot of light, circling a common centre",
      [14, 18, 28, 64, 68, 77, 91, 100],
    ],
    [
      "lattice",
      "Lattice",
      "A crystal of stars, perfectly ordered, and the moment order gives way",
      [1, 2, 16, 30, 52, 55, 78, 88],
    ],
    [
      "orrery",
      "Orrery",
      "A sun and its planets in clean, patient orbits",
      [7, 8, 27, 43, 44, 49, 71, 92],
    ],
    [
      "milky-way",
      "Milky Way",
      "A barred spiral with its dust lanes, seen from above the disc",
      [15, 17, 32, 34, 82, 84, 87, 90],
    ],
    [
      "sombrero",
      "Sombrero",
      "An edge-on galaxy with a bright bulge and a dark lane across it",
      [21, 24, 37, 62, 66, 74, 79, 93],
    ],
    [
      "horsehead",
      "Horsehead",
      "A dense stellar nursery, light pressing through dust",
      [3, 6, 9, 19, 20, 38, 45, 67],
    ],
    [
      "collision",
      "Collision",
      "Two galaxies on a collision course, the scenario the token's own — a grazing flyby, a polar passage, a head-on merger — tidal tails, a bridge, a remnant",
      [31, 36, 60, 65, 89, 96],
    ],
    [
      "whirlpool",
      "Whirlpool",
      "A grand-design spiral grown live from a cold disc and a passing companion",
      [63, 70, 75, 80],
    ],
    [
      "cartwheel",
      "Cartwheel",
      "A compact intruder punching through a disc; a ring wave expanding outward",
      [13, 22, 54, 83],
    ],
    [
      "antennae",
      "Antennae",
      "Two spirals torn into long tidal arms as they fall together",
      [10, 11, 56, 98],
    ],
    [
      "stephans-quintet",
      "Stephan's Quintet",
      "A compact group of galaxies interacting all at once",
      [5, 29, 48, 72],
    ],
    [
      "bullet-cluster",
      "Bullet Cluster",
      "Two galaxy clusters passing through each other, gas and halos parting ways",
      [26, 46, 57, 81],
    ],
    [
      "virgo-m87",
      "Virgo · M87",
      "A giant elliptical around a supermassive black hole, with its jet",
      [25, 53, 76, 99],
    ],
    [
      "sagittarius",
      "Sagittarius",
      "The Galactic Centre: stars swinging close around the black hole",
      [61, 69],
    ],
    [
      "event-horizon",
      "Event Horizon",
      "An accretion disc, a photon ring, and the shadow at the centre",
      [33, 40],
    ],
  ];

  function tier(n) {
    return n >= 8 ? "common" : n >= 4 ? "uncommon" : "rare";
  }
  function id4(id) {
    return ("000" + id).slice(-4);
  }

  var families = FAMILIES.map(function (f) {
    return {
      scene: f[0],
      name: f[1],
      count: f[3].length,
      tier: tier(f[3].length),
      sentence: f[2],
      ids: f[3].slice(),
      hero: "assets/families/" + f[0] + ".jpg",
      thumb: "assets/families/" + f[0] + "-thumb.jpg",
    };
  });

  // All 100, in id order, from the same table.
  var tokens = [];
  families.forEach(function (f) {
    f.ids.forEach(function (id) {
      tokens.push({
        id: id,
        family: f.name,
        scene: f.scene,
        thumb: "assets/tokens/" + id4(id) + ".jpg",
      });
    });
  });
  tokens.sort(function (a, b) {
    return a.id - b.id;
  });

  // The 46 tracks, as the app lists them (TRACKS in ../index.html).
  // `file` is relative to appBase + "ssi_tracks/".
  var TRACKS = [
    ["Adjoining Room", "Adjoining Room.mp3"],
    ["After the Bowl", "After the Bowl.mp3"],
    ["Almost Hum", "Almost Hum.mp3"],
    ["Before the Cloth", "Before the Cloth.mp3"],
    ["Between the Stars", "Between the Stars.mp3"],
    ["Bough Bend", "Bough-Bend.mp3"],
    ["Cathedral, Small", "Cathedral, Small.mp3"],
    ["Chapel Stone", "Chapel Stone.mp3"],
    ["Day's Rim", "Day's Rim.mp3"],
    ["Drift", "Drift.mp3"],
    ["Eddy", "Eddy.mp3"],
    ["Filament", "Filament.mp3"],
    ["First Kindling", "First Kindling.mp3"],
    ["Gathered", "Gathered.mp3"],
    ["Hairline", "Hairline.mp3"],
    ["Held In", "Held In.mp3"],
    ["Interior", "Interior.mp3"],
    ["Inwards", "Inwards.mp3"],
    ["Lamplighter", "Lamplighter.mp3"],
    ["Lid Closing", "Lid Closing.mp3"],
    ["Lid Settling", "Lid Settling.mp3"],
    ["Limb Yield", "Limb Yield.mp3"],
    ["Long Exhale", "Long Exhale.mp3"],
    ["Long Shadow", "Long Shadow.mp3"],
    ["Longer Shadow", "Longer Shadow.mp3"],
    ["Muffled Tick", "Muffled Tick.mp3"],
    ["One Line", "One Line.mp3"],
    ["Past the Threshold", "Past the Threshold.mp3"],
    ["Quiet Drone", "Quiet Drone.mp3"],
    ["Quiet Front", "Quiet Front.mp3"],
    ["Slow Weather", "Slow Weather.mp3"],
    ["Small Fault", "Small Fault.mp3"],
    ["The Edge of Day", "The Edge of Day.mp3"],
    ["The Hold", "The Hold.mp3"],
    ["The Lip", "The Lip.mp3"],
    ["The Pair", "The Pair.mp3"],
    ["The Rim", "The Rim.mp3"],
    ["The Sisters", "The Sisters.mp3"],
    ["The Sustain", "The Sustain.mp3"],
    ["Thread", "Thread.mp3"],
    ["Threshold Again", "Threshold Again.mp3"],
    ["Tinder", "Tinder.mp3"],
    ["Two Rooms", "Two Rooms.mp3"],
    ["Wick", "Wick.mp3"],
    ["Wrapped Tick", "Wrapped Tick.mp3"],
    ["Written Behind the Stars", "Written Behind the Stars.mp3"],
  ];
  var tracks = TRACKS.map(function (t) {
    return { title: t[0], file: t[1] };
  });

  var chapters = [
    {
      key: "enter",
      kicker: "A hundred living galaxies",
      title: "Each token is a seed",
      body: [
        "Sixty-five thousand stars pulling on each other, on your own GPU, painted as a pointillist sky. Not a video of a galaxy: the galaxy, running.",
        "The sky behind this is token #63. Open it live and it is being computed as you watch — nothing pre-rendered, nothing looping — and it will never run this way again.",
      ],
      music: "The Pair",
      scene: {
        kind: "live",
        // The frames start light — standard 16k (the tier every preview
        // still was rendered at) at 1× — with the device watchdog kept
        // on; the piece opens at the device's own tier.
        url: "index.html?id=63&gallery=1&bare=1&intro=0&objects=mini&scale=1&tokenwd=on",
        poster: "assets/posters/enter.jpg",
      },
    },
    {
      key: "piece",
      kicker: "The piece",
      title: "Not a rendering",
      body: [
        "Almost every generative piece you have collected is a rendering: the code draws a picture and stops. This one never stops. It is an N-body gravity simulation — the same mathematics astrophysicists use — sixty-five thousand bodies pulling on one another, painted as pointillism instead of plotted as data.",
        "Each token is a seed. The seed decides the family — a spiral, a head-on collision, a lattice of stars that collapses, a black hole's disc — then the palette, the light, the opening film. Then physics takes over. Gravity is chaotic: open your token tomorrow and it is a different performance. Same universe, never the same twice.",
        "The film here is Rewind: one merger witnessed, frozen at closest approach, run backwards until the discs part, then replayed from inside on the follow-cam.",
      ],
      music: "Slow Weather",
      scene: {
        kind: "live",
        url: "index.html?film=rewind&bare=1&intro=0&objects=mini&scale=1",
        poster: "assets/posters/piece.jpg",
      },
    },
    {
      key: "families",
      kicker: "What the seed decides first",
      title: "Seventeen families",
      body: [
        "The seed's first draw is the family: which universe you get. Eight families are common, seven uncommon, two rare. Within a family every token differs in palette, light, spin and temperament — and then in everything that happens after the first frame.",
        "Each card opens the family's first token live; the second link browses the collection by family.",
      ],
      music: "Inwards",
    },
    {
      key: "hundred",
      kicker: "One hundred seeds",
      title: "The hundred",
      body: [
        "A hundred tokens on Ethereum, a self-hosted ERC-721, and no more. Each still here is a token at its first moments — its birth certificate. The live piece is what it becomes.",
        "Every token is one self-contained page: no server, no network requests, so it opens the same way in ten years. On a phone it runs with a lighter sky; the physics is the same.",
      ],
      music: "Filament",
    },
    {
      key: "mint",
      kicker: "The list",
      title: "The question",
      body: [
        "There is no date and there is no form. There is a question, and the way onto the list is a comment that answers it.",
        "These pieces are made to be watched, and I'd rather they go to people who watch. Nothing else gets you on the list — not a wallet address, not “gm”, not a repost.",
      ],
      music: "Threshold Again",
    },
    {
      key: "music",
      kicker: "Forty-six tracks",
      title: "The soundtrack",
      body: [
        "The music on this site is the project's own: forty-six pieces written for it, released CC-BY. Use them in your own work and credit @unrealape.",
        "The tokens carry no music. The soundtrack belongs to this site and to the films; a galaxy on its own is quiet.",
      ],
      music: "Lamplighter",
    },
    {
      key: "credits",
      kicker: "Colophon",
      title: "A garden of light, still growing",
      body: [
        "Three principles, from the start. The Phosphene Effect: the fleeting, dreamlike quality of light between observation and imagination. Pointillist Space: the galaxy as a collection of luminous points, dots converging into texture. Curated Chaos: the simulation makes the beauty on its own; the work is choosing what to keep.",
        "Made by @unrealape. Code MIT; three.js © 2010–2023 three.js authors, MIT.",
      ],
      music: "Long Exhale",
    },
  ];

  window.PHOS_CONTENT = {
    appBase: APP_BASE,
    site: {
      title: "Giverny Phos",
      subtitle: "The Hundred",
      oneLine:
        "A hundred living galaxies. Each token is a seed; every viewing is a performance.",
      tagline: "Never the same twice.",
      author: "@unrealape",
      x: X,
      live: LIVE,
      ogImage: "assets/og.jpg",
    },
    chapters: chapters,
    families: families,
    tokens: tokens,
    mint: {
      question: "Tell me the last time the sky stopped you.",
      detail:
        "Where you were, what you saw, what it did to you. Two sentences is plenty.",
      rule: "Every comment that answers gets a reply and a place on the list, in order of arrival. When it reaches 100, it drops.",
      cta: "Answer on X",
      link: X,
      facts: [
        "Ethereum",
        "100 tokens, one hundred seeds, no more",
        "a self-hosted ERC-721",
        "no music in the token — the soundtrack is this site's",
        "a lighter sky on phones; the same physics",
      ],
    },
    tracks: tracks,
    credits: {
      author: "@unrealape",
      license:
        "Code © the author, MIT; three.js © 2010–2023 three.js authors, MIT. The piece runs without music; the project's soundtrack is a separate CC-BY release.",
      tech: [
        "WebGPU compute: sixty-five thousand bodies under gravity, on your GPU",
        "A Barnes–Hut tree, so the work grows as N log N rather than N²",
        "One self-contained page: no server, no network requests, no build",
        "An opening tour cut for each token, then a director that keeps the camera moving when you don't",
        "The follow-cam: ride one star through a merger",
        "The lens: bend the light around the core",
        "Time in the holder's hands: ½× to 3×, and rewind",
        "Deterministic seeds: every token is rendered headless and its first frame diffed before it ships",
      ],
      links: [
        { label: "@unrealape on X", href: X },
        { label: "The live page", href: LIVE },
        {
          label: "github.com/givernyphos",
          href: "https://github.com/givernyphos",
        },
        { label: "Open the app", href: APP_BASE + "index.html" },
        { label: "The collection viewer", href: APP_BASE + "collection.html" },
      ],
    },
  };
})();
