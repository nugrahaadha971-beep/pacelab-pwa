import { useState, type FormEvent } from 'react';
import { X } from 'lucide-react';
import { db } from '../db/database';
import type { RaceDistance, UserProfile } from '../analytics/types';
import { PENALTY_RULES, RACE_KM } from '../analytics/predictor';
import { parseDuration } from '../parsers/manual';
import { fmtPace } from '../plans/pace';
import { isoFromRaceTs, isValidIso } from '../plans/schedule';
import { fmtHms } from './format';
import { useDialog } from './useDialog';
import { Button, Field, PrimaryButton } from './ui';

const TARGET_DISTANCES: ReadonlyArray<{ id: RaceDistance; label: string; sub: string }> = [
  { id: '5K', label: '5K', sub: '5 km' },
  { id: '10K', label: '10K', sub: '10 km' },
  { id: '21.1K', label: 'Half Marathon', sub: '21,1 km' },
  { id: '42.2K', label: 'Marathon', sub: '42,2 km' },
];

interface TargetRaceModalProps {
  profile: UserProfile;
  onClose: () => void;
  onSaved?: () => void | Promise<void>;
}

export default function TargetRaceModal({ profile, onClose, onSaved }: TargetRaceModalProps) {
  const ref = useDialog<HTMLDivElement>(onClose);
  const [distance, setDistance] = useState<RaceDistance>(profile.targetDistance);
  const [raceDateIso, setRaceDateIso] = useState(() =>
    profile.targetRaceDate > 0 ? isoFromRaceTs(profile.targetRaceDate) : '',
  );
  const [targetTimeText, setTargetTimeText] = useState(() => fmtHms(profile.targetTimeSec));
  const [weeklyKmText, setWeeklyKmText] = useState(() =>
    profile.weeklyTargetKm != null ? String(profile.weeklyTargetKm) : '',
  );
  const [errs, setErrs] = useState<{ raceDate?: string; targetTime?: string; weeklyTargetKm?: string }>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const parsedTargetSec = parseDuration(targetTimeText);
  const targetPacePreview =
    parsedTargetSec != null && parsedTargetSec > 0
      ? `Pace target: ${fmtPace(parsedTargetSec / RACE_KM[distance])} /km`
      : 'Format jam:menit:detik atau menit:detik, contoh 00:50:00';

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const trimmedDate = raceDateIso.trim();
    const trimmedWeekly = weeklyKmText.trim().replace(',', '.');
    const weekly = trimmedWeekly === '' ? undefined : Number(trimmedWeekly);

    const nextErrs: { raceDate?: string; targetTime?: string; weeklyTargetKm?: string } = {};
    if (trimmedDate !== '' && !isValidIso(trimmedDate)) {
      nextErrs.raceDate = 'Tanggal lomba tidak valid.';
    }
    if (parsedTargetSec == null || parsedTargetSec <= 0) {
      nextErrs.targetTime = 'Isi dengan format jam:menit:detik, contoh 00:50:00.';
    }
    if (weekly !== undefined && (!Number.isFinite(weekly) || weekly <= 0)) {
      nextErrs.weeklyTargetKm = 'Isi angka lebih dari 0, atau kosongkan.';
    }

    setErrs(nextErrs);
    setSaveError(null);
    if (Object.keys(nextErrs).length > 0 || parsedTargetSec == null) return;

    setSaving(true);
    try {
      await db.userProfile.put({
        ...profile,
        targetDistance: distance,
        targetRaceDate: trimmedDate ? Date.parse(trimmedDate) || 0 : 0,
        targetTimeSec: parsedTargetSec,
        weeklyTargetKm: weekly,
      });
      await onSaved?.();
      onClose();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Gagal menyimpan target lomba.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/75 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby="target-race-modal-title"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md max-h-[90dvh] overflow-y-auto rounded-t-3xl border border-white/10 bg-[#121215] px-5 pt-3 shadow-2xl sm:rounded-3xl sm:pt-5"
        style={{ paddingBottom: 'calc(1.25rem + env(safe-area-inset-bottom))' }}
      >
        <div aria-hidden className="mx-auto mb-3 h-1 w-9 rounded-full bg-[#27272E] sm:hidden" />
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h2 id="target-race-modal-title" className="font-display text-base font-bold text-white">
              Atur Target Lomba
            </h2>
            <p className="mt-0.5 text-xs text-zinc-400">
              Langsung memperbarui jadwal, target mingguan, dan analisa D-Day.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Tutup pengatur target lomba"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-zinc-400 hover:bg-white/[0.06] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#BEF264]"
          >
            <X size={20} aria-hidden />
          </button>
        </div>

        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4" noValidate>
          <div>
            <span className="text-sm font-semibold text-zinc-200">Jarak Lomba</span>
            <div className="mt-1.5 grid grid-cols-2 gap-2" role="group" aria-label="Pilih jarak lomba">
              {TARGET_DISTANCES.map((d) => {
                const active = distance === d.id;
                return (
                  <button
                    key={d.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setDistance(d.id)}
                    className={`flex min-h-[44px] flex-col items-start justify-center rounded-2xl border px-3.5 py-2 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#BEF264] ${
                      active
                        ? 'border-[#BEF264] bg-[#BEF264]/15 text-white'
                        : 'border-white/10 bg-[#18181D] text-zinc-300 hover:border-white/20 hover:text-white'
                    }`}
                  >
                    <span className={`font-display text-xs font-bold ${active ? 'text-[#BEF264]' : 'text-zinc-100'}`}>
                      {d.label}
                    </span>
                    <span className="font-mono text-[11px] tabular-nums text-zinc-400">{d.sub}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <Field
            label="Tanggal Lomba"
            type="date"
            value={raceDateIso}
            onChange={(e) => setRaceDateIso(e.target.value)}
            hint="Opsional — kosongkan jika belum memilih tanggal"
            error={errs.raceDate}
          />

          <Field
            label="Target Waktu Finis"
            value={targetTimeText}
            onChange={(e) => setTargetTimeText(e.target.value)}
            placeholder="00:50:00"
            hint={targetPacePreview}
            error={errs.targetTime}
          />

          <Field
            label="Target Volume Mingguan"
            term="km/minggu"
            inputMode="decimal"
            value={weeklyKmText}
            onChange={(e) => setWeeklyKmText(e.target.value)}
            placeholder={String(PENALTY_RULES[distance]?.weeklyKm ?? 30)}
            hint={`Opsional — bawaan ${PENALTY_RULES[distance]?.weeklyKm ?? 30} km/minggu untuk ${distance}`}
            error={errs.weeklyTargetKm}
          />

          {saveError && (
            <p role="alert" className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-400">
              {saveError}
            </p>
          )}

          <div className="flex items-center gap-2.5 pt-1">
            <Button variant="secondary" block={false} onClick={onClose} className="flex-1">
              Batal
            </Button>
            <PrimaryButton type="submit" block={false} disabled={saving} className="flex-[1.5]">
              {saving ? 'Menyimpan…' : 'Simpan Target'}
            </PrimaryButton>
          </div>
        </form>
      </div>
    </div>
  );
}
