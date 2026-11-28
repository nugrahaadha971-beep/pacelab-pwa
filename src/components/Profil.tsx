import { useState, type ChangeEvent, type FormEvent } from 'react';
import { ChevronDown } from 'lucide-react';
import { clearAll, db, exportBackup, importBackup, type ImportMode } from '../db/database';
import { markBackupDone } from '../db/backupReminder';
import { tanakaMaxHr } from '../analytics/workload';
import { clearGeminiApiKey, loadGeminiApiKey, saveGeminiApiKey } from '../analytics/aiCoach';
import type { HrMethod, RaceDistance, Sex, UserProfile, Workout } from '../analytics/types';
import { detectPeakHr } from '../plans/hrZones';
import { HrZoneCard } from './HrZoneCard';
import {
  addShoe,
  calcAllShoesMileage,
  DEFAULT_MAX_KM,
  deleteShoe,
  loadShoes,
  parseKmInput,
  retireShoe,
  saveShoes,
  setDefaultShoe,
  SHOE_STATUS_TEXT,
  updateShoeKm,
  type ShoeStatus,
} from '../plans/shoeStore';
import { parseDuration } from '../parsers/manual';
import { fmtHms } from './format';
import ConfirmDialog from './ConfirmDialog';
import { Button, Field, PrimaryButton, ScreenHeader, SelectField, StatusPill } from './ui';

const DISTANCES: RaceDistance[] = ['5K', '10K', '21.1K', '42.2K'];

interface Msg { text: string; ok: boolean }
interface Errs { age?: string; restingHr?: string; maxHr?: string; targetTime?: string; weeklyTargetKm?: string }

function Notice({ msg }: { msg: Msg }) {
  return msg.ok ? (
    <p role="status" className="rounded-2xl border border-[#BEF264]/25 bg-[#BEF264]/10 px-3 py-2 text-sm font-semibold text-[#BEF264]">
      ✓ {msg.text}
    </p>
  ) : (
    <p role="alert" className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-400">
      {msg.text}
    </p>
  );
}

const SHOE_BAR_STYLE: Record<ShoeStatus, { bar: string; badgeText: string }> = {
  good: { bar: 'bg-[#BEF264]', badgeText: 'Masih nyaman' },
  warn: { bar: 'bg-amber-400', badgeText: 'Hampir habis' },
  replace: { bar: 'bg-rose-500', badgeText: 'Perlu ganti' },
};

export default function Profil({ profile, workouts = [], onSaved }: { profile: UserProfile | null; workouts?: Workout[]; onSaved: () => void }) {
  const [formMsg, setFormMsg] = useState<Msg | null>(null);
  const [backupMsg, setBackupMsg] = useState<Msg | null>(null);
  const [errs, setErrs] = useState<Errs>({});
  const [age, setAge] = useState(profile?.age ?? 0);
  const [auto, setAuto] = useState(() => !profile || profile.maxHr === tanakaMaxHr(profile.age));
  const [maxHrText, setMaxHrText] = useState(String(profile?.maxHr ?? ''));
  const [restingText, setRestingText] = useState(String(profile?.restingHr ?? ''));
  const [hrMethod, setHrMethod] = useState<HrMethod>(profile?.hrMethod ?? 'hrr');
  const [pendingImport, setPendingImport] = useState<File | null>(null);
  const [importMode, setImportMode] = useState<ImportMode>('merge');
  const [askWipe, setAskWipe] = useState(false);
  const [geminiKey, setGeminiKey] = useState(() => loadGeminiApiKey());
  const [hasGeminiKey, setHasGeminiKey] = useState(() => Boolean(loadGeminiApiKey()));
  const [geminiMsg, setGeminiMsg] = useState<Msg | null>(null);

  const [shoes, setShoes] = useState(() => loadShoes());
  const [showAddShoe, setShowAddShoe] = useState(() => loadShoes().every((s) => s.retired));
  const [newShoeName, setNewShoeName] = useState('');
  const [newShoeInitialKm, setNewShoeInitialKm] = useState('0');
  const [newShoeMaxKm, setNewShoeMaxKm] = useState(String(DEFAULT_MAX_KM));
  const [editingShoeId, setEditingShoeId] = useState<string | null>(null);
  const [editingShoeKm, setEditingShoeKm] = useState('');
  const [shoeMsg, setShoeMsg] = useState<Msg | null>(null);

  const liveMaxHr = auto ? (age > 0 ? tanakaMaxHr(age) : null) : Number(maxHrText) > 0 ? Number(maxHrText) : null;
  const liveRestingHr = Number(restingText) > 0 ? Number(restingText) : null;

  const save = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const restingHr = Number(restingText);
    const maxHr = auto ? tanakaMaxHr(age) : Number(maxHrText);
    const targetTimeSec = parseDuration(String(f.get('targetTime')));
    const weeklyRaw = String(f.get('weeklyTargetKm') ?? '').trim().replace(',', '.');
    const weekly = weeklyRaw === '' ? undefined : Number(weeklyRaw);

    const next: Errs = {};
    if (!(age >= 10 && age <= 100)) next.age = 'Usia harus 10–100 tahun.';
    if (!(restingHr >= 30 && restingHr <= 120)) next.restingHr = 'Resting HR harus 30–120 bpm.';
    if (!(maxHr > restingHr && maxHr <= 230)) {
      next.maxHr = 'Max HR harus lebih tinggi dari Resting HR dan paling tinggi 230 bpm.';
    }
    if (targetTimeSec == null || targetTimeSec <= 0) {
      next.targetTime = 'Format jam:menit:detik, contoh 00:50:00 (lebih dari 0).';
    }
    if (weekly !== undefined && !(weekly > 0)) next.weeklyTargetKm = 'Isi angka lebih dari 0, atau kosongkan.';
    setErrs(next);
    setFormMsg(null);
    if (Object.keys(next).length > 0 || targetTimeSec == null) return;

    try {
      await db.userProfile.put({
        id: 'default', age, restingHr, maxHr, hrMethod,
        sex: (f.get('sex') as Sex) || 'male',
        targetDistance: f.get('target') as RaceDistance,
        targetRaceDate: Date.parse(String(f.get('raceDate'))) || 0,
        targetTimeSec,
        weeklyTargetKm: weekly,
      });
    } catch (err) {
      setFormMsg({ text: err instanceof Error ? err.message : 'Gagal menyimpan profil.', ok: false });
      return;
    }
    setFormMsg({ text: 'Profil & target diperbarui.', ok: true });
    onSaved();
  };

  const exportJson = async () => {
    const url = URL.createObjectURL(new Blob([await exportBackup()], { type: 'application/json' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: `pacelab-${new Date().toISOString().slice(0, 10)}.json` });
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    markBackupDone();
    setBackupMsg({ text: 'Cadangan diunduh.', ok: true });
  };

  const pickImport = (e: ChangeEvent<HTMLInputElement>) => {
    const input = e.target;
    const file = input.files?.[0];
    input.value = '';
    if (file) setPendingImport(file);
  };

  const doImport = async () => {
    const file = pendingImport;
    const mode = importMode;
    setPendingImport(null);
    if (!file) return;
    try {
      if (mode === 'replace') {
        await exportJson();
      }
      const r = await importBackup(await file.text(), mode);
      const parts = [mode === 'merge' ? `${r.workouts} sesi digabung` : `${r.workouts} sesi dipulihkan`];
      if (r.skipped > 0) parts.push(`${r.skipped} sesi rusak dilewati`);
      if (!r.profile && mode === 'replace') {
        parts.push('profil lama dipertahankan (cadangan tidak memuat profil valid)');
      }
      setBackupMsg({ text: parts.join('; ') + '.', ok: true });
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
      setGeminiMsg({ text: 'API Key tersimpan secara lokal.', ok: true });
    } catch (err) {
      setGeminiMsg({ text: err instanceof Error ? err.message : 'Gagal menyimpan API Key.', ok: false });
    }
  };

  const removeGemini = () => {
    clearGeminiApiKey();
    setGeminiKey('');
    setHasGeminiKey(false);
    setGeminiMsg({ text: 'API Key dihapus.', ok: true });
  };

  const activeShoeEntries = calcAllShoesMileage(workouts, shoes);

  const handleAddShoe = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const trimmedName = newShoeName.trim();
    const initVal = newShoeInitialKm.trim() === '' ? 0 : parseKmInput(newShoeInitialKm);
    const maxVal = newShoeMaxKm.trim() === '' ? DEFAULT_MAX_KM : parseKmInput(newShoeMaxKm);
    if (!trimmedName) {
      setShoeMsg({ text: 'Masukkan nama sepatu.', ok: false });
      return;
    }
    if (initVal === null || initVal < 0) {
      setShoeMsg({ text: 'Km awal harus 0 atau lebih.', ok: false });
      return;
    }
    if (maxVal === null || maxVal <= 0) {
      setShoeMsg({ text: 'Maks km harus lebih dari 0.', ok: false });
      return;
    }
    const updated = saveShoes(addShoe(shoes, { name: trimmedName, initialKm: initVal, maxKm: maxVal }));
    setShoes(updated);
    setNewShoeName('');
    setNewShoeInitialKm('0');
    setNewShoeMaxKm(String(DEFAULT_MAX_KM));
    setShowAddShoe(false);
    setShoeMsg({ text: `Sepatu "${trimmedName}" ditambahkan.`, ok: true });
  };

  const handleOpenEditKm = (id: string, currentInitialKm: number) => {
    setEditingShoeId(id);
    setEditingShoeKm(String(currentInitialKm));
    setShoeMsg(null);
  };

  const handleSaveEditKm = (e: FormEvent<HTMLFormElement>, id: string, shoeName: string) => {
    e.preventDefault();
    const parsedKm = editingShoeKm.trim() === '' ? 0 : parseKmInput(editingShoeKm);
    if (parsedKm === null || parsedKm < 0) {
      setShoeMsg({ text: 'Km awal harus angka 0 atau lebih.', ok: false });
      return;
    }
    const updated = saveShoes(updateShoeKm(shoes, id, parsedKm));
    setShoes(updated);
    setEditingShoeId(null);
    setEditingShoeKm('');
    setShoeMsg({ text: `Jarak awal "${shoeName}" diperbarui.`, ok: true });
  };

  const handleSetDefaultShoe = (id: string) => {
    setShoes(saveShoes(setDefaultShoe(shoes, id)));
    setShoeMsg({ text: 'Sepatu utama diperbarui.', ok: true });
  };

  const handleRetireShoe = (id: string) => {
    setShoes(saveShoes(retireShoe(shoes, id)));
    if (editingShoeId === id) setEditingShoeId(null);
    setShoeMsg({ text: 'Sepatu dipensiunkan.', ok: true });
  };

  const handleDeleteShoe = (id: string) => {
    setShoes(saveShoes(deleteShoe(shoes, id)));
    if (editingShoeId === id) setEditingShoeId(null);
    setShoeMsg({ text: 'Sepatu dihapus.', ok: true });
  };

  return (
    <div className="space-y-4">
      <ScreenHeader
        title={profile ? 'Profil & Pengaturan' : 'Atur Profil'}
        subtitle={profile ? 'Data fisiologis, target lomba & preferensi' : undefined}
      />
      {!profile && (
        <p className="text-sm text-zinc-300">
          Lengkapi data berikut untuk mengaktifkan zona detak jantung dan target latihan.
        </p>
      )}

      {/* Kartu 1: Data Diri & Target Lomba */}
      <form onSubmit={save} noValidate className="space-y-4 sport-card p-5" aria-labelledby="profil-data-judul">
        <h2 id="profil-data-judul" className="font-display text-base font-bold text-white">1. Data Diri & Target Lomba</h2>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Usia" hint="Tahun" type="number" inputMode="numeric" value={age || ''} onChange={(e) => setAge(Number(e.target.value))} error={errs.age} />
          <Field label="Resting HR" term="bpm" type="number" inputMode="numeric" value={restingText} onChange={(e) => setRestingText(e.target.value)} error={errs.restingHr} />
        </div>

        <label className="flex min-h-[44px] items-center gap-3 text-sm font-semibold text-zinc-200">
          <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} className="h-5 w-5 accent-[#BEF264]" />
          Hitung Max HR otomatis (Tanaka)
        </label>

        <Field
          label="Max HR"
          term="bpm"
          type="number"
          inputMode="numeric"
          disabled={auto}
          value={auto ? (age > 0 ? String(tanakaMaxHr(age)) : '') : maxHrText}
          onChange={(e) => setMaxHrText(e.target.value)}
          error={errs.maxHr}
        />

        <SelectField label="Jenis kelamin" hint="Dipakai untuk rumus beban latihan (TRIMP)." name="sex" defaultValue={profile?.sex ?? 'male'}>
          <option value="male">Pria</option>
          <option value="female">Wanita</option>
        </SelectField>

        <div className="grid grid-cols-2 gap-3">
          <SelectField label="Jarak Target" name="target" defaultValue={profile?.targetDistance ?? '10K'}>
            {DISTANCES.map((d) => <option key={d}>{d}</option>)}
          </SelectField>
          <Field
            label="Tanggal Lomba"
            name="raceDate"
            type="date"
            defaultValue={profile?.targetRaceDate ? new Date(profile.targetRaceDate).toISOString().slice(0, 10) : ''}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field
            label="Target Waktu"
            hint="HH:MM:SS"
            name="targetTime"
            placeholder="00:50:00"
            autoComplete="off"
            defaultValue={profile ? fmtHms(profile.targetTimeSec) : ''}
            error={errs.targetTime}
          />
          <Field
            label="Target Mingguan"
            term="km"
            name="weeklyTargetKm"
            inputMode="decimal"
            autoComplete="off"
            defaultValue={profile?.weeklyTargetKm}
            error={errs.weeklyTargetKm}
          />
        </div>

        {formMsg && <Notice msg={formMsg} />}
        <PrimaryButton type="submit">Simpan profil</PrimaryButton>
      </form>

      <HrZoneCard
        maxHr={liveMaxHr}
        restingHr={liveRestingHr}
        method={hrMethod}
        detectedMaxHr={detectPeakHr(workouts)}
        onMethodChange={setHrMethod}
        onUseDetected={(bpm) => { setAuto(false); setMaxHrText(String(bpm)); }}
      />

      {/* Kartu 2: Pelatih AI (Gemini) */}
      <section className="space-y-3 sport-card p-5" aria-labelledby="gemini-coach-judul">
        <div className="flex items-center justify-between gap-2">
          <h2 id="gemini-coach-judul" className="font-display text-base font-bold text-white">2. Pelatih AI (Gemini)</h2>
          <StatusPill tone={hasGeminiKey ? 'good' : 'info'}>
            {hasGeminiKey ? 'Aktif' : 'Belum diatur'}
          </StatusPill>
        </div>
        <Field
          label="Gemini API Key"
          type="password"
          autoComplete="off"
          placeholder="AIza..."
          value={geminiKey}
          onChange={(e) => setGeminiKey(e.target.value)}
          hint="Tersimpan lokal di perangkat ini."
        />
        <div className="grid grid-cols-2 gap-2">
          <Button variant="secondary" onClick={saveGemini}>Simpan</Button>
          <Button variant="danger" onClick={removeGemini} disabled={!hasGeminiKey && !geminiKey.trim()}>Hapus</Button>
        </div>
        {geminiMsg && <Notice msg={geminiMsg} />}
      </section>

      {/* Kartu 3: Sepatu Lari */}
      <section className="space-y-3 sport-card p-5" aria-labelledby="shoe-tracker-judul">
        <div className="flex items-center justify-between gap-2">
          <h2 id="shoe-tracker-judul" className="font-display text-base font-bold text-white">3. Sepatu Lari</h2>
          <Button
            variant="secondary"
            block={false}
            onClick={() => { setShowAddShoe((v) => !v); setShoeMsg(null); }}
            className="px-3.5 text-xs"
          >
            {showAddShoe ? 'Tutup' : '+ Tambah'}
          </Button>
        </div>

        {activeShoeEntries.length === 0 ? (
          <p className="sport-subcard p-3 text-xs text-zinc-400">Belum ada sepatu aktif.</p>
        ) : (
          <div className="space-y-2.5">
            {activeShoeEntries.map((entry) => {
              const style = SHOE_BAR_STYLE[entry.status];
              return (
                <div key={entry.shoe.id} className="sport-subcard space-y-2.5 p-3.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="truncate font-display text-sm font-bold text-white">{entry.shoe.name}</span>
                      {entry.shoe.isDefault && (
                        <span className="shrink-0 rounded-full bg-[#BEF264]/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[#BEF264]">
                          Utama
                        </span>
                      )}
                    </div>
                    <StatusPill tone={entry.status === 'good' ? 'good' : entry.status === 'warn' ? 'warn' : 'bad'}>
                      {style.badgeText}
                    </StatusPill>
                  </div>

                  <div>
                    <div className="flex items-baseline justify-between gap-2 text-xs">
                      <span className="font-mono font-bold tabular-nums text-zinc-100">
                        {entry.totalKm.toFixed(1)} / {entry.shoe.maxKm} km
                      </span>
                      <span className="font-mono tabular-nums text-zinc-400">{Math.min(100, Math.round(entry.pct))}%</span>
                    </div>
                    <div
                      role="progressbar"
                      aria-label={`Jarak tempuh ${entry.shoe.name}`}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={Math.min(100, Math.round(entry.pct))}
                      className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-[#27272E]"
                    >
                      <div
                        className={`h-full rounded-full transition-all duration-300 ${style.bar}`}
                        style={{ width: `${Math.min(100, Math.max(0, entry.pct))}%` }}
                      />
                    </div>
                    {entry.status !== 'good' && (
                      <p className="mt-1 text-xs text-zinc-400">{SHOE_STATUS_TEXT[entry.status]}</p>
                    )}
                  </div>

                  {editingShoeId === entry.shoe.id && (
                    <form
                      onSubmit={(e) => handleSaveEditKm(e, entry.shoe.id, entry.shoe.name)}
                      noValidate
                      className="space-y-2 rounded-xl border border-white/10 bg-[#121215] p-3"
                    >
                      <Field
                        label="Km Awal"
                        inputMode="decimal"
                        value={editingShoeKm}
                        onChange={(e) => { setEditingShoeKm(e.target.value); setShoeMsg(null); }}
                      />
                      <div className="flex gap-2">
                        <Button type="submit" variant="primary" block={false} className="min-h-[44px] px-4 text-xs">
                          Simpan
                        </Button>
                        <Button
                          type="button"
                          variant="secondary"
                          block={false}
                          onClick={() => { setEditingShoeId(null); setEditingShoeKm(''); }}
                          className="min-h-[44px] px-4 text-xs"
                        >
                          Batal
                        </Button>
                      </div>
                    </form>
                  )}

                  <div className="flex flex-wrap gap-2 pt-0.5">
                    <Button variant="secondary" block={false} onClick={() => handleOpenEditKm(entry.shoe.id, entry.shoe.initialKm)} className="px-3 text-xs">
                      Edit KM
                    </Button>
                    {!entry.shoe.isDefault && (
                      <Button variant="secondary" block={false} onClick={() => handleSetDefaultShoe(entry.shoe.id)} className="px-3 text-xs">
                        Utama
                      </Button>
                    )}
                    <Button variant="secondary" block={false} onClick={() => handleRetireShoe(entry.shoe.id)} className="px-3 text-xs">
                      Pensiun
                    </Button>
                    <Button variant="danger" block={false} onClick={() => handleDeleteShoe(entry.shoe.id)} className="px-3 text-xs">
                      Hapus
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {showAddShoe && (
          <form onSubmit={handleAddShoe} noValidate className="space-y-3 rounded-2xl border border-white/[0.08] bg-[#18181D]/80 p-3.5">
            <Field
              label="Nama Sepatu"
              placeholder="ASICS Gel-Cumulus 28"
              value={newShoeName}
              onChange={(e) => { setNewShoeName(e.target.value); setShoeMsg(null); }}
            />
            <div className="grid grid-cols-2 gap-3">
              <Field label="Km Awal" inputMode="decimal" value={newShoeInitialKm} onChange={(e) => { setNewShoeInitialKm(e.target.value); setShoeMsg(null); }} />
              <Field label="Maks Km" inputMode="decimal" value={newShoeMaxKm} onChange={(e) => { setNewShoeMaxKm(e.target.value); setShoeMsg(null); }} />
            </div>
            <Button type="submit" variant="primary">Simpan Sepatu</Button>
          </form>
        )}

        {shoeMsg && <Notice msg={shoeMsg} />}
      </section>

      {/* Kartu 4: Cadangan & Reset Data */}
      <details className="group sport-card p-5">
        <summary className="flex min-h-[44px] cursor-pointer list-none items-center justify-between gap-2 font-display text-base font-bold text-white">
          <span>4. Cadangan & Reset Data</span>
          <ChevronDown className="h-4 w-4 text-zinc-400 transition-transform group-open:rotate-180" aria-hidden />
        </summary>

        <div className="mt-3 space-y-3 border-t border-white/[0.06] pt-3">
          <Button variant="secondary" onClick={exportJson}>Ekspor cadangan (.json)</Button>
          <label className="flex min-h-[44px] w-full cursor-pointer items-center justify-center rounded-2xl border border-dashed border-white/15 px-4 py-2 text-sm font-semibold text-zinc-300 focus-within:ring-2 focus-within:ring-[#BEF264]">
            Pulihkan dari cadangan (.json)
            <input type="file" accept=".json" onChange={pickImport} className="sr-only" />
          </label>
          {backupMsg && <Notice msg={backupMsg} />}

          {profile && (
            <div className="border-t border-rose-500/20 pt-3">
              <Button variant="danger" onClick={() => setAskWipe(true)}>Hapus semua data lokal</Button>
            </div>
          )}
        </div>
      </details>

      {pendingImport && (
        <ConfirmDialog id="impor" title="Pulihkan dari cadangan?" confirmLabel="Ya, pulihkan" onConfirm={doImport} onCancel={() => setPendingImport(null)}>
          <p>Berkas: <strong>{pendingImport.name}</strong></p>
          <div role="radiogroup" aria-label="Mode pemulihan" className="mt-2 space-y-2 text-sm">
            <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-white/10 bg-[#18181D] p-2.5">
              <input
                type="radio"
                name="import-mode"
                checked={importMode === 'merge'}
                onChange={() => setImportMode('merge')}
                className="mt-0.5 h-4 w-4 accent-[#BEF264]"
              />
              <span><strong>Gabung</strong> — tambahkan sesi baru, lewati duplikat.</span>
            </label>
            <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-white/10 bg-[#18181D] p-2.5">
              <input
                type="radio"
                name="import-mode"
                checked={importMode === 'replace'}
                onChange={() => setImportMode('replace')}
                className="mt-0.5 h-4 w-4 accent-[#BEF264]"
              />
              <span><strong>Ganti semua</strong> — hapus sesi saat ini (salinan pengaman diunduh otomatis).</span>
            </label>
          </div>
        </ConfirmDialog>
      )}
      {askWipe && (
        <ConfirmDialog id="hapus-semua" title="Hapus semua data?" confirmLabel="Hapus semua" onConfirm={wipe} onCancel={() => setAskWipe(false)}>
          <p>Semua sesi, profil, jadwal, data sepatu, serta API key Gemini dan hasil analisis AI di perangkat ini akan dihapus permanen.</p>
        </ConfirmDialog>
      )}
    </div>
  );
}
