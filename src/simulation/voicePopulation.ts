/**
 * Bio-Solar Swarm: Acoustic & Speech Recognition Crowd Population Estimator
 * Pure deterministic signal/transcript parser converting live microphone RMS +
 * spoken crowd cues into street pedestrian population estimates and fan scaling multipliers.
 */

export type CrowdDensityBand = 'Low' | 'Moderate' | 'Dense' | 'Surge';

export interface VoicePopulationEstimate {
  estimatedPopulation: number; // 5..180 pedestrians
  dbSpl: number;               // 38..94 dB SPL proxy
  crowdBand: CrowdDensityBand;
  fanMultiplier: number;       // 1.00 .. 1.85
  reason: string;
}

const KEYWORD_POPULATION_MAP: Array<{ pattern: RegExp; pop: number; label: string }> = [
  { pattern: /\b(surge|stampede|festival|evacuation|packed|extreme crowd|stadium)\b/i, pop: 160, label: 'Surge crowd keyword' },
  { pattern: /\b(rush hour|heavy crowd|crowded|very busy|dense|congested|peak)\b/i, pop: 120, label: 'Dense crowd keyword' },
  { pattern: /\b(market|commuter|moderate crowd|busy|plaza|junction|group)\b/i, pop: 70, label: 'Moderate crowd keyword' },
  { pattern: /\b(quiet|empty|low traffic|sparse|calm|night|few people)\b/i, pop: 14, label: 'Low crowd keyword' },
];

/**
 * Computes fan demand scaling multiplier (1.00x at <=15 pedestrians up to 1.85x at 160+ pedestrians).
 */
export function computePopulationFanMultiplier(populationCount: number): number {
  const clamped = Math.max(5, Math.min(180, populationCount));
  const multiplier = 1 + Math.min(0.85, (Math.max(0, clamped - 15) / 145) * 0.85);
  return Math.round(multiplier * 1000) / 1000;
}

export function classifyCrowdBand(populationCount: number): CrowdDensityBand {
  if (populationCount >= 115) return 'Surge';
  if (populationCount >= 70) return 'Dense';
  if (populationCount >= 35) return 'Moderate';
  return 'Low';
}

/**
 * Estimates pedestrian population from normalized microphone RMS amplitude (0..1)
 * and recognized speech transcript (Web Speech API or Gemini Live transcription).
 */
export function estimatePopulationFromAcousticAndSpeech(
  rmsAmplitude: number,
  transcript: string,
  previousPopulation = 24
): VoicePopulationEstimate {
  const clampedRms = Math.max(0, Math.min(1, rmsAmplitude));
  // Convert RMS to calibrated street acoustic SPL proxy (38 dB quiet to 94 dB dense vocal chatter)
  const dbSpl = Math.round((38 + Math.min(1, Math.pow(clampedRms * 2.2, 0.72)) * 56) * 10) / 10;

  // Acoustic crowd baseline: ambient street chatter energy maps smoothly to 8..135 people
  const acousticPop = Math.round(8 + Math.max(0, (dbSpl - 42) / 52) * 128);

  const cleanText = transcript.trim();
  let explicitNumber: number | null = null;
  let keywordPop: number | null = null;
  let reason = `Acoustic energy ${dbSpl.toFixed(1)} dB SPL`;

  if (cleanText.length > 0) {
    // Check for spoken numeric population count, e.g. "120 people", "population 85", "80 pedestrians"
    const numMatch = cleanText.match(/\b(\d{1,3})\s*(?:people|persons|pedestrians|crowd|population|occupants|commuters)?\b/i);
    if (numMatch) {
      const parsed = Number(numMatch[1]);
      if (!Number.isNaN(parsed) && parsed >= 1 && parsed <= 500) {
        explicitNumber = Math.max(5, Math.min(180, parsed));
        reason = `Voice command detected count (${explicitNumber} pedestrians)`;
      }
    }

    if (explicitNumber === null) {
      for (const entry of KEYWORD_POPULATION_MAP) {
        if (entry.pattern.test(cleanText)) {
          keywordPop = entry.pop;
          reason = `${entry.label} + ${dbSpl.toFixed(1)} dB SPL`;
          break;
        }
      }
    }
  }

  let estimatedPopulation: number;
  if (explicitNumber !== null) {
    // Spoken numeric count takes direct priority blended lightly with acoustic energy
    estimatedPopulation = Math.round(explicitNumber * 0.85 + Math.max(explicitNumber, acousticPop) * 0.15);
  } else if (keywordPop !== null) {
    estimatedPopulation = Math.round(keywordPop * 0.7 + acousticPop * 0.3);
  } else if (clampedRms > 0.015) {
    // Pure ambient voice/chatter estimation
    estimatedPopulation = Math.round(previousPopulation * 0.35 + acousticPop * 0.65);
  } else {
    estimatedPopulation = previousPopulation;
  }

  estimatedPopulation = Math.max(5, Math.min(180, estimatedPopulation));
  return {
    estimatedPopulation,
    dbSpl,
    crowdBand: classifyCrowdBand(estimatedPopulation),
    fanMultiplier: computePopulationFanMultiplier(estimatedPopulation),
    reason,
  };
}
