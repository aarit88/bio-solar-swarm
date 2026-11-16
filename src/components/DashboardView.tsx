import React, { useEffect, useState } from 'react';
import {
  Activity,
  Cpu,
  Fan,
  Lock,
  Power,
  ShieldCheck,
  Users,
  Wind,
  Zap,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { SimulationSnapshot } from '../simulation/types';

export interface TelemetryHistoryPoint {
  timeLabel: string;
  aqi: number;
  pm25: number;
  population: number;
  meanFanPct: number;
  pvPowerW: number;
  loadPowerW: number;
}

interface SecurityAuditRow {
  id: number;
  timestamp: number;
  actor_email: string;
  action: string;
  target: string;
  status: string;
  detail: string;
  entry_hash: string;
}

interface DashboardViewProps {
  snapshot: SimulationSnapshot;
  history: TelemetryHistoryPoint[];
  onSelectNode: (nodeId: string) => void;
  onRequestTogglePodPower: (nodeId: string, nextEnabled: boolean) => void;
}

function buildPolylinePoints(values: number[], width: number, height: number, maxVal: number): string {
  if (values.length === 0) return '';
  const safeMax = Math.max(1, maxVal);
  return values
    .map((v, idx) => {
      const x = values.length === 1 ? width / 2 : (idx / (values.length - 1)) * width;
      const y = height - Math.min(1, Math.max(0, v / safeMax)) * (height - 12) - 6;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  snapshot,
  history,
  onSelectNode,
  onRequestTogglePodPower,
}) => {
  const { authFetch, user } = useAuth();
  const [auditLogs, setAuditLogs] = useState<SecurityAuditRow[]>([]);
  const [auditValid, setAuditValid] = useState<boolean>(true);

  useEffect(() => {
    let active = true;
    const loadAudit = async () => {
      try {
        const resp = await authFetch('/api/v1/security/audit?limit=12');
        if (!resp.ok) return;
        const data = await resp.json();
        if (active) {
          setAuditLogs(data.logs || []);
          setAuditValid(Boolean(data.integrity?.valid ?? true));
        }
      } catch {
        // ignore transient refresh failure
      }
    };
    loadAudit();
    const timer = window.setInterval(loadAudit, 6000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [authFetch, snapshot.activeNodeCount]);

  const meanFanPct =
    snapshot.nodes.reduce((sum, n) => sum + (n.enabled !== false ? n.fan_duty * 100 : 0), 0) /
    Math.max(1, snapshot.nodes.length);

  const recentPoints = history.slice(-30);
  const aqiSeries = recentPoints.map((p) => p.aqi);
  const popSeries = recentPoints.map((p) => p.population);
  const fanSeries = recentPoints.map((p) => p.meanFanPct);
  const pvSeries = recentPoints.map((p) => p.pvPowerW);
  const loadSeries = recentPoints.map((p) => p.loadPowerW);

  return (
    <div
      data-testid="engineering-dashboard-view"
      className="fixed inset-0 top-12 z-20 bg-[#D5DDE5] text-[#1E293B] overflow-y-auto p-4 md:p-6"
    >
      <div className="max-w-7xl mx-auto space-y-5 pb-24">
        {/* Top Engineering Strip */}
        <div className="flex flex-wrap items-center justify-between gap-3 bg-[#EEF2F6] border border-[#B8C4D0] rounded-xl px-5 py-3.5 shadow-sm">
          <div>
            <div className="text-[11px] font-mono uppercase tracking-wider text-[#0F766E] font-semibold">
              Bio-Solar Swarm · Cyber-Physical Operations Console
            </div>
            <h1 className="text-lg font-bold text-[#0F172A]">
              Corridor Remediation Telemetry, Swarm Coordination &amp; Security Ledger
            </h1>
          </div>
          <div className="flex items-center gap-3 text-xs">
            <div className="px-3 py-1.5 rounded-lg bg-[#DCE4EC] border border-[#CBD5E1] font-mono">
              Operator: <strong>{user?.email || user?.uid}</strong>
            </div>
            <div
              className={`px-3 py-1.5 rounded-lg border font-mono font-semibold inline-flex items-center gap-1.5 ${
                auditValid
                  ? 'bg-[#ECFDF5] border-[#6EE7B7] text-[#065F46]'
                  : 'bg-[#FEF2F2] border-[#FCA5A5] text-[#991B1B]'
              }`}
            >
              <ShieldCheck className="w-3.5 h-3.5" />
              SHA-256 Chain: {auditValid ? 'VERIFIED' : 'ALERT'}
            </div>
          </div>
        </div>

        {/* 6-Card KPI Matrix */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <KpiCard
            icon={<Wind className="w-4 h-4 text-[#059669]" />}
            label="Pedestrian AQI"
            value={`${snapshot.pedestrianAqi}`}
            sub={`${snapshot.aqiCategory} · PM2.5 ${snapshot.pedestrianPm25.toFixed(1)} µg/m³`}
          />
          <KpiCard
            icon={<Activity className="w-4 h-4 text-[#0D9488]" />}
            label="Verified Rv Gain"
            value={`+${snapshot.verifiedReductionRvPct.toFixed(1)}%`}
            sub={`CO₂ Captured ${snapshot.totalCo2CapturedG.toFixed(1)} g`}
          />
          <KpiCard
            icon={<Users className="w-4 h-4 text-[#0284C7]" />}
            label="Voice Crowd Est."
            value={`${snapshot.populationCount} pax`}
            sub={`SPL ${snapshot.voiceActivityDb.toFixed(1)} dB · ${snapshot.populationFanMultiplier.toFixed(2)}x`}
          />
          <KpiCard
            icon={<Fan className="w-4 h-4 text-[#2563EB]" />}
            label="Mean Fan Duty"
            value={`${meanFanPct.toFixed(0)}%`}
            sub={`Policy: ${snapshot.environment.activeMode}`}
          />
          <KpiCard
            icon={<Zap className="w-4 h-4 text-[#D97706]" />}
            label="Net Solar Balance"
            value={`${snapshot.totalNetPowerW >= 0 ? '+' : ''}${snapshot.totalNetPowerW.toFixed(0)} W`}
            sub={`PV +${snapshot.totalPvPowerW.toFixed(0)}W / Load ${snapshot.totalLoadPowerW.toFixed(0)}W`}
          />
          <KpiCard
            icon={<Cpu className="w-4 h-4 text-[#475569]" />}
            label="Swarm Pod Status"
            value={`${snapshot.activeNodeCount} / ${snapshot.nodes.length}`}
            sub="Individual Auth Enforced"
          />
        </div>

        {/* Time-Series SVG Trend Charts */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <ChartCard
            title="Pedestrian Corridor AQI Trend"
            valueLabel={`Latest ${snapshot.pedestrianAqi} AQI`}
            color="#059669"
            seriesA={aqiSeries}
            maxVal={200}
            legendA="AQI"
          />
          <ChartCard
            title="Voice Crowd vs. Mean Fan Duty (%)"
            valueLabel={`${snapshot.populationCount} pax → ${meanFanPct.toFixed(0)}% fan`}
            color="#0284C7"
            colorB="#D97706"
            seriesA={fanSeries}
            seriesB={popSeries.map((p) => (p / 180) * 100)}
            maxVal={100}
            legendA="Fan Duty %"
            legendB="Crowd Density %"
          />
          <ChartCard
            title="50W Solar PV Harvest vs. Swarm Load (W)"
            valueLabel={`PV +${snapshot.totalPvPowerW.toFixed(0)}W`}
            color="#0D9488"
            colorB="#DC2626"
            seriesA={pvSeries}
            seriesB={loadSeries}
            maxVal={280}
            legendA="PV Harvest (W)"
            legendB="Total Load (W)"
          />
        </div>

        {/* Per-Pod Telemetry Matrix & Authenticated Individual Power Control */}
        <div className="bg-[#EEF2F6] border border-[#B8C4D0] rounded-xl overflow-hidden shadow-sm">
          <div className="px-5 py-3 bg-[#DCE4EC] border-b border-[#B8C4D0] flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs font-semibold text-[#0F172A]">
              <Lock className="w-4 h-4 text-[#0F766E]" />
              IEEE 1451 Smart Transducer Matrix &amp; Authenticated Pod Switching
            </div>
            <span className="text-[11px] font-mono text-[#475569]">
              Per-pod Activate / Deactivate prompts Firebase re-authentication
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-[#E3EAF0] text-[#475569] font-semibold border-b border-[#CBD5E1]">
                <tr>
                  <th className="px-4 py-2.5">Pod ID &amp; Zone</th>
                  <th className="px-4 py-2.5">State</th>
                  <th className="px-4 py-2.5">PM2.5 In → Out (η)</th>
                  <th className="px-4 py-2.5">Fan Duty / Flow</th>
                  <th className="px-4 py-2.5">PBR pH / CO₂</th>
                  <th className="px-4 py-2.5">Battery / Net W</th>
                  <th className="px-4 py-2.5">Safety Override</th>
                  <th className="px-4 py-2.5 text-right">Auth Power Control</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#CBD5E1]">
                {snapshot.nodes.map((node) => {
                  const isEnabled = node.enabled !== false;
                  return (
                    <tr key={node.node_id} className="hover:bg-[#F8FAFC] transition-colors">
                      <td className="px-4 py-2.5">
                        <button
                          type="button"
                          onClick={() => onSelectNode(node.node_id)}
                          className="font-mono font-semibold text-[#0F172A] hover:text-[#059669] text-left"
                        >
                          {node.node_id}
                        </button>
                        <div className="text-[11px] text-[#64748B]">{node.zone}</div>
                      </td>
                      <td className="px-4 py-2.5 font-mono font-semibold">
                        <span className={isEnabled ? 'text-[#059669]' : 'text-[#DC2626]'}>
                          {isEnabled ? 'ACTIVE' : 'OFFLINE'}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 font-mono tabular-nums">
                        {node.cin.pm25.toFixed(1)} → {node.cout.pm25.toFixed(1)}{' '}
                        <span className="text-[#059669]">({node.pm25_removal_pct.toFixed(0)}%)</span>
                      </td>
                      <td className="px-4 py-2.5 font-mono tabular-nums">
                        {Math.round(node.fan_duty * 100)}% · {node.flow_m3_h.toFixed(0)} m³/h
                      </td>
                      <td className="px-4 py-2.5 font-mono tabular-nums">
                        pH {node.pbr.ph.toFixed(2)} · {node.pbr.co2_mass_rate_gh.toFixed(2)} g/h
                      </td>
                      <td className="px-4 py-2.5 font-mono tabular-nums">
                        {node.battery_soc.toFixed(1)}% ·{' '}
                        <span className={node.net_power_w >= 0 ? 'text-[#059669]' : 'text-[#D97706]'}>
                          {node.net_power_w >= 0 ? '+' : ''}
                          {node.net_power_w.toFixed(1)}W
                        </span>
                      </td>
                      <td className="px-4 py-2.5 font-mono text-[11px] text-[#B45309]">
                        {node.safety_override || 'Nominal'}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <button
                          type="button"
                          onClick={() => onRequestTogglePodPower(node.node_id, !isEnabled)}
                          data-testid={`pod-power-btn-${node.node_id}`}
                          className={`px-3 py-1.5 rounded-md text-xs font-semibold inline-flex items-center gap-1 transition-colors ${
                            isEnabled
                              ? 'bg-[#DC2626] hover:bg-[#B91C1C] text-white'
                              : 'bg-[#059669] hover:bg-[#047857] text-white'
                          }`}
                        >
                          <Power className="w-3 h-3" />
                          {isEnabled ? 'Deactivate' : 'Activate'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Bottom Split: Swarm Links & Hash-Chained Security Audit Ledger */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="bg-[#EEF2F6] border border-[#B8C4D0] rounded-xl p-4 space-y-2.5">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-[#475569]">
              ACO Pheromone Mesh Links
            </h2>
            <div className="space-y-2 text-xs">
              {snapshot.links.map((link) => (
                <div
                  key={`${link.fromId}-${link.toId}`}
                  className="bg-[#F8FAFC] border border-[#CBD5E1] rounded-lg px-3 py-2 flex items-center justify-between font-mono"
                >
                  <span>
                    {link.fromId} ↔ {link.toId}
                  </span>
                  <span className={link.active ? 'text-[#059669]' : 'text-[#64748B]'}>
                    τ={link.pheromoneWeight.toFixed(2)} · {link.packetRateHz} Hz{' '}
                    {link.active ? 'SYNC' : 'ISOLATED'}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-[#EEF2F6] border border-[#B8C4D0] rounded-xl p-4 space-y-2.5">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-[#475569]">
              Cybersecurity SHA-256 Audit Stream
            </h2>
            <div className="space-y-1.5 max-h-56 overflow-y-auto text-xs">
              {auditLogs.length === 0 ? (
                <div className="text-[#64748B] py-4 text-center">
                  No recent security ledger events logged in this session.
                </div>
              ) : (
                auditLogs.map((log) => (
                  <div
                    key={log.id}
                    className="bg-[#F8FAFC] border border-[#CBD5E1] rounded-lg px-3 py-2 flex items-start justify-between gap-2"
                  >
                    <div className="min-w-0">
                      <div className="font-mono font-semibold text-[#0F172A] truncate">
                        {log.action} · {log.target}
                      </div>
                      <div className="text-[11px] text-[#475569] truncate">
                        {log.actor_email} — {log.detail}
                      </div>
                    </div>
                    <div className="text-[10px] font-mono text-[#64748B] shrink-0">
                      #{log.entry_hash.slice(0, 8)}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

const KpiCard: React.FC<{
  icon: React.ReactNode;
  label: string;
  value: string;
  sub: string;
}> = ({ icon, label, value, sub }) => (
  <div className="bg-[#EEF2F6] border border-[#B8C4D0] rounded-xl p-3.5 shadow-sm">
    <div className="flex items-center justify-between text-[11px] font-medium text-[#475569]">
      <span>{label}</span>
      {icon}
    </div>
    <div className="mt-1 text-xl font-mono tabular-nums font-bold text-[#0F172A]">{value}</div>
    <div className="mt-0.5 text-[11px] text-[#64748B] truncate">{sub}</div>
  </div>
);

const ChartCard: React.FC<{
  title: string;
  valueLabel: string;
  color: string;
  colorB?: string;
  seriesA: number[];
  seriesB?: number[];
  maxVal: number;
  legendA: string;
  legendB?: string;
}> = ({ title, valueLabel, color, colorB, seriesA, seriesB, maxVal, legendA, legendB }) => {
  const width = 340;
  const height = 104;
  const ptsA = buildPolylinePoints(seriesA, width, height, maxVal);
  const ptsB = seriesB ? buildPolylinePoints(seriesB, width, height, maxVal) : '';

  return (
    <div className="bg-[#EEF2F6] border border-[#B8C4D0] rounded-xl p-4 shadow-sm space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs font-semibold text-[#0F172A] truncate">{title}</div>
        <div className="text-[11px] font-mono text-[#475569] shrink-0">{valueLabel}</div>
      </div>
      <div className="bg-white border border-[#CBD5E1] rounded-lg p-2">
        <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-24 overflow-visible">
          <line x1="0" y1={height / 2} x2={width} y2={height / 2} stroke="#E2E8F0" strokeDasharray="4 4" />
          {ptsA && <polyline fill="none" stroke={color} strokeWidth="2.5" points={ptsA} />}
          {ptsB && colorB && <polyline fill="none" stroke={colorB} strokeWidth="2" points={ptsB} />}
        </svg>
      </div>
      <div className="flex items-center gap-4 text-[11px] text-[#475569]">
        <span className="inline-flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: color }} />
          {legendA}
        </span>
        {legendB && colorB && (
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: colorB }} />
            {legendB}
          </span>
        )}
      </div>
    </div>
  );
};
