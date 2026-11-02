// Local read-only API: what is playing now, for other programs (stream overlays, status bars, widgets).
// Off by default. Listens on 127.0.0.1 only, so nothing outside this computer can reach it.
import http from 'node:http';
import { app } from 'electron';
import * as logger from './logger.js';
import { yearOf } from './year.js';

export const DEFAULT_PORT = 47832;
const API_VERSION = 1;

let server = null;
let listening = 0; // the port we really listen on, 0 when off
let localOrigin = ''; // the interface server: local covers are served from there
let now = { hasTrack: false };
let updatedAt = Date.now(); // the last change of track or state
let reportedAt = Date.now(); // when the position was measured
const clients = new Set(); // open /events streams

export function setLocalOrigin(origin) {
  localOrigin = origin;
}

// ---- state ----
function absolute(url) {
  if (typeof url !== 'string' || !url) return '';
  if (/^https?:\/\//.test(url)) return url.slice(0, 600);
  if (url.startsWith('/local/cover/') && localOrigin) return localOrigin + url;
  return '';
}

export function snapshot() {
  const n = now;
  const state = !n.hasTrack ? 'stopped' : n.playing ? 'playing' : 'paused';
  return {
    app: 'Silverpane',
    version: app.getVersion(),
    apiVersion: API_VERSION,
    state,
    track: n.hasTrack
      ? {
          id: n.id,
          source: n.source,
          title: n.title,
          artist: n.artist,
          album: n.album,
          year: n.year || null,
          yearKind: n.year ? n.yearKind : null,
          durationSec: n.dur,
          url: n.url,
          cover: n.cover,
        }
      : null,
    positionSec: n.hasTrack ? n.cur : 0,
    positionAt: reportedAt, // positionSec was measured then; while playing, add the time passed since
    updatedAt,
  };
}

// Called with what the page reports about once a second
export function setNow(info) {
  if (!info || typeof info !== 'object') return;
  const next = {
    hasTrack: !!info.hasTrack,
    playing: !!info.playing,
    id: String(info.id || '').slice(0, 80),
    source: ['youtube', 'soundcloud', 'local'].includes(info.source) ? info.source : '',
    title: String(info.title || '').slice(0, 300),
    artist: String(info.artist || '').slice(0, 300),
    album: String(info.album || '').slice(0, 300),
    year: yearOf(info.year),
    yearKind: info.yearKind === 'release' ? 'release' : 'upload',
    cur: Math.max(0, Math.round((Number(info.cur) || 0) * 10) / 10),
    dur: Math.max(0, Math.round(Number(info.dur) || 0)),
    url: typeof info.url === 'string' && /^https?:\/\//.test(info.url) ? info.url.slice(0, 600) : '',
    cover: absolute(info.cover),
  };
  // listeners are told when the track or the play state changes, or the position jumps (a seek)
  const prev = now;
  const jumped = Math.abs(next.cur - (prev.cur || 0)) > 3;
  const changed =
    next.hasTrack !== prev.hasTrack || next.playing !== prev.playing || next.id !== prev.id || next.source !== prev.source || next.title !== prev.title || next.cover !== prev.cover || jumped;
  now = next;
  reportedAt = Date.now();
  if (changed) {
    updatedAt = reportedAt;
    push();
  }
}

function push() {
  if (!clients.size) return;
  const data = `event: now\ndata: ${JSON.stringify(snapshot())}\n\n`;
  for (const res of clients) res.write(data);
}

// ---- http ----
// Only requests that name this computer are answered: this blocks a web page from reaching the API through a DNS trick.
function hostOk(req) {
  const host = String(req.headers.host || '').toLowerCase();
  return host === `127.0.0.1:${listening}` || host === `localhost:${listening}` || host === `[::1]:${listening}`;
}

function send(res, code, body, type = 'application/json; charset=utf-8', extra = {}) {
  res.writeHead(code, {
    'Content-Type': type,
    'Access-Control-Allow-Origin': '*', // read-only data, and overlay pages are loaded from other origins
    'Cache-Control': 'no-store',
    ...extra,
  });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

function handle(req, res) {
  if (!hostOk(req)) return send(res, 403, { error: 'forbidden' });
  if (req.method === 'OPTIONS') return send(res, 204, '', 'text/plain', { 'Access-Control-Allow-Methods': 'GET', 'Access-Control-Allow-Headers': '*' });
  if (req.method !== 'GET') return send(res, 405, { error: 'method not allowed' });
  const path = new URL(req.url, 'http://x').pathname.replace(/\/+$/, '') || '/';

  if (path === '/api/v1' || path === '/') {
    return send(res, 200, {
      app: 'Silverpane',
      apiVersion: API_VERSION,
      endpoints: { now: '/api/v1/now', cover: '/api/v1/cover', events: '/api/v1/events' },
    });
  }
  if (path === '/api/v1/now') return send(res, 200, snapshot());
  if (path === '/api/v1/cover') {
    const url = snapshot().track?.cover;
    if (!url) return send(res, 404, { error: 'no cover' });
    return send(res, 302, '', 'text/plain', { Location: url });
  }
  if (path === '/api/v1/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
    });
    res.write(`event: now\ndata: ${JSON.stringify(snapshot())}\n\n`);
    clients.add(res);
    const beat = setInterval(() => res.write(': keep-alive\n\n'), 20000);
    req.on('close', () => {
      clearInterval(beat);
      clients.delete(res);
    });
    return;
  }
  return send(res, 404, { error: 'not found' });
}

export const isOn = () => !!server;

export function stop() {
  for (const res of clients) res.end();
  clients.clear();
  if (server) {
    server.close();
    server.closeAllConnections?.(); // keep-alive connections would otherwise outlive a port change
  }
  server = null;
  listening = 0;
}

// Turn the API on (or move it to another port) or off. Resolves { ok, port, error }.
export function configure({ enabled, port }) {
  const want = Number.isInteger(port) && port >= 1024 && port <= 65535 ? port : DEFAULT_PORT;
  if (!enabled) {
    if (server) logger.info('api', 'API stopped');
    stop();
    return Promise.resolve({ ok: true, port: 0 });
  }
  if (server && listening === want) return Promise.resolve({ ok: true, port: want });
  stop();
  return new Promise((resolve) => {
    const s = http.createServer(handle);
    s.once('error', (err) => {
      logger.warn('api', `API could not start on port ${want}`, { error: err.code || err.message });
      if (server === s) server = null;
      resolve({ ok: false, port: 0, error: err.code === 'EADDRINUSE' ? 'busy' : String(err.code || err.message) });
    });
    s.listen(want, '127.0.0.1', () => {
      server = s;
      listening = want;
      logger.info('api', `API listening on 127.0.0.1:${want}`);
      resolve({ ok: true, port: want });
    });
  });
}
