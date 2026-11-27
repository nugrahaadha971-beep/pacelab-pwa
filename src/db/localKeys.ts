import { SCHEDULE_KEY, PLAN_MODE_KEY, MAF_ADJ_KEY } from '../plans/scheduleStore.ts';
import { SHOES_KEY, SHOE_KEY } from '../plans/shoeStore.ts';
import { K5_KEY } from '../plans/k5Store.ts';
import { BACKUP_KEY } from './backupReminder.ts';
import {
  AI_COACH_CACHE_STORAGE_KEY,
  GEMINI_API_KEY_STORAGE_KEY,
  GEMINI_MODEL_STORAGE_KEY,
} from '../analytics/aiCoach.ts';

/** Semua kunci localStorage milik PACELAB. Dihapus oleh "Hapus semua data lokal". */
export const ALL_LOCAL_KEYS: readonly string[] = [
  SCHEDULE_KEY,
  SHOES_KEY,
  SHOE_KEY,
  PLAN_MODE_KEY,
  MAF_ADJ_KEY,
  K5_KEY,
  BACKUP_KEY,
  GEMINI_API_KEY_STORAGE_KEY,
  GEMINI_MODEL_STORAGE_KEY,
  AI_COACH_CACHE_STORAGE_KEY,
];
