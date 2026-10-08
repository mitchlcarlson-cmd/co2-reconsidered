/* Protective CO2 explainer: page wiring. Classic script, no modules, no fetch.
   Works from file://. If GSAP, ScrollTrigger or Lenis fail to load, every
   word stays visible, the controls still work and the page scrolls natively.

   One owner per behaviour:
   - CellScene (js/cell.js) owns its own render loop, offscreen pausing and
     tab-visibility pausing; this file only calls .start() once per scene.
   - The hero dial owns the hero CO2 value; section 3 and window.__pco2 go
     through applyValue().
   - In-page anchor clicks (rail, scroll cue) go through scrollToTarget(). */
(function () {
  "use strict";

  var root = document.documentElement;
  root.classList.add("js");

  var reduce = false;
  var coarse = false;
  try {
    reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    coarse = window.matchMedia("(pointer: coarse)").matches;
  } catch (err) { /* matchMedia missing */ }

  var gsap = window.gsap || null;
  var ST = gsap && window.ScrollTrigger ? window.ScrollTrigger : null;
  if (ST) gsap.registerPlugin(ST);

  var DATA = window.PCO2_DATA || {};
  var SVGNS = "http://www.w3.org/2000/svg";

  /* ---------- helpers ---------- */

  function num(v, fallback) {
    v = +v;
    return v === v ? v : fallback;
  }
  function clamp01(v) {
    v = +v;
    if (v !== v) return 0;
    return v < 0 ? 0 : v > 1 ? 1 : v;
  }
  function byId(id) { return document.getElementById(id); }

  /* CSS cubic-bezier as a function of x (0..1), usable as a GSAP ease. */
  function bezier(p1x, p1y, p2x, p2y) {
    var cx = 3 * p1x, bx = 3 * (p2x - p1x) - cx, ax = 1 - cx - bx;
    var cy = 3 * p1y, by = 3 * (p2y - p1y) - cy, ay = 1 - cy - by;
    function sx(t) { return ((ax * t + bx) * t + cx) * t; }
    function sy(t) { return ((ay * t + by) * t + cy) * t; }
    function dx(t) { return (3 * ax * t + 2 * bx) * t + cx; }
    return function (x) {
      if (x <= 0) return 0;
      if (x >= 1) return 1;
      var t = x, i;
      for (i = 0; i < 8; i++) {
        var e = sx(t) - x;
        if (Math.abs(e) < 1e-6) return sy(t);
        var d = dx(t);
        if (Math.abs(d) < 1e-6) break;
        t -= e / d;
      }
      var lo = 0, hi = 1;
      t = x;
      for (i = 0; i < 30; i++) {
        if (sx(t) < x) lo = t; else hi = t;
        t = (lo + hi) / 2;
      }
      return sy(t);
    };
  }
  var EASE_OUT = bezier(0.22, 1, 0.36, 1);   /* entrances */
  var EASE_MOVE = bezier(0.65, 0, 0.35, 1);  /* moves */

  /* Run each section's setup on its own, so one failure can't take the rest down. */
  function safe(fn) {
    try { fn(); } catch (err) {
      if (window.console && console.warn) console.warn("[pco2]", err);
    }
  }

  /* ---------- plates ---------- */

  function initPlates() {
    var plates = DATA.PLATES || {};
    Object.keys(plates).forEach(function (key) {
      var file = plates[key];
      if (!file) return; /* null: no request, CSS gradient stays */
      var nodes = document.querySelectorAll('.plate[data-plate="' + key + '"]');
      if (!nodes.length) return;
      var url = "assets/plates/" + file;
      var img = new Image();
      img.onload = function () {
        for (var i = 0; i < nodes.length; i++) {
          nodes[i].style.backgroundImage = 'url("' + url + '")';
          nodes[i].classList.add("is-loaded");
        }
      };
      img.src = url;
    });
  }

  /* ---------- smooth scroll + anchors ---------- */

  var lenis = null;

  function initLenis() {
    if (reduce || typeof window.Lenis !== "function") return;
    lenis = new window.Lenis({ lerp: 0.1 });
    window.__lenis = lenis;
    if (ST) lenis.on("scroll", ST.update);
    if (gsap) {
      gsap.ticker.add(function (time) { lenis.raf(time * 1000); });
      gsap.ticker.lagSmoothing(0);
    } else {
      var loop = function (t) {
        lenis.raf(t);
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    }
  }

  function scrollToTarget(el) {
    if (lenis) lenis.scrollTo(el, { offset: 0 });
    else el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  }

  function initAnchors() {
    document.addEventListener("click", function (e) {
      if (e.defaultPrevented || e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      var a = e.target.closest ? e.target.closest('a[href^="#"]') : null;
      if (!a || a.classList.contains("skip")) return; /* skip link keeps native focus behaviour */
      var id = a.getAttribute("href").slice(1);
      var el = id ? byId(id) : null;
      if (!el) return;
      e.preventDefault();
      scrollToTarget(el);
    });
  }

  /* ---------- hero: dial + cell ---------- */

  var heroScene = null;
  var dialValue = clamp01(num(DATA.DIAL_START, 0.65));
  var interacted = false;
  var demoToken = 0;
  var springToken = 0;
  var repaintDial = function () {};
  var dialEl = null;

  var DIAL_CX = 130;
  var DIAL_CY = 132;
  var DIAL_R = 96;
  var DIAL_START_ANG = 210 * Math.PI / 180; /* math angle, 0 = east, CCW */
  var DIAL_SWEEP = 240 * Math.PI / 180;

  function dialPoint(v, r) {
    var a = DIAL_START_ANG - DIAL_SWEEP * v;
    return { x: DIAL_CX + r * Math.cos(a), y: DIAL_CY - r * Math.sin(a) };
  }
  function dialArcPath(r) {
    var p0 = dialPoint(0, r);
    var p1 = dialPoint(1, r);
    return "M " + p0.x.toFixed(2) + " " + p0.y.toFixed(2) +
      " A " + r + " " + r + " 0 1 1 " + p1.x.toFixed(2) + " " + p1.y.toFixed(2);
  }
  function band(list, v, key) {
    list = list || [];
    for (var i = 0; i < list.length; i++) if (v <= list[i].upTo) return list[i][key];
    return list.length ? list[list.length - 1][key] : "";
  }
  function nearestSnap(v) {
    var snaps = DATA.DIAL_SNAPS || [];
    var best = null, bestD = 0.12;
    for (var i = 0; i < snaps.length; i++) {
      var d = Math.abs(v - snaps[i]);
      if (d <= bestD) { bestD = d; best = snaps[i]; }
    }
    return best;
  }

  function stopDemo() { demoToken++; }
  function cancelSpring() { springToken++; }
  function userTookOver() {
    interacted = true;
    stopDemo();
    if (dialEl) dialEl.classList.remove("is-hinting");
  }

  /* The only place the hero CO2 value changes. `visual` lets the thumb
     overshoot slightly past an end during the release spring. */
  function applyValue(v, visual, skipHero) {
    dialValue = clamp01(v);
    if (visual == null) visual = dialValue;
    visual = Math.max(-0.035, Math.min(1.035, visual));
    repaintDial(dialValue, visual);
    if (!skipHero && heroScene) heroScene.setCO2(dialValue);
  }

  /* Damped spring toward a snap point (small bounce, then rest). */
  function springTo(target) {
    var token = ++springToken;
    var x = dialValue, vel = 0, last = performance.now();
    if (dialEl) dialEl.classList.add("show-bubble");
    function step(now) {
      if (token !== springToken) return;
      var dt = Math.min(0.032, Math.max(0.001, (now - last) / 1000));
      last = now;
      vel += (240 * (target - x) - 18 * vel) * dt;
      x += vel * dt;
      if (Math.abs(target - x) < 0.001 && Math.abs(vel) < 0.012) {
        applyValue(target);
        if (dialEl) dialEl.classList.remove("show-bubble");
        return;
      }
      applyValue(x, x);
      requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  function release(v) {
    var snap = nearestSnap(v);
    if (snap != null && Math.abs(snap - v) > 0.0008) springTo(snap);
    else if (dialEl) dialEl.classList.remove("show-bubble");
  }

  /* Section 3 pushes its scroll state into the hero (not a user interaction:
     the drag hint stays). */
  function setHeroFromScroll(v) {
    stopDemo();
    cancelSpring();
    applyValue(v);
    if (!interacted && dialEl) dialEl.classList.add("is-hinting");
  }

  window.__pco2 = {
    getCO2: function () { return dialValue; },
    setCO2: function (v) {
      userTookOver();
      cancelSpring();
      applyValue(v);
    },
    state: function () {
      var s = heroScene ? heroScene.state() : {};
      return { co2: dialValue, locks: s.locks, lactate: s.lactate, mitoGlow: s.mitoGlow, hero: heroScene ? s : null };
    }
  };

  function initHero() {
    var canvas = byId("hero-canvas");
    var dial = dialEl = byId("co2-dial");
    var track = byId("dial-track");
    var fill = byId("dial-fill");
    var thumb = byId("dial-thumb");
    var bubble = byId("dial-bubble");
    var center = byId("dial-center-word");
    var caption = byId("dial-caption");
    var snaps = byId("dial-snaps");
    var hint = byId("dial-hint");
    var svg = dial ? dial.querySelector("svg") : null;

    if (hint && coarse) hint.textContent = "Drag the dial, or swipe sideways on the cell.";

    if (track) {
      track.setAttribute("d", dialArcPath(DIAL_R));
      track.setAttribute("pathLength", "100");
    }
    if (fill) {
      fill.setAttribute("d", dialArcPath(DIAL_R));
      fill.setAttribute("pathLength", "100");
      fill.style.strokeDasharray = "100";
    }
    if (snaps && !snaps.children.length) {
      (DATA.DIAL_SNAPS || [0, 0.5, 1]).forEach(function (v) {
        var p = dialPoint(v, DIAL_R);
        var c = document.createElementNS(SVGNS, "circle");
        c.setAttribute("cx", p.x.toFixed(2));
        c.setAttribute("cy", p.y.toFixed(2));
        c.setAttribute("r", "3.5");
        snaps.appendChild(c);
      });
    }

    function placeBubble(pt) {
      if (!bubble || !svg || !dial) return;
      var ctm = svg.getScreenCTM && svg.getScreenCTM();
      if (!ctm) return;
      var sp = svg.createSVGPoint();
      sp.x = pt.x;
      sp.y = pt.y;
      var screen = sp.matrixTransform(ctm);
      var hr = dial.getBoundingClientRect();
      /* keep the bubble on screen at the dial's ends (phones) */
      var half = bubble.offsetWidth / 2 + 6;
      var x = Math.max(half, Math.min(window.innerWidth - half, screen.x));
      bubble.style.left = (x - hr.left) + "px";
      bubble.style.top = (screen.y - hr.top) + "px";
    }

    /* The bubble's text lives in its own span so the crossfade doesn't fight
       the bubble's show/hide opacity. */
    var bubbleText = null;
    if (bubble) {
      bubbleText = document.createElement("span");
      bubbleText.textContent = bubble.textContent;
      bubble.textContent = "";
      bubble.appendChild(bubbleText);
    }
    /* Band change only: swap the text and fade it in (instant with reduced motion). */
    function swapText(el, text, fade) {
      if (!el || el.textContent === text) return;
      el.textContent = text;
      if (fade && el.animate) {
        el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 150, easing: "cubic-bezier(.22,1,.36,1)" });
      }
    }

    var lastWord = null;
    repaintDial = function (logical, visual) {
      var word = band(DATA.DIAL_WORDS, logical, "word");
      if (word !== lastWord) {
        var fade = lastWord !== null && !reduce;
        lastWord = word;
        swapText(center, word, fade);
        swapText(bubbleText, word, fade);
        swapText(caption, band(DATA.DIAL_CAPTIONS, logical, "text"), fade);
        if (dial) dial.setAttribute("aria-valuetext", word);
      }
      if (dial) dial.setAttribute("aria-valuenow", String(Math.round(logical * 100)));
      var pt = dialPoint(visual, DIAL_R);
      if (thumb) thumb.setAttribute("transform", "translate(" + pt.x.toFixed(2) + " " + pt.y.toFixed(2) + ")");
      if (fill) {
        fill.style.strokeDashoffset = String(100 * (1 - logical));
        fill.style.opacity = logical < 0.004 ? "0" : "1";
      }
      placeBubble(pt);
    };
    repaintDial(dialValue, dialValue);

    function valueFromEvent(e) {
      var ctm = svg && svg.getScreenCTM && svg.getScreenCTM();
      if (!ctm) return dialValue;
      var sp = svg.createSVGPoint();
      sp.x = e.clientX;
      sp.y = e.clientY;
      var pt = sp.matrixTransform(ctm.inverse());
      var TAU = Math.PI * 2;
      var delta = (DIAL_START_ANG - Math.atan2(-(pt.y - DIAL_CY), pt.x - DIAL_CX)) % TAU;
      if (delta < 0) delta += TAU;
      if (delta <= DIAL_SWEEP) return delta / DIAL_SWEEP;
      /* in the gap under the dial: nearest end */
      return delta < DIAL_SWEEP + (TAU - DIAL_SWEEP) / 2 ? 1 : 0;
    }

    if (dial) {
      var pid = null;
      dial.addEventListener("pointerdown", function (e) {
        if (e.button) return;
        userTookOver();
        cancelSpring();
        pid = e.pointerId;
        try { dial.setPointerCapture(pid); } catch (err) { /* ignore */ }
        /* pointer focus: no keyboard ring (cleared on keydown / blur) */
        dial.classList.add("is-pointer");
        try { dial.focus({ preventScroll: true }); } catch (err2) { dial.focus(); }
        dial.classList.add("is-grabbing", "show-bubble");
        applyValue(valueFromEvent(e));
      });
      dial.addEventListener("pointermove", function (e) {
        if (pid == null || e.pointerId !== pid) return;
        if (e.cancelable) e.preventDefault();
        applyValue(valueFromEvent(e));
      });
      var endDrag = function (e) {
        if (pid == null || e.pointerId !== pid) return;
        pid = null;
        dial.classList.remove("is-grabbing");
        release(dialValue);
      };
      dial.addEventListener("pointerup", endDrag);
      dial.addEventListener("pointercancel", endDrag);
      dial.addEventListener("keydown", function (e) {
        dial.classList.remove("is-pointer");
        var step = { ArrowUp: 0.02, ArrowRight: 0.02, ArrowDown: -0.02, ArrowLeft: -0.02, PageUp: 0.1, PageDown: -0.1 }[e.key];
        var next = e.key === "Home" ? 0 : e.key === "End" ? 1 : step ? clamp01(dialValue + step) : null;
        if (next == null) return;
        e.preventDefault();
        userTookOver();
        cancelSpring();
        dial.classList.add("show-bubble");
        applyValue(next);
      });
      dial.addEventListener("keyup", function () { dial.classList.remove("show-bubble"); });
      dial.addEventListener("blur", function () { dial.classList.remove("show-bubble", "is-pointer"); });
    }

    window.addEventListener("resize", function () { repaintDial(dialValue, dialValue); });

    if (canvas && window.CellScene) {
      var anchor = byId("hero-stage");
      if (anchor) {
        var ar = anchor.getBoundingClientRect();
        if (ar.width < 20 || ar.height < 20) anchor = null;
      }
      heroScene = new window.CellScene(canvas, {
        interactive: true,
        anchor: anchor,
        fill: 0.42,
        bloom: !reduce,
        parallax: !reduce,
        gentle: reduce,
        co2: dialValue,
        onInput: function (v, phase) {
          userTookOver();
          cancelSpring();
          if (dial) dial.classList.add("show-bubble");
          if (phase === "end") {
            if (dial) dial.classList.remove("is-grabbing");
            applyValue(v, v, true);
            release(v);
          } else {
            if (dial) dial.classList.add("is-grabbing");
            applyValue(v, v, true);
          }
        }
      });
      heroScene.setCO2(dialValue, { immediate: true });
      heroScene.start();
    }

    /* light cursor parallax on the burrow plate (eased in CSS) */
    var plate = document.querySelector(".hero-plate .plate");
    if (plate && !reduce && !coarse) {
      var pending = false, px = 0, py = 0;
      window.addEventListener("pointermove", function (e) {
        if (e.pointerType && e.pointerType !== "mouse") return;
        px = (e.clientX / window.innerWidth - 0.5) * 14;
        py = (e.clientY / window.innerHeight - 0.5) * 8;
        if (pending) return;
        pending = true;
        requestAnimationFrame(function () {
          pending = false;
          plate.style.transform = "translate3d(" + px.toFixed(1) + "px," + py.toFixed(1) + "px,0)";
        });
      }, { passive: true });
    }

    introHero();
    runDemo();
  }

  /* First second: headline words rise in (60 ms stagger), then the rest;
     everything is in place by about 1 s. */
  function introHero() {
    if (reduce || !gsap) return;
    var words = document.querySelectorAll("#hero-title .word");
    if (words.length) {
      gsap.from(words, { y: 28, opacity: 0, duration: 0.7, stagger: 0.06, delay: 0.2, ease: EASE_OUT });
    }
    var rest = document.querySelectorAll(".hero .kicker, .hero-sub, .hero .framing-note, .hero-dial, .hero-label");
    if (rest.length) {
      gsap.from(rest, { y: 20, opacity: 0, duration: 0.6, stagger: 0.05, delay: 0.3, ease: EASE_OUT, clearProps: "transform" });
    }
  }

  /* ~1 s in: one sweep toward low CO2 and back, then a "drag me" pulse. */
  function runDemo() {
    if (reduce || interacted) return;
    var token = ++demoToken;
    var from = dialValue, low = 0.08;
    var startAt = performance.now() + 1000, dur = 2400;
    function frame(now) {
      if (token !== demoToken) return;
      if (now < startAt) { requestAnimationFrame(frame); return; }
      var t = Math.min(1, (now - startAt) / dur);
      var v = t < 0.5 ? from + (low - from) * EASE_MOVE(t * 2) : low + (from - low) * EASE_MOVE(t * 2 - 1);
      applyValue(v);
      if (t < 1) requestAnimationFrame(frame);
      else if (dialEl && !interacted) dialEl.classList.add("is-hinting");
    }
    requestAnimationFrame(frame);
  }

  /* ---------- rail ---------- */

  function initRail() {
    var links = document.querySelectorAll(".rail [data-rail]");
    var items = [];
    for (var i = 0; i < links.length; i++) {
      var sec = byId(links[i].getAttribute("data-rail"));
      if (sec) items.push({ el: sec, link: links[i] });
    }
    if (!items.length) return;
    function mark(pick) {
      items.forEach(function (it) {
        var on = it === pick;
        it.link.classList.toggle("is-active", on);
        if (on) it.link.setAttribute("aria-current", "true");
        else it.link.removeAttribute("aria-current");
      });
    }
    mark(items[0]);
    if (!("IntersectionObserver" in window)) return;
    var seen = new Map();
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) { seen.set(en.target, en.isIntersecting); });
      var pick = null;
      items.forEach(function (it) { if (seen.get(it.el)) pick = it; });
      if (pick) mark(pick);
    }, { rootMargin: "-35% 0px -50% 0px" });
    items.forEach(function (it) { io.observe(it.el); });
  }

  /* ---------- reveals (hidden only when GSAP is present) ---------- */

  function initReveals() {
    if (reduce || !gsap) return;
    var nodes = document.querySelectorAll(".reveal");
    if (!nodes.length) return;
    root.classList.add("js-anim");

    function show(list) {
      var fresh = [];
      for (var i = 0; i < list.length; i++) {
        if (list[i].hasAttribute("data-shown")) continue;
        list[i].setAttribute("data-shown", "");
        fresh.push(list[i]);
      }
      if (fresh.length) {
        gsap.to(fresh, { opacity: 1, y: 0, duration: 0.8, stagger: 0.06, ease: EASE_OUT, overwrite: true });
      }
    }

    if (ST) {
      gsap.set(nodes, { y: 24, opacity: 0 });
      ST.batch(nodes, { start: "top 88%", onEnter: show, onEnterBack: show });
    } else if ("IntersectionObserver" in window) {
      var io = new IntersectionObserver(function (entries) {
        var list = [];
        entries.forEach(function (en) {
          if (!en.isIntersecting) return;
          list.push(en.target);
          io.unobserve(en.target);
        });
        show(list);
      }, { rootMargin: "0px 0px -8% 0px" });
      for (var i = 0; i < nodes.length; i++) io.observe(nodes[i]);
    } else {
      show(nodes);
    }

    /* Safety net: anything on screen or already scrolled past (e.g. after a
       reload mid-page) is shown, never left invisible. */
    function sweep() {
      var list = [];
      for (var i = 0; i < nodes.length; i++) {
        if (nodes[i].hasAttribute("data-shown")) continue;
        if (nodes[i].getBoundingClientRect().top < window.innerHeight) list.push(nodes[i]);
      }
      show(list);
    }
    setTimeout(sweep, 900);
    window.addEventListener("scroll", function () {
      if (sweep.pending) return;
      sweep.pending = true;
      setTimeout(function () { sweep.pending = false; sweep(); }, 400);
    }, { passive: true });
  }

  /* ---------- 1. exhaust / signal ---------- */

  function initExhaust() {
    var canvas = byId("exhaust-canvas");
    var ctx = canvas && canvas.getContext("2d");
    if (!ctx) return;
    var buttons = document.querySelectorAll(".seg-btn[data-mode]");
    var targetMode = 0, mode = 0;
    var onScreen = false, raf = 0, last = 0, t = 0;
    var dpr = 1, w = 1, h = 1;
    var motes = [];
    for (var i = 0; i < 46; i++) {
      motes.push({ ang: Math.random() * Math.PI * 2, ph: Math.random(), sp: 0.12 + Math.random() * 0.3, sz: 0.55 + Math.random() * 1.35 });
    }

    function resize() {
      var rect = canvas.getBoundingClientRect();
      w = Math.max(1, rect.width);
      h = Math.max(1, rect.height);
      dpr = Math.min(2, window.devicePixelRatio || 1);
      var cw = Math.round(w * dpr), ch = Math.round(h * dpr);
      if (canvas.width !== cw) canvas.width = cw;
      if (canvas.height !== ch) canvas.height = ch;
      draw();
    }

    function draw() {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      var cx = w * 0.42, cy = h * 0.58;
      var R = Math.min(w, h) * 0.13 * (1 + 0.03 * Math.sin(t * 1.3));

      var halo = ctx.createRadialGradient(cx, cy, R * 0.4, cx, cy, R * 3.2);
      halo.addColorStop(0, "rgba(255,179,71," + (0.16 + 0.12 * mode).toFixed(3) + ")");
      halo.addColorStop(1, "rgba(255,179,71,0)");
      ctx.fillStyle = halo;
      ctx.fillRect(0, 0, w, h);

      ctx.beginPath();
      ctx.ellipse(cx, cy, R * 1.2, R * 0.92, -0.4, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255,179,71,0.12)";
      ctx.fill();
      ctx.lineWidth = 1.6;
      ctx.strokeStyle = "rgba(255,179,71,0.8)";
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx - R * 0.08, cy + R * 0.02, R * 0.36, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(122,111,143,0.55)";
      ctx.fill();

      for (var m = 0; m < motes.length; m++) {
        var mote = motes[m];
        var u = (t * mote.sp + mote.ph) % 1;
        /* exhaust: drift outward and up like smoke */
        var ex = cx + Math.cos(mote.ang) * R * (1.05 + u * 6.4);
        var ey = cy + Math.sin(mote.ang) * R * (0.7 + u * 2.4) - u * h * 0.42;
        var ea = Math.sin(Math.min(1, u * 1.35) * Math.PI) * (1 - u * 0.25);
        /* signal: spiral in from far out and fade into the membrane
           (alpha is 0 at both ends of the cycle, so nothing pops) */
        var orbit = mote.ang + t * (0.8 + mote.sp) * 1.4;
        var sr = R * (5.6 * (1 - u) + 1.05);
        var sx = cx + Math.cos(orbit) * sr;
        var sy = cy + Math.sin(orbit) * sr * 0.7;
        var sa = 0.9 * Math.sin(u * Math.PI);
        var x = ex + (sx - ex) * mode;
        var y = ey + (sy - ey) * mode;
        var alpha = ea + (sa - ea) * mode;
        if (alpha <= 0.02) continue;
        ctx.beginPath();
        ctx.fillStyle = "rgba(94,242,214," + alpha.toFixed(3) + ")";
        ctx.arc(x, y, (1.8 + mote.sz * 2.2) * (1 + 0.15 * (1 - mode)), 0, Math.PI * 2);
        ctx.fill();
      }
    }

    function loop(now) {
      raf = 0;
      if (!onScreen || document.hidden) return;
      var dt = last ? Math.min(0.05, (now - last) / 1000) : 0.016;
      last = now;
      t += dt * (reduce ? 0.35 : 1);
      mode += (targetMode - mode) * (1 - Math.exp(-dt * 3.4));
      if (Math.abs(mode - targetMode) < 0.0008) mode = targetMode;
      draw();
      raf = requestAnimationFrame(loop);
    }
    function wake() {
      if (raf || !onScreen || document.hidden) return;
      last = 0;
      raf = requestAnimationFrame(loop);
    }

    function setMode(name) {
      targetMode = name === "signal" ? 1 : 0;
      for (var b = 0; b < buttons.length; b++) {
        var on = buttons[b].getAttribute("data-mode") === name;
        buttons[b].classList.toggle("is-on", on);
        buttons[b].setAttribute("aria-pressed", on ? "true" : "false");
      }
    }
    for (var b = 0; b < buttons.length; b++) {
      buttons[b].addEventListener("click", function () { setMode(this.getAttribute("data-mode")); });
    }

    resize();
    if ("ResizeObserver" in window) new ResizeObserver(resize).observe(canvas);
    else window.addEventListener("resize", resize);
    if ("IntersectionObserver" in window) {
      new IntersectionObserver(function (ents) {
        onScreen = ents[ents.length - 1].isIntersecting;
        wake();
      }, { rootMargin: "80px" }).observe(canvas);
    } else {
      onScreen = true;
      wake();
    }
    document.addEventListener("visibilitychange", wake);
  }

  /* 2. cat / crocodile: owned entirely by js/source-scene.js (canvas, buttons,
     scrub, drag and its own short pin). */

  /* ---------- 3. when CO2 runs low ---------- */

  var low = null;

  function initLow() {
    var pin = byId("low-pin");
    if (!pin) return;
    var visual = byId("low-visual");
    var canvas = byId("low-canvas");
    var meter = byId("low-meter-fill");
    var steps = pin.querySelectorAll(".low-step");
    var nodes = pin.querySelectorAll("#tree-svg .node");
    var edges = pin.querySelectorAll("#tree-svg .edge");
    var items = DATA.LOW_DIAGRAM || [];
    var at = {}, from = {};
    items.forEach(function (it, k) {
      at[it.sel] = it.at;
      from[it.sel] = k > 0 ? items[k - 1].at : 0;
    });

    var scene = null;
    if (canvas && window.CellScene) {
      scene = new window.CellScene(canvas, { interactive: false, gentle: reduce, co2: 1, bloom: false, scale: 0.42, motes: 48, contained: true });
      scene.start();
    }

    var st = null, pinned = null, lastStep = -1, ticking = false;

    function apply(p, driveHero) {
      p = clamp01(p);
      var co2 = 1 - p;
      if (scene) scene.setCO2(co2);
      for (var n = 0; n < nodes.length; n++) {
        var id = nodes[n].getAttribute("data-node");
        nodes[n].classList.toggle("is-lit", at[id] != null && p >= at[id]);
      }
      for (var e = 0; e < edges.length; e++) {
        var eid = edges[e].getAttribute("data-node");
        if (at[eid] == null) continue;
        var t = clamp01((p - from[eid]) / Math.max(0.0001, at[eid] - from[eid]));
        if (edges[e].classList.contains("edge--spec") || edges[e].classList.contains("edge--side")) {
          edges[e].style.opacity = String(t * 0.85);
        } else {
          edges[e].style.strokeDashoffset = String(1 - t);
        }
      }
      var idx = Math.min(steps.length - 1, Math.max(0, Math.floor(p * steps.length)));
      if (idx !== lastStep) {
        lastStep = idx;
        for (var s = 0; s < steps.length; s++) steps[s].classList.toggle("is-active", s === idx);
      }
      if (meter) meter.style.height = (co2 * 100).toFixed(1) + "%";
      if (driveHero) setHeroFromScroll(co2);
    }

    /* Unpinned (phones, reduced motion, no ScrollTrigger): progress follows
       the step text actually being read, measured against a reading line
       that sits below the sticky diagram on phones. */
    function measure() {
      var vh = window.innerHeight;
      var narrow = window.innerWidth < 900;
      var cover = narrow && visual ? visual.getBoundingClientRect().bottom : 0;
      var line = narrow ? cover + (vh - cover) * 0.4 : vh * 0.5;
      var n = steps.length;
      if (!n) return 0;
      var tops = [];
      for (var i = 0; i < n; i++) {
        var first = steps[i].firstElementChild || steps[i];
        tops.push(first.getBoundingClientRect().top);
      }
      if (line < tops[0]) return 0;
      for (var k = n - 1; k >= 0; k--) {
        if (tops[k] <= line) {
          var end = k + 1 < n ? tops[k + 1] : steps[k].getBoundingClientRect().bottom;
          return (k + clamp01((line - tops[k]) / Math.max(1, end - tops[k]))) / n;
        }
      }
      return 0;
    }
    function engaged() {
      var r = pin.getBoundingClientRect();
      return r.top < window.innerHeight * 0.75 && r.bottom > window.innerHeight * 0.25;
    }
    function onScroll() {
      if (pinned || ticking) return;
      ticking = true;
      requestAnimationFrame(function () {
        ticking = false;
        if (!pinned) apply(measure(), engaged());
      });
    }

    /* Phones: the sticky diagram's real height decides where the text starts. */
    function syncCover() {
      if (window.innerWidth >= 900 || !visual) pin.style.removeProperty("--low-cover");
      else pin.style.setProperty("--low-cover", visual.offsetHeight + "px");
    }

    function syncMode() {
      syncCover();
      var want = !reduce && !!ST && window.innerWidth >= 900;
      if (want !== pinned) {
        pinned = want;
        if (st) { st.kill(true); st = null; }
        root.classList.toggle("low-pinned", want);
        if (want) {
          st = ST.create({
            trigger: pin,
            start: "top top",
            end: function () { return "+=" + Math.round(window.innerHeight * 3.2); },
            pin: true,
            scrub: true,
            anticipatePin: 1,
            invalidateOnRefresh: true,
            onUpdate: function (self) { apply(self.progress, self.isActive); }
          });
        }
        if (scene) scene.resize();
        if (ST) ST.refresh();
      }
      if (pinned && st) apply(st.progress, st.isActive);
      else apply(measure(), engaged());
    }

    apply(0, false);
    syncMode();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", syncMode);
    low = { scene: scene, sync: syncMode };
  }

  /* ---------- 4. night clock ---------- */

  function initNight() {
    var hit = byId("clock-hit");
    var hand = byId("clock-hand");
    var nightPath = byId("clock-night");
    var ticks = byId("clock-ticks");
    var remG = byId("clock-rem");
    var glow = byId("clock-glow");
    var word = byId("night-phase-word");
    var text = byId("night-text");
    var panels = text ? text.querySelectorAll(".night-panel") : [];
    var night = DATA.NIGHT || {};
    if (!hit || !hand) return;

    var hour = num(night.start, 21);
    var turn = Math.max(1, num(night.turnSeconds, 90));
    var dragging = false, pauseUntil = 0, inView = false, shown = null, raf = 0, last = 0;
    var remPaths = [];

    function polar(h, r) {
      var a = (h / 24) * Math.PI * 2 - Math.PI / 2;
      return { x: 200 + r * Math.cos(a), y: 200 + r * Math.sin(a) };
    }
    function n2(v) { return Math.round(v * 100) / 100; }
    function span(h0, h1) { return (h1 - h0 + 24) % 24; }
    function arcD(h0, h1, r) {
      var p0 = polar(h0, r), p1 = polar(h1, r);
      return "M " + n2(p0.x) + " " + n2(p0.y) + " A " + r + " " + r + " 0 " + (span(h0, h1) > 12 ? 1 : 0) + " 1 " + n2(p1.x) + " " + n2(p1.y);
    }

    if (nightPath && !nightPath.getAttribute("d") && night.dusk != null && night.dawn != null) {
      var outer = 156, inner = 108, large = span(night.dusk, night.dawn) > 12 ? 1 : 0;
      var a = polar(night.dusk, outer), b = polar(night.dawn, outer);
      var c = polar(night.dawn, inner), d = polar(night.dusk, inner);
      nightPath.setAttribute("d",
        "M " + n2(a.x) + " " + n2(a.y) +
        " A " + outer + " " + outer + " 0 " + large + " 1 " + n2(b.x) + " " + n2(b.y) +
        " L " + n2(c.x) + " " + n2(c.y) +
        " A " + inner + " " + inner + " 0 " + large + " 0 " + n2(d.x) + " " + n2(d.y) + " Z");
    }
    if (ticks && !ticks.children.length) {
      for (var h = 0; h < 24; h++) {
        var major = h % 6 === 0;
        var p0 = polar(h, major ? 140 : 150), p1 = polar(h, 162);
        var line = document.createElementNS(SVGNS, "line");
        line.setAttribute("x1", n2(p0.x));
        line.setAttribute("y1", n2(p0.y));
        line.setAttribute("x2", n2(p1.x));
        line.setAttribute("y2", n2(p1.y));
        if (major) line.setAttribute("class", "major");
        ticks.appendChild(line);
      }
    }
    if (remG && !remG.children.length) {
      (night.rem || []).forEach(function (r) {
        var path = document.createElementNS(SVGNS, "path");
        path.setAttribute("d", arcD(r[0], r[1], 150));
        remG.appendChild(path);
      });
    }
    if (remG) for (var ri = 0; ri < remG.children.length; ri++) remPaths.push(remG.children[ri]);

    function inSpan(v, a, b) {
      if (a == null || b == null) return false;
      return a <= b ? v >= a && v < b : v >= a || v < b;
    }
    function wrap(v) {
      v %= 24;
      return v < 0 ? v + 24 : v;
    }
    function phaseOf(v) {
      var rems = night.rem || [], phases = night.phases || [], i;
      for (i = 0; i < rems.length; i++) if (inSpan(v, rems[i][0], rems[i][1])) return { id: "rem", rem: i };
      for (i = 0; i < phases.length; i++) if (inSpan(v, phases[i].from, phases[i].to)) return { id: phases[i].id, rem: -1 };
      return { id: "day", rem: -1 };
    }
    var phaseWord = { day: "Day", dark: "Evening", rest: "Rest", rem: "Dreaming", late: "Late" };

    function render() {
      hour = wrap(hour);
      hand.setAttribute("transform", "rotate(" + (hour * 15).toFixed(3) + " 200 200)");
      var ph = phaseOf(hour);
      for (var i = 0; i < remPaths.length; i++) remPaths[i].classList.toggle("is-on", i === ph.rem);
      if (glow) glow.classList.toggle("is-on", ph.rem >= 0);
      if (ph.id !== shown) {
        shown = ph.id;
        for (var p = 0; p < panels.length; p++) {
          panels[p].classList.toggle("is-active", panels[p].getAttribute("data-phase") === ph.id);
        }
        if (word) word.textContent = phaseWord[ph.id] || "";
        hit.setAttribute("aria-valuetext", phaseWord[ph.id] || "");
      }
      hit.setAttribute("aria-valuenow", String(Math.round(hour * 60) % 1440));
    }

    function geom(e) {
      var rect = hit.getBoundingClientRect();
      var dx = e.clientX - (rect.left + rect.width / 2);
      var dy = e.clientY - (rect.top + rect.height / 2);
      return { dist: Math.sqrt(dx * dx + dy * dy) / (rect.width / 2), ang: Math.atan2(dy, dx) };
    }
    function hourFrom(e) {
      var a = geom(e).ang + Math.PI / 2;
      if (a < 0) a += Math.PI * 2;
      return (a / (Math.PI * 2)) * 24;
    }
    function hold() {
      pauseUntil = performance.now() + 4000;
    }

    /* Touch: only the outer ring (where the hand's knob runs) grabs the
       gesture; a swipe that starts in the middle of the face scrolls the page. */
    var RING = 0.42;
    hit.addEventListener("touchstart", function (e) {
      var t = e.touches && e.touches[0];
      if (t && geom(t).dist >= RING && e.cancelable) e.preventDefault();
    }, { passive: false });

    var pid = null;
    hit.addEventListener("pointerdown", function (e) {
      if (e.button) return;
      if (e.pointerType === "touch" && geom(e).dist < RING) return;
      dragging = true;
      pid = e.pointerId;
      try { hit.setPointerCapture(pid); } catch (err) { /* ignore */ }
      try { hit.focus({ preventScroll: true }); } catch (err2) { hit.focus(); }
      hit.classList.add("is-grabbing");
      hour = hourFrom(e);
      render();
    });
    hit.addEventListener("pointermove", function (e) {
      if (!dragging || e.pointerId !== pid) return;
      if (e.cancelable) e.preventDefault();
      hour = hourFrom(e);
      render();
    });
    var endClock = function (e) {
      if (!dragging || e.pointerId !== pid) return;
      dragging = false;
      pid = null;
      hit.classList.remove("is-grabbing");
      hold();
    };
    hit.addEventListener("pointerup", endClock);
    hit.addEventListener("pointercancel", endClock);
    hit.addEventListener("keydown", function (e) {
      var step = { ArrowUp: 0.25, ArrowRight: 0.25, ArrowDown: -0.25, ArrowLeft: -0.25, PageUp: 1, PageDown: -1 }[e.key];
      var next = e.key === "Home" ? 0 : e.key === "End" ? 23 + 59 / 60 : step ? hour + step : null;
      if (next == null) return;
      e.preventDefault();
      hour = next;
      hold();
      render();
    });

    render();
    if (text) text.classList.add("is-live"); /* panels only hide once one is showing */

    /* Slow auto-advance while the section is on screen; no frames otherwise. */
    function loop(now) {
      raf = 0;
      if (!inView || document.hidden) return;
      if (!dragging && now >= pauseUntil && last) {
        hour += Math.min(0.05, (now - last) / 1000) * (24 / turn);
        render();
      }
      last = now;
      raf = requestAnimationFrame(loop);
    }
    function wake() {
      if (reduce || raf || !inView || document.hidden) return;
      last = 0;
      raf = requestAnimationFrame(loop);
    }
    var section = byId("night");
    if (section && "IntersectionObserver" in window) {
      new IntersectionObserver(function (ents) {
        var en = ents[ents.length - 1];
        inView = en.isIntersecting && en.intersectionRect.height > 100;
        wake();
      }, { threshold: [0, 0.05, 0.2, 0.5] }).observe(section);
    } else {
      inView = true;
      wake();
    }
    document.addEventListener("visibilitychange", wake);
  }

  /* ---------- 5. flip cards ---------- */

  var CARD_CONTROLS = "a[href], button, input, select, textarea, label, summary, [contenteditable], [role=button], [role=link]";

  function initCards() {
    var cards = document.querySelectorAll("[data-card]");
    for (var i = 0; i < cards.length; i++) {
      (function (card) {
        var btn = card.querySelector(".card-toggle");
        if (!btn) return;
        var back = card.querySelector(".card-back");
        /* the back face scrolls on its own; keep Lenis off its wheel/touch */
        if (back) back.setAttribute("data-lenis-prevent", "");

        function flip() {
          var on = card.classList.toggle("is-flipped");
          btn.setAttribute("aria-pressed", on ? "true" : "false");
        }

        /* The button is the keyboard/AT control (Enter/Space arrive here as
           clicks). Clicks anywhere else on the visible face toggle too, except
           on another control or when the click ends a text selection. */
        btn.addEventListener("click", flip);
        card.addEventListener("click", function (e) {
          if (e.defaultPrevented) return;
          var t = e.target.closest ? e.target : e.target.parentElement;
          if (!t || t.closest(".card-toggle")) return;
          var ctl = t.closest(CARD_CONTROLS);
          if (ctl && card.contains(ctl)) return;
          var sel = window.getSelection && window.getSelection();
          if (sel && !sel.isCollapsed && sel.containsNode(card, true)) return;
          flip();
        });
      })(cards[i]);
    }
  }

  /* ---------- 6. womb ---------- */

  function initWomb() {
    var canvas = byId("womb-canvas");
    if (!canvas || !window.CellScene) return;
    /* Held at rich CO2. Each time the chamber comes into view the locks are
       let go one by one (slow ease); they are put back while it is offscreen. */
    var START = 0.4;
    var scene = new window.CellScene(canvas, {
      interactive: false,
      gentle: reduce,
      co2: reduce ? 1 : START,
      bloom: !reduce,
      scale: 0.36,
      motes: 64,
      ease: 0.7,
      contained: true
    });
    scene.start();
    if (reduce || !("IntersectionObserver" in window)) {
      scene.setCO2(1);
      return;
    }
    new IntersectionObserver(function (ents) {
      var en = ents[ents.length - 1];
      if (en.intersectionRatio >= 0.35) scene.setCO2(1);
      else if (!en.isIntersecting) scene.setCO2(START, { immediate: true });
    }, { threshold: [0, 0.35] }).observe(canvas);
  }

  /* ---------- key ideas ---------- */

  function initWords() {
    var rail = byId("words-rail");
    if (!rail) return;
    var prev = byId("words-prev");
    var next = byId("words-next");
    var count = byId("words-count");
    var cards = rail.querySelectorAll(".word-card");
    if (!cards.length) return;
    rail.setAttribute("data-lenis-prevent", "");
    if (count && !count.children.length) {
      for (var i = 0; i < cards.length; i++) count.appendChild(document.createElement("i"));
    }
    var dots = count ? count.children : [];

    function leftOf(i) { return cards[i].offsetLeft - cards[0].offsetLeft; }
    function current() {
      if (rail.scrollLeft >= rail.scrollWidth - rail.clientWidth - 4) return cards.length - 1;
      var best = 0, bestD = Infinity;
      for (var i = 0; i < cards.length; i++) {
        var d = Math.abs(leftOf(i) - rail.scrollLeft);
        if (d < bestD) { bestD = d; best = i; }
      }
      return best;
    }
    function paint() {
      var i = current();
      for (var d = 0; d < dots.length; d++) dots[d].classList.toggle("is-on", d === i);
      if (prev) prev.disabled = i === 0;
      if (next) next.disabled = i === cards.length - 1;
    }
    function go(dir) {
      var n = Math.max(0, Math.min(cards.length - 1, current() + dir));
      rail.scrollTo({ left: leftOf(n), behavior: reduce ? "auto" : "smooth" });
    }
    if (prev) prev.addEventListener("click", function () { go(-1); });
    if (next) next.addEventListener("click", function () { go(1); });
    rail.addEventListener("keydown", function (e) {
      if (e.key === "ArrowRight") { e.preventDefault(); go(1); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); go(-1); }
    });
    var pending = 0;
    rail.addEventListener("scroll", function () {
      if (pending) return;
      pending = requestAnimationFrame(function () { pending = 0; paint(); });
    }, { passive: true });
    window.addEventListener("resize", paint);
    paint();
  }

  /* ---------- ambient CSS drifts: run only while their section is on screen ---------- */

  function initAmbient() {
    if (reduce || !("IntersectionObserver" in window)) return;
    var secs = document.querySelectorAll(".section--animals, .section--words");
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) { en.target.classList.toggle("in-view", en.isIntersecting); });
    }, { rootMargin: "60px 0px" });
    for (var i = 0; i < secs.length; i++) io.observe(secs[i]);
  }

  /* ---------- after webfonts: re-measure ---------- */

  function whenFonts() {
    function done() {
      if (heroScene) heroScene.resize();
      if (low) {
        if (low.scene) low.scene.resize();
        low.sync();
      }
      if (ST) ST.refresh();
      repaintDial(dialValue, dialValue);
    }
    if (document.fonts && document.fonts.ready && document.fonts.ready.then) document.fonts.ready.then(done, done);
    else done();
  }

  safe(initPlates);
  safe(initLenis);
  safe(initAnchors);
  safe(initHero);
  safe(initRail);
  safe(initExhaust);
  safe(initLow);
  safe(initNight);
  safe(initCards);
  safe(initWomb);
  safe(initWords);
  safe(initAmbient);
  safe(initReveals); /* last: pins above must exist before reveal triggers measure */
  safe(whenFonts);
})();
