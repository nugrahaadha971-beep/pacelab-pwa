import {
  addCustomSession,
  applyPresetTemplate,
  clearAiSchedule,
  DEFAULT_SCHEDULE_STATE,
  deleteCustomSession,
  normalizeScheduleState,
  setProgramTitle,
  updateCustomSession,
} from './schedule.ts';
import type {
  CustomSessionInput,
  PlanSession,
  PresetTemplateId,
  PresetTemplateOptions,
  ScheduleState,
} from './schedule.ts';
import { normalizePlanMode } from './planSelector.ts';
import type { PlanMode } from './planSelector.ts';
import { normalizeMafAdj } from './maf.ts';
import type { MafAdjustment } from './maf.ts';

export const SCHEDULE_KEY = 'pacelab.schedule';

export function loadScheduleState(): ScheduleState {
  try {
    const raw = localStorage.getItem(SCHEDULE_KEY);
    return (raw && normalizeScheduleState(JSON.parse(raw))) || { ...DEFAULT_SCHEDULE_STATE, days: [...DEFAULT_SCHEDULE_STATE.days] };
  } catch {
    return { ...DEFAULT_SCHEDULE_STATE, days: [...DEFAULT_SCHEDULE_STATE.days] };
  }
}

export function saveScheduleState(s: ScheduleState): void {
  try {
    const normalized = normalizeScheduleState(s) ?? s;
    localStorage.setItem(SCHEDULE_KEY, JSON.stringify(normalized));
  } catch { /* penyimpanan tidak tersedia: abaikan */ }
}

export function saveAiScheduleState(current: ScheduleState, aiSessions: PlanSession[], aiSummary?: string): ScheduleState {
  const next: ScheduleState = {
    ...clearAiSchedule(current),
    ...(aiSessions.length > 0 ? { aiSessions } : {}),
    ...(aiSummary?.trim() ? { aiSummary: aiSummary.trim() } : {}),
  };
  saveScheduleState(next);
  return next;
}

export function clearAiScheduleState(current: ScheduleState): ScheduleState {
  const next = clearAiSchedule(current);
  saveScheduleState(next);
  return next;
}

export function addCustomSessionState(current: ScheduleState, input: CustomSessionInput): ScheduleState {
  const next = addCustomSession(current, input);
  saveScheduleState(next);
  return next;
}

export function updateCustomSessionState(
  current: ScheduleState,
  id: string,
  patch: Partial<CustomSessionInput>,
): ScheduleState {
  const next = updateCustomSession(current, id, patch);
  saveScheduleState(next);
  return next;
}

export function deleteCustomSessionState(current: ScheduleState, id: string): ScheduleState {
  const next = deleteCustomSession(current, id);
  saveScheduleState(next);
  return next;
}

export function applyPresetTemplateState(
  current: ScheduleState,
  templateId: PresetTemplateId,
  opts: PresetTemplateOptions,
): ScheduleState {
  const next = applyPresetTemplate(current, templateId, opts);
  saveScheduleState(next);
  return next;
}

export function setProgramTitleState(current: ScheduleState, title: string): ScheduleState {
  const next = setProgramTitle(current, title);
  saveScheduleState(next);
  return next;
}

export const PLAN_MODE_KEY = 'pacelab.planMode';
export function loadPlanMode(): PlanMode {
  try { return normalizePlanMode(localStorage.getItem(PLAN_MODE_KEY)); } catch { return 'auto'; }
}
export function savePlanMode(m: PlanMode): void {
  try { localStorage.setItem(PLAN_MODE_KEY, m); } catch { /* penyimpanan tidak tersedia: abaikan */ }
}

export const MAF_ADJ_KEY = 'pacelab.mafAdj';
export function loadMafAdj(): MafAdjustment {
  try { return normalizeMafAdj(Number(localStorage.getItem(MAF_ADJ_KEY))); } catch { return 0; }
}
export function saveMafAdj(a: MafAdjustment): void {
  try { localStorage.setItem(MAF_ADJ_KEY, String(a)); } catch { /* penyimpanan tidak tersedia: abaikan */ }
}
