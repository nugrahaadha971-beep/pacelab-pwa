// Sumber: Nike Run Club 5K Training Program (PDF). Urutan sesi = urutan teks PDF.
export type SessionKind = 'recovery' | 'speed' | 'long' | 'race';
export interface Session { kind: SessionKind; name: string; steps: string[] }
export interface Week { label: string; sessions: Session[] }

const rec = (name: string): Session => ({ kind: 'recovery', name, steps: [] });
const long = (name: string): Session => ({ kind: 'long', name, steps: [] });
const race = (name: string): Session => ({ kind: 'race', name, steps: [] });
const speed = (name: string, steps: string[]): Session => ({ kind: 'speed', name, steps });

export const NIKE_5K_PLAN: Week[] = [
  { label: '8 minggu lagi', sessions: [
    rec('5:00'),
    speed('Intervals', ['8 x 1:00 5K Pace', '1:00 Recovery between all intervals']),
    rec('7:00'),
    speed('Intervals', ['5:00 Warm Up', '1:00 5K Pace', '2:00 10K Pace', '1:00 5K Pace', '2 x 0:45 Mile Pace', '2:00 10K Pace', '1:00 5K Pace', '0:45 Mile Pace', '0:30 Best Pace', '0:15 Best Pace', '1:00 Recovery between all intervals']),
    long('1.6K / 1 Mile'),
  ]},
  { label: '7 minggu lagi', sessions: [
    rec('10:00'),
    speed('Intervals', ['5:00 Warm Up', '0:30 Mile Pace', '1:00 5K Pace', '0:30 Mile Pace', '2:00 10K Pace', '0:30 Mile Pace', '1:00 5K Pace', '0:30 Mile Pace', '45 seconds recovery between all intervals']),
    rec('12:00'),
    speed('Intervals', ['5:00 Warm Up', '2:00 Mile Pace', '0:30 10K Pace', '1:30 Mile Pace', '0:30 10K Pace', '1:00 Mile Pace', '0:30 10K Pace', '1:00 Mile Pace', '0:30 10K Pace', '0:30 Best Pace', '30 seconds recovery between all intervals']),
    long('15:00'),
  ]},
  { label: '6 minggu lagi', sessions: [
    rec('3.2K / 2 Mile'),
    speed('Fartlek', ['2 x 1:30 10K Pace', '3 x 1:00 5K Pace', '4 x 0:30 Mile Pace', '5 x 0:15 Best Pace', 'Continuous: recovery easy sama dengan durasi interval hard sebelumnya']),
    rec('20:00'),
    speed('Fartlek', ['5:00 Warm Up', '15:00 Fartlek run', 'Effort: 1:00 hard / 1:00 easy']),
    long('25:00'),
  ]},
  { label: '5 minggu lagi', sessions: [
    rec('25:00'),
    speed('Intervals', ['5:00 Warm Up', '0:30 Mile Pace', '4 x 0:30 5K Pace', '3:00 10K Pace', '4 x 0:30 5K Pace', '0:30 Mile Pace', 'Recovery 30 detik antar interval']),
    rec('1.6K / 1 Mile'),
    speed('Intervals', ['5:00 Warm Up', '2:00 5K Pace', '1:00 Mile Pace', '2 x 0:15 Best Pace', 'Ulangi seluruh rangkaian 3 kali', '1:00 recovery setelah interval 5K pertama', '0:30 recovery setelah interval Mile dan Best pertama', '2:00 recovery antar set']),
    long('30:00'),
  ]},
  { label: '4 minggu lagi', sessions: [
    rec('25:00'),
    speed('Intervals', ['5:00 Warm Up', '5 x 4:00 5K Pace', '2:00 recovery setelah interval 1 & 3', '2:30 recovery setelah interval 2 & 4']),
    rec('25:00'),
    speed('Tempo Run', ['5:00 Warm Up', '23:00 Tempo Run: 12:00 pertama kuat & terkontrol', '11:00 terakhir makin cepat secara progresif', 'Tujuan: jarak pulang-pergi sama']),
    long('33:00 Recovery'),
  ]},
  { label: '3 minggu lagi', sessions: [
    rec('30:00'),
    speed('Intervals', ['5:00 Warm Up', '0:30 Mile Pace', '0:15 Best Pace', '0:45 Mile Pace', '0:15 Best Pace', '1:00 Mile Pace', '0:15 Best Pace', '1:15 Mile Pace', '0:15 Best Pace', '1:30 Mile Pace', '0:15 Best Pace', 'Recovery 30 detik setelah set pertama, +15 detik tiap set berikutnya']),
    rec('31:00'),
    speed('Tempo Run', ['7:00 Warm Up', '25:00 Tempo Run']),
    long('6.5K / 4 Mile'),
  ]},
  { label: '2 minggu lagi', sessions: [
    rec('35:00'),
    speed('Hill Workout', ['5:00 Warm Up', '0:45 10K effort', '0:15 Best effort', 'Ulangi 5 kali', 'Recovery 75 detik setelah 10K effort, 45 detik setelah Best effort']),
    rec('25:00'),
    speed('Intervals', ['8:00 Warm Up', '3:00 10K Pace', '1:00 Mile Pace', '2:00 5K Pace', '1:00 Mile Pace', '2:00 5K Pace', '1:00 Mile Pace', '5:00 10K Pace', '0:30 Best Pace', '1:00 recovery antar interval (1:30 setelah interval 10K pertama)']),
    long('5K / 3.1 Mile'),
  ]},
  { label: '1 minggu lagi', sessions: [
    rec('5K / 3.1 Mile'),
    speed('Tempo Run', ['5:00 Warm Up', '5:00 Recovery Run Pace', '4:00 10K Pace', '3:00 5K Pace', '2:00 Mile Pace', '1:00 Best Pace', 'Dijalankan sebagai progression run']),
    rec('25:00'),
    rec('1K / 0.62 Mile'),
    race('5K / 3.1 Miles (Hari-H)'),
  ]},
];
