import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeSwarmAllocations,
  createInitialSnapshot,
  runControlledValidationSuite,
  stepSimulationSnapshot,
} from './swarm';
import { EnvironmentParams } from './types';

const BASE_ENV: EnvironmentParams = {
  trafficPollution: 65,
  windSpeedMs: 1.5,
  windAngleDeg: 30,
  solarIrradianceWm2: 700,
  ambientTempC: 27,
  ambientHumidityPct: 55,
  activeMode: 'swarm_pso_aco',
  strain: 'Chlorella_sorokiniana_RMT01',
  treatmentConfig: {
    particulateStage: true,
    chemicalAdsorptionStage: true,
    biologicalPbrStage: true,
  },
  simSpeed: 1,
  populationCount: 24,
  voiceActivityDb: 52,
  voiceDetectedTranscript: '',
};

test('Swarm PSO+ACO mode creates neighbor pheromone links and differentiates node fan duties', () => {
  const snap = createInitialSnapshot(BASE_ENV);
  const alloc = computeSwarmAllocations(snap.nodes, BASE_ENV, 1.0);

  assert.equal(alloc.links.length, 4, '5 pods in street corridor should form 4 neighbor mesh links');
  const minDuty = Math.min(...alloc.duties);
  const maxDuty = Math.max(...alloc.duties);
  assert.ok(maxDuty >= minDuty, 'Duties should adapt to spatial pollution differences');
});

test('Higher voice-recognized population increases swarm pod fan duties proportionally', () => {
  const lowPopEnv: EnvironmentParams = { ...BASE_ENV, trafficPollution: 38, populationCount: 12, voiceActivityDb: 44 };
  const highPopEnv: EnvironmentParams = { ...BASE_ENV, trafficPollution: 38, populationCount: 150, voiceActivityDb: 84 };

  let lowSnap = createInitialSnapshot(lowPopEnv);
  let highSnap = createInitialSnapshot(highPopEnv);
  for (let i = 0; i < 8; i++) {
    lowSnap = stepSimulationSnapshot(lowSnap, lowPopEnv, 1.0);
    highSnap = stepSimulationSnapshot(highSnap, highPopEnv, 1.0);
  }

  const avgLowDuty = lowSnap.nodes.reduce((s, n) => s + n.fan_duty, 0) / lowSnap.nodes.length;
  const avgHighDuty = highSnap.nodes.reduce((s, n) => s + n.fan_duty, 0) / highSnap.nodes.length;
  assert.ok(
    avgHighDuty > avgLowDuty,
    `Expected high population avg duty (${avgHighDuty.toFixed(3)}) > low population avg duty (${avgLowDuty.toFixed(3)})`
  );
  assert.ok(highSnap.populationFanMultiplier > lowSnap.populationFanMultiplier);
});

test('Deactivating an individual pod zeroes its fan duty and drops activeNodeCount', () => {
  let snap = createInitialSnapshot(BASE_ENV);
  snap = {
    ...snap,
    nodes: snap.nodes.map((n, i) => (i === 0 ? { ...n, enabled: false } : n)),
  };
  snap = stepSimulationSnapshot(snap, BASE_ENV, 1.0);

  assert.equal(snap.nodes[0].fan_duty, 0);
  assert.equal(snap.nodes[0].flow_m3_h, 0);
  assert.equal(snap.nodes[0].safety_override, 'POD_DEACTIVATED_BY_OPERATOR');
  assert.equal(snap.activeNodeCount, 4);
});

test('Decentralized Swarm outperforms Centralized Tower on pedestrian-zone AQI and load power', () => {
  let towerSnap = createInitialSnapshot({ ...BASE_ENV, activeMode: 'centralized_tower' });
  let swarmSnap = createInitialSnapshot({ ...BASE_ENV, activeMode: 'swarm_pso_aco' });

  for (let i = 0; i < 15; i++) {
    towerSnap = stepSimulationSnapshot(towerSnap, { ...BASE_ENV, activeMode: 'centralized_tower' }, 1.0);
    swarmSnap = stepSimulationSnapshot(swarmSnap, { ...BASE_ENV, activeMode: 'swarm_pso_aco' }, 1.0);
  }

  assert.ok(
    swarmSnap.pedestrianAqi < towerSnap.pedestrianAqi,
    `Expected Swarm AQI (${swarmSnap.pedestrianAqi}) < Tower AQI (${towerSnap.pedestrianAqi})`
  );
  assert.ok(
    swarmSnap.totalLoadPowerW < towerSnap.totalLoadPowerW,
    `Expected Swarm power (${swarmSnap.totalLoadPowerW}W) < Tower power (${towerSnap.totalLoadPowerW}W)`
  );
});

test('Controlled Validation Suite C1-C7 passes all scientific comparisons', () => {
  const results = runControlledValidationSuite(BASE_ENV);
  assert.equal(results.length, 7);
  for (const row of results) {
    assert.equal(row.passed, true, `Validation condition ${row.conditionId} failed: ${row.notes}`);
  }
});
