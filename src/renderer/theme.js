// The theme engine: what a theme is, how it is checked, applied to the page and converted to Figma tokens.
// A theme is a small object. Colours, shape and the background picture are single values ("tokens"):
// the interface refers to them through CSS variables, so one change reaches every page.
(() => {
  'use strict';

  // key, CSS variable, whether the colour has an alpha channel
  const COLORS = [
    { key: 'text', group: 'main' },
    { key: 'textDim', group: 'main', alpha: true },
    { key: 'accent', group: 'main' },
    { key: 'panelFrom', group: 'panel' },
    { key: 'panelMid', group: 'panel' },
    { key: 'panelTo', group: 'panel' },
    { key: 'card', group: 'surface', alpha: true },
    { key: 'cardEdge', group: 'surface', alpha: true },
    { key: 'rowHover', group: 'surface', alpha: true },
    { key: 'track', group: 'surface', alpha: true },
    { key: 'popup', group: 'surface', alpha: true },
    { key: 'gloss', group: 'surface', alpha: true },
    { key: 'shadow', group: 'surface', alpha: true },
  ];
  const VARS = {
    text: '--text', textDim: '--text-dim', accent: '--accent', card: '--card', cardEdge: '--card-edge', rowHover: '--row-hover',
    track: '--track', popup: '--popup', gloss: '--gloss',
  };

  const BASES = {
    silver: {
      text: '#11141b', textDim: 'rgba(17, 20, 27, 0.6)', accent: '#2f6df6',
      panelFrom: '#f8f9fc', panelMid: '#d0d6e1', panelTo: '#a5adbd',
      card: 'rgba(255, 255, 255, 0.34)', cardEdge: 'rgba(255, 255, 255, 0.7)', rowHover: 'rgba(255, 255, 255, 0.5)',
      track: 'rgba(17, 20, 27, 0.16)', popup: 'rgba(238, 241, 247, 0.97)', gloss: 'rgba(255, 255, 255, 0.6)', shadow: 'rgba(24, 34, 56, 0.16)',
    },
    graphite: {
      text: '#eef1f7', textDim: 'rgba(238, 241, 247, 0.6)', accent: '#6c9bff',
      panelFrom: '#4a505f', panelMid: '#2a2e3a', panelTo: '#181b24',
      card: 'rgba(255, 255, 255, 0.07)', cardEdge: 'rgba(255, 255, 255, 0.16)', rowHover: 'rgba(255, 255, 255, 0.1)',
      track: 'rgba(255, 255, 255, 0.2)', popup: 'rgba(34, 38, 49, 0.97)', gloss: 'rgba(255, 255, 255, 0.22)', shadow: 'rgba(0, 0, 0, 0.3)',
    },
  };

  const SHAPE_DEFAULTS = { radius: 16, blur: 14, thumb: 44, density: 'normal', npWidth: 0, npSide: 'right', font: 'system' };
  const RANGES = { radius: [0, 28], blur: [0, 40], thumb: [32, 64] };
  const DENSITY = { compact: 2, normal: 6, relaxed: 11 }; // vertical padding of a list row, px
  const FONTS = {
    system: "'Segoe UI Variable', 'Segoe UI', system-ui, -apple-system, sans-serif",
    humanist: "'Trebuchet MS', 'Segoe UI', system-ui, sans-serif",
    serif: "Georgia, 'Times New Roman', serif",
    mono: "ui-monospace, 'Cascadia Mono', Consolas, monospace",
  };
  const BG_DEFAULTS = { image: '', opacity: 40, blur: 0 };
  const MAX_IMAGE = 4 * 1024 * 1024; // characters of the data address

  // ---------- colours ----------
  const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
  const RGB = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*(\d*\.?\d+)\s*)?\)$/i;

  // "#rrggbb" or "rgba(r, g, b, a)" -> { r, g, b, a }, or null
  function parseColor(css) {
    const s = String(css || '').trim();
    let m = HEX.exec(s);
    if (m) {
      let h = m[1];
      if (h.length === 3) h = [...h].map((c) => c + c).join('');
      return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1 };
    }
    m = RGB.exec(s);
    if (!m) return null;
    const c = { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] };
    return c.r > 255 || c.g > 255 || c.b > 255 || c.a > 1 ? null : c;
  }
  const hex2 = (n) => Math.round(n).toString(16).padStart(2, '0');
  const toHex = (c) => '#' + hex2(c.r) + hex2(c.g) + hex2(c.b);
  function formatColor(c) {
    const a = Math.round(Math.max(0, Math.min(1, c.a)) * 100) / 100;
    return a >= 1 ? toHex(c) : `rgba(${Math.round(c.r)}, ${Math.round(c.g)}, ${Math.round(c.b)}, ${a})`;
  }
  const withAlpha = (css, a) => {
    const c = parseColor(css);
    return c ? formatColor({ ...c, a }) : css;
  };

  // ---------- checking ----------
  const num = (v, lo, hi, fallback) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.max(lo, Math.min(hi, Math.round(n))) : fallback;
  };

  // Anything may arrive here (a file from the internet): only known keys with valid values are kept.
  function sanitize(raw, fallbackName = 'My theme') {
    const r = raw && typeof raw === 'object' ? raw : {};
    const base = r.base === 'graphite' ? 'graphite' : 'silver';
    const colors = {};
    for (const { key } of COLORS) {
      const c = parseColor(r.colors && r.colors[key]);
      if (c) colors[key] = formatColor(c);
    }
    const sh = r.shape && typeof r.shape === 'object' ? r.shape : {};
    const shape = {
      radius: num(sh.radius, ...RANGES.radius, SHAPE_DEFAULTS.radius),
      blur: num(sh.blur, ...RANGES.blur, SHAPE_DEFAULTS.blur),
      thumb: num(sh.thumb, ...RANGES.thumb, SHAPE_DEFAULTS.thumb),
      density: sh.density in DENSITY ? sh.density : SHAPE_DEFAULTS.density,
      npWidth: Number(sh.npWidth) > 0 ? num(sh.npWidth, 320, 560, 0) : 0,
      npSide: sh.npSide === 'left' ? 'left' : 'right',
      font: sh.font in FONTS ? sh.font : SHAPE_DEFAULTS.font,
    };
    const bg = r.background && typeof r.background === 'object' ? r.background : {};
    const image = typeof bg.image === 'string' && bg.image.length <= MAX_IMAGE && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(bg.image) ? bg.image : '';
    return {
      format: 'silverpane-theme',
      version: 1,
      id: typeof r.id === 'string' && /^(custom:[\w-]{1,40}|silver|graphite)$/.test(r.id) ? r.id : '',
      name: String(r.name || fallbackName).replace(/[\u0000-\u001f]/g, '').trim().slice(0, 40) || fallbackName,
      base,
      colors,
      shape,
      background: { image, opacity: num(bg.opacity, 0, 100, BG_DEFAULTS.opacity), blur: num(bg.blur, 0, 30, BG_DEFAULTS.blur) },
    };
  }

  const builtin = (id) => sanitize({ id, name: id === 'graphite' ? 'Graphite' : 'Silver', base: id });
  const effective = (theme) => ({ ...BASES[theme.base === 'graphite' ? 'graphite' : 'silver'], ...(theme.colors || {}) });
  const newId = () => 'custom:' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  // ---------- applying ----------
  const ALL_VARS = [...Object.values(VARS), '--accent-soft', '--panel', '--shadow', '--radius', '--blur', '--thumb', '--row-pad', '--np-width', '--font', '--bg-image', '--bg-opacity', '--bg-blur', '--bg-scale'];

  function apply(theme, root = document.documentElement) {
    const th = sanitize(theme);
    root.dataset.theme = th.base;
    const style = root.style;
    for (const v of ALL_VARS) style.removeProperty(v);
    const own = th.colors;
    const eff = effective(th);
    for (const [key, cssVar] of Object.entries(VARS)) if (own[key]) style.setProperty(cssVar, own[key]);
    // values derived from others follow them, unless the theme sets them itself
    if (own.text && !own.textDim) style.setProperty('--text-dim', withAlpha(own.text, 0.6));
    if (own.accent) style.setProperty('--accent-soft', withAlpha(own.accent, th.base === 'graphite' ? 0.2 : 0.16));
    if (own.shadow) style.setProperty('--shadow', `0 10px 30px ${own.shadow}`);
    if (own.panelFrom || own.panelMid || own.panelTo) {
      const stop = (c, at) => `color-mix(in srgb, ${c} calc(var(--tint) * 100%), transparent) ${at}`;
      style.setProperty('--panel', `linear-gradient(145deg, ${stop(eff.panelFrom, '0%')}, ${stop(eff.panelMid, '48%')}, ${stop(eff.panelTo, '100%')})`);
    }
    const sh = th.shape;
    style.setProperty('--radius', sh.radius + 'px');
    style.setProperty('--blur', sh.blur + 'px');
    style.setProperty('--thumb', sh.thumb + 'px');
    style.setProperty('--row-pad', DENSITY[sh.density] + 'px');
    if (sh.npWidth) style.setProperty('--np-width', sh.npWidth + 'px');
    style.setProperty('--font', FONTS[sh.font]);
    root.classList.toggle('np-left', sh.npSide === 'left');
    const bg = th.background;
    root.classList.toggle('has-bg', !!bg.image);
    if (bg.image) {
      style.setProperty('--bg-image', `url("${bg.image}")`);
      style.setProperty('--bg-opacity', String(bg.opacity / 100));
      style.setProperty('--bg-blur', bg.blur + 'px');
      style.setProperty('--bg-scale', bg.blur ? '1.08' : '1');
    }
    // the layers of a theme folder (they are not part of the checked theme: the main process vouches for them)
    if (root === document.documentElement && window.BgLayers) window.BgLayers.set(theme && theme.layers);
    return th;
  }

  // ---------- Figma: Tokens Studio JSON ----------
  // https://docs.tokens.studio : { "<set>": { "color": { "text": { "value", "type" } } }, "$metadata": {...} }
  function toTokensStudio(theme) {
    const th = sanitize(theme);
    const eff = effective(th);
    const color = {};
    for (const { key } of COLORS) color[key] = { value: eff[key], type: 'color' };
    const sh = th.shape;
    return {
      silverpane: {
        base: { value: th.base, type: 'other', description: 'silver (light) or graphite (dark): what the colours not listed here start from' },
        color,
        radius: { value: String(sh.radius), type: 'borderRadius' },
        blur: { value: String(sh.blur), type: 'sizing', description: 'Backdrop blur of cards, px' },
        thumb: { value: String(sh.thumb), type: 'sizing', description: 'Cover size in lists, px' },
        npWidth: { value: String(sh.npWidth), type: 'sizing', description: 'Width of the track panel, px. 0 = automatic' },
        npSide: { value: sh.npSide, type: 'other', description: 'left or right' },
        density: { value: sh.density, type: 'other', description: 'compact, normal or relaxed' },
        font: { value: sh.font, type: 'other', description: 'system, humanist, serif or mono' },
      },
      $themes: [],
      $metadata: { tokenSetOrder: ['silverpane'], name: th.name },
    };
  }

  const tokenValue = (x) => (x && typeof x === 'object' && 'value' in x ? x.value : undefined);

  function fromTokensStudio(file) {
    const set = file && file.silverpane;
    if (!set || typeof set !== 'object') return null;
    const colors = {};
    for (const { key } of COLORS) {
      const v = tokenValue(set.color && set.color[key]);
      if (typeof v === 'string') colors[key] = v;
    }
    return sanitize(
      {
        name: file.$metadata && file.$metadata.name,
        base: tokenValue(set.base),
        colors,
        shape: {
          radius: tokenValue(set.radius), blur: tokenValue(set.blur), thumb: tokenValue(set.thumb), npWidth: tokenValue(set.npWidth),
          npSide: tokenValue(set.npSide), density: tokenValue(set.density), font: tokenValue(set.font),
        },
      },
      'Imported theme',
    );
  }

  // The theme file: a text that carries the whole theme (the picture included)
  const toFile = (theme) => JSON.stringify(sanitize(theme), null, 2);

  // A file from outside: our own format or a Tokens Studio file. Returns a checked theme or null.
  function fromFile(text) {
    let obj;
    try {
      obj = JSON.parse(text);
    } catch {
      return null;
    }
    if (obj && obj.format === 'silverpane-theme') return sanitize(obj, 'Imported theme');
    return fromTokensStudio(obj);
  }

  window.Themes = {
    COLORS, BASES, SHAPE_DEFAULTS, RANGES, DENSITY, FONTS, BG_DEFAULTS, MAX_IMAGE,
    parseColor, formatColor, toHex, sanitize, builtin, effective, newId, apply,
    toTokensStudio, fromTokensStudio, toFile, fromFile,
  };
})();
