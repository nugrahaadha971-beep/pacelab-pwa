export const K5_KEY = 'pacelab.k5';

/** Input waktu 5K (teks HH:MM:SS / MM:SS) yang dipakai Program, Riwayat, dan Beranda. */
export function loadK5(): string | null {
  try {
    return localStorage.getItem(K5_KEY);
  } catch {
    return null;
  }
}

export function saveK5(value: string): void {
  try {
    localStorage.setItem(K5_KEY, value);
  } catch {
    /* penyimpanan tidak tersedia: abaikan */
  }
}
