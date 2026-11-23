/** Terima HH:MM:SS atau MM:SS. Blueprint menulis "JJ:MM:DD", yang keliru; dikoreksi di sini. */
export function parseDuration(text: string): number | null {
  const parts = text.trim().split(':').map(Number);
  if (parts.some((n) => !Number.isInteger(n) || n < 0)) return null;
  if (parts.length === 3) {
    const [h, m, s] = parts;
    return m > 59 || s > 59 ? null : h * 3600 + m * 60 + s;
  }
  if (parts.length === 2) {
    const [m, s] = parts;
    return s > 59 ? null : m * 60 + s;
  }
  return null;
}
