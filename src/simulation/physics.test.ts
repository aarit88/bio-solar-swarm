import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applySafetyRuleEngine,
  computeCo2MassRateGh,
  computeColorimetricRgb,
  computeMonodGrowthRate,
  computePvHarvestW,
  computeRemovalEfficiencyPct,
  createInitialNodes,
  pm25ToUsAqi,
  stepNodePhysics,
} from './physics';
import { EnvironmentParams } from './types';
import {
  computePopulationFanMultiplier,
  estimatePopulationFromAcousticAndSpeech,
} from './voicePopulation';

const DEFAULT_ENV: EnvironmentParams = {
  trafficPollution: 55,
  windSpeedMs: 1.8,
  windAngleDeg: 35,
  solarIrradianceWm2: 720,
  ambientTempC: 28,
  ambientHumidityPct: 58,
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

test('Monod growth rate scales with CO2 substrate and light and drops outside pH range', () => {
  const optimal = computeMonodGrowthRate('Chlorella_sorokiniana_RMT01', 550, 720, 28, 7.3);
  const lowLight = computeMonodGrowthRate('Chlorella_sorokiniana_RMT01', 550, 80, 28, 7.3);
  const badPh = computeMonodGrowthRate('Chlorella_sorokiniana_RMT01', 550, 720, 28, 4.5);

  assert.ok(optimal > lowLight, 'Optimal light should yield higher growth than low light');
  assert.ok(optimal > badPh, 'Optimal pH should yield higher growth than acidic drift');
});

test('Removal efficiency eta and CO2 mass rate R_CO2 follow Eq. (3) and Eq. (5)', () => {
  const eta = computeRemovalEfficiencyPct(100, 35);
  assert.equal(eta, 65);

  const rCo2 = computeCo2MassRateGh(550, 440, 80, 25);
  assert.ok(rCo2 > 10 && rCo2 < 25, `Expected realistic CO2 mass rate in g/h, got ${rCo2}`);
});

test('Colorimetric RGB transitions smoothly from fresh KMnO4 violet to spent amber-brown', () => {
  const fresh = computeColorimetricRgb(100);
  const spent = computeColorimetricRgb(0);
  assert.ok(fresh[2] > fresh[0], 'Fresh KMnO4 should have stronger blue/violet channel than spent');
  assert.ok(spent[0] > spent[2], 'Spent MnO2 should shift toward brown/amber');
});

test('Local safety rule engine overrides AI/swarm commands on low battery, pH drift, and operator deactivation', () => {
  const nodes = createInitialNodes(DEFAULT_ENV);
  const lowBattNode = { ...nodes[0], battery_soc: 12 };
  const battCheck = applySafetyRuleEngine(0.95, lowBattNode, DEFAULT_ENV.treatmentConfig);
  assert.equal(battCheck.override, 'LOW_BATTERY_FAN_CAP');
  assert.ok(battCheck.safeDuty <= 0.2, 'Fan duty must be capped <= 0.20 on low battery');

  const phDriftNode = {
    ...nodes[1],
    pbr: { ...nodes[1].pbr, ph: 5.2 },
  };
  const phCheck = applySafetyRuleEngine(0.75, phDriftNode, DEFAULT_ENV.treatmentConfig);
  assert.equal(phCheck.pbrIsolated, true);
  assert.equal(phCheck.override, 'PBR_PH_ISOLATED');

  const disabledNode = { ...nodes[2], enabled: false };
  const disabledCheck = applySafetyRuleEngine(0.85, disabledNode, DEFAULT_ENV.treatmentConfig);
  assert.equal(disabledCheck.safeDuty, 0);
  assert.equal(disabledCheck.pbrIsolated, true);
  assert.equal(disabledCheck.override, 'POD_DEACTIVATED_BY_OPERATOR');
});

test('PV harvest and node physics step maintain valid Eq. (4) energy accounting', () => {
  const pv = computePvHarvestW(800, 28);
  assert.ok(pv > 35 && pv <= 58, `Expected 50W bifacial PV yield around 40-50W, got ${pv}`);

  const nodes = createInitialNodes(DEFAULT_ENV);
  const stepped = stepNodePhysics(nodes[0], 0.7, DEFAULT_ENV, 10, 1.0);
  const expectedNet =
    Math.round((stepped.pv_harvest_w - (stepped.fan_power_w + stepped.pump_power_w + stepped.sense_comm_ctrl_w)) * 100) /
    100;
  assert.equal(stepped.net_power_w, expectedNet);
  assert.ok(stepped.cout.pm25 < stepped.cin.pm25, 'Active node should reduce downstream PM2.5');
});

test('US EPA PM2.5 to AQI conversion matches standard breakpoints', () => {
  assert.equal(pm25ToUsAqi(12.0), 50);
  assert.equal(pm25ToUsAqi(35.4), 100);
  assert.ok(pm25ToUsAqi(65) > 150);
});

test('Voice recognition crowd estimator parses numeric counts, crowd keywords, and acoustic RMS', () => {
  const quiet = estimatePopulationFromAcousticAndSpeech(0.03, 'quiet night street', 24);
  const surge = estimatePopulationFromAcousticAndSpeech(0.45, 'rush hour crowd of 140 people detected', 24);
  assert.ok(quiet.estimatedPopulation < 30, `Expected low population, got ${quiet.estimatedPopulation}`);
  assert.ok(surge.estimatedPopulation >= 120, `Expected high population >= 120, got ${surge.estimatedPopulation}`);
  assert.ok(computePopulationFanMultiplier(surge.estimatedPopulation) > computePopulationFanMultiplier(quiet.estimatedPopulation));
});
