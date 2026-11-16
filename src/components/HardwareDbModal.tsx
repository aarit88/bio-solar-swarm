/**
 * Database, Hardware HIL Integration & End-to-End Verification Modal
 * Connects the 3D simulation to SQLite persistence, ESP32 IEEE 1451.1.6 ingestion APIs,
 * benchmark run history, and a live end-to-end backend/physics/DB test suite runner.
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  X,
  Database,
  Cpu,
  CheckCircle2,
  XCircle,
  Send,
  RefreshCw,
  Download,
  FlaskConical,
  ShieldCheck,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { SimulationSnapshot } from '../simulation/types';

interface DbStats {
  telemetryCount: number;
  runsCount: number;
  validationsCount: number;
  hilNodesCount: number;
}

interface TelemetryRow {
  id: number;
  node_id: string;
  timestamp: number;
  pm25_in: number;
  pm25_out: number;
  no2_in: number;
  no2_out: number;
  co2_in: number;
  co2_out: number;
  flow_m3_h: number;
  battery_soc: number;
  ph: number;
  control_mode: string;
  safety_override: string | null;
  source: string;
}

interface SavedRun {
  id: number;
  name: string;
  control_mode: string;
  pedestrian_aqi: number;
  verified_reduction_pct: number;
  total_co2_g: number;
  net_power_w: number;
  created_at: number;
}

interface TestCheckResult {
  id: string;
  name: string;
  passed: boolean;
  detail: string;
}

interface HardwareDbModalProps {
  snapshot: SimulationSnapshot;
  wsConnected: boolean;
  onClose: () => void;
  onHilPacketSent: (nodeId: string, pm25In: number, pm25Out: number, batterySoc: number) => void;
}

interface AuditLogItem {
  id: number;
  actor_email: string;
  action: string;
  target: string;
  status: string;
  detail: string;
  entry_hash: string;
  created_at: number;
}

export const HardwareDbModal: React.FC<HardwareDbModalProps> = ({
  snapshot,
  wsConnected,
  onClose,
  onHilPacketSent,
}) => {
  const { authFetch } = useAuth();
  const [activeTab, setActiveTab] = useState<'database' | 'hardware' | 'tests' | 'security'>('database');
  const [stats, setStats] = useState<DbStats | null>(null);
  const [history, setHistory] = useState<TelemetryRow[]>([]);
  const [runs, setRuns] = useState<SavedRun[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogItem[]>([]);
  const [chainValid, setChainValid] = useState<boolean>(true);
  const [testResults, setTestResults] = useState<{ allPassed: boolean; checks: TestCheckResult[] } | null>(
    null
  );
  const [hilNodeId, setHilNodeId] = useState('BSS-POD-02');
  const [hilPm25In, setHilPm25In] = useState(112);
  const [hilPm25Out, setHilPm25Out] = useState(31);
  const [hilBattery, setHilBattery] = useState(74);
  const [hilResponse, setHilResponse] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refreshData = useCallback(async () => {
    try {
      const [histRes, runsRes, secRes] = await Promise.all([
        authFetch('/api/v1/telemetry/history?limit=16'),
        authFetch('/api/v1/runs'),
        authFetch('/api/v1/security/audit?limit=25'),
      ]);
      if (histRes.ok) {
        const hd = await histRes.json();
        setHistory(hd.rows ?? []);
        setStats(hd.stats ?? null);
      }
      if (runsRes.ok) {
        const rd = await runsRes.json();
        setRuns(rd.runs ?? []);
      }
      if (secRes.ok) {
        const sd = await secRes.json();
        setAuditLogs(sd.logs ?? []);
        setChainValid(Boolean(sd.integrity?.valid ?? true));
      }
    } catch {
      // handled gracefully in UI
    }
  }, [authFetch]);

  useEffect(() => {
    refreshData();
  }, [refreshData]);

  const persistSnapshotNow = async () => {
    setBusy(true);
    try {
      await authFetch('/api/v1/telemetry/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nodes: snapshot.nodes }),
      });
      await refreshData();
    } finally {
      setBusy(false);
    }
  };

  const sendHilPacket = async () => {
    setBusy(true);
    setHilResponse(null);
    try {
      const resp = await authFetch('/api/v1/hardware/telemetry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          node_id: hilNodeId,
          timestamp: Date.now(),
          pm25_in: hilPm25In,
          pm25_out: hilPm25Out,
          no2_in: 68,
          no2_out: 24,
          co2_in: 560,
          co2_out: 448,
          flow_m3_h: 88,
          fan_power_w: 7.4,
          pv_harvest_w: 39.2,
          battery_soc: hilBattery,
          ph: 7.36,
          algae_state: 0.95,
          media_state: 89,
          control_mode: snapshot.environment.activeMode,
          calibration_id: 'IEEE1451-TEDS-2026-ESP32-HIL',
        }),
      });
      const data = await resp.json();
      setHilResponse(JSON.stringify(data, null, 2));
      onHilPacketSent(hilNodeId, hilPm25In, hilPm25Out, hilBattery);
      await refreshData();
    } finally {
      setBusy(false);
    }
  };

  const runE2eTests = async () => {
    setBusy(true);
    try {
      const resp = await authFetch('/api/v1/tests/run', { method: 'POST' });
      const data = await resp.json();
      setTestResults({ allPassed: Boolean(data.allPassed), checks: data.checks ?? [] });
      if (data.stats) setStats(data.stats);
    } finally {
      setBusy(false);
    }
  };

  const exportCsv = () => {
    const header =
      'id,node_id,timestamp,pm25_in,pm25_out,no2_in,no2_out,co2_in,co2_out,flow_m3_h,battery_soc,ph,control_mode,safety_override,source';
    const lines = history.map((r) =>
      [
        r.id,
        r.node_id,
        r.timestamp,
        r.pm25_in,
        r.pm25_out,
        r.no2_in,
        r.no2_out,
        r.co2_in,
        r.co2_out,
        r.flow_m3_h,
        r.battery_soc,
        r.ph,
        r.control_mode,
        r.safety_override ?? '',
        r.source,
      ].join(',')
    );
    const blob = new Blob([[header, ...lines].join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `biosolar_swarm_telemetry_${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Database, Hardware HIL Integration, and End-to-End Test Console"
      className="fixed inset-0 z-40 bg-[#1E293B]/55 flex items-center justify-center p-4"
    >
      <div className="bg-[#EBF0F5] text-[#1E293B] border border-[#B8C4D0] rounded-xl shadow-2xl w-full max-w-5xl max-h-[88vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-5 py-3.5 bg-[#DCE4EC] border-b border-[#C3CFD9] flex items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-[#0F172A]">
              SQLite Database, ESP32 Hardware HIL & E2E Test Suite
            </h2>
            <p className="text-xs text-[#475569]">
              IEEE 1451.1.6 Telemetry Persistence · WebSocket Stream: {wsConnected ? 'Connected' : 'Reconnecting'} ·
              Rows Logged: <span className="font-mono tabular-nums">{stats?.telemetryCount ?? 0}</span>
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close Database and Hardware Console"
            className="p-1.5 rounded-lg text-[#475569] hover:text-[#0F172A] hover:bg-[#CBD5E1]/70 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Sub-navigation tabs */}
        <div className="px-5 py-2 bg-[#E3EAF0] border-b border-[#CBD5E1] flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setActiveTab('database')}
              className={`px-3 py-1.5 rounded-md text-xs font-medium inline-flex items-center gap-1.5 transition-colors ${
                activeTab === 'database'
                  ? 'bg-[#2D3744] text-white'
                  : 'bg-[#F4F7FA] text-[#334155] border border-[#CBD5E1] hover:bg-white'
              }`}
            >
              <Database className="w-3.5 h-3.5" />
              SQLite Telemetry & Runs
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('hardware')}
              className={`px-3 py-1.5 rounded-md text-xs font-medium inline-flex items-center gap-1.5 transition-colors ${
                activeTab === 'hardware'
                  ? 'bg-[#2D3744] text-white'
                  : 'bg-[#F4F7FA] text-[#334155] border border-[#CBD5E1] hover:bg-white'
              }`}
            >
              <Cpu className="w-3.5 h-3.5" />
              Hardware-In-the-Loop (ESP32)
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('tests')}
              className={`px-3 py-1.5 rounded-md text-xs font-medium inline-flex items-center gap-1.5 transition-colors ${
                activeTab === 'tests'
                  ? 'bg-[#2D3744] text-white'
                  : 'bg-[#F4F7FA] text-[#334155] border border-[#CBD5E1] hover:bg-white'
              }`}
            >
              <FlaskConical className="w-3.5 h-3.5" />
              E2E Software Test Suite
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('security')}
              className={`px-3 py-1.5 rounded-md text-xs font-medium inline-flex items-center gap-1.5 transition-colors ${
                activeTab === 'security'
                  ? 'bg-[#2D3744] text-white'
                  : 'bg-[#F4F7FA] text-[#334155] border border-[#CBD5E1] hover:bg-white'
              }`}
            >
              <ShieldCheck className="w-3.5 h-3.5" />
              Security Audit Chain
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={persistSnapshotNow}
              disabled={busy}
              className="px-3 py-1.5 rounded-md bg-[#059669] hover:bg-[#047857] text-white text-xs font-medium inline-flex items-center gap-1.5"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Log Current Snapshot
            </button>
            <button
              type="button"
              onClick={exportCsv}
              className="px-3 py-1.5 rounded-md bg-white border border-[#CBD5E1] hover:bg-[#F8FAFC] text-[#334155] text-xs font-medium inline-flex items-center gap-1.5"
            >
              <Download className="w-3.5 h-3.5" />
              Export CSV
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {activeTab === 'database' && (
            <>
              {/* Saved Benchmark Runs */}
              <section className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-[#475569]">
                  Saved Simulation Benchmark Runs ({runs.length})
                </h3>
                {runs.length === 0 ? (
                  <div className="p-4 bg-[#F4F7FA] border border-[#CBD5E1] rounded-lg text-xs text-[#475569]">
                    No benchmark runs saved yet. Click "Save Run to DB" in the top bar to record a comparison baseline.
                  </div>
                ) : (
                  <div className="overflow-x-auto bg-[#F4F7FA] border border-[#CBD5E1] rounded-lg">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="bg-[#DCE4EC] text-[#334155] border-b border-[#C3CFD9]">
                          <th className="py-2 px-3">Run Name</th>
                          <th className="py-2 px-3">Control Policy</th>
                          <th className="py-2 px-3 text-right">Pedestrian AQI</th>
                          <th className="py-2 px-3 text-right">Verified Rv</th>
                          <th className="py-2 px-3 text-right">CO₂ Captured</th>
                          <th className="py-2 px-3 text-right">Net Power</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#E2E8F0]">
                        {runs.map((run) => (
                          <tr key={run.id}>
                            <td className="py-2 px-3 font-medium text-[#0F172A]">{run.name}</td>
                            <td className="py-2 px-3 font-mono text-[#334155]">{run.control_mode}</td>
                            <td className="py-2 px-3 font-mono tabular-nums text-right font-semibold">
                              {run.pedestrian_aqi}
                            </td>
                            <td className="py-2 px-3 font-mono tabular-nums text-right text-[#059669]">
                              {run.verified_reduction_pct.toFixed(1)}%
                            </td>
                            <td className="py-2 px-3 font-mono tabular-nums text-right">
                              {run.total_co2_g.toFixed(2)} g
                            </td>
                            <td className="py-2 px-3 font-mono tabular-nums text-right">
                              {run.net_power_w.toFixed(1)} W
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>

              {/* Recent Persisted Telemetry */}
              <section className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-[#475569]">
                  Persisted IEEE 1451 Telemetry Log (Latest {history.length})
                </h3>
                <div className="overflow-x-auto bg-[#F4F7FA] border border-[#CBD5E1] rounded-lg">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-[#DCE4EC] text-[#334155] border-b border-[#C3CFD9]">
                        <th className="py-2 px-3">Node ID</th>
                        <th className="py-2 px-3">Source</th>
                        <th className="py-2 px-3 text-right">PM2.5 In→Out</th>
                        <th className="py-2 px-3 text-right">CO₂ In→Out</th>
                        <th className="py-2 px-3 text-right">Flow</th>
                        <th className="py-2 px-3 text-right">SoC</th>
                        <th className="py-2 px-3">Mode / Guard</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#E2E8F0]">
                      {history.map((row) => (
                        <tr key={row.id}>
                          <td className="py-2 px-3 font-mono font-medium text-[#0F172A]">{row.node_id}</td>
                          <td className="py-2 px-3 font-mono text-[11px] text-[#475569]">{row.source}</td>
                          <td className="py-2 px-3 font-mono tabular-nums text-right">
                            {row.pm25_in.toFixed(1)} → {row.pm25_out.toFixed(1)}
                          </td>
                          <td className="py-2 px-3 font-mono tabular-nums text-right">
                            {row.co2_in.toFixed(0)} → {row.co2_out.toFixed(0)}
                          </td>
                          <td className="py-2 px-3 font-mono tabular-nums text-right">
                            {row.flow_m3_h.toFixed(1)} m³/h
                          </td>
                          <td className="py-2 px-3 font-mono tabular-nums text-right">
                            {row.battery_soc.toFixed(1)}%
                          </td>
                          <td className="py-2 px-3 text-[11px] font-mono text-[#334155]">
                            {row.safety_override ?? row.control_mode}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </>
          )}

          {activeTab === 'hardware' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <section className="bg-[#F4F7FA] border border-[#CBD5E1] rounded-lg p-4 space-y-3">
                <h3 className="text-sm font-semibold text-[#0F172A]">
                  Test Live ESP32 Hardware-In-the-Loop (HIL) Ingestion
                </h3>
                <p className="text-xs text-[#475569]">
                  Simulates a physical ESP32 Bio-Solar node posting IEEE 1451.1.6 sensor readings to{' '}
                  <code className="font-mono bg-[#DCE4EC] px-1 py-0.5 rounded">POST /api/v1/hardware/telemetry</code>.
                  The backend validates safety bounds, persists to SQLite, broadcasts via WebSocket, and updates the 3D pod.
                </p>

                <div className="grid grid-cols-2 gap-3 text-xs">
                  <label className="space-y-1">
                    <span className="text-[#475569] font-medium block">Target Pod ID</span>
                    <select
                      value={hilNodeId}
                      onChange={(e) => setHilNodeId(e.target.value)}
                      className="w-full px-2.5 py-1.5 rounded-md bg-white border border-[#CBD5E1] font-mono"
                    >
                      {snapshot.nodes.map((n) => (
                        <option key={n.node_id} value={n.node_id}>
                          {n.node_id}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="space-y-1">
                    <span className="text-[#475569] font-medium block">Battery SoC (%)</span>
                    <input
                      type="number"
                      min={5}
                      max={100}
                      value={hilBattery}
                      onChange={(e) => setHilBattery(Number(e.target.value))}
                      className="w-full px-2.5 py-1.5 rounded-md bg-white border border-[#CBD5E1] font-mono"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-[#475569] font-medium block">Upstream PM2.5 (µg/m³)</span>
                    <input
                      type="number"
                      min={1}
                      max={500}
                      value={hilPm25In}
                      onChange={(e) => setHilPm25In(Number(e.target.value))}
                      className="w-full px-2.5 py-1.5 rounded-md bg-white border border-[#CBD5E1] font-mono"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-[#475569] font-medium block">Downstream PM2.5 (µg/m³)</span>
                    <input
                      type="number"
                      min={1}
                      max={500}
                      value={hilPm25Out}
                      onChange={(e) => setHilPm25Out(Number(e.target.value))}
                      className="w-full px-2.5 py-1.5 rounded-md bg-white border border-[#CBD5E1] font-mono"
                    />
                  </label>
                </div>

                <button
                  type="button"
                  onClick={sendHilPacket}
                  disabled={busy}
                  className="w-full py-2 px-4 rounded-lg bg-[#059669] hover:bg-[#047857] text-white text-xs font-semibold inline-flex items-center justify-center gap-1.5"
                >
                  <Send className="w-3.5 h-3.5" />
                  Send Live Hardware HIL Packet
                </button>
              </section>

              <section className="bg-[#F4F7FA] border border-[#CBD5E1] rounded-lg p-4 space-y-3">
                <h3 className="text-sm font-semibold text-[#0F172A]">
                  Hardware Integration Endpoints & Actuation Response
                </h3>
                <div className="text-xs font-mono bg-[#2D3744] text-[#E2E8F0] p-3 rounded-lg overflow-x-auto space-y-1">
                  <div>POST /api/v1/nodes/register</div>
                  <div>POST /api/v1/hardware/telemetry</div>
                  <div>GET  /api/v1/nodes/:nodeId/command</div>
                  <div>WS   /ws/telemetry</div>
                </div>
                {hilResponse ? (
                  <pre className="text-[11px] font-mono bg-[#1E293B] text-[#A7F3D0] p-3 rounded-lg overflow-x-auto max-h-48">
                    {hilResponse}
                  </pre>
                ) : (
                  <div className="text-xs text-[#64748B] p-3 bg-[#E3EAF0] rounded-lg">
                    Send a test HIL packet on the left to inspect the verified actuation command returned to the ESP32 controller.
                  </div>
                )}
              </section>
            </div>
          )}

          {activeTab === 'tests' && (
            <section className="space-y-3">
              <div className="flex items-center justify-between bg-[#F4F7FA] border border-[#CBD5E1] rounded-lg p-4">
                <div>
                  <h3 className="text-sm font-semibold text-[#0F172A]">
                    Automated End-to-End Software & Hardware Readiness Verification
                  </h3>
                  <p className="text-xs text-[#475569]">
                    Tests SQLite TEDS registry, safety rule overrides, Monod kinetics, C1–C7 protocols, and WebSocket hub live against the running server.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={runE2eTests}
                  disabled={busy}
                  className="px-4 py-2 rounded-lg bg-[#2D3744] hover:bg-[#1E293B] text-white text-xs font-semibold shrink-0"
                >
                  {busy ? 'Running Tests...' : 'Run Full E2E Suite'}
                </button>
              </div>

              {testResults && (
                <div className="bg-[#F4F7FA] border border-[#CBD5E1] rounded-lg divide-y divide-[#E2E8F0]">
                  <div className="px-4 py-2.5 flex items-center justify-between bg-[#DCE4EC]">
                    <span className="text-xs font-semibold text-[#0F172A]">
                      Verification Summary: {testResults.checks.filter((c) => c.passed).length}/
                      {testResults.checks.length} Passed
                    </span>
                    <span
                      className={`text-xs font-semibold ${
                        testResults.allPassed ? 'text-[#059669]' : 'text-[#DC2626]'
                      }`}
                    >
                      {testResults.allPassed ? 'ALL CHECKS PASSED' : 'FAILURES DETECTED'}
                    </span>
                  </div>
                  {testResults.checks.map((c) => (
                    <div key={c.id} className="px-4 py-2.5 flex items-start justify-between gap-3 text-xs">
                      <div className="flex items-start gap-2">
                        {c.passed ? (
                          <CheckCircle2 className="w-4 h-4 text-[#059669] shrink-0 mt-0.5" />
                        ) : (
                          <XCircle className="w-4 h-4 text-[#DC2626] shrink-0 mt-0.5" />
                        )}
                        <div>
                          <div className="font-medium text-[#0F172A]">
                            <span className="font-mono text-[#475569] mr-1.5">{c.id}</span>
                            {c.name}
                          </div>
                          <div className="text-[#475569] mt-0.5">{c.detail}</div>
                        </div>
                      </div>
                      <span
                        className={`font-mono font-semibold shrink-0 ${
                          c.passed ? 'text-[#059669]' : 'text-[#DC2626]'
                        }`}
                      >
                        {c.passed ? 'PASS' : 'FAIL'}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}

          {activeTab === 'security' && (
            <section className="space-y-3">
              <div className="flex items-center justify-between bg-[#F4F7FA] border border-[#CBD5E1] rounded-lg p-3.5">
                <div>
                  <h3 className="text-sm font-semibold text-[#0F172A]">
                    SHA-256 Hash-Chained Cybersecurity Audit Ledger
                  </h3>
                  <p className="text-xs text-[#475569]">
                    Every pod activation, HIL telemetry packet, and blocked unauthorized request is cryptographically chained.
                  </p>
                </div>
                <span
                  className={`px-2.5 py-1 rounded text-xs font-mono font-semibold ${
                    chainValid ? 'bg-[#D1FAE5] text-[#065F46]' : 'bg-[#FEE2E2] text-[#991B1B]'
                  }`}
                >
                  {chainValid ? 'CHAIN INTEGRITY: VERIFIED' : 'CHAIN MISMATCH'}
                </span>
              </div>

              <div className="overflow-x-auto bg-[#F4F7FA] border border-[#CBD5E1] rounded-lg">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-[#DCE4EC] text-[#334155] border-b border-[#C3CFD9]">
                      <th className="py-2 px-3">Action</th>
                      <th className="py-2 px-3">Operator</th>
                      <th className="py-2 px-3">Target</th>
                      <th className="py-2 px-3">Status</th>
                      <th className="py-2 px-3">SHA-256 Digest</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E2E8F0]">
                    {auditLogs.map((log) => (
                      <tr key={log.id}>
                        <td className="py-2 px-3 font-mono font-medium text-[#0F172A]">{log.action}</td>
                        <td className="py-2 px-3 text-[#334155]">{log.actor_email}</td>
                        <td className="py-2 px-3 font-mono text-[#334155]">{log.target}</td>
                        <td className="py-2 px-3 font-mono">
                          <span
                            className={
                              log.status === 'allowed'
                                ? 'text-[#059669]'
                                : log.status === 'denied'
                                ? 'text-[#DC2626]'
                                : 'text-[#0284C7]'
                            }
                          >
                            {log.status.toUpperCase()}
                          </span>
                        </td>
                        <td className="py-2 px-3 font-mono text-[11px] text-[#64748B]">
                          {log.entry_hash.slice(0, 16)}...
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
};
