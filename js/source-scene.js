/* Section 2, "Where the CO2 comes from": cat and crocodile on one canvas.
   Classic script (no modules), works from file:// and without GSAP.

   One value drives the whole scene: zoom z, 0 = "body" view (both whole
   animals; the crocodile huge and long, the cat small) and 1 = "brain" view
   (camera in on the two heads, where the equal-sized amber brains dominate).
   Teal motes rise from each brain at the same rate in every view.

   Inputs, all writing the same spring target:
   - the .seg-btn[data-scale] buttons (is-on + aria-pressed follow the target)
   - the scrub slider between them (pointer + arrow keys)
   - horizontal drag on the stage (touch-action: pan-y, so vertical swipes
     still scroll the page on phones)
   - desktop + ScrollTrigger: a short pin (< 1 viewport) scrubs body -> brain.
   Release springs to the nearest end with a small bounce. Without the pin,
   the scene glides from body to brain once, the first time it is seen.
   prefers-reduced-motion: static brain view, frames only drawn on demand.
   The loop stops offscreen and in hidden tabs. */
(function () {
  "use strict";

  var stage = document.getElementById("source-stage");
  var canvas = document.getElementById("source-canvas");
  var ctx = canvas && canvas.getContext && canvas.getContext("2d");
  if (!stage || !ctx) return;

  var pinEl = document.getElementById("source-pin");
  var scrub = document.getElementById("source-scrub");
  var scrubFill = document.getElementById("source-scrub-fill");
  var scrubThumb = document.getElementById("source-scrub-thumb");
  var payoff = document.getElementById("source-payoff");
  var buttons = document.querySelectorAll(".seg-btn[data-scale]");

  var reduce = false, coarse = false;
  try {
    reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    coarse = window.matchMedia("(pointer: coarse)").matches;
  } catch (err) { /* matchMedia missing */ }

  var TAU = Math.PI * 2;
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function smooth(t) { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); }
  function rgba(c, a) { return "rgba(" + c[0] + "," + c[1] + "," + c[2] + "," + clamp(a, 0, 1).toFixed(3) + ")"; }
  function rng(seed) {
    var s = seed % 2147483647;
    if (s <= 0) s += 2147483646;
    return function () { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
  }

  var AMBER = [255, 179, 71], DEEP = [224, 138, 30], HOT = [255, 243, 214], TEAL = [94, 242, 214], INK = [239, 230, 214];

  function sprite(color) {
    var c = document.createElement("canvas");
    c.width = c.height = 64;
    var g = c.getContext("2d");
    var grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, rgba(color, 1));
    grd.addColorStop(0.2, rgba(color, 0.8));
    grd.addColorStop(0.5, rgba(color, 0.2));
    grd.addColorStop(1, rgba(color, 0));
    g.fillStyle = grd;
    g.fillRect(0, 0, 64, 64);
    return c;
  }
  var SPR_TEAL = sprite(TEAL), SPR_AMBER = sprite(AMBER);

  /* ---------- the animals (world units; ground at y = 0, y down) ---------- */

  /* Brain cores are the same world size in both animals. */
  var BRAIN_R = 0.06;

  /* Cat: sitting, profile, facing right. Drawn in local units (sitting
     height ~105), scaled into the world. */
  var CAT = { x: 0, s: 0.0078 };
  var catBody = new Path2D(
    "M -27 0 C -41 -9 -42 -33 -26 -46 C -15 -55 -3 -60 5 -71 " +
    "C 8 -76 9 -82 12 -87 L 14 -102 L 21 -92 L 28 -105 L 33 -90 " +
    "C 37 -88 40 -84 41 -80 L 42.5 -77.5 C 41.5 -74 39 -72 36.5 -71 " +
    "C 34 -68.5 31 -66.5 29 -62 C 30 -50 29 -31 26 -15 C 25 -8 26 -3 31 -1.2 " +
    "C 33 -0.6 33 0 31 0 L 17 0 C 18 -3 16 -6 13 -7 C 4 -9 -6 -6 -11 0 Z");
  var catTail = new Path2D(
    "M -26 -3 C -46 -1 -57 -17 -51 -33 C -50 -36 -46.5 -36 -46.5 -32.5 " +
    "C -51 -19 -43 -8.5 -24 -8.5 Z");
  var catWhiskers = new Path2D("M 39 -74 C 47 -76 53 -75 58 -72 M 39 -73 C 47 -72 52 -69 56 -65 M 38 -75 C 45 -79 50 -80 55 -79");
  var CAT_BRAIN = { lx: 23, ly: -82 };

  /* Crocodile: high walk, profile, facing left (snout toward the cat).
     Local units (length 1000); the back and tail carry a row of scutes. */
  var CROC = { x: 0.62, s: 0.0076 };
  function catmull(pts, n) {
    var out = [];
    for (var i = 0; i < pts.length - 1; i++) {
      var p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
      for (var k = 0; k < n; k++) {
        var t = k / n, t2 = t * t, t3 = t2 * t;
        out.push([
          0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
          0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3)
        ]);
      }
    }
    out.push(pts[pts.length - 1]);
    return out;
  }
  function buildCroc() {
    var p = new Path2D();
    /* head: snout tip, nostril, eye knob, skull table */
    p.moveTo(0, -56);
    p.bezierCurveTo(2, -62, 8, -66, 16, -67);
    p.bezierCurveTo(22, -71, 27, -70, 30, -67);
    p.bezierCurveTo(60, -69, 100, -74, 132, -82);
    p.bezierCurveTo(142, -96, 156, -106, 168, -104);
    p.bezierCurveTo(178, -103, 182, -96, 184, -92);
    p.bezierCurveTo(205, -94, 222, -96, 240, -101);
    /* back and tail with scutes */
    var back = catmull([[240, -101], [300, -124], [380, -140], [480, -146], [560, -140], [630, -126], [760, -98], [880, -64], [1000, -34]], 14);
    for (var i = 1; i < back.length; i++) {
      var a = back[i - 1], b = back[i];
      var x = (a[0] + b[0]) / 2;
      var amp = x < 290 ? 0 : x < 620 ? 7 : lerp(9, 3, (x - 620) / 380);
      p.lineTo(a[0] + (b[0] - a[0]) * 0.3, a[1] + (b[1] - a[1]) * 0.3);
      p.lineTo(x, (a[1] + b[1]) / 2 - amp);
      p.lineTo(b[0], b[1]);
    }
    /* tail underside back to the hips */
    var under = catmull([[1000, -29], [880, -44], [760, -62], [650, -76]], 10);
    for (var j = 1; j < under.length; j++) p.lineTo(under[j][0], under[j][1]);
    /* near hind leg */
    p.bezierCurveTo(664, -62, 664, -40, 650, -22);
    p.bezierCurveTo(646, -14, 652, -6, 664, -3);
    p.bezierCurveTo(676, -1, 680, 0, 674, 0);
    p.lineTo(612, 0);
    p.bezierCurveTo(606, -2, 610, -10, 618, -14);
    p.bezierCurveTo(626, -30, 618, -52, 596, -66);
    /* belly */
    p.bezierCurveTo(540, -60, 440, -60, 380, -62);
    /* near front leg */
    p.bezierCurveTo(384, -48, 378, -30, 366, -16);
    p.bezierCurveTo(362, -9, 368, -4, 380, -2);
    p.bezierCurveTo(390, -0.5, 390, 0, 384, 0);
    p.lineTo(330, 0);
    p.bezierCurveTo(326, -3, 332, -10, 338, -14);
    p.bezierCurveTo(342, -30, 336, -50, 318, -66);
    /* chest, throat, lower jaw back to the snout */
    p.bezierCurveTo(290, -70, 254, -64, 226, -60);
    p.bezierCurveTo(190, -54, 160, -48, 120, -46);
    p.bezierCurveTo(80, -44, 40, -42, 14, -45);
    p.bezierCurveTo(5, -46, 0, -50, 0, -56);
    p.closePath();
    return p;
  }
  var crocBody = buildCroc();
  var crocFar = new Path2D(
    "M 430 -70 C 446 -50 444 -30 432 -14 C 428 -7 434 -3 446 -2 L 450 0 L 402 0 C 398 -4 404 -10 410 -14 C 420 -32 418 -52 404 -66 Z " +
    "M 700 -86 C 716 -66 716 -40 704 -22 C 700 -12 706 -5 718 -3 L 722 0 L 664 0 C 662 -4 668 -10 676 -14 C 688 -34 684 -60 664 -80 Z");
  var crocMouth = (function () {
    var p = new Path2D();
    p.moveTo(18, -54);
    for (var x = 18; x < 196; x += 11) {
      var y = -54 - (x - 18) * 0.03;
      p.lineTo(x + 5.5, y + (x < 150 ? 3.2 : 1.4));
      p.lineTo(x + 11, y - 0.4);
    }
    return p;
  })();
  var CROC_EYE = { lx: 166, ly: -96 };
  var CROC_BRAIN = { lx: 204, ly: -84 };

  function brainWorld(a, b) { return { x: a.x + b.lx * a.s, y: b.ly * a.s }; }
  var catBrainW = brainWorld(CAT, CAT_BRAIN);
  var crocBrainW = brainWorld(CROC, CROC_BRAIN);

  /* ---------- camera ---------- */

  var W = 1, H = 1, dpr = 1, reserveTop = 0, reserveBottom = 0, portrait = false;
  var camBody = { cx: 0, cy: 0, s: 1 }, camBrain = { cx: 0, cy: 0, s: 1 }, cam = { cx: 0, cy: 0, s: 1 };

  /* The open area is [reserveTop, H - reserveBottom]: the heading overlay
     sits above it and the controls overlay below it (desktop only). */
  function frameViews() {
    portrait = H > W * 1.05;
    var usableH = Math.max(120, H - reserveTop - reserveBottom);
    /* body view: both whole animals, ground near the bottom of the usable area */
    var x0 = -0.62, x1 = CROC.x + 1000 * CROC.s + 0.12;
    var s0 = Math.min((W * 0.94) / (x1 - x0), (usableH * 0.55) / 1.25);
    var groundY = reserveTop + usableH * (portrait ? 0.74 : 0.8);
    camBody = { cx: (x0 + x1) / 2, cy: -(groundY - H / 2) / s0, s: s0 };
    /* brain view: the two heads side by side, brains at the same height,
       sitting a little below the middle of the open area so the labels and
       the rising motes have room above them (nothing clipped at the top).
       Heads, brains and labels stay inside the open area; the lower bodies
       may run on under the bottom controls' vignette. */
    var hx0 = portrait ? 0.02 : -0.2, hx1 = crocBrainW.x + (portrait ? 0.22 : 0.36);
    var s1 = Math.min((W * 0.94) / (hx1 - hx0), usableH);
    var by = (catBrainW.y + crocBrainW.y) / 2;
    var brainScreenY = reserveTop + usableH * (portrait ? 0.56 : 0.58);
    camBrain = { cx: (hx0 + hx1) / 2, cy: by - (brainScreenY - H / 2) / s1, s: s1 };
  }

  /* Zoom keeps the focus point steady: scale moves in log space and the
     centre moves linearly in 1/scale. Works slightly past both ends too
     (the release bounce). */
  function setCamera(z) {
    var ls = lerp(Math.log(camBody.s), Math.log(camBrain.s), z);
    var s = Math.exp(ls);
    var k = (1 / camBody.s - 1 / s) / (1 / camBody.s - 1 / camBrain.s);
    cam.s = s;
    cam.cx = lerp(camBody.cx, camBrain.cx, k);
    cam.cy = lerp(camBody.cy, camBrain.cy, k);
  }
  function sx(x) { return (x - cam.cx) * cam.s + W / 2; }
  function sy(y) { return (y - cam.cy) * cam.s + H / 2; }

  /* ---------- state ---------- */

  var z = reduce ? 1 : 0;        /* drawn zoom */
  var target = z;                /* spring target */
  var vel = 0;
  /* spring per input: release/buttons overshoot a little, scroll follows
     closely without overshoot, the one-time demo glides slowly */
  var SPRINGS = { bounce: { k: 42, c: 8.2 }, follow: { k: 70, c: 16.7 }, soft: { k: 9, c: 6 } };
  var spring = SPRINGS.follow;
  var dragging = false;
  var interacted = false;
  var t = 0, last = 0, raf = 0, onScreen = false, seen = false;
  var st = null, pinned = false;

  var R = rng(23);
  var dust = [];
  var nDust = coarse ? 46 : 80;
  for (var i = 0; i < nDust; i++) dust.push({ x: R(), y: R(), z: 0.2 + R() * 0.8, ph: R() * TAU, sp: 0.2 + R() * 0.6, warm: R() < 0.35 });

  /* CO2 motes: same emission schedule for both brains, independent jitter. */
  var motes = [];
  var emitters = [
    { w: catBrainW, acc: 0.3, r: rng(5), ph: 0 },
    { w: crocBrainW, acc: 0.0, r: rng(9), ph: 1.3 }
  ];
  var RATE = coarse ? 3.2 : 4.2;   /* motes per second, per brain */
  var LIFE = 5.2;

  function emit(e, age) {
    var r = e.r;
    motes.push({
      e: e, age: age || 0, life: LIFE * (0.75 + r() * 0.5),
      a: r() * TAU, sp: 0.75 + r() * 0.5, sway: 8 + r() * 14, sz: 0.7 + r() * 0.9, ph: r() * TAU
    });
  }
  /* Pre-seed so the scene starts alive (and the reduced-motion still has motes). */
  for (var p = 0; p < RATE * LIFE * 0.9; p++) { emit(emitters[0], p / RATE); emit(emitters[1], p / RATE + 0.11); }

  /* ---------- drawing ---------- */

  function drawBackground(zz) {
    ctx.fillStyle = "#07060a";
    ctx.fillRect(0, 0, W, H);
    var gy = sy(0);
    /* warm lamplight pooled between the animals, behind them */
    var lx = sx((catBrainW.x + crocBrainW.x) / 2), ly = Math.min(H * 1.1, gy);
    var rad = Math.max(W, H) * lerp(0.75, 0.6, zz);
    var g = ctx.createRadialGradient(lx, ly, 0, lx, ly, rad);
    g.addColorStop(0, "rgba(224,138,30,0.20)");
    g.addColorStop(0.35, "rgba(150,80,20,0.08)");
    g.addColorStop(1, "rgba(7,6,10,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    /* earth below the ground line */
    if (gy < H) {
      var e = ctx.createLinearGradient(0, gy, 0, Math.min(H, gy + Math.max(80, cam.s * 0.8)));
      e.addColorStop(0, "rgba(30,18,10,0.95)");
      e.addColorStop(1, "rgba(10,8,9,1)");
      ctx.fillStyle = e;
      ctx.fillRect(0, gy, W, H - gy);
      /* rim of light along the ground */
      var hg = ctx.createLinearGradient(0, 0, W, 0);
      hg.addColorStop(0, "rgba(255,179,71,0)");
      hg.addColorStop(clamp((lx / W) - 0.25, 0.01, 0.98), "rgba(255,179,71,0.05)");
      hg.addColorStop(clamp(lx / W, 0.02, 0.98), "rgba(255,190,110,0.32)");
      hg.addColorStop(clamp((lx / W) + 0.3, 0.03, 0.99), "rgba(255,179,71,0.06)");
      hg.addColorStop(1, "rgba(255,179,71,0)");
      ctx.fillStyle = hg;
      ctx.fillRect(0, gy - 0.5, W, 1.2);
    }
  }

  function drawDust(dt, zz) {
    var pan = (cam.cx - camBody.cx) * cam.s;
    var zr = cam.s / camBody.s;
    for (var i = 0; i < dust.length; i++) {
      var d = dust[i];
      d.y -= dt * 0.006 * d.sp;
      d.x += dt * 0.003 * Math.sin(t * 0.3 + d.ph);
      if (d.y < -0.05) d.y += 1.1;
      var depth = d.z;
      var x = (d.x * W - W / 2) * (1 + (Math.pow(zr, 0.12 * depth) - 1)) + W / 2 - pan * 0.04 * depth;
      x = ((x % W) + W) % W;
      var y = d.y * H;
      var a = (0.06 + 0.16 * depth) * (0.6 + 0.4 * Math.sin(t * d.sp * 1.7 + d.ph));
      var s = (1.5 + 3.5 * depth) * (1 + zz * 0.4 * depth);
      ctx.globalAlpha = clamp(a, 0, 1);
      ctx.drawImage(d.warm ? SPR_AMBER : SPR_TEAL, x - s, y - s, s * 2, s * 2);
    }
    ctx.globalAlpha = 1;
  }

  /* Silhouette with amber rim light: near-black fill, then (clipped to the
     shape) layered strokes whose colour comes from a top-down light and from
     the animal's own brain. */
  function drawBeast(a, body, extras, brainW, breathe, zz, kind) {
    var s = a.s * cam.s;
    var ox = sx(a.x), oy = sy(0);
    ctx.save();
    ctx.translate(ox, oy);
    ctx.scale(s, s * (1 + breathe));
    var px = 1 / s;

    var top = kind === "cat" ? -106 : -150;
    var fill = ctx.createLinearGradient(0, top, 0, 0);
    fill.addColorStop(0, "#1a120c");
    fill.addColorStop(0.45, "#0d0a0b");
    fill.addColorStop(1, "#08070a");

    /* soft outer halo (atmosphere around the backlit body) */
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.strokeStyle = "rgba(255,170,80," + (0.05 + 0.03 * zz).toFixed(3) + ")";
    ctx.lineWidth = 10 * px;
    ctx.stroke(body);
    ctx.lineWidth = 4 * px;
    ctx.strokeStyle = "rgba(255,170,80,0.07)";
    ctx.stroke(body);

    ctx.fillStyle = fill;
    ctx.fill(body);

    ctx.save();
    ctx.clip(body);
    var rim = ctx.createLinearGradient(0, top, 0, 0);
    rim.addColorStop(0, rgba([255, 200, 130], 0.95));
    rim.addColorStop(0.35, rgba(AMBER, 0.55));
    rim.addColorStop(0.75, rgba(DEEP, 0.12));
    rim.addColorStop(1, rgba(DEEP, 0.03));
    var widths = [1.3, 3.5, 9, 20], alphas = [0.9, 0.4, 0.16, 0.07];
    for (var i = 0; i < widths.length; i++) {
      ctx.globalAlpha = alphas[i] * (0.85 + 0.15 * Math.sin(t * 0.9 + (kind === "cat" ? 0 : 1.7)));
      ctx.strokeStyle = rim;
      ctx.lineWidth = widths[i] * px;
      ctx.stroke(body);
    }
    /* the brain lights its own head from inside */
    var bl = { x: (brainW.x - a.x) / a.s, y: brainW.y / a.s };
    var reach = (BRAIN_R / a.s) * lerp(4.5, 5.5, zz);
    var glow = ctx.createRadialGradient(bl.x, bl.y, 0, bl.x, bl.y, reach);
    glow.addColorStop(0, "rgba(255,210,140,0.34)");
    glow.addColorStop(0.4, "rgba(255,170,70,0.1)");
    glow.addColorStop(1, "rgba(255,170,70,0)");
    ctx.globalAlpha = 1;
    ctx.fillStyle = glow;
    ctx.fillRect(bl.x - reach, bl.y - reach, reach * 2, reach * 2);
    ctx.strokeStyle = glow;
    ctx.lineWidth = 6 * px;
    ctx.stroke(body);
    ctx.restore();

    if (extras) extras(px, zz);
    ctx.restore();
  }

  function catExtras(px, zz) {
    /* tail sits behind the haunch visually but shares the rim treatment */
    ctx.fillStyle = "#0c090a";
    ctx.fill(catTail);
    ctx.save();
    ctx.clip(catTail);
    ctx.strokeStyle = "rgba(255,190,110,0.7)";
    ctx.lineWidth = 1.4 * px;
    ctx.stroke(catTail);
    ctx.restore();
    ctx.strokeStyle = "rgba(255,215,160," + (0.25 + 0.3 * zz).toFixed(3) + ")";
    ctx.lineWidth = 0.9 * px;
    ctx.stroke(catWhiskers);
  }
  function crocExtras(px, zz) {
    ctx.strokeStyle = "rgba(255,200,130," + (0.18 + 0.3 * zz).toFixed(3) + ")";
    ctx.lineWidth = 1 * px;
    ctx.stroke(crocMouth);
    /* eye knob catches a little light (kept faint so it never reads as a brain) */
    ctx.beginPath();
    ctx.ellipse(CROC_EYE.lx, CROC_EYE.ly, 5, 2.4, -0.15, 0, TAU);
    ctx.fillStyle = "rgba(255,200,130," + (0.12 + 0.18 * zz).toFixed(3) + ")";
    ctx.fill();
  }
  function crocFarLegs() {
    var s = CROC.s * cam.s;
    ctx.save();
    ctx.translate(sx(CROC.x), sy(0));
    ctx.scale(s, s);
    ctx.fillStyle = "#060508";
    ctx.fill(crocFar);
    ctx.strokeStyle = "rgba(224,138,30,0.18)";
    ctx.lineWidth = 1 / s;
    ctx.stroke(crocFar);
    ctx.restore();
  }

  function drawBrain(bw, ph, zz) {
    var x = sx(bw.x), y = sy(bw.y);
    var r = BRAIN_R * cam.s;
    var pulse = 1 + 0.06 * Math.sin(t * 1.6 + ph);
    /* screen-space emphasis so the brains read even in the wide view */
    var halo = Math.max(r * lerp(4.6, 3.6, zz), lerp(26, 44, zz)) * pulse;
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = lerp(0.55, 0.7, zz);
    ctx.drawImage(SPR_AMBER, x - halo, y - halo, halo * 2, halo * 2);
    ctx.globalAlpha = 0.85;
    var mid = Math.max(r * 1.9, 9) * pulse;
    ctx.drawImage(SPR_AMBER, x - mid, y - mid, mid * 2, mid * 2);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    var core = Math.max(r, 2.6) * (1 + 0.03 * Math.sin(t * 1.6 + ph));
    var g = ctx.createRadialGradient(x - core * 0.25, y - core * 0.3, 0, x, y, core);
    g.addColorStop(0, rgba(HOT, 1));
    g.addColorStop(0.55, rgba([255, 205, 130], 1));
    g.addColorStop(1, rgba(AMBER, 0.95));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(x, y, core * 1.12, core * 0.9, 0, 0, TAU);
    ctx.fill();
    /* folds, only once the core is big enough to show them */
    if (core > 11) {
      ctx.save();
      ctx.globalAlpha = clamp((core - 11) / 10, 0, 1) * 0.45;
      ctx.strokeStyle = "rgba(190,100,20,1)";
      ctx.lineWidth = Math.max(1, core * 0.07);
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(x - core * 0.7, y - core * 0.1);
      ctx.bezierCurveTo(x - core * 0.4, y - core * 0.5, x - core * 0.1, y + core * 0.2, x + core * 0.15, y - core * 0.35);
      ctx.moveTo(x - core * 0.35, y + core * 0.45);
      ctx.bezierCurveTo(x - core * 0.05, y + core * 0.1, x + core * 0.3, y + core * 0.55, x + core * 0.75, y + core * 0.05);
      ctx.moveTo(x + core * 0.05, y - core * 0.72);
      ctx.bezierCurveTo(x + core * 0.35, y - core * 0.45, x + core * 0.5, y - core * 0.6, x + core * 0.8, y - core * 0.3);
      ctx.stroke();
      ctx.restore();
    }
  }

  function stepMotes(dt) {
    if (dt > 0) {
      for (var k = 0; k < emitters.length; k++) {
        var e = emitters[k];
        e.acc += dt * RATE * (0.8 + 0.4 * e.r());
        while (e.acc >= 1) { e.acc -= 1; emit(e, 0); }
      }
    }
    for (var i = motes.length - 1; i >= 0; i--) {
      motes[i].age += dt;
      if (motes[i].age > motes[i].life) motes.splice(i, 1);
    }
  }
  function drawMotes(zz) {
    var k = lerp(0.85, 1.1, zz) * (H < 560 ? 0.8 : 1);
    var rise = 48 * k;                 /* px per second at full speed */
    ctx.globalCompositeOperation = "lighter";
    for (var i = 0; i < motes.length; i++) {
      var m = motes[i];
      var u = m.age / m.life;
      var bx = sx(m.e.w.x), by = sy(m.e.w.y);
      var spread = 3 + u * 22 * k;
      var x = bx + Math.cos(m.a) * spread * 0.6 + Math.sin(m.age * 0.9 + m.ph) * m.sway * u * k;
      var y = by - m.age * rise * m.sp + Math.sin(m.a) * spread * 0.3;
      var a = Math.sin(Math.min(1, u * 1.15) * Math.PI) * 0.9;
      if (u < 0.08) a *= u / 0.08;
      var s = (2.2 + m.sz * 3.2) * (0.7 + 0.5 * u) * lerp(1, 1.5, zz);
      ctx.globalAlpha = clamp(a, 0, 1);
      ctx.drawImage(SPR_TEAL, x - s * 2, y - s * 2, s * 4, s * 4);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  }

  /* screen rects of the labels drawn this frame (for keeping the hint clear) */
  var labelRects = [];
  function noteLabel(x, y, half, size, pad) {
    if (ctx.globalAlpha > 0.02) labelRects.push({ l: x - half, r: x + half, t: y - size - pad, b: y + 4 + pad });
  }

  function drawLabels(zz) {
    var size = W < 600 ? 12 : 14;
    labelRects.length = 0;
    ctx.font = "500 " + size + "px \"Space Grotesk\", system-ui, sans-serif";
    ctx.textBaseline = "alphabetic";
    var a = 0.62;
    ctx.fillStyle = "rgba(239,230,214," + a + ")";
    var gy = sy(0);
    if (zz < 0.5) {
      var fade = 1 - smooth(zz / 0.5);
      ctx.globalAlpha = fade;
      ctx.textAlign = "center";
      var ly = Math.min(H - reserveBottom - 6, gy + size + 12);
      var catX = sx(CAT.x - 0.05), crocX = sx(CROC.x + 480 * CROC.s);
      ctx.fillText("cat", catX, ly);
      ctx.fillText("crocodile", crocX, ly);
      noteLabel(catX, ly, ctx.measureText("cat").width / 2, size, 0);
      noteLabel(crocX, ly, ctx.measureText("crocodile").width / 2, size, 0);
    } else {
      ctx.globalAlpha = smooth((zz - 0.5) / 0.5);
      ctx.textAlign = "center";
      if (portrait) {
        /* phone: in the earth band under the ground line, where no motes go */
        var under = Math.min(H - reserveBottom - 6, gy + size + 14);
        brainLabel("cat", sx(catBrainW.x), under, false);
        brainLabel("crocodile", sx(crocBrainW.x), under, false);
      } else {
        /* above the heads, clear of the ears and the skull, each on an
           opaque pill drawn after the motes so they pass behind it */
        var off = Math.max(BRAIN_R * cam.s * 4.2, 52);
        brainLabel("cat", sx(catBrainW.x), sy(catBrainW.y) - off, true);
        brainLabel("crocodile", sx(crocBrainW.x), sy(crocBrainW.y) - off, true);
      }
    }
    ctx.globalAlpha = 1;
  }
  /* x is clamped so the label (and its pill) stays on screen */
  function brainLabel(text, x, y, pill) {
    var size = W < 600 ? 12 : 14, pad = 8;
    var half = ctx.measureText(text).width / 2 + (pill ? pad : 0);
    x = clamp(x, half + 6, W - half - 6);
    noteLabel(x, y, half, size, pill ? pad - 2 : 0);
    if (pill) {
      var top = y - size - pad + 2, h = size + pad * 2, r = h / 2;
      ctx.fillStyle = "rgba(7,6,10,.8)";
      ctx.beginPath();
      ctx.moveTo(x - half + r, top);
      ctx.lineTo(x + half - r, top);
      ctx.arc(x + half - r, top + r, r, -Math.PI / 2, Math.PI / 2);
      ctx.lineTo(x - half + r, top + h);
      ctx.arc(x - half + r, top + r, r, Math.PI / 2, Math.PI * 1.5);
      ctx.closePath();
      ctx.fill();
    }
    ctx.fillStyle = "rgba(239,230,214,0.62)";
    ctx.fillText(text, x, y);
  }

  function vignette() {
    var g = ctx.createRadialGradient(W / 2, H * 0.45, Math.min(W, H) * 0.35, W / 2, H * 0.5, Math.max(W, H) * 0.78);
    g.addColorStop(0, "rgba(7,6,10,0)");
    g.addColorStop(1, "rgba(7,6,10,0.85)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    if (reserveBottom > 0) {
      var b = ctx.createLinearGradient(0, H - reserveBottom - 60, 0, H);
      b.addColorStop(0, "rgba(7,6,10,0)");
      b.addColorStop(0.45, "rgba(7,6,10,0.72)");
      b.addColorStop(1, "rgba(7,6,10,0.94)");
      ctx.fillStyle = b;
      ctx.fillRect(0, H - reserveBottom - 60, W, reserveBottom + 60);
    }
    /* the heading overlay brings its own gradient */
    if (reserveTop > 0) return;
    var tg = ctx.createLinearGradient(0, 0, 0, H * 0.12);
    tg.addColorStop(0, "rgba(7,6,10,0.9)");
    tg.addColorStop(1, "rgba(7,6,10,0)");
    ctx.fillStyle = tg;
    ctx.fillRect(0, 0, W, H * 0.12);
  }

  function draw(dt) {
    var zz = clamp(z, 0, 1);
    setCamera(z);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawBackground(zz);
    drawDust(dt, zz);
    var bc = reduce ? 0 : 0.008 * Math.sin(t * 2.1);
    var bk = reduce ? 0 : 0.006 * Math.sin(t * 2.1 + 1.1);
    crocFarLegs();
    drawBeast(CROC, crocBody, crocExtras, crocBrainW, bk, zz, "croc");
    drawBeast(CAT, catBody, catExtras, catBrainW, bc, zz, "cat");
    drawMotes(zz);
    drawBrain(catBrainW, 0, zz);
    drawBrain(crocBrainW, 0.6, zz);
    drawLabels(zz);
    vignette();
    keepHintClear();
  }

  /* The hint sits above the slider, out of the labels' reach by layout; this
     is the guarantee: if any drawn label rect comes within 6 px of it (some
     odd width or height), the hint fades out until the label moves away. */
  var hintBlocked = false;
  function keepHintClear() {
    if (!hint || interacted) return;
    var hr = hint.getBoundingClientRect(), sr = stage.getBoundingClientRect();
    var l = hr.left - sr.left - 6, r = hr.right - sr.left + 6;
    var tp = hr.top - sr.top - 6, bt = hr.bottom - sr.top + 6;
    var hit = false;
    for (var i = 0; i < labelRects.length; i++) {
      var L = labelRects[i];
      if (L.l < r && L.r > l && L.t < bt && L.b > tp) { hit = true; break; }
    }
    if (hit !== hintBlocked) {
      hintBlocked = hit;
      hint.classList.toggle("is-blocked", hit);
    }
  }

  /* ---------- UI sync ---------- */

  var lastEnd = null;
  function syncUI() {
    var end = (dragging ? z : target) >= 0.5 ? "brain" : "body";
    if (end !== lastEnd) {
      lastEnd = end;
      for (var i = 0; i < buttons.length; i++) {
        var on = buttons[i].getAttribute("data-scale") === end;
        buttons[i].classList.toggle("is-on", on);
        buttons[i].setAttribute("aria-pressed", on ? "true" : "false");
      }
      stage.setAttribute("data-view", end);
    }
    var zc = clamp(z, 0, 1);
    if (scrub) {
      scrub.setAttribute("aria-valuenow", String(Math.round(zc * 100)));
      scrub.setAttribute("aria-valuetext", zc < 0.08 ? "Whole bodies" : zc > 0.92 ? "Brains side by side" : "Zooming");
    }
    var pct = (clamp(z, -0.04, 1.04) * 100).toFixed(2) + "%";
    if (scrubThumb) scrubThumb.style.left = pct;
    if (scrubFill) scrubFill.style.width = (zc * 100).toFixed(2) + "%";
    if (payoff) payoff.classList.toggle("is-lit", zc > 0.8);
  }

  /* ---------- loop + spring ---------- */

  function tick(dt) {
    if (dragging) { vel = 0; return; }
    if (reduce) { z = target; vel = 0; return; }
    var k = spring.k, c = spring.c;
    var sub = Math.max(1, Math.ceil(dt / 0.008));
    var h = dt / sub;
    for (var i = 0; i < sub; i++) {
      vel += (k * (target - z) - c * vel) * h;
      z += vel * h;
    }
    z = clamp(z, -0.08, 1.08);
    if (Math.abs(target - z) < 0.0005 && Math.abs(vel) < 0.002) { z = target; vel = 0; }
  }

  function frame(now) {
    raf = 0;
    if (!onScreen || document.hidden) return;
    var dt = last ? Math.min(0.05, (now - last) / 1000) : 0.016;
    last = now;
    t += dt;
    tick(dt);
    stepMotes(dt);
    draw(dt);
    syncUI();
    raf = requestAnimationFrame(frame);
  }
  function wake() {
    if (reduce) { requestStatic(); return; }
    if (raf || !onScreen || document.hidden) return;
    last = 0;
    raf = requestAnimationFrame(frame);
  }
  var staticPending = 0;
  function requestStatic() {
    if (staticPending) return;
    staticPending = requestAnimationFrame(function () {
      staticPending = 0;
      tick(0);
      draw(0);
      syncUI();
    });
  }
  function kick() { if (reduce) requestStatic(); else wake(); }

  function setTarget(v, mode) {
    target = clamp(v, 0, 1);
    spring = SPRINGS[mode] || SPRINGS.follow;
    kick();
  }
  function userTookOver() {
    interacted = true;
    if (hint) hint.classList.add("is-gone"); /* the drag hint has done its job */
    if (scrub) scrub.classList.remove("is-hinting");
  }

  /* ---------- size ---------- */

  function resize() {
    var r = stage.getBoundingClientRect();
    W = Math.max(1, r.width);
    H = Math.max(1, r.height);
    dpr = Math.min(2, window.devicePixelRatio || 1);
    var cw = Math.round(W * dpr), ch = Math.round(H * dpr);
    if (canvas.width !== cw) canvas.width = cw;
    if (canvas.height !== ch) canvas.height = ch;
    /* desktop: the heading + a1 passage overlay the top of the stage, the
       controls + payoff passage its bottom (phone: both are in normal flow) */
    var head = document.getElementById("source-head");
    reserveTop = 0;
    if (head && window.getComputedStyle(head).position === "absolute") reserveTop = head.offsetHeight + 8;
    var ui = document.getElementById("source-ui");
    reserveBottom = 0;
    if (ui && window.getComputedStyle(ui).position === "absolute") reserveBottom = ui.offsetHeight + 8;
    frameViews();
    draw(0);
    syncUI();
  }

  /* ---------- inputs ---------- */

  for (var b = 0; b < buttons.length; b++) {
    buttons[b].addEventListener("click", function () {
      userTookOver();
      setTarget(this.getAttribute("data-scale") === "brain" ? 1 : 0, "bounce");
    });
  }

  function release() {
    dragging = false;
    stage.classList.remove("is-dragging");
    if (scrub) scrub.classList.remove("is-grabbing");
    setTarget(z >= 0.5 ? 1 : 0, "bounce");
  }

  /* Horizontal drag on the stage. Touch: only a sideways gesture is taken;
     touch-action: pan-y leaves vertical swipes to the page. */
  (function () {
    var pid = null, x0 = 0, y0 = 0, z0 = 0, lastX = 0, lastT = 0, v = 0, live = false;
    stage.addEventListener("pointerdown", function (e) {
      if (e.button) return;
      if (e.target.closest && e.target.closest("button, a, .source-scrub, .source-ui")) return;
      pid = e.pointerId; x0 = lastX = e.clientX; y0 = e.clientY; z0 = z; lastT = performance.now(); v = 0;
      live = e.pointerType === "mouse";
      if (live) begin(e);
    });
    function begin(e) {
      live = true;
      dragging = true;
      userTookOver();
      z0 = z;
      x0 = e.clientX;
      stage.classList.add("is-dragging");
      try { stage.setPointerCapture(pid); } catch (err) { /* ignore */ }
    }
    stage.addEventListener("pointermove", function (e) {
      if (pid == null || e.pointerId !== pid) return;
      if (!live) {
        var dx = e.clientX - x0, dy = e.clientY - y0;
        if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) { pid = null; return; }
        if (Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy) * 1.2) begin(e); else return;
      }
      if (e.cancelable) e.preventDefault();
      var now = performance.now();
      var span = Math.max(260, W * 0.55);
      z = clamp(z0 + (e.clientX - x0) / span, -0.05, 1.05);
      v = (e.clientX - lastX) / Math.max(1, now - lastT);
      lastX = e.clientX; lastT = now;
      kick();
    });
    function end(e) {
      if (pid == null || e.pointerId !== pid) return;
      pid = null;
      if (!live) return;
      live = false;
      /* a flick carries toward the end it was thrown at */
      if (Math.abs(v) > 0.6) z = clamp(z + (v > 0 ? 0.3 : -0.3), -0.05, 1.05);
      release();
    }
    stage.addEventListener("pointerup", end);
    stage.addEventListener("pointercancel", end);
  })();

  /* Scrub slider between the two buttons. */
  if (scrub) {
    var spid = null;
    var fromX = function (e) {
      var r = scrub.getBoundingClientRect();
      return clamp((e.clientX - r.left) / Math.max(1, r.width), 0, 1);
    };
    /* Mouse grabs at once. Touch waits for a sideways move (a vertical swipe
       that starts here still scrolls the page); a plain tap jumps there. */
    var sx0 = 0, sy0 = 0, sLive = false;
    var sBegin = function (e) {
      sLive = true;
      dragging = true;
      userTookOver();
      scrub.classList.add("is-grabbing");
      try { scrub.setPointerCapture(spid); } catch (err) { /* ignore */ }
      try { scrub.focus({ preventScroll: true }); } catch (err2) { scrub.focus(); }
      z = fromX(e);
      kick();
    };
    scrub.addEventListener("pointerdown", function (e) {
      if (e.button) return;
      spid = e.pointerId;
      sx0 = e.clientX;
      sy0 = e.clientY;
      sLive = false;
      if (e.pointerType !== "touch") sBegin(e);
    });
    scrub.addEventListener("pointermove", function (e) {
      if (spid == null || e.pointerId !== spid) return;
      if (!sLive) {
        var dx = e.clientX - sx0, dy = e.clientY - sy0;
        if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) { spid = null; return; }
        if (Math.abs(dx) > 6 && Math.abs(dx) > Math.abs(dy)) sBegin(e); else return;
      }
      if (e.cancelable) e.preventDefault();
      z = fromX(e);
      kick();
    });
    scrub.addEventListener("pointerup", function (e) {
      if (spid == null || e.pointerId !== spid) return;
      spid = null;
      if (!sLive) { userTookOver(); setTarget(fromX(e) >= 0.5 ? 1 : 0, "bounce"); return; }
      sLive = false;
      release();
    });
    scrub.addEventListener("pointercancel", function (e) {
      if (spid == null || e.pointerId !== spid) return;
      spid = null;
      if (sLive) { sLive = false; release(); }
    });
    scrub.addEventListener("keydown", function (e) {
      var step = { ArrowRight: 0.1, ArrowUp: 0.1, ArrowLeft: -0.1, ArrowDown: -0.1, PageUp: 0.5, PageDown: -0.5 }[e.key];
      var next = e.key === "Home" ? 0 : e.key === "End" ? 1 : step ? clamp(target + step, 0, 1) : null;
      if (next == null) return;
      e.preventDefault();
      userTookOver();
      setTarget(Math.round(next * 10) / 10, "follow");
    });
  }

  /* ---------- desktop: short scroll pin (GSAP + ScrollTrigger only) ---------- */

  var gsap = window.gsap || null;
  var ST = gsap && window.ScrollTrigger ? window.ScrollTrigger : null;
  if (ST) gsap.registerPlugin(ST);

  function wantPin() { return !reduce && !!ST && !!pinEl && window.innerWidth >= 900 && !coarse; }
  function syncPin() {
    var want = wantPin();
    if (want === pinned) return;
    pinned = want;
    if (st) { st.kill(true); st = null; }
    if (want) {
      st = ST.create({
        trigger: pinEl,
        start: "top top",
        end: function () { return "+=" + Math.round(window.innerHeight * 0.9); },
        pin: true,
        anticipatePin: 1,
        invalidateOnRefresh: true,
        refreshPriority: 1,
        onUpdate: function (self) {
          if (dragging) return;
          setTarget(fromScroll(self.progress), "follow");
        }
      });
    }
    ST.refresh();
    /* reload mid-page: start from wherever the pin already is */
    if (st) { z = target = fromScroll(st.progress); vel = 0; kick(); }
  }
  /* ends linger a little; the spring smooths the rest */
  function fromScroll(p) { return smooth(clamp((p - 0.08) / 0.8, 0, 1)); }

  /* Without the pin: one gentle glide from bodies to brains, first time seen. */
  function maybeDemo() {
    if (seen || reduce || pinned) return;
    seen = true;
    setTimeout(function () {
      if (interacted || pinned) return;
      setTarget(1, "soft");
      setTimeout(function () { if (!interacted && scrub) scrub.classList.add("is-hinting"); }, 1800);
    }, 650);
  }

  /* ---------- start ---------- */

  var hint = document.getElementById("source-hint");
  if (hint && coarse) hint.textContent = "Swipe sideways on the scene";
  stage.classList.add("is-live");
  if (hint) hint.classList.add("is-live");
  resize();
  syncPin();
  if ("ResizeObserver" in window) {
    var ro = new ResizeObserver(resize);
    ro.observe(stage);
    var headEl = document.getElementById("source-head");
    if (headEl) ro.observe(headEl);
  }
  window.addEventListener("resize", function () { resize(); syncPin(); });
  if (document.fonts && document.fonts.ready && document.fonts.ready.then) {
    document.fonts.ready.then(function () { resize(); kick(); }, function () {});
  }

  if ("IntersectionObserver" in window) {
    new IntersectionObserver(function (ents) {
      var en = ents[ents.length - 1];
      onScreen = en.isIntersecting;
      if (en.intersectionRatio >= 0.45) maybeDemo();
      kick();
    }, { threshold: [0, 0.45], rootMargin: "60px 0px" }).observe(stage);
  } else {
    onScreen = true;
    maybeDemo();
    kick();
  }
  document.addEventListener("visibilitychange", kick);

  window.__source = {
    get: function () { return { z: z, target: target, pinned: pinned, motes: motes.length, running: !!raf }; },
    set: function (v) { userTookOver(); setTarget(v, "bounce"); }
  };
})();
