/**
 * Bio-Solar Swarm: Distributed PSO + ACO Swarm Intelligence & Table III Validation Runner
 * Implements Eq. (J = Rv - lambda*E - mu*B - nu*M), voice-detected population fan scaling,
 * individual pod activation filtering, and control policy comparisons.
 */

import {
  computePedestrianExposure,
  createInitialNodes,
  stepNodePhysics,
} from './physics';
import {
  CentralTowerState,
  EnvironmentParams,
  SimulationSnapshot,
  SmartTransducerNodeState,
  SwarmEdgeLink,
  ValidationConditionResult,
} from './types';
import { computePopulationFanMultiplier } from './voicePopulation';

export interface ObjectiveWeights {
  lambdaEnergy: number;
  muBioStress: number;
  nuMediaWear: number;
}

export const DEFAULT_WEIGHTS: ObjectiveWeights = {
  lambdaEnergy: 0.34,
  muBioStress: 0.28,
  nuMediaWear: 0.16,
};

/**
 * Evaluates constrained optimization objective J = Rv - lambda*E - mu*B - nu*M
 * for a candidate fan duty (0..1) on a given node, scaled by acoustic/voice population demand.
 */
export function evaluatePsoCandidateObjective(
  duty: number,
  node: SmartTransducerNodeState,
  neighborMeanPm25: number,
  acoPheromone: number,
  populationCount = 24,
  weights: ObjectiveWeights = DEFAULT_WEIGHTS
): number {
  if (node.enabled === false) {
    return duty === 0 ? 1 : -10;
  }

  const effectivePm25 = 0.72 * node.cin.pm25 + 0.28 * neighborMeanPm25;
  const popMultiplier = computePopulationFanMultiplier(populationCount);
  const pollutionDemand = Math.min(2.6, (effectivePm25 / 95) * popMultiplier);

  // Verified remediation gain Rv scales sub-linearly with airflow and population-weighted exposure
  const rv = pollutionDemand * (1 - Math.exp(-2.8 * duty)) * (1 + 0.25 * acoPheromone);

  // Energy penalty E scales with fan power curve and battery urgency (relaxed slightly under high crowd urgency)
  const socPenalty = node.battery_soc < 35 ? 2.4 : node.battery_soc < 55 ? 1.35 : 0.85;
  const energyPenalty = weights.lambdaEnergy * Math.pow(duty, 2.35) * socPenalty;

  const bioStress = node.pbr.isolated ? 0.55 : Math.max(0, 1 - node.pbr.algae_health_score);
  const bioPenalty = weights.muBioStress * duty * bioStress;

  const mediaUrgency = node.media.carbon_kmno4_remaining_pct < 25 ? 1.8 : 0.6;
  const mediaPenalty = weights.nuMediaWear * duty * mediaUrgency;

  return rv - energyPenalty - bioPenalty - mediaPenalty;
}

/**
 * Computes swarm neighbor links and ACO pheromone trails + PSO duty allocation.
 */
export function computeSwarmAllocations(
  nodes: SmartTransducerNodeState[],
  env: EnvironmentParams,
  dtSeconds: number
): {
  duties: number[];
  pheromones: number[];
  links: SwarmEdgeLink[];
} {
  const count = nodes.length;
  const duties = new Array<number>(count).fill(0);
  const pheromones = new Array<number>(count).fill(0);
  const links: SwarmEdgeLink[] = [];
  const popMultiplier = computePopulationFanMultiplier(env.populationCount ?? 24);

  if (env.activeMode === 'centralized_tower') {
    for (let i = 0; i < count; i++) {
      duties[i] = nodes[i].enabled === false ? 0 : 0.04;
      pheromones[i] = Math.max(0.05, nodes[i].aco_pheromone * (1 - 0.15 * dtSeconds));
    }
    return { duties, pheromones, links };
  }

  if (env.activeMode === 'fixed_duty') {
    for (let i = 0; i < count; i++) {
      duties[i] = nodes[i].enabled === false ? 0 : 0.65;
      pheromones[i] = 0.2;
    }
    return { duties, pheromones, links };
  }

  if (env.activeMode === 'independent_local') {
    for (let i = 0; i < count; i++) {
      const n = nodes[i];
      if (n.enabled === false) {
        duties[i] = 0;
        pheromones[i] = 0.05;
        continue;
      }
      const localDemand = Math.min(1, Math.max(0.15, ((n.cin.pm25 - 18) / 110) * popMultiplier));
      duties[i] = n.battery_soc < 25 ? Math.min(localDemand, 0.3) : localDemand;
      pheromones[i] = Math.min(1, n.cin.pm25 / 140);
    }
    return { duties, pheromones, links };
  }

  // SWARM PSO + ACO COORDINATED MODE:
  const evaporation = Math.exp(-0.18 * dtSeconds);
  const windRad = (env.windAngleDeg * Math.PI) / 180;
  const windX = Math.cos(windRad);

  for (let i = 0; i < count; i++) {
    const n = nodes[i];
    if (n.enabled === false) {
      pheromones[i] = Math.max(0.04, n.aco_pheromone * evaporation);
      continue;
    }
    const deposit = Math.min(0.75, Math.max(0, (n.cin.pm25 - 18) / 130) * popMultiplier) * 0.35;
    let neighborPull = 0;
    if (i > 0 && nodes[i - 1].enabled !== false) {
      const upwindFactor = windX > 0 ? 1.25 : 0.75;
      neighborPull += nodes[i - 1].aco_pheromone * 0.16 * upwindFactor;
    }
    if (i < count - 1 && nodes[i + 1].enabled !== false) {
      const downwindFactor = windX < 0 ? 1.25 : 0.75;
      neighborPull += nodes[i + 1].aco_pheromone * 0.16 * downwindFactor;
    }
    pheromones[i] = Math.max(0.08, Math.min(1.0, n.aco_pheromone * evaporation + deposit + neighborPull));
  }

  for (let i = 0; i < count - 1; i++) {
    const bothEnabled = nodes[i].enabled !== false && nodes[i + 1].enabled !== false;
    const avgPheromone = (pheromones[i] + pheromones[i + 1]) / 2;
    links.push({
      fromId: nodes[i].node_id,
      toId: nodes[i + 1].node_id,
      pheromoneWeight: Math.round(avgPheromone * 1000) / 1000,
      active: bothEnabled && avgPheromone > 0.18,
      packetRateHz: bothEnabled ? (avgPheromone > 0.45 ? 2.0 : 0.5) : 0,
    });
  }

  const candidates = [0.1, 0.22, 0.35, 0.48, 0.62, 0.76, 0.88, 1.0];
  for (let i = 0; i < count; i++) {
    const n = nodes[i];
    if (n.enabled === false) {
      duties[i] = 0;
      continue;
    }
    const neighborVals: number[] = [];
    if (i > 0 && nodes[i - 1].enabled !== false) neighborVals.push(nodes[i - 1].cin.pm25);
    if (i < count - 1 && nodes[i + 1].enabled !== false) neighborVals.push(nodes[i + 1].cin.pm25);
    const neighborMean =
      neighborVals.length > 0
        ? neighborVals.reduce((a, b) => a + b, 0) / neighborVals.length
        : n.cin.pm25;

    let bestDuty = 0.25;
    let bestScore = -Infinity;
    for (const cDuty of candidates) {
      const score = evaluatePsoCandidateObjective(
        cDuty,
        n,
        neighborMean,
        pheromones[i],
        env.populationCount ?? 24
      );
      if (score > bestScore) {
        bestScore = score;
        bestDuty = cDuty;
      }
    }
    duties[i] = n.pso_target_duty + (bestDuty - n.pso_target_duty) * Math.min(1, dtSeconds * 1.5);
  }

  return { duties, pheromones, links };
}

/**
 * Steps the entire Bio-Solar Swarm simulation snapshot forward by dtSeconds.
 */
export function stepSimulationSnapshot(
  prev: SimulationSnapshot,
  env: EnvironmentParams,
  dtSeconds: number
): SimulationSnapshot {
  const simTimeSec = prev.simTimeSec + dtSeconds;
  const allocation = computeSwarmAllocations(prev.nodes, env, dtSeconds);

  const nextNodes = prev.nodes.map((node, idx) => {
    const stepped = stepNodePhysics(node, allocation.duties[idx], env, simTimeSec, dtSeconds);
    return {
      ...stepped,
      aco_pheromone: Math.round(allocation.pheromones[idx] * 1000) / 1000,
    };
  });

  const towerActive = env.activeMode === 'centralized_tower';
  const tower: CentralTowerState = {
    active: towerActive,
    position: { x: 16, z: -22 },
    power_w: towerActive ? 3800 : 0,
    flow_m3_h: towerActive ? 14000 : 0,
    chamber_removal_pct: towerActive ? 78 : 0,
    pedestrian_zone_impact_pct: towerActive ? Math.max(6, 17 - env.windSpeedMs * 1.8) : 0,
  };

  const exposure = computePedestrianExposure(nextNodes, tower, env, simTimeSec);

  const totalPvPowerW = round2(nextNodes.reduce((s, n) => s + n.pv_harvest_w, 0));
  const totalNodeLoadW = round2(
    nextNodes.reduce((s, n) => s + n.fan_power_w + n.pump_power_w + n.sense_comm_ctrl_w, 0)
  );
  const totalLoadPowerW = round2(totalNodeLoadW + tower.power_w);
  const totalNetPowerW = round2(totalPvPowerW - totalLoadPowerW);

  const co2StepG = nextNodes.reduce((s, n) => s + (n.pbr.co2_mass_rate_gh * dtSeconds) / 3600, 0);
  const pm25StepMg = nextNodes.reduce(
    (s, n) => s + (Math.max(0, n.cin.pm25 - n.cout.pm25) * n.flow_m3_h * dtSeconds) / (3600 * 1000),
    0
  );

  const activeNodeCount =
    env.activeMode === 'centralized_tower'
      ? 0
      : nextNodes.filter((n) => n.enabled !== false && n.fan_duty > 0.12).length;

  return {
    tick: prev.tick + 1,
    simTimeSec: round2(simTimeSec),
    pedestrianPm25: exposure.pedestrianPm25,
    pedestrianNo2: exposure.pedestrianNo2,
    pedestrianCo2: exposure.pedestrianCo2,
    pedestrianAqi: exposure.pedestrianAqi,
    aqiCategory: exposure.aqiCategory,
    verifiedReductionRvPct: exposure.verifiedReductionRvPct,
    totalNetPowerW,
    totalPvPowerW,
    totalLoadPowerW,
    totalCo2CapturedG: round2(prev.totalCo2CapturedG + co2StepG),
    totalPm25CapturedMg: round2(prev.totalPm25CapturedMg + pm25StepMg),
    activeNodeCount,
    populationCount: env.populationCount ?? 24,
    voiceActivityDb: env.voiceActivityDb ?? 52,
    populationFanMultiplier: computePopulationFanMultiplier(env.populationCount ?? 24),
    nodes: nextNodes,
    links: allocation.links,
    tower,
    environment: { ...env },
  };
}

export function createInitialSnapshot(env: EnvironmentParams): SimulationSnapshot {
  const nodes = createInitialNodes(env);
  const seed: SimulationSnapshot = {
    tick: 0,
    simTimeSec: 0,
    pedestrianPm25: 55,
    pedestrianNo2: 45,
    pedestrianCo2: 495,
    pedestrianAqi: 149,
    aqiCategory: 'Unhealthy for Sensitive',
    verifiedReductionRvPct: 0,
    totalNetPowerW: 0,
    totalPvPowerW: 0,
    totalLoadPowerW: 0,
    totalCo2CapturedG: 0,
    totalPm25CapturedMg: 0,
    activeNodeCount: env.activeMode === 'centralized_tower' ? 0 : 5,
    populationCount: env.populationCount ?? 24,
    voiceActivityDb: env.voiceActivityDb ?? 52,
    populationFanMultiplier: computePopulationFanMultiplier(env.populationCount ?? 24),
    nodes,
    links: [],
    tower: {
      active: env.activeMode === 'centralized_tower',
      position: { x: 16, z: -22 },
      power_w: env.activeMode === 'centralized_tower' ? 3800 : 0,
      flow_m3_h: env.activeMode === 'centralized_tower' ? 14000 : 0,
      chamber_removal_pct: env.activeMode === 'centralized_tower' ? 78 : 0,
      pedestrian_zone_impact_pct: 14,
    },
    environment: { ...env },
  };
  return stepSimulationSnapshot(seed, env, 0.5);
}

function simulateScenario(env: EnvironmentParams, steps = 20, dt = 1.0): SimulationSnapshot {
  let snap = createInitialSnapshot(env);
  for (let i = 0; i < steps; i++) {
    snap = stepSimulationSnapshot(snap, env, dt);
  }
  return snap;
}

export function runControlledValidationSuite(baseEnv: EnvironmentParams): ValidationConditionResult[] {
  const results: ValidationConditionResult[] = [];

  const c1Off = simulateScenario({
    ...baseEnv,
    activeMode: 'fixed_duty',
    treatmentConfig: { particulateStage: false, chemicalAdsorptionStage: false, biologicalPbrStage: false },
  });
  const c1On = simulateScenario({
    ...baseEnv,
    activeMode: 'fixed_duty',
    treatmentConfig: { particulateStage: true, chemicalAdsorptionStage: true, biologicalPbrStage: true },
  });
  results.push(buildValidationRow(
    'C1',
    'Node ON vs. OFF under matched flow',
    'Treatment OFF vs. Full Hybrid ON',
    'Baseline treatment effect',
    'Control (OFF)',
    'Treatment (ON)',
    c1Off,
    c1On,
    c1On.verifiedReductionRvPct > c1Off.verifiedReductionRvPct + 10,
    'Verifies measurable downstream reduction vs matched airflow control.'
  ));

  const c2Low = simulateScenario({ ...baseEnv, activeMode: 'centralized_tower' });
  const c2High = simulateScenario({ ...baseEnv, activeMode: 'fixed_duty' });
  results.push(buildValidationRow(
    'C2',
    'High vs. low duty cycle',
    'Standby / Remote vs. 65% Street Duty',
    'Energy-versus-removal trade-off',
    'Low / Tower',
    '65% Fixed Street',
    c2Low,
    c2High,
    c2High.pedestrianAqi < c2Low.pedestrianAqi,
    'Quantifies fan power cubic penalty vs street-level PM2.5 capture.'
  ));

  const c3Bypass = simulateScenario({
    ...baseEnv,
    activeMode: 'fixed_duty',
    treatmentConfig: { particulateStage: true, chemicalAdsorptionStage: true, biologicalPbrStage: false },
  });
  const c3BioOn = simulateScenario({
    ...baseEnv,
    activeMode: 'fixed_duty',
    treatmentConfig: { particulateStage: true, chemicalAdsorptionStage: true, biologicalPbrStage: true },
  });
  const c3Co2Rate = round2(c3BioOn.nodes.reduce((s, n) => s + n.pbr.co2_mass_rate_gh, 0));
  results.push(buildValidationRow(
    'C3',
    'Biological stage ON vs. bypassed',
    'PBR Bypassed vs. PBR Active',
    'Biological contribution',
    'PBR Bypassed',
    'PBR Active',
    c3Bypass,
    c3BioOn,
    c3Co2Rate > 0.2,
    `Isolates CO2 biofixation (${c3Co2Rate} g/h) & O2 generation from filtration.`
  ));

  const c4BioOnly = simulateScenario({
    ...baseEnv,
    activeMode: 'fixed_duty',
    treatmentConfig: { particulateStage: false, chemicalAdsorptionStage: false, biologicalPbrStage: true },
  });
  const c4Hybrid = c1On;
  results.push(buildValidationRow(
    'C4',
    'Hybrid stage vs. biological-only',
    'PBR-Only vs. PM+Chem+PBR Hybrid',
    'Hybrid contribution',
    'Bio-Only',
    'Full Hybrid',
    c4BioOnly,
    c4Hybrid,
    c4Hybrid.verifiedReductionRvPct > c4BioOnly.verifiedReductionRvPct + 20,
    'Demonstrates why PBR alone cannot handle street PM2.5 and NO2.'
  ));

  const c5Fixed = simulateScenario({ ...baseEnv, activeMode: 'fixed_duty' });
  const c5Indep = simulateScenario({ ...baseEnv, activeMode: 'independent_local' });
  results.push(buildValidationRow(
    'C5',
    'Fixed network vs. independent nodes',
    'Fixed 65% vs. Independent Local',
    'Network-control comparison',
    'Fixed Duty',
    'Independent',
    c5Fixed,
    c5Indep,
    c5Indep.totalLoadPowerW <= c5Fixed.totalLoadPowerW * 1.15,
    'Evaluates local threshold throttling vs constant-duty operation.'
  ));

  const c6Swarm = simulateScenario({ ...baseEnv, activeMode: 'swarm_pso_aco' });
  const swarmRemPerWh = c6Swarm.verifiedReductionRvPct / Math.max(1, c6Swarm.totalLoadPowerW);
  const indepRemPerWh = c5Indep.verifiedReductionRvPct / Math.max(1, c5Indep.totalLoadPowerW);
  results.push(buildValidationRow(
    'C6',
    'Independent nodes vs. swarm',
    'Independent vs. PSO+ACO Swarm',
    'Swarm benefit',
    'Independent',
    'Swarm PSO+ACO',
    c5Indep,
    c6Swarm,
    swarmRemPerWh >= indepRemPerWh * 0.95 || c6Swarm.verifiedReductionRvPct >= c5Indep.verifiedReductionRvPct,
    'Tests spatial reallocation of remediation effort to pollution hotspots.'
  ));

  results.push(buildValidationRow(
    'C7',
    'Model-based vs. rule-based control',
    'Centralized Tower vs. Decentralized Swarm',
    'AI/control & spatial benefit',
    'Central Tower',
    'Bio-Solar Swarm',
    c2Low,
    c6Swarm,
    c6Swarm.pedestrianAqi < c2Low.pedestrianAqi && c6Swarm.totalLoadPowerW < c2Low.totalLoadPowerW,
    'Validates street-level exposure drop and huge power savings vs central tower.'
  ));

  return results;
}

function buildValidationRow(
  conditionId: ValidationConditionResult['conditionId'],
  title: string,
  comparison: string,
  purpose: string,
  baselineLabel: string,
  testLabel: string,
  baseSnap: SimulationSnapshot,
  testSnap: SimulationSnapshot,
  passed: boolean,
  notes: string
): ValidationConditionResult {
  const co2MassRateGh = round2(testSnap.nodes.reduce((s, n) => s + n.pbr.co2_mass_rate_gh, 0));
  const remPerWh = round3(testSnap.verifiedReductionRvPct / Math.max(1, testSnap.totalLoadPowerW));
  return {
    conditionId,
    title,
    comparison,
    purpose,
    baselineLabel,
    testLabel,
    baselineAqi: baseSnap.pedestrianAqi,
    testAqi: testSnap.pedestrianAqi,
    baselineRemovalPct: baseSnap.verifiedReductionRvPct,
    testRemovalPct: testSnap.verifiedReductionRvPct,
    baselinePowerW: baseSnap.totalLoadPowerW,
    testPowerW: testSnap.totalLoadPowerW,
    co2MassRateGh,
    deltaRvPct: round2(testSnap.verifiedReductionRvPct - baseSnap.verifiedReductionRvPct),
    remPerWh,
    passed,
    notes,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
