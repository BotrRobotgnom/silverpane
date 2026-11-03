// Profiles: each one has its own history, likes and playlists (with their covers).
//   <data folder>/profiles.json              the list of profiles and which one is active
//   <data folder>/profiles/<id>/             history.json, playlists.json, reactions.json, covers/
// Settings, themes and the video checks (blocked.json) are shared by all profiles.
// This module must not import library.js: the library asks it where the active profile's files are.
import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import * as logger from './logger.js';

const COLORS = ['#e5484d', '#d6409f', '#8e4ec6', '#5b5bd6', '#0090ff', '#12a594', '#30a46c', '#f76b15'];
const PERSONAL = ['history.json', 'playlists.json', 'reactions.json']; // plus their .bak copies and covers/
const MAX_AVATAR = 200 * 1024; // characters of the data address (the page sends a small square picture)
export const MAX_PROFILES = 12;

const registryFile = () => path.join(app.getPath('userData'), 'profiles.json');
const profilesRoot = () => path.join(app.getPath('userData'), 'profiles');
const idOk = (id) => typeof id === 'string' && /^p-[a-z0-9]{6,20}$/.test(id);

let registry = null; // { active, profiles: [{ id, name, color, avatar }] }

function writeRegistry() {
  try {
    const tmp = registryFile() + '.tmp';
    fs.mkdirSync(path.dirname(tmp), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(registry));
    if (fs.existsSync(registryFile())) fs.copyFileSync(registryFile(), registryFile() + '.bak');
    fs.renameSync(tmp, registryFile());
  } catch (err) {
    logger.error('profiles', 'Saving profiles.json failed', err);
  }
}

const newId = () => 'p-' + crypto.randomBytes(5).toString('hex');
const randomColor = () => COLORS[crypto.randomInt(COLORS.length)];

// Name: 1 to 24 characters without control characters
function cleanName(name) {
  return String(name ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 24);
}
function cleanAvatar(avatar) {
  return typeof avatar === 'string' && avatar.length <= MAX_AVATAR && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(avatar) ? avatar : '';
}
const cleanColor = (c) => (COLORS.includes(c) ? c : randomColor());

const parseRegistry = (file) => {
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!parsed || !Array.isArray(parsed.profiles)) return null;
  const profiles = parsed.profiles.filter((p) => p && idOk(p.id)).map((p) => ({ id: p.id, name: cleanName(p.name) || 'Profile', color: cleanColor(p.color), avatar: cleanAvatar(p.avatar) }));
  return profiles.length ? { active: parsed.active, profiles } : null;
};

// Starts before any personal file is read: the first run moves the old single-profile data into a profile
export function init() {
  if (registry) return;
  for (const file of [registryFile(), registryFile() + '.bak']) {
    try {
      registry = parseRegistry(file);
    } catch {
      registry = null; // missing (the first run) or damaged: the backup copy is tried next
    }
    if (registry) {
      if (file !== registryFile()) logger.warn('profiles', 'profiles.json restored from the backup copy');
      break;
    }
  }
  if (registry && registry.profiles.length) {
    if (!registry.profiles.some((p) => p.id === registry.active)) registry.active = registry.profiles[0].id;
    fs.mkdirSync(path.join(profilesRoot(), registry.active), { recursive: true });
    return;
  }
  // first run with profiles: the existing data becomes the first profile
  const first = { id: newId(), name: 'Me', color: randomColor(), avatar: '' };
  registry = { active: first.id, profiles: [first] };
  const dir = path.join(profilesRoot(), first.id);
  fs.mkdirSync(dir, { recursive: true });
  const root = app.getPath('userData');
  const names = [...PERSONAL, ...PERSONAL.map((n) => n + '.bak'), 'covers'];
  let moved = 0;
  for (const name of names) {
    const from = path.join(root, name);
    if (!fs.existsSync(from)) continue;
    try {
      fs.renameSync(from, path.join(dir, name));
      moved++;
    } catch (err) {
      // not moved (a locked file, say): copy instead and leave the original, so nothing is ever lost
      try {
        fs.cpSync(from, path.join(dir, name), { recursive: true });
        moved++;
      } catch (err2) {
        logger.error('profiles', `Could not move ${name} into the first profile`, { error: err2.message });
      }
      logger.warn('profiles', `Moved ${name} by copying`, { error: err.message });
    }
  }
  writeRegistry();
  logger.info('profiles', 'Profiles created: the existing data is now the profile "Me"', { moved });
}

// Where the active profile keeps its files
export function activeDir() {
  init();
  return path.join(profilesRoot(), registry.active);
}

export function list() {
  init();
  return { active: registry.active, profiles: registry.profiles.map((p) => ({ ...p })) };
}

export function create({ name, avatar, color } = {}) {
  init();
  const n = cleanName(name);
  if (!n) return { error: 'name' };
  if (registry.profiles.length >= MAX_PROFILES) return { error: 'limit' };
  if (registry.profiles.some((p) => p.name.toLowerCase() === n.toLowerCase())) return { error: 'exists' };
  const p = { id: newId(), name: n, color: cleanColor(color), avatar: cleanAvatar(avatar) };
  registry.profiles.push(p);
  fs.mkdirSync(path.join(profilesRoot(), p.id), { recursive: true });
  writeRegistry();
  logger.info('profiles', `Profile created: ${n}`);
  return { id: p.id };
}

export function update({ id, name, avatar, color } = {}) {
  init();
  const p = registry.profiles.find((x) => x.id === id);
  if (!p) return { error: 'missing' };
  if (name !== undefined) {
    const n = cleanName(name);
    if (!n) return { error: 'name' };
    if (registry.profiles.some((x) => x.id !== id && x.name.toLowerCase() === n.toLowerCase())) return { error: 'exists' };
    p.name = n;
  }
  if (avatar !== undefined) p.avatar = cleanAvatar(avatar); // '' or null removes it
  if (color !== undefined) p.color = cleanColor(color);
  writeRegistry();
  return { ok: true };
}

// The caller flushes and reloads the library around this
export function setActive(id) {
  init();
  if (!registry.profiles.some((p) => p.id === id)) return false;
  registry.active = id;
  fs.mkdirSync(path.join(profilesRoot(), id), { recursive: true });
  writeRegistry();
  logger.info('profiles', `Active profile: ${registry.profiles.find((p) => p.id === id).name}`);
  return true;
}

// Deletes a profile and everything it holds. Returns { ok, activeChanged } or { error }
export function remove(id) {
  init();
  if (registry.profiles.length < 2) return { error: 'last' };
  const i = registry.profiles.findIndex((p) => p.id === id);
  if (i < 0) return { error: 'missing' };
  const wasActive = registry.active === id;
  const [gone] = registry.profiles.splice(i, 1);
  if (wasActive) registry.active = registry.profiles[0].id;
  writeRegistry();
  try {
    fs.rmSync(path.join(profilesRoot(), gone.id), { recursive: true, force: true });
  } catch (err) {
    logger.warn('profiles', 'The files of a deleted profile could not be removed', { error: err.message });
  }
  logger.info('profiles', `Profile deleted: ${gone.name}`);
  return { ok: true, activeChanged: wasActive };
}
