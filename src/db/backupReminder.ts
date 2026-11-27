export const BACKUP_KEY = 'pacelab.lastBackup';

export function markBackupDone(now = Date.now()): void {
  try {
    localStorage.setItem(BACKUP_KEY, String(now));
  } catch {
    /* penyimpanan tidak tersedia: abaikan */
  }
}

export function backupOverdue(workoutCount: number, now = Date.now(), days = 14): boolean {
  if (workoutCount === 0) return false;
  try {
    const raw = localStorage.getItem(BACKUP_KEY);
    const t = Number(raw);
    return !Number.isFinite(t) || t <= 0 || now - t > days * 86_400_000;
  } catch {
    return false;
  }
}
