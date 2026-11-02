// The year of a date the services give us ("2019-05-03", "2019-05-03T10:00:00Z", 2019 ...).
// Anything outside a believable range is dropped: a wrong year is worse than none.
export function yearOf(raw, now = new Date()) {
  const m = /^\s*(\d{4})/.exec(String(raw ?? ''));
  if (!m) return 0;
  const y = Number(m[1]);
  return y >= 1900 && y <= now.getFullYear() + 1 ? y : 0;
}

// SoundCloud: the release date the artist entered, else the day it was uploaded
export function soundcloudYear(t) {
  const rel = yearOf(t?.release_date);
  if (rel) return { year: rel, yearKind: 'release' };
  const up = yearOf(t?.created_at);
  return up ? { year: up, yearKind: 'upload' } : {};
}
