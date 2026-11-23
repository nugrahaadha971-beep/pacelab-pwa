import type { LapSplit, WorkoutDraft } from '../analytics/types';

type Draft = Omit<WorkoutDraft, 'workoutType' | 'rpe'>;
interface Pt { lat: number; lon: number; ele: number | null; t: number; hr: number | null; cad: number | null }

const R = 6_371_000;
export function haversineM(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const rad = (x: number) => (x * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

const num = (s: string | null | undefined): number | null => {
  if (s == null || s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};
const child = (el: Element, name: string) =>
  Array.from(el.children).find((c) => c.localName === name)?.textContent?.trim() ?? null;
const desc = (el: Element, name: string) =>
  Array.from(el.getElementsByTagName('*')).find((c) => c.localName === name)?.textContent ?? null;

export function parseGpx(xml: string): Draft {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('Berkas GPX tidak valid (XML rusak).');

  const pts: Pt[] = [];
  for (const el of Array.from(doc.getElementsByTagName('trkpt'))) {
    const lat = Number(el.getAttribute('lat'));
    const lon = Number(el.getAttribute('lon'));
    const t = Date.parse(child(el, 'time') ?? '');
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(t)) continue;
    pts.push({ lat, lon, ele: num(child(el, 'ele')), t, hr: num(desc(el, 'hr')), cad: num(desc(el, 'cad')) });
  }
  if (pts.length < 2) throw new Error('Jejak GPS terlalu sedikit atau tanpa waktu.');

  let dist = 0, moving = 0, elevGain = 0, hrSum = 0, hrN = 0, hrMax: number | null = null, cadSum = 0, cadN = 0;
  const laps: LapSplit[] = [];
  let lapDist = 0, lapStart = pts[0].t, lapHrSum = 0, lapHrN = 0;

  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const d = haversineM(a, b);
    const dt = (b.t - a.t) / 1000;
    dist += d;
    if (dt > 0 && d / dt >= 0.5) moving += dt; // ambang diam 0,5 m/s
    if (a.ele != null && b.ele != null && b.ele > a.ele) elevGain += b.ele - a.ele;
    if (b.hr != null) {
      hrSum += b.hr; hrN++; lapHrSum += b.hr; lapHrN++;
      hrMax = Math.max(hrMax ?? 0, b.hr);
    }
    if (b.cad != null) { cadSum += b.cad; cadN++; }
    lapDist += d;
    if (lapDist >= 1000) {
      laps.push({
        km: laps.length + 1,
        paceSec: ((b.t - lapStart) / 1000) * (1000 / lapDist),
        avgHr: lapHrN ? Math.round(lapHrSum / lapHrN) : null,
      });
      lapDist = 0; lapStart = b.t; lapHrSum = 0; lapHrN = 0;
    }
  }

  const distanceKm = dist / 1000;
  const durationSec = moving > 0 ? moving : (pts[pts.length - 1].t - pts[0].t) / 1000;
  if (distanceKm <= 0 || durationSec <= 0) throw new Error('Jejak GPS tidak berisi jarak yang valid.');

  return {
    date: pts[0].t,
    source: 'gpx',
    distanceKm,
    durationSec: Math.round(durationSec),
    avgPaceSecPerKm: durationSec / distanceKm,
    avgHr: hrN ? Math.round(hrSum / hrN) : null,
    maxHr: hrMax,
    // Banyak perangkat mencatat cadence per kaki; dikali 2 untuk spm.
    avgCadence: cadN ? Math.round((cadSum / cadN) * 2) : null,
    elevationGain: pts.some((p) => p.ele != null) ? Math.round(elevGain) : null,
    laps,
  };
}
