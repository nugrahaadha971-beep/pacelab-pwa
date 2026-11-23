import type { LapSplit, WorkoutDraft } from '../analytics/types.ts';

type Draft = Omit<WorkoutDraft, 'workoutType' | 'rpe'>;
export interface GpxPoint {
  lat: number;
  lon: number;
  ele: number | null;
  t: number;
  hr: number | null;
  cad: number | null;
}

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

function computeHrZonePct(
  zoneSec: [number, number, number, number, number],
): [number, number, number, number, number] | undefined {
  const total = zoneSec[0] + zoneSec[1] + zoneSec[2] + zoneSec[3] + zoneSec[4];
  if (total <= 0) return undefined;
  const pcts = zoneSec.map((s) => Math.round((s / total) * 100)) as [number, number, number, number, number];
  const diff = 100 - (pcts[0] + pcts[1] + pcts[2] + pcts[3] + pcts[4]);
  if (diff !== 0) {
    let maxIdx = 0;
    for (let i = 1; i < 5; i++) {
      if (zoneSec[i] > zoneSec[maxIdx]) maxIdx = i;
    }
    pcts[maxIdx] = Math.max(0, pcts[maxIdx] + diff);
  }
  return pcts;
}

export function analyzeGpxPoints(pts: ReadonlyArray<GpxPoint>, profileMaxHr?: number): Draft {
  if (pts.length < 2) throw new Error('Jejak GPS terlalu sedikit atau tanpa waktu.');

  let dist = 0;
  let moving = 0;
  let elevGain = 0;
  let hrSum = 0;
  let hrN = 0;
  let hrMax: number | null = null;
  let cadSum = 0;
  let cadN = 0;
  let runSec = 0;
  let walkSec = 0;
  let runDist = 0;
  let walkCount = 0;
  let hasRun = false;
  let inWalkStreak = false;
  let walkStreakSec = 0;

  const laps: LapSplit[] = [];
  let lapDist = 0;
  let lapStart = pts[0].t;
  let lapHrSum = 0;
  let lapHrN = 0;

  interface Segment {
    d: number;
    dt: number;
    moving: boolean;
    hr: number | null;
  }
  const segments: Segment[] = [];

  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const d = haversineM(a, b);
    const dt = (b.t - a.t) / 1000;
    const speed = dt > 0 ? d / dt : 0;
    const isMoving = dt > 0 && speed >= 0.5;

    dist += d;
    if (isMoving) {
      moving += dt;
      const isRun = speed >= 1.8 || (b.cad != null && b.cad * 2 >= 145);
      if (isRun) {
        if (inWalkStreak && hasRun && walkStreakSec >= 10) {
          walkCount++;
        }
        inWalkStreak = false;
        walkStreakSec = 0;
        hasRun = true;
        runSec += dt;
        runDist += d;
      } else {
        walkSec += dt;
        if (hasRun) {
          inWalkStreak = true;
          walkStreakSec += dt;
        }
      }
    }

    if (a.ele != null && b.ele != null && b.ele > a.ele) elevGain += b.ele - a.ele;
    if (b.hr != null) {
      hrSum += b.hr;
      hrN++;
      lapHrSum += b.hr;
      lapHrN++;
      hrMax = Math.max(hrMax ?? 0, b.hr);
    }
    if (b.cad != null) {
      cadSum += b.cad;
      cadN++;
    }
    lapDist += d;
    if (lapDist >= 1000) {
      laps.push({
        km: laps.length + 1,
        paceSec: ((b.t - lapStart) / 1000) * (1000 / lapDist),
        avgHr: lapHrN ? Math.round(lapHrSum / lapHrN) : null,
      });
      lapDist = 0;
      lapStart = b.t;
      lapHrSum = 0;
      lapHrN = 0;
    }

    segments.push({ d, dt, moving: isMoving, hr: b.hr ?? a.hr });
  }

  if (inWalkStreak && hasRun && walkStreakSec >= 10) {
    walkCount++;
  }

  const elapsedRaw = (pts[pts.length - 1].t - pts[0].t) / 1000;
  const elapsedSec = Math.max(0, Math.round(elapsedRaw));
  const distanceKm = dist / 1000;
  const durationSec = moving > 0 ? moving : elapsedRaw;
  if (distanceKm <= 0 || durationSec <= 0) throw new Error('Jejak GPS tidak berisi jarak yang valid.');

  // Hitung splitRatio: rata-rata pace paruh kedua jarak tempuh dibagi paruh pertama.
  let splitRatio: number | undefined;
  if (dist >= 200) {
    const halfDist = dist / 2;
    let cumDist = 0;
    let firstDist = 0;
    let firstTime = 0;
    let secondDist = 0;
    let secondTime = 0;
    const useMovingOnly = moving > 0;

    for (const seg of segments) {
      if (seg.dt <= 0 || seg.d <= 0) continue;
      const segTime = !useMovingOnly || seg.moving ? seg.dt : 0;
      const prevCum = cumDist;
      const nextCum = cumDist + seg.d;
      if (nextCum <= halfDist) {
        firstDist += seg.d;
        firstTime += segTime;
      } else if (prevCum >= halfDist) {
        secondDist += seg.d;
        secondTime += segTime;
      } else {
        const ratioFirst = (halfDist - prevCum) / seg.d;
        const ratioSecond = 1 - ratioFirst;
        firstDist += seg.d * ratioFirst;
        firstTime += segTime * ratioFirst;
        secondDist += seg.d * ratioSecond;
        secondTime += segTime * ratioSecond;
      }
      cumDist = nextCum;
    }

    if (firstDist > 0 && secondDist > 0 && firstTime > 0 && secondTime > 0) {
      const pace1 = firstTime / (firstDist / 1000);
      const pace2 = secondTime / (secondDist / 1000);
      if (pace1 > 0 && Number.isFinite(pace2 / pace1)) {
        splitRatio = Math.round((pace2 / pace1) * 1000) / 1000;
      }
    }
  }

  // Hitung sebaran zona HR 1..5 berdasarkan % terhadap maxHR profil atau estimasi standar.
  const refMaxHr =
    profileMaxHr && profileMaxHr > 0
      ? Math.max(profileMaxHr, hrMax ?? 0)
      : hrMax != null && hrMax > 0
        ? Math.max(hrMax, 190)
        : null;
  let hrZonePct: [number, number, number, number, number] | undefined;
  if (refMaxHr != null && hrN > 0) {
    const zoneSec: [number, number, number, number, number] = [0, 0, 0, 0, 0];
    const useMovingOnly = moving > 0;
    for (const seg of segments) {
      if (seg.dt <= 0 || seg.hr == null) continue;
      if (useMovingOnly && !seg.moving) continue;
      const frac = seg.hr / refMaxHr;
      const idx = frac < 0.6 ? 0 : frac < 0.7 ? 1 : frac < 0.8 ? 2 : frac < 0.9 ? 3 : 4;
      zoneSec[idx] += seg.dt;
    }
    hrZonePct = computeHrZonePct(zoneSec);
  }

  const runPaceSecPerKm = runDist > 0 ? runSec / (runDist / 1000) : null;

  return {
    date: pts[0].t,
    source: 'gpx',
    distanceKm,
    durationSec: Math.round(durationSec),
    elapsedSec,
    avgPaceSecPerKm: durationSec / distanceKm,
    avgHr: hrN ? Math.round(hrSum / hrN) : null,
    maxHr: hrMax,
    // Banyak perangkat mencatat cadence per kaki; dikali 2 untuk spm.
    avgCadence: cadN ? Math.round((cadSum / cadN) * 2) : null,
    elevationGain: pts.some((p) => p.ele != null) ? Math.round(elevGain) : null,
    laps,
    ...(splitRatio != null ? { splitRatio } : {}),
    ...(hrZonePct ? { hrZonePct } : {}),
    runSec: Math.round(runSec),
    walkSec: Math.round(walkSec),
    runPaceSecPerKm,
    walkCount,
  };
}

export function parseGpx(xml: string, profileMaxHr?: number): Draft {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('Berkas GPX tidak valid (XML rusak).');

  const pts: GpxPoint[] = [];
  for (const el of Array.from(doc.getElementsByTagName('trkpt'))) {
    const lat = Number(el.getAttribute('lat'));
    const lon = Number(el.getAttribute('lon'));
    const t = Date.parse(child(el, 'time') ?? '');
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(t)) continue;
    pts.push({ lat, lon, ele: num(child(el, 'ele')), t, hr: num(desc(el, 'hr')), cad: num(desc(el, 'cad')) });
  }
  return analyzeGpxPoints(pts, profileMaxHr);
}
