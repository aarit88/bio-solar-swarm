/**
 * Bio-Solar Swarm: SQLite Persistence Layer (better-sqlite3)
 * Stores IEEE 1451 node registrations, individual pod power state, time-series telemetry,
 * simulation benchmark runs, Table III validation results, hardware command queues,
 * and a SHA-256 hash-chained tamper-evident cybersecurity audit log.
 */

import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { INITIAL_NODE_LAYOUT, SmartTransducerNodeState, ValidationConditionResult } from '../simulation/types';

export interface NodeRegistryRecord {
  node_id: string;
  label: string;
  zone: string;
  x: number;
  z: number;
  strain: string;
  calibration_id: string;
  hardware_mode: 'simulated' | 'physical_hil';
  firmware_version: string;
  enabled: number; // 1 = active, 0 = operator-deactivated
  last_seen_at: number;
}

export interface TelemetryLogRow {
  id?: number;
  node_id: string;
  timestamp: number;
  pm25_in: number;
  pm25_out: number;
  no2_in: number;
  no2_out: number;
  co2_in: number;
  co2_out: number;
  flow_m3_h: number;
  fan_power_w: number;
  pv_harvest_w: number;
  battery_soc: number;
  ph: number;
  algae_score: number;
  media_score: number;
  control_mode: string;
  safety_override: string | null;
  confidence_score: number;
  source: 'simulated' | 'physical_hil';
}

export interface SimulationRunRecord {
  id?: number;
  name: string;
  control_mode: string;
  traffic_pollution: number;
  wind_speed_ms: number;
  solar_irradiance_wm2: number;
  pedestrian_aqi: number;
  verified_reduction_pct: number;
  total_co2_g: number;
  net_power_w: number;
  created_at: number;
}

export interface NodeCommandRecord {
  id?: number;
  node_id: string;
  target_fan_duty: number;
  bypass_pbr: number;
  control_mode: string;
  status: 'pending' | 'acked';
  created_at: number;
}

export interface SecurityAuditRecord {
  id?: number;
  actor_uid: string;
  actor_email: string;
  action: string;
  target: string;
  status: 'allowed' | 'denied' | 'info';
  ip_addr: string;
  detail: string;
  prev_hash: string;
  entry_hash: string;
  created_at: number;
}

export class BioSwarmDatabase {
  private db: Database.Database;

  constructor(dbPath = path.resolve(process.cwd(), 'data', 'biosolar_swarm.db')) {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.initSchema();
    this.seedNodesIfEmpty();
  }

  private initSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS nodes (
        node_id TEXT PRIMARY KEY,
        label TEXT NOT NULL,
        zone TEXT NOT NULL,
        x REAL NOT NULL,
        z REAL NOT NULL,
        strain TEXT NOT NULL,
        calibration_id TEXT NOT NULL,
        hardware_mode TEXT NOT NULL DEFAULT 'simulated',
        firmware_version TEXT NOT NULL DEFAULT 'v1.4.2-esp32-ieee1451',
        enabled INTEGER NOT NULL DEFAULT 1,
        last_seen_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS telemetry_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        node_id TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        pm25_in REAL NOT NULL,
        pm25_out REAL NOT NULL,
        no2_in REAL NOT NULL,
        no2_out REAL NOT NULL,
        co2_in REAL NOT NULL,
        co2_out REAL NOT NULL,
        flow_m3_h REAL NOT NULL,
        fan_power_w REAL NOT NULL,
        pv_harvest_w REAL NOT NULL,
        battery_soc REAL NOT NULL,
        ph REAL NOT NULL,
        algae_score REAL NOT NULL,
        media_score REAL NOT NULL,
        control_mode TEXT NOT NULL,
        safety_override TEXT,
        confidence_score REAL NOT NULL,
        source TEXT NOT NULL DEFAULT 'simulated'
      );

      CREATE INDEX IF NOT EXISTS idx_telemetry_ts ON telemetry_logs(timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_telemetry_node ON telemetry_logs(node_id, timestamp DESC);

      CREATE TABLE IF NOT EXISTS simulation_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        control_mode TEXT NOT NULL,
        traffic_pollution REAL NOT NULL,
        wind_speed_ms REAL NOT NULL,
        solar_irradiance_wm2 REAL NOT NULL,
        pedestrian_aqi REAL NOT NULL,
        verified_reduction_pct REAL NOT NULL,
        total_co2_g REAL NOT NULL,
        net_power_w REAL NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS validation_experiments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        condition_id TEXT NOT NULL,
        title TEXT NOT NULL,
        baseline_aqi REAL NOT NULL,
        test_aqi REAL NOT NULL,
        delta_rv_pct REAL NOT NULL,
        rem_per_wh REAL NOT NULL,
        passed INTEGER NOT NULL,
        notes TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS node_commands (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        node_id TEXT NOT NULL,
        target_fan_duty REAL NOT NULL,
        bypass_pbr INTEGER NOT NULL DEFAULT 0,
        control_mode TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS security_audit_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        actor_uid TEXT NOT NULL,
        actor_email TEXT NOT NULL,
        action TEXT NOT NULL,
        target TEXT NOT NULL,
        status TEXT NOT NULL,
        ip_addr TEXT NOT NULL,
        detail TEXT NOT NULL,
        prev_hash TEXT NOT NULL,
        entry_hash TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_audit_ts ON security_audit_logs(id DESC);
    `);

    // Safe schema migration for existing SQLite files missing `enabled` column
    const cols = this.db.prepare('PRAGMA table_info(nodes)').all() as Array<{ name: string }>;
    if (!cols.some((c) => c.name === 'enabled')) {
      this.db.exec('ALTER TABLE nodes ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1;');
    }
  }

  private seedNodesIfEmpty() {
    const countRow = this.db.prepare('SELECT COUNT(*) as c FROM nodes').get() as { c: number };
    if (countRow.c === 0) {
      const insert = this.db.prepare(`
        INSERT INTO nodes (node_id, label, zone, x, z, strain, calibration_id, hardware_mode, firmware_version, enabled, last_seen_at)
        VALUES (@node_id, @label, @zone, @x, @z, @strain, @calibration_id, @hardware_mode, @firmware_version, @enabled, @last_seen_at)
      `);
      const now = Date.now();
      const tx = this.db.transaction(() => {
        INITIAL_NODE_LAYOUT.forEach((slot, idx) => {
          insert.run({
            node_id: slot.node_id,
            label: slot.label,
            zone: slot.zone,
            x: slot.x,
            z: slot.z,
            strain: 'Chlorella_sorokiniana_RMT01',
            calibration_id: `IEEE1451-TEDS-2026-0${idx + 1}`,
            hardware_mode: 'simulated',
            firmware_version: 'v1.4.2-esp32-ieee1451',
            enabled: 1,
            last_seen_at: now,
          });
        });
      });
      tx();
    }
  }

  listNodes(): NodeRegistryRecord[] {
    return this.db.prepare('SELECT * FROM nodes ORDER BY node_id ASC').all() as NodeRegistryRecord[];
  }

  upsertNode(node: Partial<NodeRegistryRecord> & { node_id: string }): NodeRegistryRecord {
    const existing = this.db
      .prepare('SELECT * FROM nodes WHERE node_id = ?')
      .get(node.node_id) as NodeRegistryRecord | undefined;

    const merged: NodeRegistryRecord = {
      node_id: node.node_id,
      label: node.label ?? existing?.label ?? `Hardware Pod ${node.node_id}`,
      zone: node.zone ?? existing?.zone ?? 'Street Edge',
      x: node.x ?? existing?.x ?? 0,
      z: node.z ?? existing?.z ?? -5.6,
      strain: node.strain ?? existing?.strain ?? 'Chlorella_sorokiniana_RMT01',
      calibration_id: node.calibration_id ?? existing?.calibration_id ?? 'IEEE1451-TEDS-2026-HW',
      hardware_mode: node.hardware_mode ?? existing?.hardware_mode ?? 'physical_hil',
      firmware_version: node.firmware_version ?? existing?.firmware_version ?? 'v1.4.2-esp32-ieee1451',
      enabled: node.enabled ?? existing?.enabled ?? 1,
      last_seen_at: Date.now(),
    };

    this.db
      .prepare(`
        INSERT INTO nodes (node_id, label, zone, x, z, strain, calibration_id, hardware_mode, firmware_version, enabled, last_seen_at)
        VALUES (@node_id, @label, @zone, @x, @z, @strain, @calibration_id, @hardware_mode, @firmware_version, @enabled, @last_seen_at)
        ON CONFLICT(node_id) DO UPDATE SET
          label = excluded.label,
          zone = excluded.zone,
          x = excluded.x,
          z = excluded.z,
          strain = excluded.strain,
          calibration_id = excluded.calibration_id,
          hardware_mode = excluded.hardware_mode,
          firmware_version = excluded.firmware_version,
          enabled = excluded.enabled,
          last_seen_at = excluded.last_seen_at
      `)
      .run(merged);

    return merged;
  }

  setNodeEnabled(nodeId: string, enabled: boolean): NodeRegistryRecord | undefined {
    const existing = this.db
      .prepare('SELECT * FROM nodes WHERE node_id = ?')
      .get(nodeId) as NodeRegistryRecord | undefined;
    if (!existing) return undefined;

    const now = Date.now();
    this.db
      .prepare('UPDATE nodes SET enabled = ?, last_seen_at = ? WHERE node_id = ?')
      .run(enabled ? 1 : 0, now, nodeId);

    return {
      ...existing,
      enabled: enabled ? 1 : 0,
      last_seen_at: now,
    };
  }

  private computeAuditHash(
    prevHash: string,
    payload: Omit<SecurityAuditRecord, 'id' | 'prev_hash' | 'entry_hash'>
  ): string {
    const canonical = `${prevHash}|${payload.actor_uid}|${payload.actor_email}|${payload.action}|${payload.target}|${payload.status}|${payload.ip_addr}|${payload.detail}|${payload.created_at}`;
    return crypto.createHash('sha256').update(canonical).digest('hex');
  }

  appendSecurityAudit(
    entry: Omit<SecurityAuditRecord, 'id' | 'prev_hash' | 'entry_hash' | 'created_at'>
  ): SecurityAuditRecord {
    const created_at = Date.now();
    const lastRow = this.db
      .prepare('SELECT entry_hash FROM security_audit_logs ORDER BY id DESC LIMIT 1')
      .get() as { entry_hash: string } | undefined;
    const prev_hash = lastRow?.entry_hash ?? '0000000000000000000000000000000000000000000000000000000000000000';
    const fullPayload = { ...entry, created_at };
    const entry_hash = this.computeAuditHash(prev_hash, fullPayload);

    const res = this.db
      .prepare(`
        INSERT INTO security_audit_logs (
          actor_uid, actor_email, action, target, status, ip_addr, detail, prev_hash, entry_hash, created_at
        ) VALUES (
          @actor_uid, @actor_email, @action, @target, @status, @ip_addr, @detail, @prev_hash, @entry_hash, @created_at
        )
      `)
      .run({ ...fullPayload, prev_hash, entry_hash });

    return {
      id: Number(res.lastInsertRowid),
      ...fullPayload,
      prev_hash,
      entry_hash,
    };
  }

  listSecurityAuditLogs(limit = 50): SecurityAuditRecord[] {
    return this.db
      .prepare('SELECT * FROM security_audit_logs ORDER BY id DESC LIMIT ?')
      .all(limit) as SecurityAuditRecord[];
  }

  verifyAuditChainIntegrity(): { valid: boolean; totalEntries: number; lastHash: string } {
    const rows = this.db
      .prepare('SELECT * FROM security_audit_logs ORDER BY id ASC')
      .all() as SecurityAuditRecord[];
    let expectedPrev = '0000000000000000000000000000000000000000000000000000000000000000';
    for (const row of rows) {
      if (row.prev_hash !== expectedPrev) {
        return { valid: false, totalEntries: rows.length, lastHash: row.entry_hash };
      }
      const recomputed = this.computeAuditHash(row.prev_hash, {
        actor_uid: row.actor_uid,
        actor_email: row.actor_email,
        action: row.action,
        target: row.target,
        status: row.status,
        ip_addr: row.ip_addr,
        detail: row.detail,
        created_at: row.created_at,
      });
      if (recomputed !== row.entry_hash) {
        return { valid: false, totalEntries: rows.length, lastHash: row.entry_hash };
      }
      expectedPrev = row.entry_hash;
    }
    return { valid: true, totalEntries: rows.length, lastHash: expectedPrev };
  }

  insertTelemetryBatch(nodes: SmartTransducerNodeState[]): number {
    const stmt = this.db.prepare(`
      INSERT INTO telemetry_logs (
        node_id, timestamp, pm25_in, pm25_out, no2_in, no2_out, co2_in, co2_out,
        flow_m3_h, fan_power_w, pv_harvest_w, battery_soc, ph, algae_score,
        media_score, control_mode, safety_override, confidence_score, source
      ) VALUES (
        @node_id, @timestamp, @pm25_in, @pm25_out, @no2_in, @no2_out, @co2_in, @co2_out,
        @flow_m3_h, @fan_power_w, @pv_harvest_w, @battery_soc, @ph, @algae_score,
        @media_score, @control_mode, @safety_override, @confidence_score, @source
      )
    `);

    const tx = this.db.transaction((rows: SmartTransducerNodeState[]) => {
      for (const n of rows) {
        stmt.run({
          node_id: n.node_id,
          timestamp: n.timestamp,
          pm25_in: n.cin.pm25,
          pm25_out: n.cout.pm25,
          no2_in: n.cin.no2,
          no2_out: n.cout.no2,
          co2_in: n.cin.co2,
          co2_out: n.cout.co2,
          flow_m3_h: n.flow_m3_h,
          fan_power_w: n.fan_power_w,
          pv_harvest_w: n.pv_harvest_w,
          battery_soc: n.battery_soc,
          ph: n.pbr.ph,
          algae_score: n.pbr.algae_health_score,
          media_score: n.media.carbon_kmno4_remaining_pct,
          control_mode: n.control_mode,
          safety_override: n.safety_override,
          confidence_score: n.confidence_score,
          source: n.hardware_source,
        });
      }
      this.db.prepare(`
        DELETE FROM telemetry_logs
        WHERE id NOT IN (SELECT id FROM telemetry_logs ORDER BY id DESC LIMIT 3000)
      `).run();
    });

    tx(nodes);
    return nodes.length;
  }

  insertSingleTelemetry(row: TelemetryLogRow): number {
    const res = this.db
      .prepare(`
        INSERT INTO telemetry_logs (
          node_id, timestamp, pm25_in, pm25_out, no2_in, no2_out, co2_in, co2_out,
          flow_m3_h, fan_power_w, pv_harvest_w, battery_soc, ph, algae_score,
          media_score, control_mode, safety_override, confidence_score, source
        ) VALUES (
          @node_id, @timestamp, @pm25_in, @pm25_out, @no2_in, @no2_out, @co2_in, @co2_out,
          @flow_m3_h, @fan_power_w, @pv_harvest_w, @battery_soc, @ph, @algae_score,
          @media_score, @control_mode, @safety_override, @confidence_score, @source
        )
      `)
      .run(row);
    return Number(res.lastInsertRowid);
  }

  getTelemetryHistory(limit = 50, nodeId?: string): TelemetryLogRow[] {
    if (nodeId) {
      return this.db
        .prepare('SELECT * FROM telemetry_logs WHERE node_id = ? ORDER BY id DESC LIMIT ?')
        .all(nodeId, limit) as TelemetryLogRow[];
    }
    return this.db
      .prepare('SELECT * FROM telemetry_logs ORDER BY id DESC LIMIT ?')
      .all(limit) as TelemetryLogRow[];
  }

  saveSimulationRun(run: Omit<SimulationRunRecord, 'id' | 'created_at'>): SimulationRunRecord {
    const created_at = Date.now();
    const res = this.db
      .prepare(`
        INSERT INTO simulation_runs (
          name, control_mode, traffic_pollution, wind_speed_ms, solar_irradiance_wm2,
          pedestrian_aqi, verified_reduction_pct, total_co2_g, net_power_w, created_at
        ) VALUES (
          @name, @control_mode, @traffic_pollution, @wind_speed_ms, @solar_irradiance_wm2,
          @pedestrian_aqi, @verified_reduction_pct, @total_co2_g, @net_power_w, @created_at
        )
      `)
      .run({ ...run, created_at });

    return { id: Number(res.lastInsertRowid), ...run, created_at };
  }

  listSimulationRuns(limit = 25): SimulationRunRecord[] {
    return this.db
      .prepare('SELECT * FROM simulation_runs ORDER BY id DESC LIMIT ?')
      .all(limit) as SimulationRunRecord[];
  }

  saveValidationResults(results: ValidationConditionResult[]): void {
    const stmt = this.db.prepare(`
      INSERT INTO validation_experiments (
        condition_id, title, baseline_aqi, test_aqi, delta_rv_pct, rem_per_wh, passed, notes, created_at
      ) VALUES (
        @condition_id, @title, @baseline_aqi, @test_aqi, @delta_rv_pct, @rem_per_wh, @passed, @notes, @created_at
      )
    `);
    const now = Date.now();
    const tx = this.db.transaction((items: ValidationConditionResult[]) => {
      for (const r of items) {
        stmt.run({
          condition_id: r.conditionId,
          title: r.title,
          baseline_aqi: r.baselineAqi,
          test_aqi: r.testAqi,
          delta_rv_pct: r.deltaRvPct,
          rem_per_wh: r.remPerWh,
          passed: r.passed ? 1 : 0,
          notes: r.notes,
          created_at: now,
        });
      }
    });
    tx(results);
  }

  enqueueNodeCommand(cmd: Omit<NodeCommandRecord, 'id' | 'created_at' | 'status'>): NodeCommandRecord {
    const created_at = Date.now();
    const res = this.db
      .prepare(`
        INSERT INTO node_commands (node_id, target_fan_duty, bypass_pbr, control_mode, status, created_at)
        VALUES (@node_id, @target_fan_duty, @bypass_pbr, @control_mode, 'pending', @created_at)
      `)
      .run({ ...cmd, created_at });
    return { id: Number(res.lastInsertRowid), ...cmd, status: 'pending', created_at };
  }

  getLatestCommandForNode(nodeId: string): NodeCommandRecord | undefined {
    return this.db
      .prepare('SELECT * FROM node_commands WHERE node_id = ? ORDER BY id DESC LIMIT 1')
      .get(nodeId) as NodeCommandRecord | undefined;
  }

  getStats() {
    const telemetryCount = (this.db.prepare('SELECT COUNT(*) as c FROM telemetry_logs').get() as { c: number }).c;
    const runsCount = (this.db.prepare('SELECT COUNT(*) as c FROM simulation_runs').get() as { c: number }).c;
    const validationsCount = (this.db.prepare('SELECT COUNT(*) as c FROM validation_experiments').get() as { c: number }).c;
    const hilNodesCount = (
      this.db.prepare("SELECT COUNT(*) as c FROM nodes WHERE hardware_mode = 'physical_hil'").get() as { c: number }
    ).c;
    const auditCount = (this.db.prepare('SELECT COUNT(*) as c FROM security_audit_logs').get() as { c: number }).c;
    const enabledNodesCount = (
      this.db.prepare('SELECT COUNT(*) as c FROM nodes WHERE enabled = 1').get() as { c: number }
    ).c;

    return {
      telemetryCount,
      runsCount,
      validationsCount,
      hilNodesCount,
      auditCount,
      enabledNodesCount,
    };
  }

  close() {
    this.db.close();
  }
}
