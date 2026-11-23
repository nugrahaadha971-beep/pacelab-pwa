import { useState, type ChangeEvent, type FormEvent } from 'react';
import { clearAll, db, exportBackup, importBackup } from '../db/database';
import { tanakaMaxHr } from '../analytics/workload';
import type { RaceDistance, UserProfile } from '../analytics/types';
import { parseDuration } from '../parsers/manual';
import { fmtHms } from './format';
import ConfirmDialog from './ConfirmDialog';
import { Button, Field, PrimaryButton, ScreenHeader, SelectField } from './ui';

const DISTANCES: RaceDistance[] = ['5K', '10K', '21.1K', '42.2K'];

interface Msg { text: string; ok: boolean }
interface Errs { age?: string; restingHr?: string; maxHr?: string; targetTime?: string; weeklyTargetKm?: string }

function Notice({ msg }: { msg: Msg }) {
  return msg.ok ? (
    <p role="status" className="rounded-xl bg-emerald-400/15 px-3 py-2 text-sm font-semibold text-emerald-300">✓ {msg.text}</p>
  ) : (
    <p role="alert" className="rounded-xl bg-coral/15 px-3 py-2 text-sm text-coral">{msg.text}</p>
  );
}

export default function Profil({ profile, onSaved }: { profile: UserProfile | null; onSaved: () => void }) {
  const [formMsg, setFormMsg] = useState<Msg | null>(null);
  const [backupMsg, setBackupMsg] = useState<Msg | null>(null);
  const [errs, setErrs] = useState<Errs>({});
  const [age, setAge] = useState(profile?.age ?? 0);
  // Otomatis hanya bila profil baru, atau Max HR tersimpan memang sama dengan hasil Tanaka.
  const [auto, setAuto] = useState(() => !profile || profile.maxHr === tanakaMaxHr(profile.age));
  const [maxHrText, setMaxHrText] = useState(String(profile?.maxHr ?? ''));
  const [pendingImport, setPendingImport] = useState<File | null>(null);
  const [askWipe, setAskWipe] = useState(false);

  const save = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const restingHr = Number(f.get('restingHr'));
    const maxHr = auto ? tanakaMaxHr(age) : Number(maxHrText);
    const targetTimeSec = parseDuration(String(f.get('targetTime')));
    const weeklyRaw = String(f.get('weeklyTargetKm') ?? '').trim().replace(',', '.');
    const weekly = weeklyRaw === '' ? undefined : Number(weeklyRaw);

    const next: Errs = {};
    if (!(age > 0)) next.age = 'Isi usia dengan angka lebih dari 0.';
    if (!(restingHr > 30)) next.restingHr = 'Detak jantung istirahat harus lebih dari 30 bpm.';
    if (!(maxHr > restingHr)) next.maxHr = 'Detak jantung maksimal harus lebih tinggi dari detak jantung istirahat.';
    if (targetTimeSec == null) next.targetTime = 'Isi dengan format jam:menit:detik, contoh 00:50:00.';
    if (weekly !== undefined && !(weekly > 0)) next.weeklyTargetKm = 'Isi dengan angka lebih dari 0, atau kosongkan.';
    setErrs(next);
    setFormMsg(null);
    if (Object.keys(next).length > 0 || targetTimeSec == null) return;

    try {
      await db.userProfile.put({
        id: 'default', age, restingHr, maxHr,
        targetDistance: f.get('target') as RaceDistance,
        targetRaceDate: Date.parse(String(f.get('raceDate'))) || 0,
        targetTimeSec,
        weeklyTargetKm: weekly,
      });
    } catch (err) {
      setFormMsg({ text: err instanceof Error ? err.message : 'Gagal menyimpan profil.', ok: false });
      return;
    }
    setFormMsg({ text: 'Profil tersimpan. Zona dan prediksi diperbarui.', ok: true });
    onSaved();
  };

  const exportJson = async () => {
    const url = URL.createObjectURL(new Blob([await exportBackup()], { type: 'application/json' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: `pacelab-${new Date().toISOString().slice(0, 10)}.json` });
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setBackupMsg({ text: 'Cadangan diunduh.', ok: true });
  };

  const pickImport = (e: ChangeEvent<HTMLInputElement>) => {
    const input = e.target;
    const file = input.files?.[0];
    input.value = ''; // agar berkas yang sama bisa dipilih lagi
    if (file) setPendingImport(file);
  };

  const doImport = async () => {
    const file = pendingImport;
    setPendingImport(null);
    if (!file) return;
    try {
      const r = await importBackup(await file.text());
      const parts = [`${r.workouts} sesi dipulihkan`];
      if (r.skipped) parts.push(`${r.skipped} dilewati karena data rusak`);
      if (r.profile) parts.push('profil dipulihkan');
      if (r.schedule) parts.push('jadwal latihan dipulihkan');
      setBackupMsg({ text: parts.join(', ') + '.', ok: true });
      onSaved();
    } catch (err) {
      setBackupMsg({ text: err instanceof Error ? err.message : 'Gagal mengimpor.', ok: false });
    }
  };

  const wipe = async () => {
    setAskWipe(false);
    await clearAll();
    onSaved();
  };

  return (
    <div className="space-y-4">
      <ScreenHeader title={profile ? 'Profil & Pengaturan' : 'Atur profil dulu'} subtitle={profile ? 'Data diri, target lomba, dan cadangan' : undefined} />
      {!profile && <p className="text-sm text-slate-300">Isi data berikut agar beban latihan, zona kecepatan, dan prediksi lomba bisa dihitung. Semua data hanya tersimpan di perangkat ini.</p>}

      <form onSubmit={save} noValidate className="space-y-4 sport-card p-4">
        <Field label="Usia" hint="Tahun" type="number" inputMode="numeric" value={age || ''} onChange={(e) => setAge(Number(e.target.value))} error={errs.age} />
        <Field label="Detak jantung istirahat" term="Resting HR, bpm" hint="Ukur saat bangun tidur, sebelum bangkit dari tempat tidur." name="restingHr" type="number" inputMode="numeric"
          defaultValue={profile?.restingHr} error={errs.restingHr} />
        <label className="flex min-h-11 items-center gap-3 text-sm font-semibold text-slate-200">
          <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} className="h-5 w-5 accent-coral" />
          Hitung detak jantung maksimal otomatis (rumus Tanaka)
        </label>
        <Field label="Detak jantung maksimal" term="Max HR, bpm" type="number" inputMode="numeric" disabled={auto}
          value={auto ? (age > 0 ? String(tanakaMaxHr(age)) : '') : maxHrText} onChange={(e) => setMaxHrText(e.target.value)} error={errs.maxHr} />
        <SelectField label="Jarak lomba target" name="target" defaultValue={profile?.targetDistance ?? '10K'}>
          {DISTANCES.map((d) => <option key={d}>{d}</option>)}
        </SelectField>
        <Field label="Tanggal lomba" hint="Boleh dikosongkan dan diisi nanti di tab Program." name="raceDate" type="date"
          defaultValue={profile?.targetRaceDate ? new Date(profile.targetRaceDate).toISOString().slice(0, 10) : ''} />
        <Field label="Target waktu lomba" hint="jam:menit:detik, contoh 00:50:00" name="targetTime" placeholder="00:50:00" autoComplete="off"
          defaultValue={profile ? fmtHms(profile.targetTimeSec) : ''} error={errs.targetTime} />
        <Field label="Target jarak mingguan" term="km" hint="Boleh dikosongkan. Contoh 30 atau 32,5." name="weeklyTargetKm" inputMode="decimal" autoComplete="off"
          defaultValue={profile?.weeklyTargetKm} error={errs.weeklyTargetKm} />
        {formMsg && <Notice msg={formMsg} />}
        <PrimaryButton type="submit">Simpan profil</PrimaryButton>
      </form>

      <section className="space-y-3 sport-card p-4" aria-labelledby="cadangan-judul">
        <h2 id="cadangan-judul" className="text-base font-bold">Cadangan data</h2>
        <p className="text-sm text-slate-400">Cadangan berisi seluruh sesi dan profil. Data hanya tersimpan di perangkat ini, jadi buat cadangan secara berkala.</p>
        <Button variant="secondary" onClick={exportJson}>Ekspor cadangan (.json)</Button>
        <label className="flex min-h-11 w-full cursor-pointer items-center justify-center rounded-xl border border-dashed border-navy-700 px-4 py-2 text-sm font-semibold text-slate-300 focus-within:ring-2 focus-within:ring-coral">
          Pulihkan dari cadangan (.json)
          <input type="file" accept=".json" onChange={pickImport} className="sr-only" />
        </label>
        {backupMsg && <Notice msg={backupMsg} />}
      </section>

      {profile && (
        <section className="space-y-3 rounded-2xl border border-red-500/30 bg-navy-800 p-4" aria-labelledby="bahaya-judul">
          <h2 id="bahaya-judul" className="text-base font-bold text-red-300">Zona berbahaya</h2>
          <p className="text-sm text-slate-400">Menghapus semua sesi dan profil dari perangkat ini. Ekspor cadangan dulu bila perlu.</p>
          <Button variant="danger" onClick={() => setAskWipe(true)}>Hapus semua data lokal</Button>
        </section>
      )}

      {pendingImport && (
        <ConfirmDialog id="impor" title="Pulihkan dari cadangan?" confirmLabel="Ya, pulihkan" onConfirm={doImport} onCancel={() => setPendingImport(null)}>
          <p>Seluruh sesi di perangkat ini akan diganti dengan isi berkas <strong>{pendingImport.name}</strong>.</p>
        </ConfirmDialog>
      )}
      {askWipe && (
        <ConfirmDialog id="hapus-semua" title="Hapus semua data?" confirmLabel="Hapus semua" onConfirm={wipe} onCancel={() => setAskWipe(false)}>
          <p>Semua sesi dan profil di perangkat ini akan dihapus. Tindakan ini tidak bisa dibatalkan.</p>
        </ConfirmDialog>
      )}
    </div>
  );
}
