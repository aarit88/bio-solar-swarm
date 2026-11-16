/**
 * Node Inspector Drawer: Detailed IEEE 1451 Smart Transducer & PBR Digital Twin
 * Shows Cin vs Cout mass balance, Monod kinetics, colorimetric KMnO4 proxy,
 * Eq. (4) PV/LiFePO4 energy budget, Table II BOM, and local safety rule testing.
 */

import React from 'react';
import { X, ShieldAlert, Cpu, BatteryCharging, FlaskConical, Wind, RotateCcw, Power, Lock } from 'lucide-react';
import {
  AlgalStrain,
  PRELIMINARY_BOM_INR,
  SmartTransducerNodeState,
  TreatmentConfig,
} from '../simulation/types';

interface NodeInspectorDrawerProps {
  node: SmartTransducerNodeState;
  allNodes: SmartTransducerNodeState[];
  onSelectNode: (nodeId: string) => void;
  onClose: () => void;
  strain: AlgalStrain;
  onChangeStrain: (strain: AlgalStrain) => void;
  treatmentConfig: TreatmentConfig;
  onChangeTreatmentConfig: (cfg: TreatmentConfig) => void;
  onToggleFault: (nodeId: string, fault: 'ph' | 'battery' | 'reset') => void;
  onRequestTogglePodPower: (nodeId: string, nextEnabled: boolean) => void;
}

export const NodeInspectorDrawer: React.FC<NodeInspectorDrawerProps> = ({
  node,
  allNodes,
  onSelectNode,
  onClose,
  strain,
  onChangeStrain,
  treatmentConfig,
  onChangeTreatmentConfig,
  onToggleFault,
  onRequestTogglePodPower,
}) => {
  const [cr, cg, cb] = node.media.colorimetric_rgb;
  const totalBom = PRELIMINARY_BOM_INR.reduce((s, i) => s + i.costInr, 0);
  const totalLoadW =
    Math.round((node.fan_power_w + node.pump_power_w + node.sense_comm_ctrl_w) * 100) / 100;

  return (
    <aside
      aria-label="Node Hardware and Biological Inspector"
      className="fixed top-14 right-4 bottom-4 w-[min(430px,calc(100vw-2rem))] z-30 bg-[#EBF0F5] text-[#1E293B] border border-[#C3CFD9] rounded-xl shadow-xl flex flex-col overflow-hidden"
    >
      {/* Header */}
      <div className="px-4 py-3 bg-[#DCE4EC] border-b border-[#C3CFD9] flex items-center justify-between gap-3 shrink-0">
        <div className="min-w-0">
          <div className="text-xs font-mono text-[#475569] truncate">
            {node.calibration_id} · {node.hardware_source === 'physical_hil' ? 'Hardware HIL' : 'Digital Twin'}
          </div>
          <h2 className="text-base font-semibold text-[#0F172A] truncate">{node.label}</h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close Node Inspector"
          className="p-1.5 rounded-lg text-[#475569] hover:text-[#0F172A] hover:bg-[#CBD5E1]/60 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Node Selector Tabs */}
      <div className="px-4 py-2 bg-[#E3EAF0] border-b border-[#CBD5E1] flex items-center gap-1.5 overflow-x-auto shrink-0">
        {allNodes.map((n, idx) => (
          <button
            key={n.node_id}
            type="button"
            onClick={() => onSelectNode(n.node_id)}
            className={`px-2.5 py-1 text-xs font-mono font-medium rounded-md whitespace-nowrap shrink-0 transition-colors ${
              n.node_id === node.node_id
                ? 'bg-[#2D3744] text-[#F8FAFC]'
                : 'bg-[#F4F7FA] text-[#334155] border border-[#CBD5E1] hover:bg-white'
            }`}
          >
            Pod 0{idx + 1}
          </button>
        ))}
      </div>

      {/* Scrollable Telemetry Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Individual Pod Authenticated Power Control */}
        <section className="bg-[#DCE4EC] border border-[#B8C4D0] rounded-lg p-3 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs font-semibold text-[#0F172A] flex items-center gap-1.5">
              <Lock className="w-3.5 h-3.5 text-[#0F766E]" />
              Pod Status: {node.enabled !== false ? 'ACTIVE' : 'DEACTIVATED'}
            </div>
            <div className="text-[11px] text-[#475569]">
              Individual pod switching requires Firebase operator re-authentication.
            </div>
          </div>
          <button
            type="button"
            onClick={() => onRequestTogglePodPower(node.node_id, node.enabled === false)}
            className={`px-3 py-1.5 rounded-md text-xs font-semibold inline-flex items-center gap-1.5 shrink-0 transition-colors ${
              node.enabled !== false
                ? 'bg-[#DC2626] hover:bg-[#B91C1C] text-white'
                : 'bg-[#059669] hover:bg-[#047857] text-white'
            }`}
          >
            <Power className="w-3.5 h-3.5" />
            {node.enabled !== false ? 'Deactivate Pod' : 'Activate Pod'}
          </button>
        </section>

        {/* Safety Override Banner */}
        {node.safety_override && (
          <div className="p-3 rounded-lg bg-[#FEF3C7] border border-[#F59E0B] flex items-start gap-2.5">
            <ShieldAlert className="w-4 h-4 text-[#B45309] shrink-0 mt-0.5" />
            <div className="text-xs text-[#78350F]">
              <div className="font-semibold">Local Safety Rule Active: {node.safety_override}</div>
              <div className="mt-0.5">
                Edge controller overrode swarm setpoint to protect battery or biological reactor invariants.
              </div>
            </div>
          </div>
        )}

        {/* Section 1: Upstream vs Downstream Verification (Eq. 3 & Eq. 5) */}
        <section className="bg-[#F4F7FA] border border-[#CBD5E1] rounded-lg p-3.5 space-y-2.5">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-[#475569] flex items-center gap-1.5">
              <Wind className="w-3.5 h-3.5 text-[#0D9488]" />
              Inlet vs. Outlet Verification
            </h3>
            <span className="text-xs font-mono tabular-nums text-[#0F766E] font-medium">
              Q = {node.flow_m3_h.toFixed(1)} m³/h
            </span>
          </div>

          <div className="space-y-2 text-xs">
            <MetricComparisonRow
              label="PM2.5 (µg/m³)"
              cin={node.cin.pm25}
              cout={node.cout.pm25}
              eta={node.pm25_removal_pct}
            />
            <MetricComparisonRow
              label="NO₂ (ppb)"
              cin={node.cin.no2}
              cout={node.cout.no2}
              eta={node.no2_removal_pct}
            />
            <MetricComparisonRow
              label="CO₂ (ppm)"
              cin={node.cin.co2}
              cout={node.cout.co2}
              eta={node.co2_removal_pct}
            />
          </div>

          <div className="pt-2 border-t border-[#E2E8F0] grid grid-cols-2 gap-2 text-xs">
            <div>
              <span className="text-[#64748B]">CO₂ Mass Rate (Eq. 5):</span>
              <div className="font-mono tabular-nums font-semibold text-[#0F172A]">
                {node.pbr.co2_mass_rate_gh.toFixed(2)} g/h
              </div>
            </div>
            <div>
              <span className="text-[#64748B]">O₂ Evolution:</span>
              <div className="font-mono tabular-nums font-semibold text-[#0F766E]">
                {node.pbr.o2_evolution_gh.toFixed(2)} g/h
              </div>
            </div>
          </div>
        </section>

        {/* Section 2: Microalgal Photobioreactor (PBR) & Strain Controls */}
        <section className="bg-[#F4F7FA] border border-[#CBD5E1] rounded-lg p-3.5 space-y-2.5">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-[#475569] flex items-center gap-1.5">
              <FlaskConical className="w-3.5 h-3.5 text-[#059669]" />
              Photobioreactor Kinetics
            </h3>
            <span className="text-xs font-mono tabular-nums text-[#334155]">
              {node.pbr.isolated ? 'Bypassed' : 'Active'} · Health {Math.round(node.pbr.algae_health_score * 100)}%
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => onChangeStrain('Chlorella_sorokiniana_RMT01')}
              className={`flex-1 py-1.5 px-2 text-xs font-medium rounded-md border transition-colors ${
                strain === 'Chlorella_sorokiniana_RMT01'
                  ? 'bg-[#059669] text-white border-[#047857]'
                  : 'bg-white text-[#334155] border-[#CBD5E1] hover:bg-[#F1F5F9]'
              }`}
            >
              Chlorella RMT01
            </button>
            <button
              type="button"
              onClick={() => onChangeStrain('Spirulina_platensis')}
              className={`flex-1 py-1.5 px-2 text-xs font-medium rounded-md border transition-colors ${
                strain === 'Spirulina_platensis'
                  ? 'bg-[#0D9488] text-white border-[#0F766E]'
                  : 'bg-white text-[#334155] border-[#CBD5E1] hover:bg-[#F1F5F9]'
              }`}
            >
              Spirulina platensis
            </button>
          </div>

          <div className="grid grid-cols-3 gap-2 text-xs pt-1">
            <div className="bg-[#E8EEF3] rounded p-2">
              <div className="text-[#64748B]">Culture pH</div>
              <div className="font-mono tabular-nums font-semibold text-[#0F172A]">{node.pbr.ph.toFixed(2)}</div>
            </div>
            <div className="bg-[#E8EEF3] rounded p-2">
              <div className="text-[#64748B]">Growth µ (1/h)</div>
              <div className="font-mono tabular-nums font-semibold text-[#0F172A]">
                {node.pbr.specific_growth_rate_h.toFixed(4)}
              </div>
            </div>
            <div className="bg-[#E8EEF3] rounded p-2">
              <div className="text-[#64748B]">OD680</div>
              <div className="font-mono tabular-nums font-semibold text-[#0F172A]">
                {node.pbr.optical_density.toFixed(3)}
              </div>
            </div>
          </div>

          {/* Colorimetric KMnO4 Media & Pre-filter dP */}
          <div className="pt-2 border-t border-[#E2E8F0] flex items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2">
              <span
                className="w-4 h-4 rounded border border-slate-400 shrink-0"
                style={{ backgroundColor: `rgb(${cr}, ${cg}, ${cb})` }}
              />
              <span>
                KMnO₄ Carbon: <strong className="font-mono tabular-nums">{node.media.carbon_kmno4_remaining_pct.toFixed(1)}%</strong>
              </span>
            </div>
            <span className="font-mono tabular-nums text-[#475569]">
              ΔP {node.media.prefilter_dp_pa.toFixed(1)} Pa
            </span>
          </div>
        </section>

        {/* Section 3: Eq. (4) Solar-PV & 12V 20Ah LiFePO4 Energy Balance */}
        <section className="bg-[#F4F7FA] border border-[#CBD5E1] rounded-lg p-3.5 space-y-2.5">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-[#475569] flex items-center gap-1.5">
              <BatteryCharging className="w-3.5 h-3.5 text-[#2563EB]" />
              50W PV & LiFePO₄ Budget (Eq. 4)
            </h3>
            <span className="text-xs font-mono tabular-nums font-semibold text-[#0F172A]">
              SoC {node.battery_soc.toFixed(1)}%
            </span>
          </div>

          <div className="w-full h-2 bg-[#DCE4EC] rounded-full overflow-hidden">
            <div
              className={`h-full transition-all duration-300 ${
                node.battery_soc < 20 ? 'bg-[#DC2626]' : node.battery_soc < 45 ? 'bg-[#D97706]' : 'bg-[#059669]'
              }`}
              style={{ width: `${Math.max(4, Math.min(100, node.battery_soc))}%` }}
            />
          </div>

          <div className="grid grid-cols-3 gap-2 text-xs">
            <div>
              <div className="text-[#64748B]">PV Harvest</div>
              <div className="font-mono tabular-nums font-semibold text-[#059669]">+{node.pv_harvest_w.toFixed(1)} W</div>
            </div>
            <div>
              <div className="text-[#64748B]">Total Load</div>
              <div className="font-mono tabular-nums font-semibold text-[#334155]">-{totalLoadW.toFixed(1)} W</div>
            </div>
            <div>
              <div className="text-[#64748B]">Net Balance</div>
              <div
                className={`font-mono tabular-nums font-semibold ${
                  node.net_power_w >= 0 ? 'text-[#059669]' : 'text-[#D97706]'
                }`}
              >
                {node.net_power_w >= 0 ? '+' : ''}
                {node.net_power_w.toFixed(1)} W
              </div>
            </div>
          </div>
          <div className="text-[11px] font-mono text-[#64748B]">
            Fan {node.fan_power_w.toFixed(1)}W · Pump {node.pump_power_w.toFixed(1)}W · ESP32+Sensors {node.sense_comm_ctrl_w.toFixed(1)}W
          </div>
        </section>

        {/* Section 4: Hybrid Stage Toggles & Local Safety Rule Fault Injection */}
        <section className="bg-[#F4F7FA] border border-[#CBD5E1] rounded-lg p-3.5 space-y-2.5">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-[#475569] flex items-center gap-1.5">
            <Cpu className="w-3.5 h-3.5 text-[#475569]" />
            Stage Isolation & Safety Rule Testing
          </h3>

          <div className="grid grid-cols-3 gap-1.5 text-xs">
            <label className="flex items-center gap-1.5 bg-white border border-[#CBD5E1] rounded px-2 py-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={treatmentConfig.particulateStage}
                onChange={(e) =>
                  onChangeTreatmentConfig({ ...treatmentConfig, particulateStage: e.target.checked })
                }
              />
              <span>PM Stage</span>
            </label>
            <label className="flex items-center gap-1.5 bg-white border border-[#CBD5E1] rounded px-2 py-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={treatmentConfig.chemicalAdsorptionStage}
                onChange={(e) =>
                  onChangeTreatmentConfig({ ...treatmentConfig, chemicalAdsorptionStage: e.target.checked })
                }
              />
              <span>KMnO₄</span>
            </label>
            <label className="flex items-center gap-1.5 bg-white border border-[#CBD5E1] rounded px-2 py-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={treatmentConfig.biologicalPbrStage}
                onChange={(e) =>
                  onChangeTreatmentConfig({ ...treatmentConfig, biologicalPbrStage: e.target.checked })
                }
              />
              <span>Bio PBR</span>
            </label>
          </div>

          <div className="flex flex-wrap gap-1.5 pt-1">
            <button
              type="button"
              onClick={() => onToggleFault(node.node_id, 'battery')}
              className={`px-2.5 py-1.5 text-xs font-medium rounded-md border transition-colors ${
                node.manual_fault_low_batt
                  ? 'bg-[#D97706] text-white border-[#B45309]'
                  : 'bg-white text-[#334155] border-[#CBD5E1] hover:bg-[#FEF3C7]'
              }`}
            >
              Simulate Low Battery
            </button>
            <button
              type="button"
              onClick={() => onToggleFault(node.node_id, 'ph')}
              className={`px-2.5 py-1.5 text-xs font-medium rounded-md border transition-colors ${
                node.manual_fault_ph_drift
                  ? 'bg-[#DC2626] text-white border-[#B91C1C]'
                  : 'bg-white text-[#334155] border-[#CBD5E1] hover:bg-[#FEE2E2]'
              }`}
            >
              Simulate pH Drift
            </button>
            <button
              type="button"
              onClick={() => onToggleFault(node.node_id, 'reset')}
              className="px-2.5 py-1.5 text-xs font-medium rounded-md bg-white text-[#334155] border border-[#CBD5E1] hover:bg-[#E2E8F0] inline-flex items-center gap-1"
            >
              <RotateCcw className="w-3 h-3" />
              Clear Faults
            </button>
          </div>
        </section>

        {/* Section 5: Table II Preliminary Node BOM */}
        <section className="bg-[#F4F7FA] border border-[#CBD5E1] rounded-lg p-3.5 space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-[#475569]">
              Table II Node BOM Estimate
            </h3>
            <span className="text-xs font-mono tabular-nums font-semibold text-[#0F172A]">
              INR {totalBom.toLocaleString('en-IN')}
            </span>
          </div>
          <div className="divide-y divide-[#E2E8F0] text-xs">
            {PRELIMINARY_BOM_INR.map((item) => (
              <div key={item.category} className="py-1.5 flex items-start justify-between gap-2">
                <div>
                  <div className="font-medium text-[#1E293B]">{item.category}</div>
                  <div className="text-[11px] text-[#64748B]">{item.specification}</div>
                </div>
                <span className="font-mono tabular-nums text-[#334155] shrink-0">
                  ₹{item.costInr.toLocaleString('en-IN')}
                </span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </aside>
  );
};

const MetricComparisonRow: React.FC<{
  label: string;
  cin: number;
  cout: number;
  eta: number;
}> = ({ label, cin, cout, eta }) => (
  <div className="space-y-1">
    <div className="flex items-center justify-between">
      <span className="text-[#334155] font-medium">{label}</span>
      <span className="font-mono tabular-nums text-[#0F172A]">
        {cin.toFixed(1)} → <strong className="text-[#059669]">{cout.toFixed(1)}</strong>{' '}
        <span className="text-[#0D9488]">(η {eta.toFixed(1)}%)</span>
      </span>
    </div>
    <div className="h-1.5 bg-[#DCE4EC] rounded-full overflow-hidden flex">
      <div
        className="h-full bg-[#10B981] transition-all duration-300"
        style={{ width: `${Math.max(4, Math.min(100, eta))}%` }}
      />
    </div>
  </div>
);
