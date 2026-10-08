/* CellScene: a reusable canvas illustration of the argument
   (not a physiological model). Used by the hero, section 3 and the womb.

   new CellScene(canvas, {
     interactive,  // vertical drag on the canvas changes CO2 (touch: horizontal)
     anchor,       // element whose box positions/sizes the cell (else canvas centre)
     fill,         // with an anchor: cell radius as a fraction of the anchor's short side (0.4)
     scale,        // cell radius as a fraction of min(w, h) when there is no anchor
     co2,          // starting value 0..1 (0 = low, 1 = rich)
     bloom,        // bloom in from a point of light on first start
     parallax,     // motes follow the mouse slightly
     gentle,       // prefers-reduced-motion: slow, calm motion
     motes,        // number of CO2 motes
     contained,    // not full-bleed: keep the glow and motes off the canvas edges
     onInput       // function (value, phase) for user drags; phase "move" | "end"
   })
   .setCO2(v, {immediate}) .getCO2() .state() .start() .stop() .resize() */
(function () {
  "use strict";

  var TAU = Math.PI * 2;
  var COL = {
    amber: [255, 179, 71],
    deep: [224, 138, 30],
    teal: [94, 242, 214],
    violet: [122, 111, 143],
    rose: [208, 106, 122],
    ink: [239, 230, 214],
    lock: [214, 204, 255],
    dark: [20, 16, 28]
  };

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function smooth(e0, e1, x) {
    var t = clamp((x - e0) / (e1 - e0), 0, 1);
    return t * t * (3 - 2 * t);
  }
  function mix(c1, c2, t) {
    return [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)];
  }
  function rgba(c, a) {
    return "rgba(" + (c[0] | 0) + "," + (c[1] | 0) + "," + (c[2] | 0) + "," + clamp(a, 0, 1).toFixed(3) + ")";
  }
  function easeOutBack(t) {
    var c1 = 1.9, c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  }
  function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }
  function rng(seed) {
    var s = seed % 2147483647;
    if (s <= 0) s += 2147483646;
    return function () {
      s = (s * 16807) % 2147483647;
      return (s - 1) / 2147483646;
    };
  }

  /* Soft round glow sprite, drawn once and reused for motes and particles. */
  function sprite(color) {
    var c = document.createElement("canvas");
    c.width = c.height = 64;
    var g = c.getContext("2d");
    var grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, rgba(color, 1));
    grd.addColorStop(0.18, rgba(color, 0.85));
    grd.addColorStop(0.45, rgba(color, 0.22));
    grd.addColorStop(1, rgba(color, 0));
    g.fillStyle = grd;
    g.fillRect(0, 0, 64, 64);
    return c;
  }

  function CellScene(canvas, opts) {
    opts = opts || {};
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.opts = opts;
    this.anchor = opts.anchor || null;
    this.gentle = !!opts.gentle;
    this.onInput = opts.onInput || null;
    this.target = this.co2 = clamp(opts.co2 != null ? opts.co2 : 0.65, 0, 1);
    this.t = 0;
    this.last = 0;
    this.breathPh = 0;
    this.started = false;
    this.running = false;
    this.onScreen = true;
    this.docVisible = !document.hidden;
    this.bloom = opts.bloom ? 0 : 1;
    this.pointer = { x: 0, y: 0, tx: 0, ty: 0 };
    this.mitoGlow = lerp(0.12, 1, this.co2);
    this.w = this.h = 1;
    this.dpr = 1;

    var r = rng(opts.seed || 11);
    var i;

    this.motes = [];
    var n = opts.motes || 90;
    for (i = 0; i < n; i++) {
      this.motes.push({
        x: r(), y: r(), z: 0.25 + r() * 0.75,
        ph: r() * TAU, sp: 0.3 + r() * 0.9, th: r()
      });
    }

    this.mito = [];
    for (i = 0; i < 5; i++) {
      var ang = (i / 5) * TAU + 0.5 + (r() - 0.5) * 0.5;
      this.mito.push({
        ang: ang,
        dist: 0.64 + r() * 0.1,
        rot: ang + Math.PI / 2 + (r() - 0.5) * 0.9,
        len: 0.2 + r() * 0.06,
        ph: r() * TAU
      });
    }

    /* Methyl "lock" attachment sites along the DNA strand. */
    this.sites = [];
    var K = opts.sites || 8;
    for (i = 0; i < K; i++) {
      this.sites.push({ u: -0.78 + (1.56 * (i + 0.5)) / K, strand: i % 2, state: "off", t: 0, flash: 0 });
    }
    this.order = [];
    for (i = 0; i < K; i++) this.order.push(i);
    for (i = K - 1; i > 0; i--) {
      var j = Math.floor(r() * (i + 1)), tmp = this.order[i];
      this.order[i] = this.order[j];
      this.order[j] = tmp;
    }
    this.freeLocks = [];
    this.lactate = [];
    this.lactAcc = 0;
    this.lockTimer = 0;

    this.spr = { teal: sprite(COL.teal), grey: sprite([150, 140, 170]), rose: sprite(COL.rose), amber: sprite(COL.amber), lock: sprite(COL.lock) };

    this._frame = this._frame.bind(this);
    this.resize();
    this._snapLocks();
    this._observe();
    if (opts.interactive) this._bindPointer();
    if (opts.parallax) this._bindParallax();
  }

  var P = CellScene.prototype;

  /* ---------- public API ---------- */

  P.setCO2 = function (v, o) {
    this.target = clamp(+v || 0, 0, 1);
    if ((o && o.immediate) || !this.running) {
      this.co2 = this.target;
      this.mitoGlow = lerp(0.12, 1, this.co2);
      this._snapLocks();
    }
    return this;
  };

  P.getCO2 = function () { return this.target; };

  P.state = function () {
    var on = 0;
    for (var i = 0; i < this.sites.length; i++) if (this.sites[i].state === "on") on++;
    return {
      co2: Math.round(this.co2 * 1000) / 1000,
      target: Math.round(this.target * 1000) / 1000,
      locks: on,
      lactate: this.lactate.length,
      mitoGlow: Math.round(this.mitoGlow * 1000) / 1000
    };
  };

  P.start = function () {
    this.started = true;
    this._sync();
    return this;
  };

  P.stop = function () {
    this.started = false;
    this._sync();
    return this;
  };

  P.resize = function () {
    var rect = this.canvas.getBoundingClientRect();
    var w = Math.max(1, rect.width), h = Math.max(1, rect.height);
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    this.w = w;
    this.h = h;
    this.dpr = dpr;
    var cw = Math.round(w * dpr), ch = Math.round(h * dpr);
    if (this.canvas.width !== cw) this.canvas.width = cw;
    if (this.canvas.height !== ch) this.canvas.height = ch;
    if (this.anchor) {
      var a = this.anchor.getBoundingClientRect();
      this.cx = a.left - rect.left + a.width / 2;
      this.cy = a.top - rect.top + a.height / 2;
      this.R = Math.max(40, Math.min(a.width, a.height) * (this.opts.fill || 0.4));
    } else {
      this.cx = w / 2;
      this.cy = h / 2;
      this.R = Math.max(40, Math.min(w, h) * (this.opts.scale || 0.34));
    }
    if (!this.running) this.draw();
    return this;
  };

  /* ---------- internals ---------- */

  P._sync = function () {
    var should = this.started && this.onScreen && this.docVisible;
    if (should && !this.running) {
      this.running = true;
      this.last = 0;
      this.raf = requestAnimationFrame(this._frame);
    } else if (!should && this.running) {
      this.running = false;
      cancelAnimationFrame(this.raf);
    }
  };

  P._observe = function () {
    var self = this;
    if ("IntersectionObserver" in window) {
      this.io = new IntersectionObserver(function (entries) {
        self.onScreen = entries[entries.length - 1].isIntersecting;
        self._sync();
      }, { rootMargin: "80px" });
      this.io.observe(this.canvas);
    }
    document.addEventListener("visibilitychange", function () {
      self.docVisible = !document.hidden;
      self._sync();
    });
    if ("ResizeObserver" in window) {
      var pending = false;
      this.ro = new ResizeObserver(function () {
        if (pending) return;
        pending = true;
        requestAnimationFrame(function () { pending = false; self.resize(); });
      });
      this.ro.observe(this.canvas);
      if (this.anchor) this.ro.observe(this.anchor);
    } else {
      window.addEventListener("resize", function () { self.resize(); });
    }
  };

  P._bindPointer = function () {
    var self = this, c = this.canvas, drag = null;
    c.classList.add("cell-canvas--interactive");
    c.addEventListener("pointerdown", function (e) {
      if (e.button) return;
      drag = { id: e.pointerId, x: e.clientX, y: e.clientY, v: self.target, type: e.pointerType, active: e.pointerType !== "touch" };
      if (drag.active) {
        try { c.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
        c.classList.add("is-dragging");
      }
    });
    c.addEventListener("pointermove", function (e) {
      if (!drag || drag.id !== e.pointerId) return;
      var dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (!drag.active) {
        /* Touch: only a clearly horizontal gesture becomes a CO2 drag,
           so vertical swipes keep scrolling the page. */
        if (Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy) * 1.6) {
          drag.active = true;
          drag.x = e.clientX;
          drag.y = e.clientY;
          drag.v = self.target;
          try { c.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
          c.classList.add("is-dragging");
        } else if (Math.abs(dy) > 12) {
          drag = null;
        }
        return;
      }
      var span = Math.max(200, self.h * 0.6);
      var delta = drag.type === "touch" ? (e.clientX - drag.x) / span : -(e.clientY - drag.y) / span;
      var v = clamp(drag.v + delta, 0, 1);
      self.setCO2(v);
      if (self.onInput) self.onInput(v, "move");
    });
    function end(e) {
      if (!drag || drag.id !== e.pointerId) return;
      var was = drag.active;
      drag = null;
      c.classList.remove("is-dragging");
      if (was && self.onInput) self.onInput(self.target, "end");
    }
    c.addEventListener("pointerup", end);
    c.addEventListener("pointercancel", end);
  };

  P._bindParallax = function () {
    var self = this;
    window.addEventListener("pointermove", function (e) {
      if (e.pointerType && e.pointerType !== "mouse") return;
      self.pointer.tx = (e.clientX / window.innerWidth - 0.5) * 2;
      self.pointer.ty = (e.clientY / window.innerHeight - 0.5) * 2;
    }, { passive: true });
  };

  P._desiredLocks = function (c) {
    return Math.round(this.sites.length * (1 - smooth(0.12, 0.72, c)));
  };

  P._snapLocks = function () {
    var want = this._desiredLocks(this.co2);
    for (var k = 0; k < this.order.length; k++) {
      var s = this.sites[this.order[k]];
      s.state = k < want ? "on" : "off";
      s.t = s.state === "on" ? 1 : 0;
      s.flash = 0;
    }
    this.freeLocks.length = 0;
    if (this.co2 > 0.55) this.lactate.length = 0;
  };

  P._frame = function (now) {
    if (!this.running) return;
    var dt = this.last ? Math.min(0.05, (now - this.last) / 1000) : 1 / 60;
    this.last = now;
    this.update(dt);
    this.draw();
    this.raf = requestAnimationFrame(this._frame);
  };

  /* Position of a site on the (rotated) DNA strand, relative to the cell centre. */
  P._sitePos = function (s) {
    var R = this.R, Rn = R * 0.4, half = Rn * 0.8;
    var ph = s.u * Math.PI * 2.6 + this.twist + s.strand * Math.PI;
    var A = Rn * 0.24;
    var x = s.u * half / 0.78, y = A * Math.sin(ph);
    var tilt = -0.22, ca = Math.cos(tilt), sa = Math.sin(tilt);
    return { x: this.nx + x * ca - y * sa, y: this.ny + x * sa + y * ca, z: Math.cos(ph) };
  };

  P.update = function (dt) {
    var speed = this.gentle ? 0.35 : 1;
    var sdt = dt * speed;
    this.t += sdt;
    this.co2 += (this.target - this.co2) * (1 - Math.exp(-dt * (this.opts.ease || 5)));
    var c = this.co2;
    if (this.bloom < 1) this.bloom = Math.min(1, this.bloom + dt / 1.1);
    this.pointer.x += (this.pointer.tx - this.pointer.x) * (1 - Math.exp(-dt * 3));
    this.pointer.y += (this.pointer.ty - this.pointer.y) * (1 - Math.exp(-dt * 3));

    /* membrane rhythm: slow and deep when rich, quick and shallow when low */
    var rate = lerp(1.55, 0.32, c);
    this.breathPh += sdt * rate * TAU;
    this.twist = this.t * 0.55;
    this.nx = -0.05 * this.R;
    this.ny = 0.02 * this.R;

    var targetGlow = lerp(0.12, 1, c);
    this.mitoGlow += (targetGlow - this.mitoGlow) * (1 - Math.exp(-dt * 4));

    /* methyl locks: attach one at a time at low CO2, release at high */
    var i, s, onCount = 0;
    for (i = 0; i < this.sites.length; i++) {
      s = this.sites[i];
      if (s.state === "attaching") {
        s.t += dt / 0.42;
        if (s.t >= 1) { s.t = 1; s.state = "on"; s.flash = 1; }
      }
      if (s.flash > 0) s.flash = Math.max(0, s.flash - dt * 2.4);
      if (s.state !== "off") onCount++;
    }
    this.lockTimer -= dt;
    if (this.lockTimer <= 0) {
      var want = this._desiredLocks(c), k;
      if (onCount < want) {
        for (k = 0; k < this.order.length; k++) {
          s = this.sites[this.order[k]];
          if (s.state === "off") { s.state = "attaching"; s.t = 0; break; }
        }
        this.lockTimer = 0.16;
      } else if (onCount > want) {
        for (k = this.order.length - 1; k >= 0; k--) {
          s = this.sites[this.order[k]];
          if (s.state !== "off") {
            var p = this._sitePos(s);
            var a = Math.atan2(p.y, p.x) + (Math.random() - 0.5) * 0.8;
            var sp = this.R * (0.35 + Math.random() * 0.3);
            this.freeLocks.push({ x: p.x, y: p.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - this.R * 0.15, rot: 0, vr: (Math.random() - 0.5) * 4, life: 1 });
            s.state = "off";
            s.t = 0;
            break;
          }
        }
        this.lockTimer = 0.12;
      }
    }
    for (i = this.freeLocks.length - 1; i >= 0; i--) {
      var f = this.freeLocks[i];
      f.x += f.vx * dt;
      f.y += f.vy * dt;
      f.vx *= Math.exp(-dt * 0.9);
      f.vy = f.vy * Math.exp(-dt * 0.9) - this.R * 0.05 * dt;
      f.rot += f.vr * dt;
      f.life -= dt / 2.4;
      if (f.life <= 0) this.freeLocks.splice(i, 1);
    }

    /* lactate rises from the cell when CO2 is low */
    var lr = clamp((0.55 - c) / 0.55, 0, 1);
    this.lactAcc += dt * lr * (this.gentle ? 8 : 18);
    while (this.lactAcc >= 1 && this.lactate.length < 140) {
      this.lactAcc -= 1;
      var ang = -Math.PI / 2 + (Math.random() - 0.5) * 2.4;
      this.lactate.push({
        x: Math.cos(ang) * this.R * 0.95,
        y: Math.sin(ang) * this.R * 0.95,
        vy: -this.R * (0.18 + Math.random() * 0.22),
        ph: Math.random() * TAU,
        sz: 0.7 + Math.random() * 0.8,
        life: 1,
        dec: 1 / (2.8 + Math.random() * 1.6)
      });
    }
    if (this.lactAcc > 1) this.lactAcc = 1;
    for (i = this.lactate.length - 1; i >= 0; i--) {
      var l = this.lactate[i];
      l.y += l.vy * sdt;
      l.x += Math.sin(this.t * 2 + l.ph) * this.R * 0.08 * sdt;
      l.life -= dt * l.dec;
      if (l.life <= 0) this.lactate.splice(i, 1);
    }

    /* motes drift slowly through the burrow */
    for (i = 0; i < this.motes.length; i++) {
      var m = this.motes[i];
      m.x += (0.006 * m.sp + Math.sin(this.t * 0.3 + m.ph) * 0.004) * sdt;
      m.y += (-0.004 * m.sp + Math.cos(this.t * 0.25 + m.ph) * 0.003) * sdt;
      if (m.x > 1.05) m.x -= 1.1;
      if (m.x < -0.05) m.x += 1.1;
      if (m.y < -0.05) m.y += 1.1;
      if (m.y > 1.05) m.y -= 1.1;
    }
  };

  P.draw = function () {
    var ctx = this.ctx, w = this.w, h = this.h, R = this.R, c = this.co2, t = this.t;
    if (this.nx == null) { this.nx = -0.05 * R; this.ny = 0.02 * R; this.twist = 0; }
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    var tint = mix(COL.violet, COL.amber, c);
    var i;

    /* glow behind the cell; teal haze thickens at rich CO2. Contained
       (not full-bleed) canvases end the glow before the nearest edge, so
       the canvas never shows as a box. */
    var contained = !!this.opts.contained;
    var haloR = contained ? Math.max(R * 1.2, Math.min(R * 2.6, this.cx, this.cy, w - this.cx, h - this.cy)) : R * 2.6;
    var halo = ctx.createRadialGradient(this.cx, this.cy, R * 0.2, this.cx, this.cy, haloR);
    halo.addColorStop(0, rgba(tint, 0.1 + 0.14 * c));
    halo.addColorStop(0.45, rgba(mix(COL.violet, COL.teal, c), 0.05 + 0.1 * c));
    halo.addColorStop(1, rgba(COL.teal, 0));
    ctx.fillStyle = halo;
    ctx.fillRect(0, 0, w, h);

    /* CO2 motes */
    var px0 = this.pointer.x * 14, py0 = this.pointer.y * 10;
    for (i = 0; i < this.motes.length; i++) {
      var m = this.motes[i];
      var present = 0.15 + 0.85 * smooth(m.th - 0.35, m.th + 0.05, c * 1.1);
      var a = (0.12 + 0.5 * m.z) * present * (0.72 + 0.28 * Math.sin(t * m.sp * 1.7 + m.ph));
      var sz = (1 + 2.2 * m.z) * (0.8 + 0.5 * c) * 5;
      var x = m.x * w + px0 * m.z, y = m.y * h + py0 * m.z;
      if (contained) {
        /* fade motes out toward an ellipse inside the canvas edges */
        var ex = (x - w / 2) / (w / 2), ey = (y - h / 2) / (h / 2);
        a *= 1 - smooth(0.62, 0.95, Math.sqrt(ex * ex + ey * ey));
        if (a <= 0.004) continue;
      }
      ctx.globalAlpha = a * (0.35 + 0.65 * c);
      ctx.drawImage(this.spr.teal, x - sz, y - sz, sz * 2, sz * 2);
      ctx.globalAlpha = a * 0.6 * (1 - c);
      ctx.drawImage(this.spr.grey, x - sz * 0.8, y - sz * 0.8, sz * 1.6, sz * 1.6);
    }
    ctx.globalAlpha = 1;

    var e = easeOutCubic(this.bloom);
    if (this.bloom < 1) {
      var fl = (1 - this.bloom);
      ctx.globalAlpha = fl;
      var fs = R * (0.25 + 1.2 * e);
      ctx.drawImage(this.spr.amber, this.cx - fs, this.cy - fs, fs * 2, fs * 2);
      ctx.globalAlpha = 1;
    }

    ctx.save();
    ctx.translate(this.cx, this.cy);
    ctx.scale(Math.max(0.001, e), Math.max(0.001, e));

    /* membrane */
    var amp = lerp(0.016, 0.05, c);
    var breath = Math.sin(this.breathPh);
    var jit = Math.pow(1 - c, 2) * 0.03;
    var N = 72, pts = [];
    for (i = 0; i < N; i++) {
      var ang = (i / N) * TAU;
      var rr = R * (1 + amp * breath +
        0.026 * Math.sin(3 * ang + t * 0.7) +
        0.018 * Math.sin(5 * ang - t * 1.1) +
        jit * Math.sin(11 * ang + t * 13) * Math.sin(t * 7.3 + ang * 2));
      pts.push([Math.cos(ang) * rr, Math.sin(ang) * rr]);
    }
    ctx.beginPath();
    for (i = 0; i <= N; i++) {
      var p0 = pts[i % N], p1 = pts[(i + 1) % N];
      var mx = (p0[0] + p1[0]) / 2, my = (p0[1] + p1[1]) / 2;
      if (i === 0) ctx.moveTo(mx, my);
      else ctx.quadraticCurveTo(p0[0], p0[1], mx, my);
    }
    ctx.closePath();
    var fill = ctx.createRadialGradient(-R * 0.25, -R * 0.3, R * 0.1, 0, 0, R * 1.05);
    fill.addColorStop(0, rgba(tint, 0.2 + 0.08 * c));
    fill.addColorStop(0.7, rgba(mix(COL.dark, tint, 0.5), 0.16));
    fill.addColorStop(1, rgba(tint, 0.3));
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.shadowColor = rgba(tint, 0.8);
    ctx.shadowBlur = 10 + 22 * c;
    ctx.strokeStyle = rgba(tint, 0.55 + 0.3 * c);
    ctx.lineWidth = 2 + 1.6 * c;
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = rgba(COL.ink, 0.08 + 0.06 * c);
    ctx.lineWidth = 7 + 4 * c;
    ctx.stroke();

    /* mitochondria */
    var glow = this.mitoGlow;
    for (i = 0; i < this.mito.length; i++) {
      var mt = this.mito[i];
      var ma = mt.ang + Math.sin(t * 0.2 + mt.ph) * 0.06;
      var mxp = Math.cos(ma) * mt.dist * R, myp = Math.sin(ma) * mt.dist * R;
      var L = mt.len * R, W = L * 0.44;
      var g = glow * (0.85 + 0.15 * Math.sin(t * 1.4 + mt.ph));
      ctx.save();
      ctx.translate(mxp, myp);
      ctx.rotate(mt.rot + Math.sin(t * 0.3 + mt.ph) * 0.1);
      ctx.beginPath();
      roundCapsule(ctx, -L / 2, -W / 2, L, W);
      ctx.shadowColor = rgba(COL.amber, 0.9 * g);
      ctx.shadowBlur = 26 * g;
      ctx.fillStyle = rgba(mix([92, 82, 110], COL.amber, g), 0.35 + 0.55 * g);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = rgba(mix(COL.violet, COL.deep, g), 0.9);
      ctx.lineWidth = 1.4;
      ctx.stroke();
      /* cristae */
      ctx.beginPath();
      var steps = 6;
      for (var k = 0; k <= steps; k++) {
        var xx = -L * 0.38 + (L * 0.76 * k) / steps;
        var yy = (k % 2 ? 1 : -1) * W * 0.26;
        if (k === 0) ctx.moveTo(xx, yy); else ctx.lineTo(xx, yy);
      }
      ctx.strokeStyle = rgba(mix([60, 50, 70], [120, 60, 10], g), 0.8);
      ctx.lineWidth = 1.1;
      ctx.stroke();
      ctx.restore();
    }

    /* nucleus */
    var Rn = R * 0.4;
    ctx.beginPath();
    ctx.ellipse(this.nx, this.ny, Rn * (1 + 0.02 * breath), Rn * (0.92 - 0.015 * breath), -0.2, 0, TAU);
    var nf = ctx.createRadialGradient(this.nx - Rn * 0.3, this.ny - Rn * 0.3, Rn * 0.1, this.nx, this.ny, Rn);
    nf.addColorStop(0, rgba(mix(COL.violet, COL.amber, c * 0.6), 0.22));
    nf.addColorStop(1, rgba(COL.dark, 0.55));
    ctx.fillStyle = nf;
    ctx.fill();
    ctx.strokeStyle = rgba(tint, 0.35 + 0.2 * c);
    ctx.lineWidth = 1.4;
    ctx.stroke();

    /* DNA double helix */
    var half = Rn * 0.8, A = Rn * 0.24, tilt = -0.22;
    var sA = mix(COL.violet, COL.teal, c), sB = mix(COL.violet, COL.amber, c);
    ctx.save();
    ctx.translate(this.nx, this.ny);
    ctx.rotate(tilt);
    var SEG = 44, u, ph, y1, y2, xq;
    for (i = 0; i <= SEG; i += 2) {
      u = -0.78 + (1.56 * i) / SEG;
      ph = u * Math.PI * 2.6 + this.twist;
      xq = (u * half) / 0.78;
      y1 = A * Math.sin(ph);
      y2 = A * Math.sin(ph + Math.PI);
      ctx.beginPath();
      ctx.moveTo(xq, y1);
      ctx.lineTo(xq, y2);
      ctx.strokeStyle = rgba(COL.ink, 0.12 + 0.12 * Math.abs(Math.cos(ph)));
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }
    for (var strand = 0; strand < 2; strand++) {
      for (i = 0; i < SEG; i++) {
        var ua = -0.78 + (1.56 * i) / SEG, ub = -0.78 + (1.56 * (i + 1)) / SEG;
        var pa = ua * Math.PI * 2.6 + this.twist + strand * Math.PI;
        var pb = ub * Math.PI * 2.6 + this.twist + strand * Math.PI;
        var depth = (Math.cos((pa + pb) / 2) + 1) / 2;
        ctx.beginPath();
        ctx.moveTo((ua * half) / 0.78, A * Math.sin(pa));
        ctx.lineTo((ub * half) / 0.78, A * Math.sin(pb));
        ctx.strokeStyle = rgba(strand ? sB : sA, 0.35 + 0.6 * depth);
        ctx.lineWidth = 1.6 + 1.6 * depth;
        ctx.stroke();
      }
    }
    ctx.restore();

    /* methyl locks on the DNA */
    var hr = Math.max(5, Rn * 0.13);
    for (i = 0; i < this.sites.length; i++) {
      var s = this.sites[i];
      if (s.state === "off") continue;
      var sp = this._sitePos(s);
      var k2 = s.state === "attaching" ? s.t : 1;
      var drop = (1 - easeOutCubic(k2)) * Rn * 0.7;
      var sc = s.state === "attaching" ? Math.max(0.2, easeOutBack(k2)) : 1;
      drawLock(ctx, this.spr.lock, sp.x, sp.y - drop, hr * sc, 0, Math.min(1, k2 * 2.2), s.flash);
    }

    /* released locks drifting away */
    for (i = 0; i < this.freeLocks.length; i++) {
      var f = this.freeLocks[i];
      drawLock(ctx, this.spr.lock, f.x, f.y, hr * (0.8 + 0.2 * f.life), f.rot, f.life * 0.9, 0);
    }

    /* lactate */
    for (i = 0; i < this.lactate.length; i++) {
      var l = this.lactate[i];
      var ls = R * 0.05 * l.sz;
      ctx.globalAlpha = Math.min(1, l.life * 1.4) * 0.75;
      ctx.drawImage(this.spr.rose, l.x - ls, l.y - ls, ls * 2, ls * 2);
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  };

  function roundCapsule(ctx, x, y, w, h) {
    var r = h / 2;
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.arc(x + w - r, y + r, r, -Math.PI / 2, Math.PI / 2);
    ctx.lineTo(x + r, y + h);
    ctx.arc(x + r, y + r, r, Math.PI / 2, (3 * Math.PI) / 2);
    ctx.closePath();
  }

  /* A methyl "lock": a small glowing hexagon cap with CH3 written on it. */
  function drawLock(ctx, spr, x, y, r, rot, alpha, flash) {
    if (alpha <= 0.01) return;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.globalAlpha = alpha * 0.55;
    ctx.drawImage(spr, -r * 2.4, -r * 2.4, r * 4.8, r * 4.8);
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    for (var i = 0; i < 6; i++) {
      var a = (i / 6) * TAU + Math.PI / 6;
      if (i === 0) ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r);
      else ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    ctx.closePath();
    ctx.fillStyle = "rgba(70,58,110,0.92)";
    ctx.fill();
    ctx.strokeStyle = "rgba(226,218,255,0.95)";
    ctx.lineWidth = Math.max(1, r * 0.16);
    ctx.stroke();
    if (r >= 8) {
      ctx.fillStyle = "rgba(240,236,255,0.95)";
      ctx.font = "600 " + Math.round(r * 0.72) + "px 'Space Grotesk', system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("CH3", 0, r * 0.04);
    }
    if (flash > 0) {
      ctx.globalAlpha = flash;
      ctx.beginPath();
      ctx.arc(0, 0, r * (1.2 + (1 - flash) * 1.6), 0, TAU);
      ctx.strokeStyle = "rgba(255,255,255,0.9)";
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    ctx.restore();
  }

  window.CellScene = CellScene;
})();
