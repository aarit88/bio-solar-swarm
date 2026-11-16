import assert from 'node:assert/strict';
import test from 'node:test';
import * as d3 from 'd3';
import { computeSwarmImprovementField, HEATMAP_BOUNDS } from './heatmap';
import { createInitialSnapshot, stepSimulationSnapshot } from './swarm';
import { EnvironmentParams } from './types';

const BASE_ENV: EnvironmentParams = {
  trafficPollution: 72,
  windSpeedMs: 1.4,
  windAngleDeg: 35,
  solarIrradianceWm2: 780,
  ambientTempC: 29,
  ambientHumidityPct: 54,
  activeMode: 'swarm_pso_aco',
  strain: 'Chlorella_sorokiniana_RMT01',
  treatmentConfig: {
    particulateStage: true,
    chemicalAdsorptionStage: true,
    biologicalPbrStage: true,
  },
  simSpeed: 1,
  populationCount: 35,
  voiceActivityDb: 55,
  voiceDetectedTranscript: '',
};

test('computeSwarmImprovementField produces bounded grid and valid D3 contours', () => {
  let snap = createInitialSnapshot(BASE_ENV);
  for (let i = 0; i < 8; i++) {
    snap = stepSimulationSnapshot(snap, BASE_ENV, 0.5);
  }

  const field = computeSwarmImprovementField(snap);
  assert.equal(field.values.length, HEATMAP_BOUNDS.cols * HEATMAP_BOUNDS.rows);
  assert.ok(field.peakImprovementPct > 15, 'Active swarm pods should generate >15% peak improvement');
  assert.ok(field.meanImprovementPct > 4, 'Active swarm corridor should have positive mean improvement');

  for (const val of field.values) {
    assert.ok(Number.isFinite(val) && val >= 0 && val <= 78, `Cell value ${val} out of expected [0, 78] bounds`);
  }

  const contourGen = d3.contours().size([field.cols, field.rows]).thresholds([8, 16, 26, 38, 50, 62]);
  const polygons = contourGen(field.values);
  assert.ok(polygons.length === 6, 'D3 contour generator should emit all 6 threshold bands');
  assert.ok(
    polygons.some((p) => p.coordinates.length > 0),
    'At least one D3 contour band should contain spatial geometry'
  );
});

test('deactivating an individual pod drops local improvement in its zone', () => {
  let snap = createInitialSnapshot(BASE_ENV);
  for (let i = 0; i < 10; i++) {
    snap = stepSimulationSnapshot(snap, BASE_ENV, 0.5);
  }

  const before = computeSwarmImprovementField(snap);
  const pod03Before = before.hotspots.find((h) => h.nodeId === 'BSS-POD-03');
  assert.ok(pod03Before && pod03Before.improvementPct > 15);

  const disabledNodes = snap.nodes.map((n) =>
    n.node_id === 'BSS-POD-03' ? { ...n, enabled: false, fan_duty: 0 } : n
  );
  const afterSnap = stepSimulationSnapshot(
    { ...snap, nodes: disabledNodes },
    BASE_ENV,
    0.5
  );
  const after = computeSwarmImprovementField(afterSnap);
  const pod03After = after.hotspots.find((h) => h.nodeId === 'BSS-POD-03');

  assert.ok(pod03After, 'BSS-POD-03 hotspot entry must still exist');
  assert.equal(pod03After.enabled, false);
  assert.equal(pod03After.improvementPct, 0);
});

test('voice-detected high crowd population increases swarm heatmap remediation gain', () => {
  const lowCrowdEnv: EnvironmentParams = { ...BASE_ENV, populationCount: 12 };
  const highCrowdEnv: EnvironmentParams = { ...BASE_ENV, populationCount: 155 };

  let lowSnap = createInitialSnapshot(lowCrowdEnv);
  let highSnap = createInitialSnapshot(highCrowdEnv);
  for (let i = 0; i < 10; i++) {
    lowSnap = stepSimulationSnapshot(lowSnap, lowCrowdEnv, 0.5);
    highSnap = stepSimulationSnapshot(highSnap, highCrowdEnv, 0.5);
  }

  const lowField = computeSwarmImprovementField(lowSnap);
  const highField = computeSwarmImprovementField(highSnap);

  assert.ok(
    highField.peakImprovementPct >= lowField.peakImprovementPct,
    `High population peak (${highField.peakImprovementPct}%) should be >= low (${lowField.peakImprovementPct}%)`
  );
  assert.ok(
    highField.meanImprovementPct >= lowField.meanImprovementPct,
    `High population mean (${highField.meanImprovementPct}%) should be >= low (${lowField.meanImprovementPct}%)`
  );
});

test('decentralized swarm mode outperforms centralized tower across street corridor', () => {
  const towerEnv: EnvironmentParams = { ...BASE_ENV, activeMode: 'centralized_tower' };
  let swarmSnap = createInitialSnapshot(BASE_ENV);
  let towerSnap = createInitialSnapshot(towerEnv);
  for (let i = 0; i < 12; i++) {
    swarmSnap = stepSimulationSnapshot(swarmSnap, BASE_ENV, 0.5);
    towerSnap = stepSimulationSnapshot(towerSnap, towerEnv, 0.5);
  }

  const swarmField = computeSwarmImprovementField(swarmSnap);
  const towerField = computeSwarmImprovementField(towerSnap);

  assert.ok(
    swarmField.meanImprovementPct > towerField.meanImprovementPct * 1.5,
    `Swarm mean (${swarmField.meanImprovementPct}%) should outperform tower (${towerField.meanImprovementPct}%)`
  );
});
