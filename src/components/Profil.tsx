import { useState, type ChangeEvent, type FormEvent } from 'react';
import { ChevronDown } from 'lucide-react';
import { clearAll, db, exportBackup, importBackup } from '../db/database';
import { tanakaMaxHr } from '../analytics/workload';
import { clearGeminiApiKey, loadGeminiApiKey, saveGeminiApiKey } from '../analytics/aiCoach';
import type { RaceDistance, UserProfile, Workout } from '../analytics/types';
import { calcShoeMileage, loadShoeConfig, saveShoeConfig, SHOE_STATUS_TEXT, type ShoeStatus } from '../plans/shoeStore';
import { parseDuration } from '../parsers/manual';
import { fmtHms } from './format';
import ConfirmDialog from './ConfirmDialog';
import { Button, Field, PrimaryButton, ScreenHeader, SelectField, StatusPill } from './ui';

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

const SHOE_BAR_STYLE: Record<ShoeStatus, { bar: string; pill: string; badgeText: string }> = {
  good: { bar: 'bg-emerald-400', pill: 'good', badgeText: 'Masih nyaman' },
  warn: { bar: 'bg-amber-400', pill: 'warn', badgeText: 'Hampir habis' },
  replace: { bar: 'bg-coral', pill: 'bad', badgeText: 'Perlu ganti' },
};

export default function Profil({ profile, workouts = [], onSaved }: { profile: UserProfile | null; workouts?: Workout[]; onSaved: () => void }) {
  const [formMsg, setFormMsg] = useState<Msg | null>(null);
  const [backupMsg, setBackupMsg] = useState<Msg | null>(null);
  const [errs, setErrs] = useState<Errs>({});
  const [age, setAge] = useState(profile?.age ?? 0);
  // Otomatis hanya bila profil baru, atau Max HR tersimpan memang sama dengan hasil Tanaka.
  const [auto, setAuto] = useState(() => !profile || profile.maxHr === tanakaMaxHr(profile.age));
  const [maxHrText, setMaxHrText] = useState(String(profile?.maxHr ?? ''));
  const [pendingImport, setPendingImport] = useState<File | null>(null);
  const [askWipe, setAskWipe] = useState(false);
  const [geminiKey, setGeminiKey] = useState(() => loadGeminiApiKey());
  const [hasGeminiKey, setHasGeminiKey] = useState(() => Boolean(loadGeminiApiKey()));
  const [geminiMsg, setGeminiMsg] = useState<Msg | null>(null);

  const [initialShoe] = useState(() => loadShoeConfig());
  const [shoeName, setShoeName] = useState(initialShoe.name);
  const [shoeStartDate, setShoeStartDate] = useState(initialShoe.startDate ?? '');
  const [shoeInitialKm, setShoeInitialKm] = useState(String(initialShoe.initialKm));
  const [shoeMaxKm, setShoeMaxKm] = useState(String(initialShoe.maxKm));
  const [shoeMsg, setShoeMsg] = useState<Msg | null>(null);

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
    setFormMsg({ text: 'Profil tersimpan. Zona latihan dan target diperbarui.', ok: true });
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

  const saveGemini = () => {
    const trimmed = geminiKey.trim();
    if (!trimmed) {
      setGeminiMsg({ text: 'Masukkan Gemini API Key terlebih dahulu.', ok: false });
      return;
    }
    try {
      saveGeminiApiKey(trimmed);
      setGeminiKey(trimmed);
      setHasGeminiKey(true);
      setGeminiMsg({ text: 'API Key Gemini tersimpan secara lokal di browser ini.', ok: true });
    } catch (err) {
      setGeminiMsg({ text: err instanceof Error ? err.message : 'Gagal menyimpan API Key.', ok: false });
    }
  };

  const removeGemini = () => {
    clearGeminiApiKey();
    setGeminiKey('');
    setHasGeminiKey(false);
    setGeminiMsg({ text: 'API Key Gemini dihapus dari perangkat ini.', ok: true });
  };

  const parsedInitialKm = Number(shoeInitialKm.replace(',', '.'));
  const parsedMaxKm = Number(shoeMaxKm.replace(',', '.'));
  const liveShoe = {
    name: shoeName.trim() || 'Sepatu Utama',
    initialKm: Number.isFinite(parsedInitialKm) && parsedInitialKm >= 0 ? parsedInitialKm : 0,
    maxKm: Number.isFinite(parsedMaxKm) && parsedMaxKm > 0 ? parsedMaxKm : 800,
    startDate: shoeStartDate,
  };
  const shoeMileage = calcShoeMileage(workouts, liveShoe);
  const shoeStyle = SHOE_BAR_STYLE[shoeMileage.status];

  const saveShoe = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const initVal = Number(shoeInitialKm.replace(',', '.'));
    const maxVal = Number(shoeMaxKm.replace(',', '.'));
    if (!Number.isFinite(initVal) || initVal < 0) {
      setShoeMsg({ text: 'Jarak awal harus 0 km atau lebih.', ok: false });
      return;
    }
    if (!Number.isFinite(maxVal) || maxVal <= 0) {
      setShoeMsg({ text: 'Batas maksimal km harus lebih dari 0.', ok: false });
      return;
    }
    const saved = saveShoeConfig({
      name: shoeName.trim(),
      initialKm: initVal,
      maxKm: maxVal,
      startDate: shoeStartDate,
    });
    setShoeName(saved.name);
    setShoeStartDate(saved.startDate ?? '');
    setShoeInitialKm(String(saved.initialKm));
    setShoeMaxKm(String(saved.maxKm));
    setShoeMsg({ text: 'Data sepatu lari utama tersimpan.', ok: true });
  };

  return (
    <div className="space-y-4">
      <ScreenHeader
        title={profile ? 'Profil & Pengaturan' : 'Atur profil dulu'}
        subtitle={profile ? 'Data diri, Pelatih AI, dan cadangan perangkat' : undefined}
      />
      {!profile && (
        <p className="text-sm text-slate-300">
          Isi data berikut agar Kondisi Beban Tubuh, target detak jantung, dan prediksi lomba bisa dihitung. Semua data tersimpan lokal di perangkat ini.
        </p>
      )}

      {/* Kartu 1: Data Diri & Target Lomba */}
      <form onSubmit={save} noValidate className="space-y-4 sport-card p-4" aria-labelledby="profil-data-judul">
        <h2 id="profil-data-judul" className="font-display text-base font-bold text-white">1. Data Diri &amp; Target Lomba</h2>

        <Field label="Usia" hint="Tahun" type="number" inputMode="numeric" value={age || ''} onChange={(e) => setAge(Number(e.target.value))} error={errs.age} />
        <Field label="Detak jantung istirahat" term="Resting HR, bpm" hint="Ukur saat bangun tidur sebelum beranjak dari kasur." name="restingHr" type="number" inputMode="numeric"
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

      {/* Kartu 2: Pelatih AI (Gemini) */}
      <section className="space-y-3 sport-card p-4" aria-labelledby="gemini-coach-judul">
        <div className="flex items-center justify-between gap-2">
          <h2 id="gemini-coach-judul" className="font-display text-base font-bold text-white">2. Pelatih AI (Gemini)</h2>
          <StatusPill tone={hasGeminiKey ? 'good' : 'info'}>
            {hasGeminiKey ? 'Key tersimpan' : 'Belum diatur'}
          </StatusPill>
        </div>
        <p className="text-sm text-slate-400">
          Opsional. API Key hanya disimpan di browser perangkat ini dan tidak pernah ikut di file cadangan.
        </p>
        <Field
          label="Gemini API Key"
          type="password"
          autoComplete="off"
          placeholder="AIza..."
          value={geminiKey}
          onChange={(e) => setGeminiKey(e.target.value)}
          hint="Dipakai saat Anda menekan tombol Tanya Pelatih AI di Beranda atau Susun Jadwal dengan AI di tab Program."
        />
        <div className="grid grid-cols-2 gap-2">
          <Button variant="secondary" onClick={saveGemini}>Simpan</Button>
          <Button variant="danger" onClick={removeGemini} disabled={!hasGeminiKey && !geminiKey.trim()}>Hapus Key</Button>
        </div>
        {geminiMsg && <Notice msg={geminiMsg} />}
      </section>

      {/* Kartu 3: Sepatu Lari Utama */}
      <form onSubmit={saveShoe} noValidate className="space-y-3 sport-card p-4" aria-labelledby="shoe-tracker-judul">
        <div className="flex items-center justify-between gap-2">
          <h2 id="shoe-tracker-judul" className="font-display text-base font-bold text-white">3. Sepatu Lari Utama</h2>
          <StatusPill tone={shoeMileage.status === 'good' ? 'good' : shoeMileage.status === 'warn' ? 'warn' : 'bad'}>
            {shoeStyle.badgeText}
          </StatusPill>
        </div>

        <div className="sport-subcard p-3 tabular-nums">
          <div className="flex items-baseline justify-between gap-2 text-sm">
            <span className="font-bold text-slate-100">
              {shoeMileage.totalKm} / {liveShoe.maxKm} km
            </span>
            <span className="text-xs font-semibold text-slate-400">{Math.min(100, Math.round(shoeMileage.pct))}% terpakai</span>
          </div>
          <div
            role="progressbar"
            aria-label="Jarak tempuh sepatu"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.min(100, Math.round(shoeMileage.pct))}
            className="mt-2 h-2.5 w-full overflow-hidden rounded-full bg-navy-700"
          >
            <div
              className={`h-full rounded-full transition-all duration-300 ${shoeStyle.bar}`}
              style={{ width: `${Math.min(100, Math.max(0, shoeMileage.pct))}%` }}
            />
          </div>
          <p className="mt-2 text-xs text-slate-300">
            {shoeMileage.status === 'good'
              ? `Tersisa sekitar ${shoeMileage.remainingKm} km sebelum batas pakai.`
              : `${SHOE_STATUS_TEXT[shoeMileage.status]}${shoeMileage.remainingKm > 0 ? ` (sisa ${shoeMileage.remainingKm} km).` : '.'}`}
          </p>
        </div>

        <Field
          label="Nama Sepatu"
          placeholder="ASICS Gel-Cumulus 28 Lite-Show"
          value={shoeName}
          onChange={(e) => { setShoeName(e.target.value); setShoeMsg(null); }}
        />
        <Field
          label="Tanggal Mulai Pakai"
          type="date"
          hint="Opsional. Jika diisi, hanya sesi sejak tanggal ini yang dihitung."
          value={shoeStartDate}
          onChange={(e) => { setShoeStartDate(e.target.value); setShoeMsg(null); }}
        />
        <div className="grid grid-cols-2 gap-3">
          <Field
            label="Jarak Awal"
            term="km"
            hint="Sebelum pakai aplikasi"
            inputMode="decimal"
            value={shoeInitialKm}
            onChange={(e) => { setShoeInitialKm(e.target.value); setShoeMsg(null); }}
          />
          <Field
            label="Batas Maksimal"
            term="km"
            hint="Umumnya 600–800 km"
            inputMode="decimal"
            value={shoeMaxKm}
            onChange={(e) => { setShoeMaxKm(e.target.value); setShoeMsg(null); }}
          />
        </div>
        {shoeMsg && <Notice msg={shoeMsg} />}
        <Button type="submit" variant="secondary">Simpan data sepatu</Button>
      </form>

      {/* Kartu 4: Cadangan & Reset Data (terlipat) */}
      <details className="group sport-card p-4">
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 font-display text-base font-bold text-white">
          <span>4. Cadangan &amp; Reset Data</span>
          <ChevronDown className="h-4 w-4 text-slate-400 transition-transform group-open:rotate-180" aria-hidden />
        </summary>

        <div className="mt-3 space-y-4 border-t border-white/[0.06] pt-3">
          <div className="space-y-3">
            <p className="text-sm text-slate-400">
              Cadangan berisi seluruh sesi lari, jadwal, dan profil. Karena semua data tersimpan lokal di browser ini, buat cadangan secara berkala.
            </p>
            <Button variant="secondary" onClick={exportJson}>Ekspor cadangan (.json)</Button>
            <label className="flex min-h-11 w-full cursor-pointer items-center justify-center rounded-xl border border-dashed border-navy-700 px-4 py-2 text-sm font-semibold text-slate-300 focus-within:ring-2 focus-within:ring-coral">
              Pulihkan dari cadangan (.json)
              <input type="file" accept=".json" onChange={pickImport} className="sr-only" />
            </label>
            {backupMsg && <Notice msg={backupMsg} />}
          </div>

          {profile && (
            <div className="space-y-3 border-t border-red-500/20 pt-3">
              <h3 className="text-sm font-bold text-red-300">Reset Data Lokal</h3>
              <p className="text-xs text-slate-400">Menghapus semua sesi dan profil dari perangkat ini. Ekspor cadangan dulu bila perlu.</p>
              <Button variant="danger" onClick={() => setAskWipe(true)}>Hapus semua data lokal</Button>
            </div>
          )}
        </div>
      </details>

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
