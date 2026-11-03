// Profiles: the avatar in the title bar, the list that opens from it, and the dialog to add or edit a profile.
// Each profile has its own history, likes and playlists. Switching reloads the page, so nothing of the old one stays.
(() => {
  'use strict';

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

  const COLORS = ['#e5484d', '#d6409f', '#8e4ec6', '#5b5bd6', '#0090ff', '#12a594', '#30a46c', '#f76b15'];
  const btn = $('#btnProfile');
  const pop = $('#pfPop');
  const wrap = btn.parentElement;
  const dlg = $('#pfDialog');
  const els = {
    title: $('#pfDialogTitle'), preview: $('#pfPreview'), pick: $('#pfPick'), removeImg: $('#pfRemoveImg'), name: $('#pfName'),
    colors: $('#pfColors'), colorField: $('#pfColorField'), error: $('#pfError'), del: $('#pfDelete'), cancel: $('#pfCancel'),
    file: $('#pfFile'), form: $('#pfForm'),
  };

  let data = { active: '', profiles: [] };
  let pinned = false; // opened by a click: stays until clicked outside
  let openTimer = 0;
  let closeTimer = 0;
  let form = null; // { id, avatar, color }

  // ---------- the avatar: a picture, or a colour with the first letter of the name ----------
  const letterOf = (name) => (Array.from(String(name).trim())[0] || '?').toUpperCase();
  function avatar(p, cls = '') {
    const a = el('span', 'pf-av ' + cls);
    if (p.avatar) a.style.backgroundImage = `url("${p.avatar}")`;
    else {
      a.style.background = p.color;
      a.textContent = letterOf(p.name);
    }
    return a;
  }
  const current = () => data.profiles.find((p) => p.id === data.active) || data.profiles[0];

  // ---------- the button and the list ----------
  function drawButton() {
    const p = current();
    if (!p) return;
    btn.replaceChildren(avatar(p));
    btn.title = p.name;
  }

  function drawList() {
    pop.replaceChildren();
    pop.append(el('div', 'pf-head', t('profile.list')));
    for (const p of data.profiles) {
      const row = el('div', 'pf-item' + (p.id === data.active ? ' on' : ''));
      row.setAttribute('role', 'menuitemradio');
      row.setAttribute('aria-checked', String(p.id === data.active));
      row.tabIndex = 0;
      row.append(avatar(p, 'sm'), el('span', 'pf-name', p.name));
      if (p.id === data.active) row.append(Object.assign(el('span', 'pf-check'), { textContent: '✓', title: t('profile.current') }));
      const edit = el('button', 'pf-edit');
      edit.type = 'button';
      edit.title = t('profile.edit');
      edit.innerHTML = '<svg><use href="#i-edit" /></svg>';
      edit.addEventListener('click', (e) => {
        e.stopPropagation();
        closePop();
        openForm(p);
      });
      row.append(edit);
      const choose = () => switchTo(p.id);
      row.addEventListener('click', choose);
      row.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          choose();
        }
      });
      pop.append(row);
    }
    const add = el('button', 'pf-add');
    add.type = 'button';
    add.innerHTML = '<svg><use href="#i-plus" /></svg>';
    add.append(el('span', '', t('profile.add')));
    add.addEventListener('click', () => {
      closePop();
      openForm(null);
    });
    pop.append(add);
  }

  function openPop() {
    clearTimeout(closeTimer);
    drawList();
    pop.classList.remove('hidden');
    btn.setAttribute('aria-expanded', 'true');
  }
  function closePop() {
    clearTimeout(openTimer);
    clearTimeout(closeTimer);
    pinned = false;
    pop.classList.add('hidden');
    btn.setAttribute('aria-expanded', 'false');
  }

  btn.addEventListener('click', () => {
    if (!pop.classList.contains('hidden') && pinned) closePop();
    else {
      pinned = true;
      openPop();
    }
  });
  // hovering shows the list too; it goes away when the mouse leaves (unless it was opened by a click)
  wrap.addEventListener('mouseenter', () => {
    clearTimeout(closeTimer);
    if (pop.classList.contains('hidden')) openTimer = setTimeout(openPop, 140);
  });
  wrap.addEventListener('mouseleave', () => {
    clearTimeout(openTimer);
    if (!pinned) closeTimer = setTimeout(closePop, 350);
  });
  document.addEventListener('mousedown', (e) => {
    if (!pop.classList.contains('hidden') && !wrap.contains(e.target)) closePop();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !pop.classList.contains('hidden')) closePop();
  });

  async function switchTo(id) {
    closePop();
    if (id === data.active) return;
    try {
      if (await api.profiles.switch(id)) window.location.reload(); // history, likes, playlists and Home are read again
    } catch {
      GP.toast(t('profile.failed'));
    }
  }

  async function refresh() {
    try {
      data = await api.profiles.list();
    } catch {
      return;
    }
    drawButton();
    if (!pop.classList.contains('hidden')) drawList();
  }

  // ---------- the dialog ----------
  function drawForm() {
    els.preview.replaceChildren();
    if (form.avatar) {
      els.preview.style.background = '';
      els.preview.style.backgroundImage = `url("${form.avatar}")`;
    } else {
      els.preview.style.backgroundImage = '';
      els.preview.style.background = form.color;
      els.preview.textContent = letterOf(els.name.value || '?');
    }
    els.removeImg.classList.toggle('hidden', !form.avatar);
    els.colorField.classList.toggle('hidden', !!form.avatar);
    for (const b of els.colors.children) b.setAttribute('aria-checked', String(b.dataset.color === form.color));
  }

  function openForm(profile) {
    form = { id: profile ? profile.id : '', avatar: profile ? profile.avatar : '', color: profile ? profile.color : COLORS[Math.floor(Math.random() * COLORS.length)] };
    els.title.textContent = t(profile ? 'profile.editTitle' : 'profile.new');
    els.name.value = profile ? profile.name : '';
    els.error.classList.add('hidden');
    els.del.classList.toggle('hidden', !profile || data.profiles.length < 2);
    els.colors.replaceChildren(
      ...COLORS.map((c) => {
        const b = el('button', 'pf-color');
        b.type = 'button';
        b.dataset.color = c;
        b.style.background = c;
        b.setAttribute('role', 'radio');
        b.addEventListener('click', () => {
          form.color = c;
          drawForm();
        });
        return b;
      }),
    );
    drawForm();
    dlg.showModal();
    els.name.focus();
    els.name.select();
  }

  els.name.addEventListener('input', drawForm);
  els.cancel.addEventListener('click', () => dlg.close());
  els.pick.addEventListener('click', () => els.file.click());
  els.removeImg.addEventListener('click', () => {
    form.avatar = '';
    drawForm();
  });

  // the picture is cut to a square and shrunk, so it stays small
  async function readAvatar(file) {
    const source = await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(r.error);
      r.readAsDataURL(file);
    });
    const img = new Image();
    img.src = source;
    await img.decode();
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    const canvas = el('canvas');
    canvas.width = canvas.height = 192;
    canvas.getContext('2d').drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, 192, 192);
    return canvas.toDataURL('image/jpeg', 0.85);
  }
  els.file.addEventListener('change', async () => {
    const f = els.file.files[0];
    els.file.value = '';
    if (!f || !form) return;
    try {
      form.avatar = await readAvatar(f);
      drawForm();
    } catch {
      GP.toast(t('profile.imageFailed'));
    }
  });

  const showError = (key) => {
    els.error.textContent = t('profile.err.' + key);
    els.error.classList.remove('hidden');
  };

  els.form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = els.name.value.trim();
    if (!name) return showError('name');
    const body = { name, avatar: form.avatar, color: form.color };
    const res = form.id ? await api.profiles.update({ id: form.id, ...body }) : await api.profiles.create(body);
    if (res.error) return showError(res.error);
    dlg.close();
    await refresh();
    if (!form.id) GP.toast(t('profile.created', { name }));
  });

  els.del.addEventListener('click', async () => {
    const p = data.profiles.find((x) => x.id === form.id);
    if (!p || !window.confirm(t('profile.deleteConfirm', { name: p.name }))) return;
    const res = await api.profiles.remove(p.id);
    if (res.error) return showError(res.error === 'last' ? 'last' : 'missing');
    dlg.close();
    if (res.activeChanged) window.location.reload();
    else await refresh();
  });

  refresh();
})();
