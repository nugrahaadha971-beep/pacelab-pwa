import type { LapSplit, WorkoutDraft } from '../analytics/types';

type Draft = Omit<WorkoutDraft, 'workoutType' | 'rpe'>;
type Vals = Partial<Record<number, number>>;
interface FieldDef { num: number; size: number; base: number }
interface MsgDef { gnum: number; le: boolean; fields: FieldDef[]; devSize: number }
interface RecordPt { ts?: number; dist?: number; hr?: number; cad?: number }

const FIT_EPOCH_OFFSET = 631065600; // detik 1970-01-01 → 1989-12-31 (epoch FIT)
const GMSG_SESSION = 18;
const GMSG_RECORD = 20;
const F_TIMESTAMP = 253;

// Tipe dasar FIT (5 bit rendah). Nilai sentinel "invalid" mengikuti spesifikasi.
const NUM_TYPES: Partial<Record<number, { signed: boolean; zeroInvalid?: boolean }>> = {
  0: { signed: false }, 1: { signed: true }, 2: { signed: false }, 3: { signed: true },
  4: { signed: false }, 5: { signed: true }, 6: { signed: false }, 13: { signed: false },
  10: { signed: false, zeroInvalid: true }, 11: { signed: false, zeroInvalid: true }, 12: { signed: false, zeroInvalid: true },
};

function readField(dv: DataView, pos: number, f: FieldDef, le: boolean): number | null {
  const spec = NUM_TYPES[f.base & 0x1f];
  if (!spec || (f.size !== 1 && f.size !== 2 && f.size !== 4)) return null;
  const bits = f.size * 8;
  const raw = f.size === 1 ? dv.getUint8(pos) : f.size === 2 ? dv.getUint16(pos, le) : dv.getUint32(pos, le);
  const v = spec.signed && raw >= 2 ** (bits - 1) ? raw - 2 ** bits : raw;
  const sentinel = spec.signed ? 2 ** (bits - 1) - 1 : 2 ** bits - 1;
  if (raw === sentinel || (spec.zeroInvalid && raw === 0)) return null;
  return v;
}

const mean = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);

/** Decoder biner FIT mandiri (tanpa dependensi). CRC berkas belum divalidasi. */
export function parseFit(buf: ArrayBuffer): Draft {
  if (buf.byteLength < 14) throw new Error('Berkas FIT terlalu kecil.');
  const dv = new DataView(buf);
  if (String.fromCharCode(...new Uint8Array(buf, 8, 4)) !== '.FIT') throw new Error('Bukan berkas FIT.');

  const hdrSize = dv.getUint8(0);
  const end = Math.min(buf.byteLength - 2, hdrSize + dv.getUint32(4, true));
  const defs = new Map<number, MsgDef>();
  const records: RecordPt[] = [];
  const sessions: Vals[] = [];
  let lastTs: number | undefined;
  let pos = hdrSize;

  while (pos < end) {
    const rh = dv.getUint8(pos++);
    let local: number;
    let compressedTs: number | undefined;

    if (rh & 0x80) {
      // Header timestamp terkompresi: 2 bit tipe lokal + 5 bit offset waktu
      local = (rh >> 5) & 0x03;
      const off = rh & 0x1f;
      if (lastTs !== undefined) {
        const low = lastTs % 32;
        compressedTs = lastTs - low + off + (off < low ? 32 : 0);
        lastTs = compressedTs;
      }
    } else if (rh & 0x40) {
      // Definition message
      local = rh & 0x0f;
      pos += 1; // reserved
      const le = dv.getUint8(pos++) === 0;
      const gnum = dv.getUint16(pos, le);
      pos += 2;
      const n = dv.getUint8(pos++);
      const fields: FieldDef[] = [];
      for (let i = 0; i < n; i++, pos += 3) {
        fields.push({ num: dv.getUint8(pos), size: dv.getUint8(pos + 1), base: dv.getUint8(pos + 2) });
      }
      let devSize = 0;
      if (rh & 0x20) {
        const dn = dv.getUint8(pos++);
        for (let i = 0; i < dn; i++, pos += 3) devSize += dv.getUint8(pos + 1);
      }
      defs.set(local, { gnum, le, fields, devSize });
      continue;
    } else {
      local = rh & 0x0f;
    }

    // Data message
    const def = defs.get(local);
    if (!def) throw new Error('Definisi pesan FIT tidak ditemukan.');
    const v: Vals = {};
    for (const f of def.fields) {
      // Pada header terkompresi, field timestamp tidak ada di data (nilainya dari offset).
      if (compressedTs !== undefined && f.num === F_TIMESTAMP) continue;
      const x = readField(dv, pos, f, def.le);
      if (x !== null) v[f.num] = x;
      pos += f.size;
    }
    pos += def.devSize; // field developer dilewati
    if (compressedTs !== undefined) v[F_TIMESTAMP] = compressedTs;
    if (v[F_TIMESTAMP] !== undefined) lastTs = v[F_TIMESTAMP];

    if (def.gnum === GMSG_RECORD) records.push({ ts: v[F_TIMESTAMP], dist: v[5], hr: v[3], cad: v[4] });
    else if (def.gnum === GMSG_SESSION) sessions.push(v);
  }

  const tsList = records.map((r) => r.ts).filter((t): t is number => t !== undefined);
  const sess: Vals = sessions[0] ?? {};
  const start = sess[2] ?? tsList[0];
  if (start === undefined) throw new Error('Berkas FIT tanpa waktu.');

  // Jarak: FIT menyimpan meter × 100
  const maxRecDist = Math.max(0, ...records.map((r) => r.dist ?? 0)) / 100;
  const distanceKm = (sess[9] !== undefined ? sess[9] / 100 : maxRecDist) / 1000;
  const durationSec = sess[8] !== undefined ? sess[8] / 1000
    : tsList.length > 1 ? tsList[tsList.length - 1] - tsList[0] : 0;
  if (distanceKm <= 0 || durationSec <= 0) throw new Error('Berkas FIT tidak berisi jarak yang valid.');

  const hrs = records.map((r) => r.hr).filter((x): x is number => x !== undefined);
  const cads = records.map((r) => r.cad).filter((x): x is number => x !== undefined);
  const cadPerFoot = sess[18] ?? mean(cads);

  // Split per km dari record (sama seperti GPX)
  const laps: LapSplit[] = [];
  let lapD0 = 0, lapT0 = tsList[0], hrSum = 0, hrN = 0;
  for (const r of records) {
    if (r.ts === undefined || r.dist === undefined) continue;
    if (r.hr !== undefined) { hrSum += r.hr; hrN++; }
    const d = r.dist / 100;
    if (d - lapD0 >= 1000 && lapT0 !== undefined) {
      laps.push({
        km: laps.length + 1,
        paceSec: ((r.ts - lapT0) * 1000) / (d - lapD0),
        avgHr: hrN ? Math.round(hrSum / hrN) : null,
      });
      lapD0 = d; lapT0 = r.ts; hrSum = 0; hrN = 0;
    }
  }

  return {
    date: (start + FIT_EPOCH_OFFSET) * 1000,
    source: 'fit',
    distanceKm,
    durationSec: Math.round(durationSec),
    avgPaceSecPerKm: durationSec / distanceKm,
    avgHr: sess[16] ?? (mean(hrs) != null ? Math.round(mean(hrs)!) : null),
    maxHr: sess[17] ?? (hrs.length ? Math.max(...hrs) : null),
    // Asumsi sama dengan GPX: cadence per kaki dikali 2 untuk spm.
    avgCadence: cadPerFoot != null ? Math.round(cadPerFoot * 2) : null,
    elevationGain: sess[22] ?? null,
    laps,
  };
}
