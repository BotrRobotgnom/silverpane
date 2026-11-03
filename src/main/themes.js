// Custom themes: stored in themes.json in the data folder, shared as .json files.
// The renderer (theme.js) checks and applies a theme; here only files are read and written.
import { app, dialog, shell } from 'electron';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createStore } from './library.js';
import * as logger from './logger.js';

const store = createStore('themes.json', () => ({ themes: [] }));
const MAX_FILE = 8 * 1024 * 1024; // a theme may carry a background picture

export const list = () => store.load().themes;
export const flush = () => store.save();

export function save(theme) {
  if (!theme || typeof theme !== 'object' || typeof theme.id !== 'string' || !/^custom:[\w-]{1,40}$/.test(theme.id)) return false;
  const data = store.load();
  const i = data.themes.findIndex((x) => x.id === theme.id);
  if (i >= 0) data.themes[i] = theme;
  else data.themes.push(theme);
  if (data.themes.length > 50) data.themes.shift();
  store.changed();
  return true;
}

export function remove(id) {
  const data = store.load();
  data.themes = data.themes.filter((x) => x.id !== id);
  store.changed();
  return true;
}

// Returns { text } (the file content), or null when cancelled
export async function importFile(win) {
  const res = await dialog.showOpenDialog(win, { title: 'Import a theme', properties: ['openFile'], filters: [{ name: 'Theme', extensions: ['json'] }] });
  if (res.canceled || !res.filePaths[0]) return null;
  try {
    const stat = await fs.stat(res.filePaths[0]);
    if (stat.size > MAX_FILE) return { error: 'big' };
    return { text: await fs.readFile(res.filePaths[0], 'utf8') };
  } catch (err) {
    logger.warn('themes', 'Could not read the theme file', { error: err.message });
    return { error: 'read' };
  }
}

// Returns the path written, or null when cancelled
export async function exportFile(win, suggested, text) {
  const safe = String(suggested || 'theme').replace(/[^\w.-]+/g, '-').slice(0, 60) || 'theme';
  const res = await dialog.showSaveDialog(win, { title: 'Export a theme', defaultPath: safe + '.json', filters: [{ name: 'Theme', extensions: ['json'] }] });
  if (res.canceled || !res.filePath) return null;
  await fs.writeFile(res.filePath, String(text), 'utf8');
  logger.info('themes', `Theme exported: ${path.basename(res.filePath)}`);
  return res.filePath;
}

// ---------- The themes folder ----------
// <data folder>/themes/ holds loose theme files (Name.json) and theme folders:
//   Name/theme.json            colours and shape (optional)
//   Name/background/           every picture or video here is a layer of the background, bottom first (by file name)
//   Name/background/layers.json  optional motion settings per file
// Only a few file types are read, and only from these places.
const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg', '.avif']);
const VIDEO_EXT = new Set(['.mp4', '.webm']);
const TYPES = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
  '.svg': 'image/svg+xml', '.avif': 'image/avif', '.mp4': 'video/mp4', '.webm': 'video/webm',
};
export const MAX_LAYERS = 12;
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const MAX_VIDEO_BYTES = 80 * 1024 * 1024;
const MAX_JSON = 9 * 1024 * 1024;
const MAX_IMPORT = 400 * 1024 * 1024;
const natural = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });

export const themesDir = () => path.join(app.getPath('userData'), 'themes');
const ensureDir = () => fs.mkdir(themesDir(), { recursive: true });

async function readText(file, limit = MAX_JSON) {
  try {
    const stat = await fs.stat(file);
    if (!stat.isFile() || stat.size > limit) return null;
    return await fs.readFile(file, 'utf8');
  } catch {
    return null;
  }
}

async function readLayers(folder) {
  const base = path.join(themesDir(), folder, 'background');
  let names;
  try {
    names = await fs.readdir(base, { withFileTypes: true });
  } catch {
    return { layers: [], manifest: {} };
  }
  const layers = [];
  for (const e of names.sort((a, b) => natural(a.name, b.name))) {
    const ext = path.extname(e.name).toLowerCase();
    const kind = IMAGE_EXT.has(ext) ? 'image' : VIDEO_EXT.has(ext) ? 'video' : null;
    if (!e.isFile() || !kind) continue;
    const stat = await fs.stat(path.join(base, e.name)).catch(() => null);
    if (!stat || stat.size > (kind === 'video' ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES)) {
      logger.warn('themes', `Layer skipped (too big): ${folder}/${e.name}`);
      continue;
    }
    layers.push({ file: e.name, kind, size: stat.size, version: Math.round(stat.mtimeMs), url: `/theme/${encodeURIComponent(folder)}/background/${encodeURIComponent(e.name)}` });
    if (layers.length >= MAX_LAYERS) break;
  }
  let manifest = {};
  try {
    const parsed = JSON.parse((await readText(path.join(base, 'layers.json'), 1024 * 1024)) || '{}');
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) manifest = parsed;
  } catch {
    logger.warn('themes', `layers.json of "${folder}" is not valid JSON`);
  }
  return { layers, manifest };
}

// Everything in the themes folder: [{ id, kind: 'folder' | 'file', name, json, layers, manifest }]
export async function scan() {
  await ensureDir();
  const items = [];
  let entries = [];
  try {
    entries = await fs.readdir(themesDir(), { withFileTypes: true });
  } catch {
    /* no folder, no themes */
  }
  for (const e of entries.sort((a, b) => natural(a.name, b.name))) {
    if (e.name.startsWith('.')) continue;
    if (e.isDirectory()) {
      const json = await readText(path.join(themesDir(), e.name, 'theme.json'));
      const { layers, manifest } = await readLayers(e.name);
      if (json === null && !layers.length) continue; // not a theme
      items.push({ id: 'folder:' + e.name, kind: 'folder', name: e.name, json, layers, manifest });
    } else if (e.isFile() && path.extname(e.name).toLowerCase() === '.json') {
      const json = await readText(path.join(themesDir(), e.name));
      if (json !== null) items.push({ id: 'file:' + e.name, kind: 'file', name: path.basename(e.name, '.json'), json, layers: [], manifest: {} });
    }
  }
  return { dir: themesDir(), items };
}

// Resolves /theme/<folder>/background/<file> to a real file, or null. Nothing outside a theme's background folder is served.
export async function resolveAsset(rest) {
  const parts = String(rest).split('/');
  if (parts.length !== 3 || parts[1] !== 'background') return null;
  const [folder, , name] = parts;
  if (!folder || !name || [folder, name].some((x) => x.startsWith('.') || /[\\/\0]/.test(x))) return null;
  const type = TYPES[path.extname(name).toLowerCase()];
  if (!type) return null;
  try {
    const root = await fs.realpath(themesDir());
    const file = await fs.realpath(path.join(root, folder, 'background', name));
    if (!file.startsWith(root + path.sep)) return null; // a link that leads out of the themes folder
    const stat = await fs.stat(file);
    return stat.isFile() ? { file, type } : null;
  } catch {
    return null;
  }
}

export async function openFolder() {
  await ensureDir();
  const err = await shell.openPath(themesDir());
  return err ? { error: err } : { ok: true };
}

async function uniqueName(name) {
  let candidate = name;
  for (let i = 2; i < 100; i++) {
    try {
      await fs.access(path.join(themesDir(), candidate));
      candidate = `${name} ${i}`;
    } catch {
      return candidate;
    }
  }
  return `${name} ${Date.now()}`;
}

async function folderSize(dir, limit) {
  let total = 0;
  const walk = async (d) => {
    for (const e of await fs.readdir(d, { withFileTypes: true })) {
      if (e.isSymbolicLink()) continue;
      const full = path.join(d, e.name);
      if (e.isDirectory()) await walk(full);
      else if (e.isFile()) total += (await fs.stat(full)).size;
      if (total > limit) throw new Error('big');
    }
  };
  await walk(dir);
  return total;
}

// Copies a theme folder chosen by the person into the themes folder. Returns { id } / { error } / null (cancelled)
export async function importFolder(win) {
  const res = await dialog.showOpenDialog(win, { title: 'Import a theme folder', properties: ['openDirectory'] });
  if (res.canceled || !res.filePaths[0]) return null;
  const src = res.filePaths[0];
  await ensureDir();
  try {
    if (path.resolve(src).startsWith(themesDir() + path.sep)) return { error: 'inside' };
    await folderSize(src, MAX_IMPORT);
    const name = await uniqueName(path.basename(src));
    await fs.cp(src, path.join(themesDir(), name), { recursive: true, filter: async (f) => !(await fs.lstat(f)).isSymbolicLink() });
    logger.info('themes', `Theme folder imported: ${name}`);
    return { id: 'folder:' + name };
  } catch (err) {
    logger.warn('themes', 'Could not import the theme folder', { error: err.message });
    return { error: err.message === 'big' ? 'big' : 'read' };
  }
}

// A ready theme to look at and copy from (it ships inside the app)
export async function createExample() {
  await ensureDir();
  const src = path.join(path.dirname(fileURLToPath(import.meta.url)), 'sample-theme');
  const name = await uniqueName('Example theme');
  try {
    await fs.cp(src, path.join(themesDir(), name), { recursive: true });
    return { id: 'folder:' + name };
  } catch (err) {
    logger.warn('themes', 'Could not create the example theme', { error: err.message });
    return { error: 'read' };
  }
}
