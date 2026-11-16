/**
 * Bio-Solar Swarm: Spatial Air-Quality Improvement Field Model
 * Computes a 2D corridor grid of local remediation effectiveness (Delta PM2.5 / Rv %)
 * driven by active Bio-Solar Pods (fan duty, removal efficiency, ACO pheromone weight),
 * wind dispersion vectors, and centralized tower fallback mode.
 */

import { SimulationSnapshot } from './types';

export const HEATMAP_BOUNDS = {
  minX: -34,
  maxX: 34,
  minZ: -11,
  maxZ: 8,
  yPlane: 0.08,
  cols: 36,
  rows: 14,
} as const;

export interface HeatmapHotspot {
  nodeId: string;
  label: string;
  x: number;
  z: number;
  improvementPct: number;
  fanDutyPct: number;
  enabled: boolean;
}

export interface SwarmHeatmapField {
  cols: number;
  rows: number;
  values: number[]; // row-major [row * cols + col], 0..78 (% AQI / PM2.5 improvement)
  meanImprovementPct: number;
  peakImprovementPct: number;
  peakLocation: {
    x: number;
    z: number;
    label: string;
  };
  hotspots: HeatmapHotspot[];
}

export function gridToWorld(gx: number, gy: number): { x: number; z: number } {
  const { minX, maxX, minZ, maxZ, cols, rows } = HEATMAP_BOUNDS;
  const u = cols > 1 ? gx / (cols - 1) : 0.5;
  const v = rows > 1 ? gy / (rows - 1) : 0.5;
  return {
    x: minX + u * (maxX - minX),
    z: minZ + v * (maxZ - minZ),
  };
}

function evaluatePointImprovementPct(wx: number, wz: number, snapshot: SimulationSnapshot): number {
  const windRad = ((snapshot.environment.windAngleDeg ?? 35) * Math.PI) / 180;
  const windSpeed = snapshot.environment.windSpeedMs ?? 1.6;
  const wxDir = Math.cos(windRad);
  const wzDir = -Math.sin(windRad);
  const shiftX = wxDir * Math.min(2.6, windSpeed * 0.65);
  const shiftZ = wzDir * Math.min(1.6, windSpeed * 0.4);

  let rawAccum = 0;

  for (const node of snapshot.nodes) {
    if (node.enabled === false || node.fan_duty <= 0.01) continue;
    const removalNorm = Math.max(0.05, Math.min(1, node.pm25_removal_pct / 85));
    const acoBoost = 1 + Math.max(0, Math.min(1, node.aco_pheromone)) * 0.42;
    const strength = node.fan_duty * removalNorm * acoBoost;

    // Anisotropic wake plume shifted slightly along wind vector
    const cx = node.position.x + shiftX;
    const cz = node.position.z + shiftZ;
    const dx = wx - cx;
    const dz = wz - cz;

    const sigmaX = 5.4 + windSpeed * 0.55;
    const sigmaZ = 3.8 + node.fan_duty * 1.15;

    const kernel = Math.exp(-(dx * dx) / (2 * sigmaX * sigmaX) - (dz * dz) / (2 * sigmaZ * sigmaZ));
    rawAccum += strength * kernel * 1.15;
  }

  // Centralized remote tower (positioned at x=16, z=-22) only weakly reaches pedestrian corridor
  if (snapshot.tower.active) {
    const tx = snapshot.tower.position.x + shiftX * 1.4;
    const tz = snapshot.tower.position.z + shiftZ * 1.4;
    const dx = wx - tx;
    const dz = wz - tz;
    const towerKernel = Math.exp(-(dx * dx) / (2 * 18 * 18) - (dz * dz) / (2 * 12 * 12));
    rawAccum += (snapshot.tower.pedestrian_zone_impact_pct / 100) * towerKernel * 1.05;
  }

  const saturated = 78 * (1 - Math.exp(-rawAccum * 1.32));
  return Math.round(Math.max(0, Math.min(78, saturated)) * 10) / 10;
}

export function computeSwarmImprovementField(snapshot: SimulationSnapshot): SwarmHeatmapField {
  const { cols, rows } = HEATMAP_BOUNDS;
  const values = new Array<number>(cols * rows);

  let sum = 0;
  let peakImprovementPct = 0;
  let peakX = 0;
  let peakZ = -5.6;

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const { x, z } = gridToWorld(col, row);
      const val = evaluatePointImprovementPct(x, z, snapshot);
      values[row * cols + col] = val;
      sum += val;
      if (val > peakImprovementPct) {
        peakImprovementPct = val;
        peakX = x;
        peakZ = z;
      }
    }
  }

  const hotspots: HeatmapHotspot[] = snapshot.nodes.map((node) => {
    const enabled = node.enabled !== false;
    const improvementPct = enabled
      ? evaluatePointImprovementPct(node.position.x, node.position.z, snapshot)
      : 0;
    return {
      nodeId: node.node_id,
      label: node.label,
      x: node.position.x,
      z: node.position.z,
      improvementPct,
      fanDutyPct: enabled ? Math.round(node.fan_duty * 100) : 0,
      enabled,
    };
  });

  // Attribute peak label to closest node or Centralized Tower
  let peakLabel = snapshot.tower.active && snapshot.activeNodeCount === 0 ? 'Central Tower Zone' : 'Swarm Corridor';
  let bestDist = Infinity;
  for (const hs of hotspots) {
    if (!hs.enabled) continue;
    const d = Math.hypot(hs.x - peakX, hs.z - peakZ);
    if (d < bestDist) {
      bestDist = d;
      peakLabel = hs.nodeId.replace('BSS-', '');
    }
  }

  return {
    cols,
    rows,
    values,
    meanImprovementPct: Math.round((sum / values.length) * 10) / 10,
    peakImprovementPct: Math.round(peakImprovementPct * 10) / 10,
    peakLocation: {
      x: Math.round(peakX * 10) / 10,
      z: Math.round(peakZ * 10) / 10,
      label: peakLabel,
    },
    hotspots,
  };
}
