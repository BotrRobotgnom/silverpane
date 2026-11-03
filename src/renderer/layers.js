// Background layers of a theme folder: every picture or video in <theme>/background/ is one layer, bottom first.
// A layer may move: parallax (follows the mouse), drift (slow back-and-forth), scroll (reacts to the mouse wheel).
// Animated files (video, GIF, animated WebP, SVG with animation) simply play. Layers are drawn only with <img> and <video>,
// so a picture can never run a script.
(() => {
  'use strict';

  const BLENDS = ['normal', 'screen', 'multiply', 'overlay', 'soft-light', 'lighten', 'plus-lighter'];
  const clamp = (v, lo, hi, fb) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : fb;
  };

  // Settings of a layer: from layers.json, and a few words in the file name work as shortcuts
  // ("clouds-parallax.png", "stars-drift.svg", "glow-scroll.png", "light-screen.png")
  function settingsOf(file, manifest) {
    const name = file.toLowerCase();
    const words = name.replace(/\.[a-z0-9]+$/, '').split(/[^a-z]+/);
    const own = manifest && typeof manifest[file] === 'object' && manifest[file] ? manifest[file] : {};
    const pick = (key, word, wordValue) => (own[key] !== undefined ? own[key] : name.includes(word) ? wordValue : 0);
    return {
      parallax: clamp(pick('parallax', 'parallax', 30), 0, 100, 0),
      drift: clamp(pick('drift', 'drift', 20), 0, 60, 0),
      period: clamp(own.period, 4, 120, 40),
      scroll: clamp(pick('scroll', 'scroll', 30), 0, 100, 0),
      opacity: clamp(own.opacity, 0, 100, 100),
      blend: BLENDS.includes(own.blend) ? own.blend : ['screen', 'multiply', 'overlay', 'lighten'].find((w) => words.includes(w)) || 'normal',
      fit: own.fit === 'contain' ? 'contain' : 'cover',
    };
  }

  // What the main process found ({ file, kind, url, version }) plus the settings
  function normalize(found, manifest) {
    return (Array.isArray(found) ? found : [])
      .filter((x) => x && typeof x.file === 'string' && typeof x.url === 'string' && x.url.startsWith('/theme/') && (x.kind === 'image' || x.kind === 'video'))
      .slice(0, 12)
      .map((x) => ({ file: x.file, kind: x.kind, url: x.url + '?v=' + (Number(x.version) || 0), ...settingsOf(x.file, manifest) }));
  }

  // ---------- drawing ----------
  let box = null;
  let layers = []; // { cfg, outer, inner, media, anim }
  let animated = true;
  let raf = 0;
  const mouse = { x: 0, y: 0, cx: 0, cy: 0 }; // target and smoothed position, -1..1
  let wheel = 0;
  let wheelSmooth = 0;

  const root = () => {
    if (!box) {
      box = document.createElement('div');
      box.id = 'bgLayers';
      box.setAttribute('aria-hidden', 'true');
      const app = document.querySelector('.app');
      (app || document.body).prepend(box);
    }
    return box;
  };

  function clear() {
    cancelAnimationFrame(raf);
    raf = 0;
    for (const l of layers) {
      if (l.anim) l.anim.cancel();
      if (l.media.tagName === 'VIDEO') l.media.pause();
    }
    layers = [];
    if (box) box.replaceChildren();
    wheel = wheelSmooth = 0;
  }

  const maxShift = (cfg) => ({ p: cfg.parallax * 0.6, s: cfg.scroll * 1.2, d: cfg.drift });

  function build(cfg) {
    const outer = document.createElement('div');
    outer.className = 'bgl';
    const m = maxShift(cfg);
    const margin = Math.ceil(m.p + m.s + m.d);
    outer.style.inset = -margin + 'px';
    outer.style.opacity = String(cfg.opacity / 100);
    outer.style.mixBlendMode = cfg.blend;
    const inner = document.createElement('div');
    inner.className = 'bgl-in';
    let media;
    if (cfg.kind === 'video') {
      media = document.createElement('video');
      Object.assign(media, { muted: true, loop: true, autoplay: true, playsInline: true, preload: 'auto', src: cfg.url });
      media.setAttribute('muted', '');
      media.disablePictureInPicture = true;
    } else {
      media = document.createElement('img');
      Object.assign(media, { src: cfg.url, alt: '', draggable: false, decoding: 'async' });
    }
    media.className = 'bgl-media';
    media.style.objectFit = cfg.fit;
    inner.append(media);
    outer.append(inner);
    return { cfg, outer, inner, media, anim: null };
  }

  // ---------- movement ----------
  const needsLoop = () => animated && !document.hidden && layers.some((l) => l.cfg.parallax || l.cfg.scroll);

  function frame() {
    raf = 0;
    mouse.cx += (mouse.x - mouse.cx) * 0.08;
    mouse.cy += (mouse.y - mouse.cy) * 0.08;
    wheel *= 0.93; // the push of the wheel fades out
    wheelSmooth += (wheel - wheelSmooth) * 0.2;
    for (const l of layers) {
      const m = maxShift(l.cfg);
      const x = -mouse.cx * m.p;
      const y = -mouse.cy * m.p - wheelSmooth * m.s;
      l.outer.style.transform = `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, 0)`;
    }
    const moving = Math.abs(mouse.x - mouse.cx) > 0.001 || Math.abs(mouse.y - mouse.cy) > 0.001 || Math.abs(wheel) > 0.002 || Math.abs(wheelSmooth) > 0.002;
    if (moving && needsLoop()) raf = requestAnimationFrame(frame);
  }
  const kick = () => {
    if (!raf && needsLoop()) raf = requestAnimationFrame(frame);
  };

  window.addEventListener('mousemove', (e) => {
    mouse.x = (e.clientX / Math.max(1, window.innerWidth) - 0.5) * 2;
    mouse.y = (e.clientY / Math.max(1, window.innerHeight) - 0.5) * 2;
    kick();
  }, { passive: true });
  window.addEventListener('wheel', (e) => {
    wheel = Math.max(-1, Math.min(1, wheel + Math.max(-300, Math.min(300, e.deltaY)) / 300));
    kick();
  }, { passive: true, capture: true });

  // drift and video follow the "animate" switch and stop while the window is hidden
  function applyMotion() {
    const run = animated && !document.hidden;
    for (const l of layers) {
      if (l.cfg.drift) {
        if (!l.anim) {
          const a = l.cfg.drift;
          l.anim = l.inner.animate(
            [{ transform: `translate3d(${-a}px, ${-a * 0.4}px, 0)` }, { transform: `translate3d(${a}px, ${a * 0.4}px, 0)` }],
            { duration: l.cfg.period * 1000, direction: 'alternate', iterations: Infinity, easing: 'ease-in-out' },
          );
        }
        if (run) l.anim.play();
        else l.anim.pause();
      }
      if (l.media.tagName === 'VIDEO') {
        if (run) l.media.play().catch(() => {});
        else l.media.pause();
      }
    }
    if (!animated) {
      for (const l of layers) l.outer.style.transform = '';
      cancelAnimationFrame(raf);
      raf = 0;
    } else kick();
  }
  document.addEventListener('visibilitychange', applyMotion);

  window.BgLayers = {
    normalize,
    // Show these layers (an empty list removes them)
    set(list) {
      clear();
      const items = Array.isArray(list) ? list : [];
      document.documentElement.classList.toggle('has-layers', items.length > 0);
      if (!items.length) return;
      const host = root();
      layers = items.map(build);
      host.append(...layers.map((l) => l.outer));
      applyMotion();
    },
    setAnimated(on) {
      animated = !!on;
      applyMotion();
    },
    count: () => layers.length,
  };
})();
