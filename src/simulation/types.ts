/**
 * Bio-Solar Swarm: Core Simulation Types & IEEE 1451 Smart Transducer Schemas
 * Grounded in the Bio-Solar Swarm Architecture (2026).
 */

export type ControlMode =
  | 'centralized_tower'
  | 'fixed_duty'
  | 'independent_local'
  | 'swarm_pso_aco';

export type AlgalStrain =
  | 'Chlorella_sorokiniana_RMT01'
  | 'Spirulina_platensis';

export interface TreatmentConfig {
  particulateStage: boolean;
  chemicalAdsorptionStage: boolean;
  biologicalPbrStage: boolean;
}

export interface PollutantVector {
  pm25: number; // ug/m3
  pm10: number; // ug/m3
  no2: number;  // ppb
  so2: number;  // ppb
  co2: number;  // ppm
  o3: number;   // ppb
  tvoc: number; // ppb
}

export interface EnvironmentParams {
  trafficPollution: number; // 0..100 (%)
  windSpeedMs: number;      // m/s (0.2..8.0)
  windAngleDeg: number;     // degrees (0 = +X east along street, 90 = +Z across street)
  solarIrradianceWm2: number; // W/m2 (0..1000)
  ambientTempC: number;     // Celsius (10..42)
  ambientHumidityPct: number; // % (20..95)
  activeMode: ControlMode;
  strain: AlgalStrain;
  treatmentConfig: TreatmentConfig;
  simSpeed: number; // 1 | 2 | 4
  populationCount: number; // Estimated street pedestrians (5..180) via voice recognition
  voiceActivityDb: number; // Ambient vocal SPL estimate (35..95 dB)
  voiceDetectedTranscript: string; // Latest recognized voice phrase / crowd cue
}

export type SafetyOverrideCode =
  | 'LOW_BATTERY_FAN_CAP'
  | 'PBR_PH_ISOLATED'
  | 'MEDIA_SATURATED_BYPASS'
  | 'SENSOR_PLAUSIBILITY_FALLBACK'
  | 'POD_DEACTIVATED_BY_OPERATOR'
  | null;

export interface PbrState {
  ph: number;
  optical_density: number; // OD680
  specific_growth_rate_h: number; // mu (1/h)
  co2_mass_rate_gh: number; // R_CO2 (g/h)
  o2_evolution_gh: number; // g/h
  algae_health_score: number; // 0..1
  strain: AlgalStrain;
  isolated: boolean;
}

export interface MediaState {
  carbon_kmno4_remaining_pct: number; // 0..100
  colorimetric_rgb: [number, number, number];
  prefilter_dp_pa: number; // Pascal pressure drop across particulate filter
  needs_service: boolean;
}

export interface SmartTransducerNodeState {
  node_id: string;
  label: string;
  zone: string;
  enabled: boolean; // Authenticated individual pod activation state
  position: { x: number; z: number };
  timestamp: number;
  cin: PollutantVector;
  cout: PollutantVector;
  pm25_removal_pct: number; // eta_PM25 (%)
  no2_removal_pct: number;  // eta_NO2 (%)
  co2_removal_pct: number;  // eta_CO2 (%)
  temperature: number;
  humidity: number;
  flow_m3_h: number;
  fan_duty: number; // 0..1
  fan_power_w: number;
  pump_power_w: number;
  sense_comm_ctrl_w: number;
  pv_harvest_w: number;
  net_power_w: number; // Enet = EPV - (Efan + Epump + Esense + Ecomm + Ectrl)
  battery_soc: number; // 0..100 (%) of 12V 20Ah (240 Wh) LiFePO4
  pbr: PbrState;
  media: MediaState;
  control_mode: ControlMode;
  safety_override: SafetyOverrideCode;
  aco_pheromone: number; // 0..1 persistent spatial pollution signal
  pso_target_duty: number; // 0..1 optimizer target
  confidence_score: number; // 0..1 IEEE 1451 measurement quality
  calibration_id: string;
  hardware_source: 'simulated' | 'physical_hil';
  manual_fault_ph_drift?: boolean;
  manual_fault_low_batt?: boolean;
}

export interface SwarmEdgeLink {
  fromId: string;
  toId: string;
  pheromoneWeight: number; // 0..1
  active: boolean;
  packetRateHz: number;
}

export interface CentralTowerState {
  active: boolean;
  position: { x: number; z: number };
  power_w: number;
  flow_m3_h: number;
  chamber_removal_pct: number;
  pedestrian_zone_impact_pct: number;
}

export interface SimulationSnapshot {
  tick: number;
  simTimeSec: number;
  pedestrianPm25: number;
  pedestrianNo2: number;
  pedestrianCo2: number;
  pedestrianAqi: number;
  aqiCategory: 'Optimal' | 'Moderate' | 'Unhealthy for Sensitive' | 'Unhealthy' | 'Very Unhealthy';
  verifiedReductionRvPct: number; // Eq. 6
  totalNetPowerW: number;
  totalPvPowerW: number;
  totalLoadPowerW: number;
  totalCo2CapturedG: number;
  totalPm25CapturedMg: number;
  activeNodeCount: number;
  populationCount: number;
  voiceActivityDb: number;
  populationFanMultiplier: number;
  nodes: SmartTransducerNodeState[];
  links: SwarmEdgeLink[];
  tower: CentralTowerState;
  environment: EnvironmentParams;
}

export interface ValidationConditionResult {
  conditionId: 'C1' | 'C2' | 'C3' | 'C4' | 'C5' | 'C6' | 'C7';
  title: string;
  comparison: string;
  purpose: string;
  baselineLabel: string;
  testLabel: string;
  baselineAqi: number;
  testAqi: number;
  baselineRemovalPct: number;
  testRemovalPct: number;
  baselinePowerW: number;
  testPowerW: number;
  co2MassRateGh: number;
  deltaRvPct: number;
  remPerWh: number; // verified remediation efficiency per watt-hour
  passed: boolean;
  notes: string;
}

export interface BomLineItem {
  category: string;
  specification: string;
  costInr: number;
}

export const PRELIMINARY_BOM_INR: BomLineItem[] = [
  {
    category: 'Power and edge compute',
    specification: '50 W bifacial PV; 12 V, 20 Ah LiFePO4; ESP32-class controller; ~15 W BLDC fan',
    costInr: 11000,
  },
  {
    category: 'Chemical adsorption',
    specification: 'Impregnated activated-carbon stage (KMnO4 + lime-neutralization candidate)',
    costInr: 1200,
  },
  {
    category: 'Autonomous sensing',
    specification: 'Optical PM2.5/PM10, CO2/NO2/SO2/O3, T/RH, airflow, RGB colorimetric sensor',
    costInr: 6900,
  },
  {
    category: 'Fluidic automation',
    specification: 'Peristaltic & air-sparging micro-pumps, isolation solenoid valves',
    costInr: 5490,
  },
  {
    category: 'Biological subsystem',
    specification: 'Tubular borosilicate PBR, microalgal inoculum (Chlorella / Spirulina), nutrients',
    costInr: 1250,
  },
];

export const INITIAL_NODE_LAYOUT: Array<{
  node_id: string;
  label: string;
  zone: string;
  x: number;
  z: number;
}> = [
  { node_id: 'BSS-POD-01', label: 'Pod 01 · Transit Shelter', zone: 'Bus Shelter West', x: -24, z: -5.6 },
  { node_id: 'BSS-POD-02', label: 'Pod 02 · Arterial Junction', zone: 'Traffic Corridor', x: -12, z: -5.6 },
  { node_id: 'BSS-POD-03', label: 'Pod 03 · Crosswalk Hub', zone: 'Pedestrian Plaza', x: 0, z: -5.6 },
  { node_id: 'BSS-POD-04', label: 'Pod 04 · Market Frontage', zone: 'Commercial Edge', x: 12, z: -5.6 },
  { node_id: 'BSS-POD-05', label: 'Pod 05 · Works Boundary', zone: 'Construction Edge', x: 24, z: -5.6 },
];
