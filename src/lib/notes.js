// Small helpers shared by the AI brief (Sectors page) and the notes history page.
export const etTime = (iso) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' });
export const etDay = (iso) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(iso));

// 'claude-haiku-5-5' -> 'Haiku 5.5'
export function modelName(m) {
  if (!m || m === 'rules') return m || '';
  const x = /^claude-([a-z]+)-(\d+)-(\d+)/.exec(m);
  return x ? `${x[1][0].toUpperCase()}${x[1].slice(1)} ${x[2]}.${x[3]}` : m;
}

// UTC range covering one New York calendar day (handles EDT/EST).
export function etDayRange(dayISO) {
  const guess = new Date(`${dayISO}T12:00:00Z`);
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', timeZoneName: 'shortOffset' }).formatToParts(guess);
  const off = (parts.find((p) => p.type === 'timeZoneName')?.value || 'GMT-4').replace('GMT', '') || '-4';
  const h = String(Math.abs(parseInt(off, 10))).padStart(2, '0');
  const start = new Date(`${dayISO}T00:00:00-${h}:00`);
  return { start: start.toISOString(), end: new Date(start.getTime() + 86400000).toISOString() };
}

export function shiftDay(dayISO, n) {
  const d = new Date(`${dayISO}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
