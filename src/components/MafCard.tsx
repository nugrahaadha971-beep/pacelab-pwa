import { HeartPulse } from 'lucide-react';
import { fmtPace } from '../plans/pace';
import { MAF_ADJUSTMENTS, mafFormula, mafRaceOutlook, mafTrend, mafZone, normalizeMafAdj } from '../plans/maf';
import type { MafAdjustment, MafPoint, SecRange } from '../plans/maf';
import type { RaceDistance } from '../analytics/types';
import { fmtDate, fmtHms } from './format';
import { SelectField, StatusPill } from './ui';

const dec = (x: number, d = 1) => x.toFixed(d).replace('.', ',');
const paceRange = (r: SecRange) => `${fmtPace(r[0])}–${fmtPace(r[1])} /km`;
const timeRange = (r: SecRange) => `${fmtHms(r[0])}–${fmtHms(r[1])}`;

interface Props {
  age: number;
  adj: MafAdjustment;
  onAdj: (a: MafAdjustment) => void;
  maf: number | null;
  /** Sesi aerobik ≥ 3 km yang HR rata-ratanya di sekitar HR MAF, urut dari terlama. */
  points: MafPoint[];
  /** HR maks (profil atau HR tertinggi terekam); null bila belum ada. */
  maxHr: number | null;
  targetDistance: RaceDistance;
  /** Sisa minggu menuju hari lomba; null bila tanggal lomba belum diisi. */
  weeksRemaining: number | null;
}

/** Zona MAF: HR MAF (180 − usia ± kondisi), rentang latihan, dan perkembangan pace di zona itu. */
export default function MafCard({ age, adj, onAdj, maf, points, maxHr, targetDistance, weeksRemaining }: Props) {
  const zone = maf != null ? mafZone(maf) : null;
  const trend = mafTrend(points);
  const recent = [...points].reverse().slice(0, 4);
  const outlook =
    maf != null
      ? mafRaceOutlook({
          mafPaceSecPerKm: points.length ? points[points.length - 1].paceSecPerKm : null,
          maxHr,
          targetDistance,
          weeksRemaining,
        })
      : null;

  return (
    <section
      className="sport-card border-sky-400/25 p-5"
      aria-labelledby="maf-judul"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-xl border border-sky-400/30 bg-sky-400/10 text-sky-400">
            <HeartPulse size={16} aria-hidden />
          </span>
          <h3 id="maf-judul" className="font-display text-base font-bold text-white">
            Zona MAF Anda
          </h3>
        </div>
        <StatusPill tone="info">Metode Maffetone</StatusPill>
      </div>

      {maf == null || zone == null ? (
        <p className="mt-3 rounded-2xl border border-dashed border-rose-500/40 bg-rose-500/10 p-3.5 text-sm text-rose-200">
          Isi usia di tab Profil untuk menghitung detak jantung MAF (180 − usia; 165 untuk usia ≤ 16).
        </p>
      ) : (
        <div className="mt-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="sport-subcard p-3.5">
              <div className="text-xs font-medium text-zinc-400">Batas Atas MAF</div>
              <div className="mt-1 font-mono text-3xl font-extrabold tabular-nums text-sky-400">
                {maf}
                <span className="ml-1 font-sans text-xs font-bold text-zinc-400">bpm</span>
              </div>
            </div>
            <div className="sport-subcard p-3.5">
              <div className="text-xs font-medium text-zinc-400">Zona Latihan</div>
              <div className="mt-1 font-mono text-2xl font-extrabold tabular-nums text-white sm:text-3xl">
                {zone[0]}–{zone[1]}
                <span className="ml-1 font-sans text-xs font-bold text-zinc-400">bpm</span>
              </div>
            </div>
          </div>
          <p className="mt-2 text-xs tabular-nums text-zinc-400">
            {mafFormula(age, adj)}. Jaga seluruh lari aerobik tetap berada di rentang ini.
          </p>
        </div>
      )}

      <div className="mt-4">
        <SelectField
          label="Kondisi Anda"
          term="penyesuaian MAF"
          value={String(adj)}
          onChange={(e) => onAdj(normalizeMafAdj(Number(e.target.value)))}
        >
          {MAF_ADJUSTMENTS.map((a) => (
            <option key={a.value} value={a.value}>
              {a.label}
            </option>
          ))}
        </SelectField>
      </div>

      <div className="mt-5 border-t border-white/[0.07] pt-4">
        <h4 className="text-xs font-semibold text-zinc-300">Perkembangan Pace di Zona MAF</h4>
        {recent.length === 0 ? (
          <p className="mt-1.5 text-sm text-zinc-400">
            Belum ada lari ≥ 3 km dengan detak jantung rata-rata di zona MAF. Hasil MAF Test (minggu 4 dan 8) dan lari biasa di zona ini akan muncul di sini.
          </p>
        ) : (
          <>
            <ul className="mt-2 divide-y divide-white/[0.06] text-sm tabular-nums">
              {recent.map((p) => (
                <li key={p.date} className="flex items-center justify-between gap-2 py-2.5">
                  <span className="text-zinc-400">{fmtDate(p.date)}</span>
                  <span className="font-mono text-zinc-200">
                    <strong className="text-[#BEF264]">{fmtPace(p.paceSecPerKm)}</strong>{' '}
                    <span className="font-sans text-xs text-zinc-400">/km</span>
                    <span className="mx-1.5 text-zinc-600">·</span>
                    {Math.round(p.avgHr)} bpm
                    {p.driftPct != null ? ` · drift ${dec(p.driftPct)}%` : ''}
                  </span>
                </li>
              ))}
            </ul>
            {trend ? (
              <p className={`mt-2 text-xs font-semibold ${trend.deltaSec < -1 ? 'text-[#BEF264]' : 'text-zinc-300'}`}>
                {Math.abs(trend.deltaSec) < 1
                  ? `Pace di zona MAF stabil (${trend.count} catatan).`
                  : `Pace di zona MAF ${trend.deltaSec < 0 ? 'lebih cepat' : 'lebih lambat'} ${Math.abs(Math.round(trend.deltaSec))} dtk/km ${trend.window > 1 ? `(rata-rata ${trend.window} catatan awal vs ${trend.window} terbaru)` : 'sejak catatan pertama'}.`}
              </p>
            ) : (
              <p className="mt-2 text-xs text-zinc-400">Butuh minimal 2 catatan untuk melihat tren perkembangan.</p>
            )}
          </>
        )}
      </div>

      {outlook && (
        <div role="group" className="mt-4 sport-subcard p-4" aria-labelledby="maf-proyeksi-judul">
          <h4 id="maf-proyeksi-judul" className="text-xs font-bold text-zinc-200">
            Proyeksi Lomba & Lini Masa MAF
          </h4>

          <div className="mt-3">
            <div className="text-xs font-semibold text-zinc-400">Lini masa progres</div>
            <ul className="mt-1.5 space-y-1 text-sm text-zinc-300">
              <li>
                <strong className="text-zinc-100">{outlook.timeline.earlyWeeks[0]}–{outlook.timeline.earlyWeeks[1]} minggu:</strong>{' '}
                drift turun dan pace di HR yang sama membaik sekitar {outlook.timeline.earlyGainSec[0]}–{outlook.timeline.earlyGainSec[1]} dtk/km.
              </li>
              <li>
                <strong className="text-zinc-100">3–6 bulan ({outlook.timeline.fullWeeks[0]}–{outlook.timeline.fullWeeks[1]} minggu):</strong>{' '}
                adaptasi aerobik penuh.
              </li>
              {outlook.timeline.weeksNote && <li className="text-sky-400">{outlook.timeline.weeksNote}</li>}
            </ul>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-3 border-t border-white/[0.06] pt-3 sm:grid-cols-2">
            <div>
              <div className="text-xs font-semibold text-zinc-400">Target HR saat lomba</div>
              {outlook.raceHr ? (
                <p className="mt-1 font-mono text-xl font-extrabold tabular-nums text-white">
                  {outlook.raceHr[0]}–{outlook.raceHr[1]}
                  <span className="ml-1 font-sans text-xs font-bold text-zinc-400">bpm</span>
                </p>
              ) : (
                <p className="mt-1 text-xs text-zinc-400">Isi HR maks di tab Profil untuk target HR lomba (90–95% HR maks).</p>
              )}
              <ul className="mt-1.5 space-y-1 text-xs text-zinc-300">
                <li>{outlook.splits.km1}</li>
                <li>{outlook.splits.middle}</li>
                <li>{outlook.splits.finish}</li>
              </ul>
            </div>

            <div>
              <div className="text-xs font-semibold text-zinc-400">Estimasi pace & finis {targetDistance}</div>
              {outlook.projection ? (
                <dl className="mt-1.5 space-y-2 text-xs tabular-nums">
                  <div>
                    <dt className="text-zinc-400">Saat ini</dt>
                    <dd className="font-mono text-sm font-bold text-zinc-100">
                      {paceRange(outlook.projection.paceNow)} · {timeRange(outlook.projection.timeNow)}
                    </dd>
                  </div>
                  {outlook.projection.raceDay ? (
                    <div>
                      <dt className="text-zinc-400">
                        Proyeksi hari lomba (−{outlook.projection.raceDay.gainSecPerKm} dtk/km)
                      </dt>
                      <dd className="font-mono text-sm font-bold text-[#BEF264]">
                        {paceRange(outlook.projection.raceDay.pace)} · {timeRange(outlook.projection.raceDay.time)}
                      </dd>
                    </div>
                  ) : (
                    <div className="text-zinc-400">Proyeksi hari lomba tampil bila tersisa ≥ 4 minggu.</div>
                  )}
                </dl>
              ) : (
                <p className="mt-1 text-xs text-zinc-400">
                  Butuh minimal 1 catatan MAF ≥ 3 km di zona MAF untuk memperkirakan pace finis.
                </p>
              )}
            </div>
          </div>
          <p className="mt-3 text-[11px] text-zinc-500">
            Perkiraan kasar dari pace aerobik MAF (1,5–2,5 mnt/km lebih cepat), bukan prediksi pasti.
          </p>
        </div>
      )}

      <details className="group mt-3 rounded-2xl border border-white/[0.08] bg-[#18181D]/70">
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between px-3.5 text-xs font-semibold text-zinc-300">
          <span>Apa itu metode MAF?</span>
          <span className="text-zinc-500 group-open:hidden">Buka</span>
          <span className="hidden text-zinc-500 group-open:inline">Tutup</span>
        </summary>
        <div className="space-y-2 border-t border-white/[0.06] px-3.5 py-3 text-sm text-zinc-300">
          <p>
            <strong>MAF</strong> (Maximum Aerobic Function, metode Phil Maffetone): membangun mesin aerobik dengan berlatih di bawah batas detak jantung tertentu, yaitu 180 dikurangi usia (165 untuk usia 16 ke bawah), disesuaikan dengan kondisi Anda.
          </p>
          <p>
            Pace mengikuti detak jantung. Awalnya pace bisa sangat pelan, bahkan perlu jalan. Itu normal; ukuran kemajuannya adalah pace yang makin cepat <em>pada detak jantung yang sama</em>.
          </p>
          <p>
            <strong>MAF Test</strong> (minggu 4 dan 8): lari 5 km di detak jantung MAF, catat waktu tiap km. Bandingkan antar-tes.
          </p>
          <p className="text-xs text-zinc-400">
            MAF paling efektif sebagai fondasi 3–6 bulan. Untuk target PB dalam waktu lebih singkat, hasil lomba bisa belum maksimal. Ini panduan umum, bukan nasihat medis; bila ada penyakit jantung atau keluhan, konsultasikan dengan dokter.
          </p>
        </div>
      </details>
    </section>
  );
}
