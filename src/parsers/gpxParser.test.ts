import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeGpxPoints, type GpxPoint } from './gpxParser.ts';

/** Buat deret titik GPS ke utara sepanjang jarak/kecepatan tertentu (1° lat ≈ 111.195 km). */
function buildLinearTrack(): GpxPoint[] {
  const pts: GpxPoint[] = [];
  let t = Date.parse('2026-11-20T06:00:00Z');
  let lat = -6.2;
  const lon = 106.8;
  const mPerDeg = 111_195;

  const pushStep = (dtSec: number, speedMs: number, hr: number, cad: number | null = null) => {
    const dM = speedMs * dtSec;
    lat += dM / mPerDeg;
    t += dtSec * 1000;
    pts.push({ lat, lon, ele: 10, t, hr, cad });
  };

  pts.push({ lat, lon, ele: 10, t, hr: 130, cad: 80 });

  // Segmen 1: Lari 200 detik @ 2.5 m/s (500 m, HR 145 = Z3 untuk maxHr 190)
  for (let i = 0; i < 20; i++) pushStep(10, 2.5, 145, 82);

  // Segmen 2: Noise GPS jalan singkat 5 detik (< 10 detik -> tidak dihitung walkCount)
  pushStep(5, 1.0, 130, 55);

  // Segmen 3: Jeda berhenti 30 detik (0 m/s -> masuk elapsedSec, bukan moving/durationSec)
  pushStep(30, 0, 115, 0);

  // Segmen 4: Jalan kaki 20 detik (>= 10 detik setelah pernah lari -> walkCount += 1)
  pushStep(10, 1.2, 125, 58);
  pushStep(10, 1.2, 125, 58);

  // Segmen 5: Lari lebih cepat di paruh akhir 200 detik @ 3.2 m/s (640 m -> Negative split)
  for (let i = 0; i < 20; i++) pushStep(10, 3.2, 160, 86);

  return pts;
}

describe('gpxParser (analyzeGpxPoints)', () => {
  it('menghitung elapsedSec, run/walk proporsi, runPaceSecPerKm, walkCount (>=10 dtk), splitRatio, dan hrZonePct', () => {
    const pts = buildLinearTrack();
    const res = analyzeGpxPoints(pts, 190);

    // Total waktu: 200 + 5 + 30 + 20 + 200 = 455 dtk; moving = 425 dtk
    assert.equal(res.elapsedSec, 455);
    assert.equal(res.durationSec, 425);
    assert.equal(res.runSec, 400);
    assert.equal(res.walkSec, 25);
    assert.equal(res.walkCount, 1);

    assert.ok(res.runPaceSecPerKm != null);
    // Run distance = 500 + 640 = 1140 m dalam 400 dtk -> ~350.9 dtk/km
    assert.ok(Math.abs((res.runPaceSecPerKm as number) - (400 / 1.14)) < 5);

    // Paruh kedua jauh lebih cepat (3.2 m/s vs 2.5 m/s) -> Negative split (< 0.99)
    assert.ok(res.splitRatio != null);
    assert.ok((res.splitRatio as number) < 0.99);

    // Total hrZonePct = 100
    assert.ok(res.hrZonePct != null);
    const sumPct = (res.hrZonePct as number[]).reduce((a, b) => a + b, 0);
    assert.equal(sumPct, 100);
    // Zona 3 (145/190=0.76) dan Zona 4 (160/190=0.84) mendominasi
    assert.ok((res.hrZonePct as number[])[2] > 30);
    assert.ok((res.hrZonePct as number[])[3] > 30);
  });

  it('mengklasifikasikan segmen cadence >= 145 spm sebagai Lari walau speed < 1.8 m/s', () => {
    const t0 = Date.parse('2026-11-20T06:00:00Z');
    const pts: GpxPoint[] = [
      { lat: -6.2, lon: 106.8, ele: 10, t: t0, hr: 140, cad: 75 },
      { lat: -6.2 + 150 / 111_195, lon: 106.8, ele: 10, t: t0 + 100_000, hr: 142, cad: 75 }, // 1.5 m/s tapi cad*2=150
    ];
    const res = analyzeGpxPoints(pts, 190);
    assert.equal(res.runSec, 100);
    assert.equal(res.walkSec, 0);
    assert.equal(res.walkCount, 0);
  });
});
