// Custom themes: stored in themes.json in the data folder, shared as .json files.
// The renderer (theme.js) checks and applies a theme; here only files are read and written.
import { dialog } from 'electron';
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
