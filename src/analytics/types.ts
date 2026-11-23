export type RaceDistance = '5K' | '10K' | '21.1K' | '42.2K';
export type Source = 'fit' | 'gpx' | 'manual';
export type WorkoutType = 'easy' | 'tempo' | 'interval' | 'long_run' | 'race';

export interface LapSplit { km: number; paceSec: number; avgHr: number | null }

export interface Workout {
  id?: number;
  date: number;
  source: Source;
  workoutType: WorkoutType;
  distanceKm: number;
  durationSec: number;
  avgPaceSecPerKm: number;
  avgHr: number | null;
  maxHr: number | null;
  avgCadence: number | null;
  elevationGain: number | null;
  rpe: number | null;
  trimp?: number | null;
  efficiencyFactor?: number | null;
  laps: LapSplit[];
  note?: string;
}

export type WorkoutDraft = Omit<Workout, 'id' | 'trimp' | 'efficiencyFactor'>;

export interface UserProfile {
  id: 'default';
  age: number;
  restingHr: number;
  maxHr: number;
  targetDistance: RaceDistance;
  targetRaceDate: number;
  targetTimeSec: number;
  weeklyTargetKm?: number;
}
