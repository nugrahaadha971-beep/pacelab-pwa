// Evaluasi analisis per sesi latihan (MAF, Progresif 5K, Nike 5K, maupun sesi mandiri).
// Murni (tanpa UI/DOM) agar dapat diuji langsung dengan node:test.
import type { UserProfile, Workout } from './types.ts';
import { cardiacDrift, DAY_MS, efficiencyFactor, sessionTrimp } from './workload.ts';
import { hrRange, resolveMaxHr } from '../plans/hrZones.ts';
import type { Zone } from '../plans/hrZones.ts';
import { mafHr } from '../plans/maf.ts';
import type { MafAdjustment } from '../plans/maf.ts';
import { isoFromLocal } from '../plans/schedule.ts';
import type { CurriculumId, PlanSession } from '../plans/schedule.ts';

export type SessionVerdictStatus = 'optimal' | 'caution' | 'off_target' | 'incomplete';
export type SessionCheckTone = 'good' | 'warn' | 'bad' | 'info' | 'neutral';
export type EvaluatedZone = Zone | 'tempo';

export interface SessionCheck {
  key: 'hr' | 'drift' | 'pacing' | 'schedule_ef';
  tone: SessionCheckTone;
  title: string;
  detail: string;
}

export interface SessionAnalysisContext {
  profile: UserProfile;
  curriculum: CurriculumId;
  mafAdjustment?: MafAdjustment;
  easyPaceSecPerKm?: number | null;
  mafPaceSecPerKm?: number | null;
  targetRacePaceSecPerKm?: number | null;
  baselineEf?: number | null;
  plannedSessions?: readonly PlanSession[];
}

export interface SessionMetricsSnapshot {
  avgHr: number | null;
  maxHr: number | null;
  peakHr: number | null;
  hrInZonePct: number | null;
  driftPct: number | null;
  ef: number | null;
  efDiffPct: number | null;
  trimp: number;
  firstHalfPaceSec: number | null;
  secondHalfPaceSec: number | null;
  splitDeltaSec: number | null; // positif = paruh kedua melambat, negatif = negative split
  plannedMin: number | null;
  actualMin: number;
}

export interface SessionAnalysis {
  workout: Workout;
  matchedPlan: PlanSession | null;
  targetZone: EvaluatedZone;
  targetZoneLabel: string;
  targetHrRange: [number, number] | null;
  isHrPrimary: boolean;
  status: SessionVerdictStatus;
  verdictLabel: string;
  summary: string;
  nextAction: string;
  checks: SessionCheck[];
  metrics: SessionMetricsSnapshot;
}

export interface PeriodComplianceSummary {
  total: number;
  evaluated: number;
  optimal: number;
  caution: number;
  offTarget: number;
  incomplete: number;
  compliancePct: number | null;
  avgMafHr: number | null;
  avgDriftPct: number | null;
}

const ZONE_DISPLAY: Record<EvaluatedZone, string> = {
  maf: 'Zona MAF (180 − usia; 165 untuk usia ≤ 16)',
  easy: 'Zona Mudah (71–82% HR maks)',
  tempo: 'Zona Tempo / Threshold (83–90% HR maks)',
  interval: 'Zona Interval (90–96% HR maks)',
  race: 'Zona Lomba (90–95% HR maks)',
  test: 'Zona Tes (88–95% HR maks)',
};

const dec1 = (x: number) => x.toFixed(1).replace('.', ',');
const dec2 = (x: number) => x.toFixed(2).replace('.', ',');
const fmtMmSs = (sec: number) => {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

type HrCompliance = 'in_zone' | 'spike' | 'over' | 'under' | 'missing' | 'no_target';

function resolveZoneAndHr(
  workout: Workout,
  ctx: SessionAnalysisContext,
  matchedPlan: PlanSession | null,
  maxHr: number | null,
  mafTarget: number | null,
): { zone: EvaluatedZone; range: [number, number] | null; isHrPrimary: boolean } {
  if (matchedPlan?.zone) {
    const z = matchedPlan.zone;
    const range = matchedPlan.hr ?? hrRange(z, maxHr, mafTarget);
    return { zone: z, range, isHrPrimary: z === 'maf' || ctx.curriculum === 'progressive5k' };
  }

  if (ctx.curriculum === 'maf') {
    if (workout.workoutType === 'race') {
      return { zone: 'race', range: hrRange('race', maxHr, mafTarget), isHrPrimary: false };
    }
    return { zone: 'maf', range: hrRange('maf', maxHr, mafTarget), isHrPrimary: true };
  }

  if (workout.workoutType === 'easy' || workout.workoutType === 'long_run') {
    return { zone: 'easy', range: hrRange('easy', maxHr, mafTarget), isHrPrimary: ctx.curriculum === 'progressive5k' };
  }
  if (workout.workoutType === 'tempo') {
    const range: [number, number] | null =
      maxHr && maxHr > 0 ? [Math.ceil(0.83 * maxHr - 1e-9), Math.ceil(0.9 * maxHr - 1e-9)] : null;
    return { zone: 'tempo', range, isHrPrimary: false };
  }
  if (workout.workoutType === 'interval') {
    return { zone: 'interval', range: hrRange('interval', maxHr, mafTarget), isHrPrimary: false };
  }
  return { zone: 'race', range: hrRange('race', maxHr, mafTarget), isHrPrimary: false };
}

function matchPlanForWorkout(workout: Workout, plannedSessions?: readonly PlanSession[]): PlanSession | null {
  if (!plannedSessions || plannedSessions.length === 0) return null;
  const wIso = isoFromLocal(workout.date);
  const sameDay = plannedSessions.filter((s) => s.date === wIso);
  if (sameDay.length === 0) return null;
  if (sameDay.length === 1) return sameDay[0];
  // Jika ada >1 sesi di hari sama, cocokkan jenis sesi terdekat
  const wantKind =
    workout.workoutType === 'race' ? 'race'
    : workout.workoutType === 'long_run' ? 'long'
    : workout.workoutType === 'tempo' || workout.workoutType === 'interval' ? 'speed'
    : 'recovery';
  return sameDay.find((s) => s.kind === wantKind) ?? sameDay[0];
}

/** Analisis mendalam untuk satu sesi latihan terhadap kurikulum & zona targetnya. */
export function analyzeWorkoutSession(workout: Workout, ctx: SessionAnalysisContext): SessionAnalysis {
  const maxHr = resolveMaxHr(ctx.profile, [workout]);
  const mafTarget = mafHr(ctx.profile.age, ctx.mafAdjustment ?? 0);
  const matchedPlan = matchPlanForWorkout(workout, ctx.plannedSessions);
  const { zone, range, isHrPrimary } = resolveZoneAndHr(workout, ctx, matchedPlan, maxHr, mafTarget);

  const checks: SessionCheck[] = [];
  const hrLaps = workout.laps.filter((l): l is { km: number; paceSec: number; avgHr: number } => l.avgHr != null && l.avgHr > 0);
  const peakLapHr = hrLaps.length > 0 ? Math.max(...hrLaps.map((l) => l.avgHr)) : null;
  const peakHr = Math.max(workout.maxHr ?? 0, peakLapHr ?? 0) || null;

  let hrCompliance: HrCompliance = 'missing';
  let hrInZonePct: number | null = null;

  // 1. Evaluasi Detak Jantung
  if (workout.avgHr == null || workout.avgHr <= 0) {
    hrCompliance = 'missing';
    checks.push({
      key: 'hr',
      tone: 'info',
      title: 'Detak jantung tidak tercatat',
      detail: 'Gunakan sensor HR / impor file FIT agar kepatuhan zona detak jantung bisa dievaluasi.',
    });
  } else if (!range) {
    hrCompliance = 'no_target';
    checks.push({
      key: 'hr',
      tone: 'info',
      title: `HR rata-rata ${Math.round(workout.avgHr)} bpm`,
      detail: zone === 'maf'
        ? 'Isi usia di tab Profil untuk menghitung batas zona MAF (180 − usia; 165 untuk usia ≤ 16).'
        : 'Isi detak jantung maksimal di tab Profil untuk menampilkan rentang zona target.',
    });
  } else {
    const [lo, hi] = range;
    const avg = Math.round(workout.avgHr);
    if (hrLaps.length > 0) {
      const inBand = hrLaps.filter((l) => l.avgHr >= lo - 2 && l.avgHr <= hi).length;
      hrInZonePct = Math.round((inBand / hrLaps.length) * 100);
    }

    const isCeilingZone = zone === 'maf' || zone === 'easy';
    if (isCeilingZone) {
      const lapsOver = hrLaps.filter((l) => l.avgHr > hi).length;
      if (avg > hi) {
        hrCompliance = 'over';
        const overBy = avg - hi;
        checks.push({
          key: 'hr',
          tone: 'bad',
          title: zone === 'maf' ? 'HR rata-rata melewati batas MAF' : 'HR terlalu tinggi untuk lari santai',
          detail: zone === 'maf'
            ? `HR rata-rata ${avg} bpm (+${overBy} bpm di atas batas atas MAF ${hi} bpm). Sesi keluar dari zona aerobik murni — turunkan pace atau selingi jalan kaki saat HR menyentuh ${hi} bpm.`
            : `HR rata-rata ${avg} bpm (+${overBy} bpm di atas batas zona mudah ${hi} bpm). Lari santai terlalu cepat menghambat pemulihan.`,
        });
      } else if (avg < lo - 3) {
        hrCompliance = 'under';
        const underBy = lo - avg;
        checks.push({
          key: 'hr',
          tone: zone === 'maf' ? 'warn' : 'good',
          title: zone === 'maf' ? 'HR di bawah rentang optimal MAF' : 'HR sangat ringan (pemulihan aktif)',
          detail: zone === 'maf'
            ? `HR rata-rata ${avg} bpm (${underBy} bpm di bawah rentang ${lo}–${hi} bpm). Aman untuk pemulihan, namun naikkan sedikit ritme jika ini sesi latihan MAF utama.`
            : `HR rata-rata ${avg} bpm (di bawah ${lo}–${hi} bpm). Sangat baik untuk pemulihan otot tanpa menambah kelelahan.`,
        });
      } else if ((peakHr != null && peakHr > hi + 4) || lapsOver >= 2) {
        hrCompliance = 'spike';
        checks.push({
          key: 'hr',
          tone: 'warn',
          title: 'HR rata-rata masuk zona, namun sempat melonjak',
          detail: `HR rata-rata ${avg} bpm berada di rentang ${lo}–${hi} bpm, tetapi sempat menyentuh ${peakHr ?? hi} bpm${lapsOver > 0 ? ` (${lapsOver}/${hrLaps.length} km melewati ${hi} bpm)` : ''}. Jeda jalan lebih awal di tanjakan atau cuaca panas.`,
        });
      } else {
        hrCompliance = 'in_zone';
        checks.push({
          key: 'hr',
          tone: 'good',
          title: zone === 'maf' ? 'Disiplin zona MAF terjaga' : 'Detak jantung tepat di zona mudah',
          detail: `HR rata-rata ${avg} bpm berada tepat di rentang ${lo}–${hi} bpm${hrLaps.length > 0 ? ` (${hrInZonePct}% lap masuk zona)` : ''}.`,
        });
      }
    } else {
      // Zona intensitas tinggi: interval mengecek HR puncak (karena jeda pemulihan menurunkan rata-rata); tempo/race/test mengecek HR rata-rata
      const refHr = zone === 'interval' ? (peakHr ?? avg) : avg;
      const metricName = zone === 'interval' ? 'puncak' : 'rata-rata';
      if (refHr >= lo - 3 && refHr <= hi + 3) {
        hrCompliance = 'in_zone';
        checks.push({
          key: 'hr',
          tone: 'good',
          title: 'Stimulus intensitas tercapai',
          detail: `HR ${metricName} ${Math.round(refHr)} bpm sesuai target ${lo}–${hi} bpm${peakHr && zone !== 'interval' ? ` (puncak ${peakHr} bpm)` : ''}.`,
        });
      } else if (refHr < lo - 3) {
        hrCompliance = 'under';
        checks.push({
          key: 'hr',
          tone: 'bad',
          title: 'Intensitas HR di bawah target sesi',
          detail: `HR ${metricName} ${Math.round(refHr)} bpm masih di bawah target ${lo}–${hi} bpm. Usaha pada bagian inti perlu ditingkatkan agar adaptasi kecepatan tercapai.`,
        });
      } else {
        hrCompliance = 'over';
        checks.push({
          key: 'hr',
          tone: 'warn',
          title: 'HR melebihi batas atas zona',
          detail: `HR ${metricName} ${Math.round(refHr)} bpm melewati batas ${hi} bpm. Jaga usaha tetap terkendali agar tidak cepat kehabisan tenaga.`,
        });
      }
    }
  }

  // 2. Evaluasi Stabilitas Aerobik (Cardiac Drift)
  const driftPct = cardiacDrift(workout.laps);
  const isAerobic = zone === 'maf' || zone === 'easy';
  if (driftPct == null) {
    checks.push({
      key: 'drift',
      tone: 'neutral',
      title: 'Cardiac drift belum tersedia',
      detail: 'Memerlukan minimal 4 lap dengan data detak jantung (impor file FIT/GPX).',
    });
  } else if (driftPct <= 3) {
    checks.push({
      key: 'drift',
      tone: 'good',
      title: 'Stabilitas aerobik sangat baik',
      detail: `Cardiac drift ${dec1(driftPct)}% (≤ 3%): detak jantung stabil dari awal hingga akhir tanpa tanda kelelahan aerobik.`,
    });
  } else if (driftPct <= 5) {
    checks.push({
      key: 'drift',
      tone: 'good',
      title: 'Cardiac drift dalam batas aman',
      detail: `Cardiac drift ${dec1(driftPct)}% (≤ 5%): ketahanan aerobik terjaga baik pada durasi ini.`,
    });
  } else {
    checks.push({
      key: 'drift',
      tone: isAerobic ? 'warn' : 'info',
      title: isAerobic ? 'Cardiac drift tinggi (> 5%)' : `Cardiac drift ${dec1(driftPct)}%`,
      detail: isAerobic
        ? `Cardiac drift ${dec1(driftPct)}%: HR terus merangkak naik di paruh kedua pada pace yang sama. Perhatikan hidrasi, panas cuaca, atau kurangi durasi/pace.`
        : `Pergeseran HR ${dec1(driftPct)}% wajar pada sesi intensitas tinggi, namun tetap jaga hidrasi dan kontrol pace awal.`,
    });
  }

  // 3. Evaluasi Konsistensi Pace & Split antar Lap
  const validLaps = workout.laps.filter((l) => l.paceSec > 0 && Number.isFinite(l.paceSec));
  let firstHalfPaceSec: number | null = null;
  let secondHalfPaceSec: number | null = null;
  let splitDeltaSec: number | null = null;
  let paceTooFastWithoutHr = false;

  if (validLaps.length >= 2) {
    const mid = Math.floor(validLaps.length / 2);
    const first = validLaps.slice(0, mid);
    const second = validLaps.slice(mid);
    firstHalfPaceSec = first.reduce((s, l) => s + l.paceSec, 0) / first.length;
    secondHalfPaceSec = second.reduce((s, l) => s + l.paceSec, 0) / second.length;
    splitDeltaSec = secondHalfPaceSec - firstHalfPaceSec;

    if (isAerobic) {
      if (splitDeltaSec > 15) {
        const controlled = hrCompliance === 'in_zone' || hrCompliance === 'under';
        checks.push({
          key: 'pacing',
          tone: controlled ? 'good' : 'warn',
          title: controlled ? 'Pace melambat demi menjaga HR' : 'Pace melambat di paruh akhir',
          detail: controlled
            ? `Paruh kedua melambat +${Math.round(splitDeltaSec)} dtk/km (${fmtMmSs(firstHalfPaceSec)} → ${fmtMmSs(secondHalfPaceSec)} /km) untuk menahan HR tetap di zona target — keputusan tepat.`
            : `Paruh kedua melambat +${Math.round(splitDeltaSec)} dtk/km (${fmtMmSs(firstHalfPaceSec)} → ${fmtMmSs(secondHalfPaceSec)} /km) disertai HR tinggi. Mulai sesi lebih pelan.`,
        });
      } else if (splitDeltaSec < -15) {
        const overshot = hrCompliance === 'over' || hrCompliance === 'spike';
        checks.push({
          key: 'pacing',
          tone: overshot ? 'warn' : 'good',
          title: overshot ? 'Pace terlalu cepat di paruh kedua' : 'Negative split dengan HR terkendali',
          detail: overshot
            ? `Paruh kedua lebih cepat ${Math.abs(Math.round(splitDeltaSec))} dtk/km hingga HR melewati batas zona. Tahan ritme tetap santai sampai akhir.`
            : `Paruh kedua lebih cepat ${Math.abs(Math.round(splitDeltaSec))} dtk/km (${fmtMmSs(firstHalfPaceSec)} → ${fmtMmSs(secondHalfPaceSec)} /km) tanpa melanggar batas HR.`,
        });
      } else {
        checks.push({
          key: 'pacing',
          tone: 'good',
          title: 'Pacing antar-kilometer stabil',
          detail: `Selisih pace paruh pertama dan kedua hanya ${Math.abs(Math.round(splitDeltaSec))} dtk/km (${fmtMmSs(firstHalfPaceSec)} vs ${fmtMmSs(secondHalfPaceSec)} /km).`,
        });
      }
    } else {
      if (splitDeltaSec <= 5) {
        checks.push({
          key: 'pacing',
          tone: 'good',
          title: splitDeltaSec < -5 ? 'Negative split terkendali' : 'Even split konsisten',
          detail: `Paruh kedua ${fmtMmSs(secondHalfPaceSec)} /km dibanding paruh awal ${fmtMmSs(firstHalfPaceSec)} /km.`,
        });
      } else if (splitDeltaSec <= 15) {
        checks.push({
          key: 'pacing',
          tone: 'info',
          title: 'Sedikit melambat di paruh akhir',
          detail: `Paruh kedua melambat +${Math.round(splitDeltaSec)} dtk/km (${fmtMmSs(firstHalfPaceSec)} → ${fmtMmSs(secondHalfPaceSec)} /km).`,
        });
      } else {
        checks.push({
          key: 'pacing',
          tone: 'warn',
          title: 'Positive split cukup besar',
          detail: `Paruh kedua melambat +${Math.round(splitDeltaSec)} dtk/km (${fmtMmSs(firstHalfPaceSec)} → ${fmtMmSs(secondHalfPaceSec)} /km). Mulai kilometer awal lebih terkontrol.`,
        });
      }
    }
  } else if (zone === 'easy' && ctx.easyPaceSecPerKm != null && workout.avgPaceSecPerKm > 0 && (workout.avgHr == null || workout.avgHr <= 0)) {
    const fasterBy = ctx.easyPaceSecPerKm - workout.avgPaceSecPerKm;
    if (fasterBy > 20) {
      paceTooFastWithoutHr = true;
      checks.push({
        key: 'pacing',
        tone: 'warn',
        title: 'Pace lebih cepat dari patokan santai',
        detail: `Pace ${fmtMmSs(workout.avgPaceSecPerKm)} /km lebih cepat ${Math.round(fasterBy)} dtk/km dari patokan santai (${fmtMmSs(ctx.easyPaceSecPerKm)} /km).`,
      });
    } else {
      checks.push({
        key: 'pacing',
        tone: 'good',
        title: 'Pace sesuai patokan santai',
        detail: `Pace ${fmtMmSs(workout.avgPaceSecPerKm)} /km berada pada kisaran santai (${fmtMmSs(ctx.easyPaceSecPerKm)} /km).`,
      });
    }
  }

  // 4. Kesesuaian Jadwal Program & Efisiensi Aerobik (EF)
  const actualMin = workout.durationSec / 60;
  const plannedMin = matchedPlan ? (matchedPlan.adjDurationMin ?? matchedPlan.durationMin ?? null) : null;
  let scheduleOverDuration = false;

  if (matchedPlan && plannedMin != null && plannedMin > 0) {
    const ratio = actualMin / plannedMin;
    if (ratio >= 0.85 && ratio <= 1.2) {
      checks.push({
        key: 'schedule_ef',
        tone: 'good',
        title: 'Durasi sesuai jadwal program',
        detail: `Durasi aktual ${Math.round(actualMin)} menit sesuai rencana "${matchedPlan.name}" (${Math.round(plannedMin)} menit).`,
      });
    } else if (ratio < 0.85) {
      checks.push({
        key: 'schedule_ef',
        tone: 'info',
        title: 'Durasi lebih singkat dari jadwal',
        detail: `Tercatat ${Math.round(actualMin)} menit dari target ${Math.round(plannedMin)} menit ("${matchedPlan.name}"). Tidak masalah jika dihentikan demi menjaga pemulihan.`,
      });
    } else {
      scheduleOverDuration = true;
      checks.push({
        key: 'schedule_ef',
        tone: 'warn',
        title: 'Durasi melebihi jadwal program',
        detail: `Tercatat ${Math.round(actualMin)} menit vs jadwal ${Math.round(plannedMin)} menit ("${matchedPlan.name}"). Hindari lonjakan durasi mendadak agar risiko cedera tetap rendah.`,
      });
    }
  }

  const ef = workout.efficiencyFactor ?? efficiencyFactor(workout);
  const efDiffPct =
    ef != null && ctx.baselineEf != null && ctx.baselineEf > 0
      ? ((ef - ctx.baselineEf) / ctx.baselineEf) * 100
      : null;
  if (ef != null && efDiffPct != null) {
    checks.push({
      key: 'schedule_ef',
      tone: efDiffPct >= 2 ? 'good' : efDiffPct <= -4 ? 'warn' : 'neutral',
      title: `Efisiensi aerobik (EF) ${dec2(ef)}`,
      detail: `${efDiffPct >= 0 ? '+' : ''}${dec1(efDiffPct)}% dibanding rata-rata 28 hari Anda (${dec2(ctx.baselineEf as number)}).`,
    });
  }

  // 5. Keputusan Akhir (Verdict)
  let status: SessionVerdictStatus;
  let verdictLabel: string;
  let summary: string;
  let nextAction: string;

  const avgHrRounded = workout.avgHr != null ? Math.round(workout.avgHr) : null;
  const hiBpm = range ? range[1] : null;
  const loBpm = range ? range[0] : null;

  if (hrCompliance === 'over' || (!isAerobic && hrCompliance === 'under')) {
    status = 'off_target';
    verdictLabel = 'Belum sesuai zona target';
    if (zone === 'maf' && avgHrRounded != null && hiBpm != null) {
      summary = `Belum sesuai target MAF: detak jantung rata-rata ${avgHrRounded} bpm melewati batas atas ${hiBpm} bpm (+${avgHrRounded - hiBpm} bpm), sehingga sesi keluar dari zona aerobik murni.`;
      nextAction = `Pada sesi berikutnya, perlambat pace awal dan langsung jeda jalan kaki 30–60 detik setiap kali HR menyentuh ${hiBpm} bpm.`;
    } else if (zone === 'easy' && avgHrRounded != null && hiBpm != null) {
      summary = `Belum sesuai target Easy Run: detak jantung rata-rata ${avgHrRounded} bpm melewati batas zona mudah (${hiBpm} bpm), sehingga membebani pemulihan.`;
      nextAction = `Turunkan pace 15–30 dtk/km pada sesi santai berikutnya hingga napas terasa ringan dan HR tetap ≤ ${hiBpm} bpm.`;
    } else {
      summary = `Intensitas detak jantung (${avgHrRounded ?? '–'} bpm) belum berada pada zona target ${loBpm}–${hiBpm} bpm untuk sesi ${ZONE_DISPLAY[zone]}.`;
      nextAction = `Sesuaikan usaha pada bagian inti agar HR berada di rentang ${loBpm}–${hiBpm} bpm tanpa memaksakan di luar porsi.`;
    }
  } else if (
    hrCompliance === 'spike' ||
    (zone === 'maf' && hrCompliance === 'under') ||
    (isAerobic && driftPct != null && driftPct > 5) ||
    scheduleOverDuration ||
    paceTooFastWithoutHr
  ) {
    status = 'caution';
    verdictLabel = 'Sudah baik, perlu penyesuaian';
    if (hrCompliance === 'spike' && avgHrRounded != null && hiBpm != null) {
      summary = `Sebagian besar sudah benar (HR rata-rata ${avgHrRounded} bpm masuk zona ${loBpm}–${hiBpm} bpm), tetapi HR sempat melonjak ke ${peakHr ?? hiBpm} bpm di atas batas.`;
      nextAction = `Mulai pemanasan 10–15 menit lebih pelan dan kurangi kecepatan lebih awal saat menemui tanjakan atau cuaca panas.`;
    } else if (isAerobic && driftPct != null && driftPct > 5) {
      summary = `Zona detak jantung sudah terjaga (${avgHrRounded ?? '–'} bpm), namun cardiac drift ${dec1(driftPct)}% (> 5%) menandakan kelelahan atau dehidrasi di paruh akhir.`;
      nextAction = `Cukupi hidrasi sebelum lari dan jaga durasi/pace tetap stabil agar cardiac drift kembali ≤ 5%.`;
    } else if (zone === 'maf' && hrCompliance === 'under' && avgHrRounded != null && loBpm != null) {
      summary = `Detak jantung aman di bawah batas MAF (${avgHrRounded} bpm), tetapi sedikit di bawah rentang optimal ${loBpm}–${hiBpm} bpm.`;
      nextAction = `Naikkan ritme perlahan pada sesi MAF berikutnya agar HR berada di ${loBpm}–${hiBpm} bpm tanpa melewati ${hiBpm} bpm.`;
    } else if (paceTooFastWithoutHr) {
      summary = `Pace sesi ini lebih cepat dari rentang santai yang dianjurkan, sehingga berisiko mengubah sesi aerobik menjadi tempo ringan.`;
      nextAction = `Gunakan sensor HR atau tahan pace lebih santai agar tujuan pemulihan dan fondasi aerobik tetap tercapai.`;
    } else {
      summary = `Zona detak jantung sudah sesuai target, namun durasi aktual melebihi jadwal program yang direncanakan.`;
      nextAction = `Ikuti durasi pada jadwal program secara bertahap agar beban mingguan tetap terkendali.`;
    }
  } else if (hrCompliance === 'in_zone' || (zone === 'easy' && hrCompliance === 'under')) {
    status = 'optimal';
    verdictLabel = 'Sudah sesuai target';
    if (zone === 'maf' && avgHrRounded != null && loBpm != null && hiBpm != null) {
      summary = `Sesi latihan MAF Anda sudah benar: detak jantung rata-rata ${avgHrRounded} bpm terjaga disiplin di zona ${loBpm}–${hiBpm} bpm${driftPct != null ? ` dengan cardiac drift stabil (${dec1(driftPct)}%)` : ''}.`;
      nextAction = `Pertahankan disiplin detak jantung ini — peningkatan pace pada HR ${loBpm}–${hiBpm} bpm akan terlihat bertahap dalam 3–6 minggu.`;
    } else if (zone === 'easy') {
      summary = `Sesi lari santai Anda sudah benar: detak jantung rata-rata ${avgHrRounded} bpm menjaga beban tetap aerobik dan mendukung pemulihan.`;
      nextAction = `Pertahankan ritme nyaman ini pada sesi Easy/Long Run berikutnya sebelum menghadapi sesi kecepatan.`;
    } else {
      summary = `Sesi kualitas Anda sudah sesuai target: stimulus detak jantung tercapai di rentang ${loBpm}–${hiBpm} bpm dengan kontrol usaha yang baik.`;
      nextAction = `Pastikan sesi berikutnya diisi lari santai atau istirahat agar adaptasi kebugaran terserap optimal.`;
    }
  } else {
    status = 'incomplete';
    verdictLabel = 'Data HR belum lengkap';
    summary = `Sesi ${workout.distanceKm.toFixed(2)} km (${fmtMmSs(workout.durationSec)}) tercatat, namun kepatuhan zona detak jantung belum dapat dipastikan.`;
    nextAction = `Hubungkan monitor detak jantung atau impor file FIT/GPX serta lengkapi usia & HR maks di Profil untuk evaluasi otomatis.`;
  }

  const trimp = workout.trimp ?? sessionTrimp(workout, ctx.profile);

  return {
    workout,
    matchedPlan,
    targetZone: zone,
    targetZoneLabel: ZONE_DISPLAY[zone],
    targetHrRange: range,
    isHrPrimary,
    status,
    verdictLabel,
    summary,
    nextAction,
    checks,
    metrics: {
      avgHr: workout.avgHr,
      maxHr: workout.maxHr,
      peakHr,
      hrInZonePct,
      driftPct,
      ef,
      efDiffPct,
      trimp,
      firstHalfPaceSec,
      secondHalfPaceSec,
      splitDeltaSec,
      plannedMin,
      actualMin,
    },
  };
}

/** Analisis seluruh sesi pada rentang `days` hari terakhir beserta ringkasan kepatuhan periode. */
export function analyzeWorkoutPeriod(
  workouts: Workout[],
  now: number,
  days: number,
  ctx: SessionAnalysisContext,
): { items: SessionAnalysis[]; summary: PeriodComplianceSummary } {
  const cutoff = now - days * DAY_MS;
  // Hitung baseline EF 28 hari bila belum disediakan pemanggil
  const efPool = workouts
    .filter((w) => (w.workoutType === 'easy' || w.workoutType === 'long_run') && w.date <= now && now - w.date <= 28 * DAY_MS)
    .map((w) => w.efficiencyFactor ?? efficiencyFactor(w))
    .filter((v): v is number => v != null && Number.isFinite(v));
  const baselineEf = ctx.baselineEf ?? (efPool.length > 0 ? efPool.reduce((a, b) => a + b, 0) / efPool.length : null);

  const inRange = workouts
    .filter((w) => w.date > cutoff && w.date <= now)
    .sort((a, b) => b.date - a.date);

  const items = inRange.map((w) => analyzeWorkoutSession(w, { ...ctx, baselineEf }));

  let optimal = 0;
  let caution = 0;
  let offTarget = 0;
  let incomplete = 0;
  const mafHrs: number[] = [];
  const drifts: number[] = [];

  for (const it of items) {
    if (it.status === 'optimal') optimal++;
    else if (it.status === 'caution') caution++;
    else if (it.status === 'off_target') offTarget++;
    else incomplete++;

    if (it.targetZone === 'maf' && it.metrics.avgHr != null) mafHrs.push(it.metrics.avgHr);
    if (it.metrics.driftPct != null && Number.isFinite(it.metrics.driftPct)) drifts.push(it.metrics.driftPct);
  }

  const evaluated = items.length - incomplete;
  const compliancePct = evaluated > 0 ? Math.round((optimal / evaluated) * 100) : null;
  const avgMafHr = mafHrs.length > 0 ? mafHrs.reduce((a, b) => a + b, 0) / mafHrs.length : null;
  const avgDriftPct = drifts.length > 0 ? drifts.reduce((a, b) => a + b, 0) / drifts.length : null;

  return {
    items,
    summary: {
      total: items.length,
      evaluated,
      optimal,
      caution,
      offTarget,
      incomplete,
      compliancePct,
      avgMafHr,
      avgDriftPct,
    },
  };
}
