/* Inline data for the Protective CO2 explainer.
   Classic script (no modules, no fetch) so the page works from file://. */
window.PCO2_DATA = {
  /* Atmospheric plates. key -> file in assets/plates/, or null for "no image"
     (null makes no request; the CSS gradient fallback for that key stays). */
  PLATES: {
    burrow: "burrow.webp",
    night: "night.webp",
    cave: "cave.webp",
    hive: "hive.webp",
    toad: "toad.webp",
    bird: "bird.webp",
    bat: "bat.webp",
    "mole-rat": "mole-rat.webp",
    womb: null
  },

  /* Hero dial: qualitative words only (no numbers). `upTo` is the upper
     bound of each band on the 0..1 dial value. */
  DIAL_WORDS: [
    { upTo: 0.15, word: "Low · stress" },
    { upTo: 0.34, word: "Low · darkness" },
    { upTo: 0.66, word: "Middle" },
    { upTo: 0.88, word: "Rich · burrow" },
    { upTo: 1.01, word: "Rich · womb" }
  ],
  DIAL_SNAPS: [0, 0.5, 1],
  DIAL_START: 0.65,

  /* Live caption under the dial (our illustration; plain caption text, no tag). */
  DIAL_CAPTIONS: [
    { upTo: 0.34, text: "Low: methyl locks settle onto the DNA; lactate rises; the membrane flutters." },
    { upTo: 0.66, text: "Middle: a few locks hover near the DNA; the mitochondria flicker." },
    { upTo: 1.01, text: "Rich: locks release; mitochondria glow; the membrane slows and deepens." }
  ],

  /* Night dial (section 4). Hours are clock positions, 0 = midnight (top).
     REM arcs are illustrative only (not to scale): more frequent and
     longer toward morning. */
  NIGHT: {
    dusk: 18.5,
    dawn: 6.5,
    rem: [
      [23.55, 23.8],
      [1.15, 1.5],
      [2.6, 3.05],
      [3.9, 4.5],
      [5.05, 5.9]
    ],
    /* Phase bands for the non-REM text panels. */
    phases: [
      { id: "dark", from: 18.5, to: 23.0 },
      { id: "rest", from: 23.0, to: 3.6 },
      { id: "late", from: 3.6, to: 6.5 }
    ],
    start: 21.0,
    /* Seconds for one full turn of the clock when auto-advancing. */
    turnSeconds: 90
  },

  /* Section 3: scroll-scrubbed steps. `at` = scroll progress (0..1) where
     each diagram element lights. */
  LOW_STEPS: 5,
  LOW_DIAGRAM: [
    { sel: "root", at: 0.02 },
    { sel: "a", at: 0.2 },
    { sel: "a-leaf", at: 0.3 },
    { sel: "b", at: 0.4 },
    { sel: "b-leaf", at: 0.48 },
    { sel: "spec", at: 0.55 },
    { sel: "side", at: 0.62 }
  ]
};
