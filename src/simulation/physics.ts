/**
 * Bio-Solar Swarm: Physics, Mass-Transfer, Monod PBR Kinetics, and Energy Balance Engine.
 * All pure functions are deterministic and side-effect free for unit testing.
 */

import {
  AlgalStrain,
  CentralTowerState,
  EnvironmentParams,
  INITIAL_NODE_LAYOUT,
  PollutantVector,
  SafetyOverrideCode,
  SmartTransducerNodeState,
  TreatmentConfig,
} from './types';

export const BATTERY_CAPACITY_WH = 240; // 12 V * 20 Ah LiFePO4
export const NOMINAL_PV_RATING_W = 50;  // 50 W bifacial PV array
export const MAX_FAN_POWER_W = 15.0;    // ~15 W BLDC fan
export const MAX_AIRFLOW_M3_H = 120.0;  // Max chamber volumetric flow at 100% duty
export const MOLAR_MASS_CO2_G_MOL = 44.01;

export interface StrainKinetics {
  muMaxH: number;
  ksPpm: number;
  optimalPhMin: number;
  optimalPhMax: number;
  optimalTempC: number;
  co2YieldRatio: number; // g CO2 fixed per g biomass
}

export const STRAIN_PARAMS: Record<AlgalStrain, StrainKinetics> = {
  Chlorella_sorokiniana_RMT01: {
    muMaxH: 0.085,
    ksPpm: 280,
    optimalPhMin: 6.5,
    optimalPhMax: 8.3,
    optimalTempC: 29,
    co2YieldRatio: 1.83,
  },
  Spirulina_platensis: {
    muMaxH: 0.072,
    ksPpm: 320,
    optimalPhMin: 8.4,
    optimalPhMax: 10.4,
    optimalTempC: 32,
    co2YieldRatio: 1.78,
  },
};

export function createInitialNodes(env: EnvironmentParams): SmartTransducerNodeState[] {
  const now = Date.now();
  return INITIAL_NODE_LAYOUT.map((slot, idx) => {
    const initialPh = env.strain === 'Spirulina_platensis' ? 9.2 : 7.3;
    const baseCin = computeLocalAmbientPollution(slot.x, slot.z, env, 0);
    return {
      node_id: slot.node_id,
      label: slot.label,
      zone: slot.zone,
      enabled: true,
      position: { x: slot.x, z: slot.z },
      timestamp: now,
      cin: baseCin,
      cout: { ...baseCin },
      pm25_removal_pct: 0,
      no2_removal_pct: 0,
      co2_removal_pct: 0,
      temperature: env.ambientTempC,
      humidity: env.ambientHumidityPct,
      flow_m3_h: 0,
      fan_duty: env.activeMode === 'centralized_tower' ? 0.05 : 0.65,
      fan_power_w: 0,
      pump_power_w: 0,
      sense_comm_ctrl_w: 2.1,
      pv_harvest_w: computePvHarvestW(env.solarIrradianceWm2, env.ambientTempC),
      net_power_w: 0,
      battery_soc: 74 + ((idx * 5) % 14),
      pbr: {
        ph: initialPh,
        optical_density: 0.85 + idx * 0.04,
        specific_growth_rate_h: 0.045,
        co2_mass_rate_gh: 0,
        o2_evolution_gh: 0,
        algae_health_score: 0.94,
        strain: env.strain,
        isolated: false,
      },
      media: {
        carbon_kmno4_remaining_pct: 92 - idx * 2,
        colorimetric_rgb: computeColorimetricRgb(92 - idx * 2),
        prefilter_dp_pa: 18 + idx * 1.5,
        needs_service: false,
      },
      control_mode: env.activeMode,
      safety_override: null,
      aco_pheromone: 0.25,
      pso_target_duty: 0.65,
      confidence_score: 0.96,
      calibration_id: `IEEE1451-TEDS-2026-0${idx + 1}`,
      hardware_source: 'simulated',
      manual_fault_ph_drift: false,
      manual_fault_low_batt: false,
    };
  });
}

/**
 * Spatial urban street pollution field at (x, z).
 * Traffic lanes run along z = 0..6, pedestrian sidewalk sits at z = -5.6.
 * Spatial hotspots occur near junctions (x = -12) and construction edges (x = +24),
 * augmented by pedestrian crowd respiration & local resuspension near z = -5.6.
 */
export function computeLocalAmbientPollution(
  x: number,
  z: number,
  env: EnvironmentParams,
  simTimeSec: number
): PollutantVector {
  const load = Math.max(0.05, Math.min(1.0, env.trafficPollution / 100));
  const windRad = (env.windAngleDeg * Math.PI) / 180;
  const windTowardSidewalk = Math.max(0.25, 0.75 - 0.5 * Math.sin(windRad));
  const dilutionFactor = 1 / (1 + 0.14 * Math.max(0, env.windSpeedMs - 0.5));

  const pulseA = 0.5 + 0.5 * Math.sin(simTimeSec * 0.45 + x * 0.12);
  const hotspotTraffic = Math.exp(-Math.pow((x + 12) / 11, 2)) * (0.35 + 0.25 * pulseA);
  const hotspotConstruction = Math.exp(-Math.pow((x - 23) / 9, 2)) * (0.42 + 0.15 * Math.cos(simTimeSec * 0.3));
  const hotspotCrosswalk = Math.exp(-Math.pow((x - 1) / 8, 2)) * (0.22 + 0.18 * Math.sin(simTimeSec * 0.6));

  const distanceFromRoad = Math.abs(z - 2.0);
  const roadDecay = Math.exp(-distanceFromRoad / 11.5);
  const spatialMultiplier =
    (0.55 + hotspotTraffic + hotspotConstruction + hotspotCrosswalk) *
    roadDecay *
    windTowardSidewalk *
    dilutionFactor;

  // Pedestrian crowd proximity factor (respiration CO2 + foot-traffic dust resuspension along sidewalk z=-5.6)
  const sidewalkProximity = Math.exp(-Math.abs(z + 5.6) / 6.0);
  const popCount = Math.max(5, env.populationCount ?? 24);
  const crowdCo2Boost = (popCount * 0.75) * sidewalkProximity * dilutionFactor;
  const crowdPmResuspension = (popCount * 0.08) * sidewalkProximity * dilutionFactor;

  const pm25 = 16 + 148 * load * spatialMultiplier + crowdPmResuspension;
  const pm10 = pm25 * (1.68 + 0.22 * hotspotConstruction);
  const no2 = 18 + 115 * load * (0.6 + hotspotTraffic + 0.5 * hotspotCrosswalk) * dilutionFactor;
  const so2 = 6 + 34 * load * (0.5 + hotspotConstruction) * dilutionFactor;
  const co2 = 415 + 260 * load * (0.65 + hotspotTraffic + 0.4 * hotspotCrosswalk) * dilutionFactor + crowdCo2Boost;
  const o3 = 24 + 28 * (env.solarIrradianceWm2 / 1000) * (1 - 0.25 * load);
  const tvoc = 85 + 320 * load * (0.6 + hotspotTraffic) * dilutionFactor + popCount * 0.25 * sidewalkProximity;

  return {
    pm25: round2(pm25),
    pm10: round2(pm10),
    no2: round2(no2),
    so2: round2(so2),
    co2: round2(co2),
    o3: round2(o3),
    tvoc: round2(tvoc),
  };
}

/**
 * Bifacial 50 W PV harvest model accounting for temperature derating.
 */
export function computePvHarvestW(solarIrradianceWm2: number, ambientTempC: number): number {
  const irradRatio = Math.max(0, Math.min(1.15, solarIrradianceWm2 / 1000));
  const bifacialGain = 1.12;
  const cellTemp = ambientTempC + 0.025 * solarIrradianceWm2;
  const tempDerating = Math.max(0.75, 1 - 0.0038 * Math.max(0, cellTemp - 25));
  return round2(NOMINAL_PV_RATING_W * irradRatio * bifacialGain * tempDerating);
}

/**
 * Eq. (2): Monod specific growth rate mu = mu_max * S / (Ks + S),
 * modulated by light response, temperature, and strain pH band.
 */
export function computeMonodGrowthRate(
  strain: AlgalStrain,
  co2Ppm: number,
  solarIrradianceWm2: number,
  tempC: number,
  ph: number
): number {
  const k = STRAIN_PARAMS[strain];
  const substrateS = Math.max(0, co2Ppm - 180);
  const monod = (k.muMaxH * substrateS) / (k.ksPpm + substrateS);
  const lightFactor = Math.min(1.0, Math.max(0.12, solarIrradianceWm2 / 650));
  const tempFactor = Math.exp(-Math.pow((tempC - k.optimalTempC) / 12, 2));
  const inPhRange = ph >= k.optimalPhMin && ph <= k.optimalPhMax;
  const phFactor = inPhRange ? 1.0 : Math.max(0.15, 1 - Math.abs(ph - (k.optimalPhMin + k.optimalPhMax) / 2) * 0.35);
  return round4(monod * lightFactor * tempFactor * phFactor);
}

/**
 * Eq. (5): Gas mass removal rate R_CO2 = (Cin - Cout) * Q * M_CO2
 */
export function computeCo2MassRateGh(
  co2InPpm: number,
  co2OutPpm: number,
  flowM3h: number,
  tempC: number
): number {
  const deltaPpm = Math.max(0, co2InPpm - co2OutPpm);
  const tempK = tempC + 273.15;
  const molarVolumeL = 0.082057 * tempK;
  const molesCo2PerM3 = (deltaPpm * 1e-3) / molarVolumeL;
  const gramsPerM3 = molesCo2PerM3 * MOLAR_MASS_CO2_G_MOL;
  return round3(gramsPerM3 * flowM3h);
}

/**
 * Eq. (3): Treatment efficiency eta = [(Cin - Cout) / Cin] * 100
 */
export function computeRemovalEfficiencyPct(cIn: number, cOut: number): number {
  if (cIn <= 0) return 0;
  return round2(Math.max(0, Math.min(99.5, ((cIn - cOut) / cIn) * 100)));
}

/**
 * Colorimetric RGB tracing for KMnO4-impregnated activated carbon media.
 */
export function computeColorimetricRgb(remainingPct: number): [number, number, number] {
  const t = Math.max(0, Math.min(1, remainingPct / 100));
  const r = Math.round(146 + (126 - 146) * t);
  const g = Math.round(108 + (40 - 108) * t);
  const b = Math.round(68 + (148 - 68) * t);
  return [r, g, b];
}

/**
 * Local Safety & Fallback Rule Engine (Section VI.C & X.A-B):
 * Always overrides AI/Swarm commands when operator power state, energy, biology, or sensor bounds trigger.
 */
export function applySafetyRuleEngine(
  requestedDuty: number,
  node: SmartTransducerNodeState,
  treatmentConfig: TreatmentConfig
): {
  safeDuty: number;
  pbrIsolated: boolean;
  chemicalActive: boolean;
  override: SafetyOverrideCode;
} {
  if (node.enabled === false) {
    return {
      safeDuty: 0,
      pbrIsolated: true,
      chemicalActive: false,
      override: 'POD_DEACTIVATED_BY_OPERATOR',
    };
  }

  let safeDuty = Math.max(0, Math.min(1, requestedDuty));
  let pbrIsolated = !treatmentConfig.biologicalPbrStage;
  let chemicalActive = treatmentConfig.chemicalAdsorptionStage;
  let override: SafetyOverrideCode = null;

  const strainBounds = STRAIN_PARAMS[node.pbr.strain];
  const phOutOfRange =
    node.manual_fault_ph_drift ||
    node.pbr.ph < strainBounds.optimalPhMin - 0.3 ||
    node.pbr.ph > strainBounds.optimalPhMax + 0.3;

  if (phOutOfRange && treatmentConfig.biologicalPbrStage) {
    pbrIsolated = true;
    override = 'PBR_PH_ISOLATED';
  }

  if (node.media.carbon_kmno4_remaining_pct <= 5 && chemicalActive) {
    chemicalActive = false;
    override = override ?? 'MEDIA_SATURATED_BYPASS';
  }

  if (node.confidence_score < 0.55) {
    safeDuty = Math.min(safeDuty, 0.35);
    override = 'SENSOR_PLAUSIBILITY_FALLBACK';
  }

  const effectiveSoc = node.manual_fault_low_batt ? Math.min(node.battery_soc, 14) : node.battery_soc;
  if (effectiveSoc < 18) {
    safeDuty = Math.min(safeDuty, 0.2);
    override = 'LOW_BATTERY_FAN_CAP';
  }

  return { safeDuty, pbrIsolated, chemicalActive, override };
}

/**
 * Advances a single Bio-Solar Swarm node by dtSeconds.
 */
export function stepNodePhysics(
  prev: SmartTransducerNodeState,
  requestedDuty: number,
  env: EnvironmentParams,
  simTimeSec: number,
  dtSeconds: number
): SmartTransducerNodeState {
  const effectiveStrain = env.strain;
  const cin = computeLocalAmbientPollution(prev.position.x, prev.position.z, env, simTimeSec);

  const nextNode: SmartTransducerNodeState = {
    ...prev,
    pbr: { ...prev.pbr, strain: effectiveStrain },
    media: { ...prev.media },
  };

  if (prev.manual_fault_ph_drift) {
    nextNode.pbr.ph = effectiveStrain === 'Spirulina_platensis' ? 6.9 : 5.4;
  } else {
    const targetNominalPh = effectiveStrain === 'Spirulina_platensis' ? 9.2 : 7.35;
    nextNode.pbr.ph = round2(prev.pbr.ph + (targetNominalPh - prev.pbr.ph) * Math.min(1, dtSeconds * 0.4));
  }

  const safety = applySafetyRuleEngine(requestedDuty, nextNode, env.treatmentConfig);
  const fanDuty = safety.safeDuty;

  const dpFactor = Math.max(0.65, 1 - (prev.media.prefilter_dp_pa - 18) / 280);
  const flowM3h = prev.enabled === false ? 0 : round2(MAX_AIRFLOW_M3_H * fanDuty * dpFactor);

  // Eq. (4) Power loads
  const fanPowerW =
    prev.enabled === false
      ? 0
      : round2(MAX_FAN_POWER_W * Math.pow(fanDuty, 2.35) * (1 + (prev.media.prefilter_dp_pa - 18) / 300));
  const pumpPowerW = prev.enabled === false || safety.pbrIsolated ? 0 : round2(1.4 + 2.6 * fanDuty);
  const senseCommCtrlW =
    prev.enabled === false ? 0.25 : round2(1.6 + (env.activeMode === 'swarm_pso_aco' ? 0.55 : 0.25));
  const pvHarvestW = computePvHarvestW(env.solarIrradianceWm2, env.ambientTempC);
  const totalLoadW = fanPowerW + pumpPowerW + senseCommCtrlW;
  const netPowerW = round2(pvHarvestW - totalLoadW);

  const deltaWh = (netPowerW * dtSeconds) / 3600;
  const chargeEff = deltaWh >= 0 ? 0.92 : 1.0 / 0.94;
  const rawSoc = prev.manual_fault_low_batt
    ? Math.min(prev.battery_soc, 14.5)
    : prev.battery_soc + ((deltaWh * chargeEff) / BATTERY_CAPACITY_WH) * 100;
  const batterySoc = round2(Math.max(5, Math.min(100, rawSoc)));

  const residenceFactor = fanDuty > 0.02 ? 1.0 - 0.18 * Math.max(0, fanDuty - 0.55) : 0;

  const pmEta =
    prev.enabled !== false && env.treatmentConfig.particulateStage && fanDuty > 0.02
      ? Math.min(0.84, 0.72 * residenceFactor + 0.06)
      : 0;
  const pm25Out = round2(cin.pm25 * (1 - pmEta));
  const pm10Out = round2(cin.pm10 * (1 - pmEta * 1.05));

  const mediaFraction = Math.max(0, prev.media.carbon_kmno4_remaining_pct / 100);
  const chemEta =
    prev.enabled !== false && safety.chemicalActive && fanDuty > 0.02
      ? Math.min(0.76, 0.64 * residenceFactor * (0.4 + 0.6 * mediaFraction))
      : 0;
  const no2Out = round2(cin.no2 * (1 - chemEta));
  const so2Out = round2(cin.so2 * (1 - chemEta * 1.06));
  const tvocOut = round2(
    prev.enabled === false ? cin.tvoc : cin.tvoc * (1 - (chemEta * 0.55 + (safety.pbrIsolated ? 0 : 0.24)))
  );

  const mu = computeMonodGrowthRate(
    effectiveStrain,
    cin.co2,
    env.solarIrradianceWm2,
    env.ambientTempC,
    nextNode.pbr.ph
  );
  const bioEta =
    prev.enabled !== false && !safety.pbrIsolated && fanDuty > 0.02
      ? Math.min(0.42, (mu / STRAIN_PARAMS[effectiveStrain].muMaxH) * 0.34 * residenceFactor)
      : 0;
  const co2Out = round2(prev.enabled === false ? cin.co2 : Math.max(360, cin.co2 * (1 - bioEta)));
  const o3Out = round2(cin.o3 * (1 - chemEta * 0.35));

  const cout: PollutantVector = {
    pm25: pm25Out,
    pm10: pm10Out,
    no2: no2Out,
    so2: so2Out,
    co2: co2Out,
    o3: o3Out,
    tvoc: tvocOut,
  };

  const co2MassRateGh = computeCo2MassRateGh(cin.co2, cout.co2, flowM3h, env.ambientTempC);
  const o2EvolutionGh = round3(co2MassRateGh * (192 / 264));

  const dustGainPa =
    prev.enabled !== false && env.treatmentConfig.particulateStage ? (cin.pm25 * flowM3h * dtSeconds) / 950000 : 0;
  const prefilterDpPa = round2(Math.min(180, prev.media.prefilter_dp_pa + dustGainPa));
  const mediaWearPct =
    prev.enabled !== false && safety.chemicalActive ? ((cin.no2 + cin.so2) * flowM3h * dtSeconds) / 1450000 : 0;
  const mediaRemaining = round2(Math.max(2, prev.media.carbon_kmno4_remaining_pct - mediaWearPct));

  const nextOd = round4(
    Math.min(2.4, prev.pbr.optical_density + (safety.pbrIsolated || prev.enabled === false ? 0 : mu * 0.012 * (dtSeconds / 60)))
  );
  const algaeHealth = round2(
    safety.pbrIsolated
      ? Math.max(0.32, prev.pbr.algae_health_score - 0.002 * dtSeconds)
      : Math.min(0.99, 0.65 + (mu / STRAIN_PARAMS[effectiveStrain].muMaxH) * 0.34)
  );

  return {
    ...nextNode,
    timestamp: Date.now(),
    cin,
    cout,
    pm25_removal_pct: computeRemovalEfficiencyPct(cin.pm25, cout.pm25),
    no2_removal_pct: computeRemovalEfficiencyPct(cin.no2, cout.no2),
    co2_removal_pct: computeRemovalEfficiencyPct(cin.co2, cout.co2),
    temperature: env.ambientTempC,
    humidity: env.ambientHumidityPct,
    flow_m3_h: flowM3h,
    fan_duty: round3(fanDuty),
    fan_power_w: fanPowerW,
    pump_power_w: pumpPowerW,
    sense_comm_ctrl_w: senseCommCtrlW,
    pv_harvest_w: pvHarvestW,
    net_power_w: netPowerW,
    battery_soc: batterySoc,
    pbr: {
      ph: nextNode.pbr.ph,
      optical_density: nextOd,
      specific_growth_rate_h: mu,
      co2_mass_rate_gh: co2MassRateGh,
      o2_evolution_gh: o2EvolutionGh,
      algae_health_score: algaeHealth,
      strain: effectiveStrain,
      isolated: safety.pbrIsolated,
    },
    media: {
      carbon_kmno4_remaining_pct: mediaRemaining,
      colorimetric_rgb: computeColorimetricRgb(mediaRemaining),
      prefilter_dp_pa: prefilterDpPa,
      needs_service: mediaRemaining < 20 || prefilterDpPa > 125,
    },
    control_mode: env.activeMode,
    safety_override: safety.override,
    pso_target_duty: prev.enabled === false ? 0 : round3(requestedDuty),
    hardware_source: prev.hardware_source,
  };
}

/**
 * Evaluates pedestrian breathing-zone exposure along the sidewalk (z = -5.6),
 * comparing centralized remote tower dilution vs street-level decentralized pod capture.
 */
export function computePedestrianExposure(
  nodes: SmartTransducerNodeState[],
  tower: CentralTowerState,
  env: EnvironmentParams,
  simTimeSec: number
): {
  pedestrianPm25: number;
  pedestrianNo2: number;
  pedestrianCo2: number;
  pedestrianAqi: number;
  aqiCategory: 'Optimal' | 'Moderate' | 'Unhealthy for Sensitive' | 'Unhealthy' | 'Very Unhealthy';
  verifiedReductionRvPct: number;
} {
  const sampleXs = [-22, -11, 0, 11, 22];
  let baselinePm25Sum = 0;
  let baselineNo2Sum = 0;
  let baselineCo2Sum = 0;

  let treatedPm25Sum = 0;
  let treatedNo2Sum = 0;
  let treatedCo2Sum = 0;

  for (const px of sampleXs) {
    const ambient = computeLocalAmbientPollution(px, -5.6, env, simTimeSec);
    baselinePm25Sum += ambient.pm25;
    baselineNo2Sum += ambient.no2;
    baselineCo2Sum += ambient.co2;

    let localPmCapture = 0;
    let localNo2Capture = 0;
    let localCo2Capture = 0;

    for (const node of nodes) {
      if (node.enabled === false) continue;
      const dist = Math.hypot(px - node.position.x, -5.6 - node.position.z);
      const windDispersion = 1 / (1 + 0.11 * env.windSpeedMs);
      const influence = Math.exp(-Math.pow(dist / 7.5, 2)) * (node.flow_m3_h / MAX_AIRFLOW_M3_H) * windDispersion;
      localPmCapture += (node.pm25_removal_pct / 100) * influence * 0.72;
      localNo2Capture += (node.no2_removal_pct / 100) * influence * 0.68;
      localCo2Capture += (node.co2_removal_pct / 100) * influence * 0.52;
    }

    const towerImpact = tower.active ? (tower.pedestrian_zone_impact_pct / 100) : 0;

    const pmFactor = Math.max(0.22, 1 - Math.min(0.75, localPmCapture + towerImpact));
    const no2Factor = Math.max(0.26, 1 - Math.min(0.70, localNo2Capture + towerImpact * 0.8));
    const co2Factor = Math.max(0.65, 1 - Math.min(0.32, localCo2Capture + towerImpact * 0.3));

    treatedPm25Sum += ambient.pm25 * pmFactor;
    treatedNo2Sum += ambient.no2 * no2Factor;
    treatedCo2Sum += ambient.co2 * co2Factor;
  }

  const n = sampleXs.length;
  const baselinePm25 = baselinePm25Sum / n;
  const pedestrianPm25 = round2(treatedPm25Sum / n);
  const pedestrianNo2 = round2(treatedNo2Sum / n);
  const pedestrianCo2 = round2(treatedCo2Sum / n);
  const pedestrianAqi = pm25ToUsAqi(pedestrianPm25);
  const verifiedReductionRvPct = round2(
    Math.max(0, ((baselinePm25 - pedestrianPm25) / Math.max(1, baselinePm25)) * 100)
  );

  return {
    pedestrianPm25,
    pedestrianNo2,
    pedestrianCo2,
    pedestrianAqi,
    aqiCategory: classifyAqi(pedestrianAqi),
    verifiedReductionRvPct,
  };
}

/**
 * Standard US EPA PM2.5 -> AQI breakpoint conversion.
 */
export function pm25ToUsAqi(pm25: number): number {
  const c = Math.max(0, pm25);
  const bps: Array<[number, number, number, number]> = [
    [0.0, 12.0, 0, 50],
    [12.1, 35.4, 51, 100],
    [35.5, 55.4, 101, 150],
    [55.5, 150.4, 151, 200],
    [150.5, 250.4, 201, 300],
    [250.5, 500.4, 301, 500],
  ];
  for (const [cLow, cHigh, iLow, iHigh] of bps) {
    if (c <= cHigh) {
      return Math.round(((iHigh - iLow) / (cHigh - cLow)) * (c - cLow) + iLow);
    }
  }
  return 500;
}

export function classifyAqi(
  aqi: number
): 'Optimal' | 'Moderate' | 'Unhealthy for Sensitive' | 'Unhealthy' | 'Very Unhealthy' {
  if (aqi <= 50) return 'Optimal';
  if (aqi <= 100) return 'Moderate';
  if (aqi <= 150) return 'Unhealthy for Sensitive';
  if (aqi <= 200) return 'Unhealthy';
  return 'Very Unhealthy';
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
