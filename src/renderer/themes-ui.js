// Settings > Themes: choose, edit, import and export themes. The engine is in theme.js.
(() => {
  'use strict';

  const T = window.Themes;
  const GP = window.GP;
  const api = window.api;
  const t = window.t;
  const $ = (sel, root = document) => root.querySelector(sel);
  const el = (tag, cls, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  let customs = []; // checked custom themes (stored by the app)
  let folders = []; // themes found in the themes folder (read-only here)
  let themesDir = '';
  let foldersSig = '';
  let cur = T.builtin('silver'); // the theme in use (an object from the list, edited in place when custom)
  const page = $('#thPage');
  const picker = $('#theme'); // the quick switch on the Appearance page
  let saveTimer = null;

  const all = () => [T.builtin('silver'), T.builtin('graphite'), ...customs, ...folders];
  const isCustom = () => cur.id.startsWith('custom:');
  const isFolder = () => cur.id.startsWith('folder:') || cur.id.startsWith('file:');
  const label = (th) => (th.id === 'silver' ? t('theme.silver') : th.id === 'graphite' ? t('theme.graphite') : th.name);

  function persist() {
    if (!isCustom()) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => api.themes.save(cur).catch(() => {}), 400);
  }

  // Something changed in the editor: show it at once, save it a moment later
  function changed() {
    T.apply(cur);
    persist();
  }

  function fillPicker() {
    picker.replaceChildren(
      ...all().map((th) => {
        const o = el('option', '', label(th));
        o.value = th.id;
        return o;
      }),
    );
    picker.value = cur.id;
  }

  // Themes found in the themes folder: a folder with theme.json and background/, or a loose .json file
  async function scanFolders() {
    let res;
    try {
      res = await api.themes.scan();
    } catch {
      return false;
    }
    themesDir = res.dir || '';
    const found = [];
    for (const item of res.items || []) {
      const parsed = item.json ? T.fromFile(item.json) : null;
      if (item.kind === 'file' && !parsed) continue; // a stray .json that is not a theme
      const th = parsed || T.sanitize({}, item.name);
      th.id = item.id;
      th.name = parsed && parsed.name !== 'Imported theme' ? parsed.name : item.name.slice(0, 40);
      th.source = item.kind;
      th.badJson = item.kind === 'folder' && item.json !== null && !parsed;
      th.layers = window.BgLayers.normalize(item.layers, item.manifest);
      found.push(th);
    }
    const sig = JSON.stringify(found.map((x) => [x.id, x.name, x.layers.map((l) => l.url), x.colors, x.shape, x.base]));
    const same = sig === foldersSig;
    foldersSig = sig;
    folders = found;
    return !same;
  }

  // Look at the folder again, keep the chosen theme (and redraw it if its files changed)
  async function refresh(quiet) {
    const changedNow = await scanFolders();
    const again = all().find((x) => x.id === cur.id);
    if (!again) return select('silver');
    if (changedNow || !quiet) {
      cur = again;
      T.apply(cur);
      fillPicker();
      render();
    }
  }

  function select(id) {
    cur = all().find((x) => x.id === id) || T.builtin('silver');
    GP.store.set('theme', cur.id);
    T.apply(cur);
    fillPicker();
    render();
  }

  // ---------- editor widgets ----------
  const section = (title, hint) => {
    const box = el('div', 'th-section');
    box.append(el('h3', '', title));
    if (hint) box.append(el('p', 'hint', hint));
    return box;
  };
  const row = (title, control, hint) => {
    const r = el('div', 'st-row');
    const text = el('span', 'st-text');
    text.append(el('b', '', title));
    if (hint) text.append(el('small', '', hint));
    r.append(text, control);
    return r;
  };
  const fill = (input) => input.style.setProperty('--fill', ((input.value - input.min) / (input.max - input.min)) * 100 + '%');

  function slider({ min, max, step = 1, value, format, onInput }) {
    const wrap = el('span', 'st-slider');
    const input = el('input');
    Object.assign(input, { type: 'range', min, max, step, value });
    const out = el('output', '', format(value));
    const sync = () => {
      out.textContent = format(Number(input.value));
      fill(input);
    };
    input.addEventListener('input', () => {
      sync();
      onInput(Number(input.value));
    });
    sync();
    wrap.append(input, out);
    return wrap;
  }

  function select_(options, value, onChange) {
    const s = el('select');
    for (const [v, text] of options) {
      const o = el('option', '', text);
      o.value = v;
      s.append(o);
    }
    s.value = value;
    s.addEventListener('change', () => onChange(s.value));
    return s;
  }

  function button(text, onClick, cls = 'swap') {
    const b = el('button', cls, text);
    b.type = 'button';
    b.addEventListener('click', onClick);
    return b;
  }

  // a colour: the colour picker plus, where it makes sense, transparency
  function colorRow(token) {
    const eff = T.effective(cur)[token.key];
    const c = T.parseColor(eff) || { r: 0, g: 0, b: 0, a: 1 };
    const state = { ...c };
    const write = () => {
      cur.colors[token.key] = T.formatColor(state);
      changed();
    };
    const wrap = el('span', 'th-color');
    const input = el('input');
    input.type = 'color';
    input.value = T.toHex(state);
    input.addEventListener('input', () => {
      const n = T.parseColor(input.value);
      Object.assign(state, { r: n.r, g: n.g, b: n.b });
      write();
    });
    wrap.append(input);
    if (token.alpha) {
      const a = el('input');
      Object.assign(a, { type: 'range', min: 0, max: 100, step: 1, value: Math.round(state.a * 100) });
      a.title = t('themes.alpha');
      fill(a);
      a.addEventListener('input', () => {
        state.a = Number(a.value) / 100;
        fill(a);
        write();
      });
      wrap.append(a);
    }
    return row(t('themes.c.' + token.key), wrap);
  }

  // The background picture is shrunk first: a theme file stays small enough to share
  async function readImage(file) {
    // a data address, not a blob one: the page's security policy allows only data: and https: pictures
    const source = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
    const img = new Image();
    img.src = source;
    await img.decode();
    const k = Math.min(1, 1920 / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = el('canvas');
    canvas.width = Math.max(1, Math.round(img.naturalWidth * k));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * k));
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.82);
  }

  // ---------- the page ----------
  function render() {
    const custom = isCustom();
    page.replaceChildren();

    // which theme, and what can be done with it
    const top = section(t('themes.current'));
    const name = el('input', 'th-name');
    name.type = 'text';
    name.maxLength = 40;
    name.value = label(cur);
    name.disabled = !custom;
    name.addEventListener('input', () => {
      cur.name = name.value.trim() || t('themes.untitled');
      fillPicker();
      persist();
    });
    top.append(row(t('themes.name'), name));
    const acts = el('div', 'st-btns th-acts');
    acts.append(button(t('themes.duplicate'), duplicate, 'swap primary'));
    if (custom) acts.append(button(t('themes.delete'), remove));
    top.append(acts);
    if (isFolder()) top.append(el('p', 'hint', t(cur.badJson ? 'themes.badJson' : 'themes.folderHint')));
    else if (!custom) top.append(el('p', 'hint', t('themes.builtinHint')));
    if (cur.layers && cur.layers.length) top.append(el('p', 'hint', t('themes.layersCount', { count: cur.layers.length })));
    page.append(top);

    // where the themes live
    const where = section(t('themes.folder'), t('themes.folderIntro'));
    where.append(el('code', 'th-path', themesDir));
    const fb = el('div', 'st-btns th-acts');
    fb.append(
      button(t('themes.openFolder'), async () => {
        const r = await api.themes.openFolder();
        if (r && r.error) GP.toast(t('themes.openFailed'));
      }, 'swap primary'),
      button(t('themes.refresh'), async () => {
        await refresh(false);
        GP.toast(t('themes.refreshed', { count: folders.length }));
      }),
      button(t('themes.example'), createExample),
    );
    where.append(fb);
    const docs = el('details', 'th-docs');
    docs.append(el('summary', '', t('themes.docs')));
    docs.append(
      Object.assign(el('pre', 'api-code'), {
        textContent: `${themesDir || 'themes'}/
  Night city/                 ${t('themes.tree.folder')}
    theme.json                ${t('themes.tree.json')}
    background/               ${t('themes.tree.bg')}
      01-sky.jpg              ${t('themes.tree.bottom')}
      02-stars-drift.svg      ${t('themes.tree.drift')}
      03-clouds-parallax.png  ${t('themes.tree.parallax')}
      04-glow-scroll.png      ${t('themes.tree.scroll')}
      layers.json             ${t('themes.tree.layers')}
  Another.json                ${t('themes.tree.loose')}`,
      }),
    );
    const list = el('ul', 'api-list');
    for (const k of ['rule1', 'rule2', 'rule3', 'rule4', 'rule5']) list.append(el('li', '', t('themes.' + k)));
    docs.append(list);
    docs.append(
      Object.assign(el('pre', 'api-code'), {
        textContent: `{\n  "02-stars-drift.svg": { "drift": 12, "period": 60, "opacity": 90 },\n  "04-glow-scroll.png": { "scroll": 40, "blend": "screen" }\n}`,
      }),
    );
    where.append(docs);
    page.append(where);

    // everything below changes the theme, so it is locked for the built-in ones
    const editor = el('div', 'th-editor' + (custom ? '' : ' locked'));

    const base = section(t('themes.base'), t('themes.baseHint'));
    base.append(
      row(
        t('themes.baseLabel'),
        select_([['silver', t('theme.silver')], ['graphite', t('theme.graphite')]], cur.base, (v) => {
          cur.base = v;
          cur.colors = {}; // colours were chosen against the other base
          changed();
          render();
        }),
      ),
    );
    editor.append(base);

    const colors = section(t('themes.colors'));
    for (const group of ['main', 'panel', 'surface']) {
      colors.append(el('h4', '', t('themes.g.' + group)));
      for (const token of T.COLORS.filter((x) => x.group === group)) colors.append(colorRow(token));
    }
    colors.append(
      row(
        t('themes.resetColors'),
        button(t('themes.reset'), () => {
          cur.colors = {};
          changed();
          render();
        }),
        t('themes.resetColorsHint'),
      ),
    );
    editor.append(colors);

    const bg = section(t('themes.background'), t('themes.backgroundHint'));
    const file = el('input');
    file.type = 'file';
    file.accept = 'image/png,image/jpeg,image/webp';
    file.className = 'hidden';
    file.addEventListener('change', async () => {
      const f = file.files[0];
      file.value = '';
      if (!f) return;
      try {
        const data = await readImage(f);
        if (data.length > T.MAX_IMAGE) throw new Error('big');
        cur.background.image = data;
        changed();
        render();
      } catch {
        GP.toast(t('themes.imageFailed'));
      }
    });
    const pick = el('span', 'st-btns');
    pick.append(button(t('themes.chooseImage'), () => file.click()));
    if (cur.background.image) {
      pick.append(
        button(t('themes.removeImage'), () => {
          cur.background.image = '';
          changed();
          render();
        }),
      );
    }
    pick.append(file);
    bg.append(row(t('themes.image'), pick));
    if (cur.background.image) {
      const prev = el('div', 'th-preview');
      prev.style.backgroundImage = `url("${cur.background.image}")`;
      bg.append(prev);
      bg.append(row(t('themes.opacity'), slider({ min: 0, max: 100, value: cur.background.opacity, format: (v) => v + '%', onInput: (v) => ((cur.background.opacity = v), changed()) })));
      bg.append(row(t('themes.imageBlur'), slider({ min: 0, max: 30, value: cur.background.blur, format: (v) => v + 'px', onInput: (v) => ((cur.background.blur = v), changed()) })));
    }
    editor.append(bg);

    const motion = section(t('themes.motion'), t('themes.motionHint'));
    const sw = el('input', 'switch');
    sw.type = 'checkbox';
    sw.checked = GP.store.get('bgAnimate', true);
    sw.addEventListener('change', () => {
      GP.store.set('bgAnimate', sw.checked);
      window.BgLayers.setAnimated(sw.checked);
    });
    motion.append(row(t('themes.animate'), sw));
    page.append(motion);

    const sh = cur.shape;
    const shape = section(t('themes.shape'));
    shape.append(row(t('themes.radius'), slider({ min: T.RANGES.radius[0], max: T.RANGES.radius[1], value: sh.radius, format: (v) => v + 'px', onInput: (v) => ((sh.radius = v), changed()) })));
    shape.append(row(t('themes.blur'), slider({ min: T.RANGES.blur[0], max: T.RANGES.blur[1], value: sh.blur, format: (v) => v + 'px', onInput: (v) => ((sh.blur = v), changed()) })));
    shape.append(row(t('themes.font'), select_(Object.keys(T.FONTS).map((k) => [k, t('themes.font.' + k)]), sh.font, (v) => ((sh.font = v), changed()))));
    editor.append(shape);

    const layout = section(t('themes.layout'));
    layout.append(row(t('themes.thumb'), slider({ min: T.RANGES.thumb[0], max: T.RANGES.thumb[1], value: sh.thumb, format: (v) => v + 'px', onInput: (v) => ((sh.thumb = v), changed()) })));
    layout.append(row(t('themes.density'), select_(Object.keys(T.DENSITY).map((k) => [k, t('themes.density.' + k)]), sh.density, (v) => ((sh.density = v), changed()))));
    layout.append(
      row(
        t('themes.npWidth'),
        slider({
          min: 300, max: 560, step: 10, value: sh.npWidth || 300,
          format: (v) => (v <= 300 ? t('themes.auto') : v + 'px'),
          onInput: (v) => ((sh.npWidth = v <= 300 ? 0 : Math.max(320, v)), changed()),
        }),
      ),
    );
    layout.append(row(t('themes.npSide'), select_([['right', t('themes.right')], ['left', t('themes.left')]], sh.npSide, (v) => ((sh.npSide = v), changed()))));
    editor.append(layout);
    page.append(editor);

    // sharing
    const share = section(t('themes.share'), t('themes.shareHint'));
    const sb = el('div', 'st-btns th-acts');
    sb.append(button(t('themes.import'), importTheme), button(t('themes.importFolder'), importFolder), button(t('themes.export'), exportTheme), button(t('themes.exportFigma'), exportFigma));
    share.append(sb, el('p', 'hint', t('themes.figmaHint')));
    page.append(share);
  }

  // ---------- actions ----------
  async function adopt(theme) {
    theme.id = T.newId();
    customs.push(theme);
    await api.themes.save(theme).catch(() => {});
    select(theme.id);
  }

  async function duplicate() {
    const copy = T.sanitize(JSON.parse(JSON.stringify(cur)));
    copy.name = (label(cur) + ' ' + t('themes.copy')).slice(0, 40);
    const hadLayers = !!(cur.layers && cur.layers.length);
    await adopt(copy);
    GP.toast(t(hadLayers ? 'themes.duplicatedNoLayers' : 'themes.duplicated'));
  }

  async function remove() {
    if (!isCustom() || !window.confirm(t('themes.deleteConfirm', { name: cur.name }))) return;
    const id = cur.id;
    customs = customs.filter((x) => x.id !== id);
    await api.themes.remove(id).catch(() => {});
    select('silver');
  }

  async function importTheme() {
    const res = await api.themes.importFile();
    if (!res) return;
    const theme = res.text ? T.fromFile(res.text) : null;
    if (!theme) {
      GP.toast(t(res.error === 'big' ? 'themes.importBig' : 'themes.importBad'));
      return;
    }
    await adopt(theme);
    GP.toast(t('themes.imported', { name: theme.name }));
  }

  async function importFolder() {
    const r = await api.themes.importFolder();
    if (!r) return;
    if (r.error) {
      GP.toast(t('themes.folderErr.' + r.error));
      return;
    }
    await scanFolders();
    select(r.id);
    GP.toast(t('themes.imported', { name: cur.name }));
  }

  async function createExample() {
    const r = await api.themes.example();
    if (!r || r.error) {
      GP.toast(t('themes.folderErr.read'));
      return;
    }
    await scanFolders();
    select(r.id);
  }

  async function exportTheme() {
    const where = await api.themes.exportFile(label(cur), T.toFile(cur));
    if (where) GP.toast(t('themes.exported'));
  }

  async function exportFigma() {
    const where = await api.themes.exportFile(label(cur) + '-figma-tokens', JSON.stringify(T.toTokensStudio(cur), null, 2));
    if (where) GP.toast(t('themes.exported'));
  }

  picker.addEventListener('change', () => select(picker.value));

  // ---------- start ----------
  (async () => {
    try {
      customs = ((await api.themes.list()) || []).map((x) => T.sanitize(x)).filter((x) => x.id.startsWith('custom:'));
    } catch {
      customs = [];
    }
    await scanFolders();
    window.BgLayers.setAnimated(GP.store.get('bgAnimate', true));
    select(GP.store.get('theme', 'silver'));
  })();

  // Files may have been added to the folder meanwhile: look again when the window gets focus on this page
  window.addEventListener('focus', () => {
    if (!page.classList.contains('hidden') && !$('#settings').classList.contains('hidden')) refresh(true);
  });
})();
