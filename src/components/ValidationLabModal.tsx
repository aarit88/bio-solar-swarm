/**
 * Controlled Validation Lab Modal (Table III C1..C7 from Research Paper)
 * Executes deterministic A/B baseline vs treatment protocols and persists results to SQLite.
 */

import React, { useState } from 'react';
import { X, Play, CheckCircle2, AlertTriangle } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { EnvironmentParams, ValidationConditionResult } from '../simulation/types';

interface ValidationLabModalProps {
  environment: EnvironmentParams;
  onClose: () => void;
  onResultsPersisted?: () => void;
}

export const ValidationLabModal: React.FC<ValidationLabModalProps> = ({
  environment,
  onClose,
  onResultsPersisted,
}) => {
  const { authFetch } = useAuth();
  const [results, setResults] = useState<ValidationConditionResult[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runSuite = async () => {
    setLoading(true);
    setError(null);
    try {
      const resp = await authFetch('/api/v1/validations/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(environment),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      setResults(data.results);
      onResultsPersisted?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to run validation suite');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Controlled Validation Protocols C1 to C7"
      className="fixed inset-0 z-40 bg-[#1E293B]/55 flex items-center justify-center p-4"
    >
      <div className="bg-[#EBF0F5] text-[#1E293B] border border-[#B8C4D0] rounded-xl shadow-2xl w-full max-w-5xl max-h-[86vh] flex flex-col overflow-hidden">
        <div className="px-5 py-3.5 bg-[#DCE4EC] border-b border-[#C3CFD9] flex items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-[#0F172A]">
              Table III Controlled Validation Suite (C1–C7)
            </h2>
            <p className="text-xs text-[#475569]">
              Separates biological, chemical adsorption, hybrid filtration, and swarm coordination benefits under matched street conditions.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={runSuite}
              disabled={loading}
              className="px-3.5 py-2 rounded-lg bg-[#059669] hover:bg-[#047857] disabled:opacity-60 text-white text-xs font-semibold inline-flex items-center gap-1.5 transition-colors whitespace-nowrap"
            >
              <Play className="w-3.5 h-3.5" />
              {loading ? 'Running Protocols...' : 'Run C1–C7 & Save to DB'}
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close Validation Lab"
              className="p-1.5 rounded-lg text-[#475569] hover:text-[#0F172A] hover:bg-[#CBD5E1]/70 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {error && (
            <div className="p-3 rounded-lg bg-[#FEE2E2] border border-[#EF4444] text-xs text-[#991B1B]">
              Error: {error}
            </div>
          )}

          {!results && !loading && (
            <div className="bg-[#F4F7FA] border border-[#CBD5E1] rounded-lg p-8 text-center space-y-3">
              <div className="text-sm font-medium text-[#1E293B]">
                Ready to execute Controlled Experimental Validation Protocols (C1–C7)
              </div>
              <p className="text-xs text-[#475569] max-w-xl mx-auto">
                Uses your current environmental profile ({environment.trafficPollution}% traffic load,{' '}
                {environment.windSpeedMs.toFixed(1)} m/s wind, {environment.solarIrradianceWm2} W/m² solar)
                to compare matched baselines and store results into SQLite.
              </p>
              <button
                type="button"
                onClick={runSuite}
                className="px-4 py-2 rounded-lg bg-[#2D3744] hover:bg-[#1E293B] text-white text-xs font-semibold inline-flex items-center gap-1.5"
              >
                <Play className="w-3.5 h-3.5" />
                Execute C1–C7 Benchmark
              </button>
            </div>
          )}

          {results && (
            <div className="overflow-x-auto bg-[#F4F7FA] border border-[#CBD5E1] rounded-lg">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-[#DCE4EC] text-[#334155] border-b border-[#C3CFD9]">
                    <th className="py-2.5 px-3 font-semibold">Cond.</th>
                    <th className="py-2.5 px-3 font-semibold">Comparison & Purpose</th>
                    <th className="py-2.5 px-3 font-semibold text-right">Baseline AQI</th>
                    <th className="py-2.5 px-3 font-semibold text-right">Test AQI</th>
                    <th className="py-2.5 px-3 font-semibold text-right">ΔRv (%)</th>
                    <th className="py-2.5 px-3 font-semibold text-right">Load (W)</th>
                    <th className="py-2.5 px-3 font-semibold text-right">Rem / W</th>
                    <th className="py-2.5 px-3 font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E2E8F0]">
                  {results.map((r) => (
                    <tr key={r.conditionId} className="hover:bg-white/60">
                      <td className="py-2.5 px-3 font-mono font-semibold text-[#0F172A]">{r.conditionId}</td>
                      <td className="py-2.5 px-3">
                        <div className="font-medium text-[#0F172A]">{r.title}</div>
                        <div className="text-[11px] text-[#475569]">{r.notes}</div>
                      </td>
                      <td className="py-2.5 px-3 font-mono tabular-nums text-right text-[#475569]">
                        {r.baselineAqi}
                      </td>
                      <td className="py-2.5 px-3 font-mono tabular-nums text-right font-semibold text-[#0F172A]">
                        {r.testAqi}
                      </td>
                      <td className="py-2.5 px-3 font-mono tabular-nums text-right font-semibold text-[#059669]">
                        {r.deltaRvPct >= 0 ? '+' : ''}
                        {r.deltaRvPct.toFixed(1)}%
                      </td>
                      <td className="py-2.5 px-3 font-mono tabular-nums text-right text-[#334155]">
                        {r.testPowerW.toFixed(1)} W
                      </td>
                      <td className="py-2.5 px-3 font-mono tabular-nums text-right text-[#0F766E]">
                        {r.remPerWh.toFixed(3)}
                      </td>
                      <td className="py-2.5 px-3 whitespace-nowrap">
                        {r.passed ? (
                          <span className="inline-flex items-center gap-1 text-[#059669] font-medium">
                            <CheckCircle2 className="w-3.5 h-3.5" /> Verified
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[#D97706] font-medium">
                            <AlertTriangle className="w-3.5 h-3.5" /> Marginal
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
