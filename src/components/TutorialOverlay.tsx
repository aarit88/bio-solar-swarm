import React, { useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  X,
  Compass,
  Mic,
  Lock,
  LayoutDashboard,
  MapPin,
  Sliders,
  Layers,
} from 'lucide-react';

export interface TutorialStep {
  id: string;
  title: string;
  commandBadge: string;
  description: string;
  highlightView?: 'twin' | 'dashboard' | 'maps' | 'validation' | 'database';
  icon: React.ReactNode;
}

const TUTORIAL_STEPS: TutorialStep[] = [
  {
    id: 'policies',
    title: 'Control Policy & Physics Sliders',
    commandBadge: 'Central Tower · Fixed Duty · Independent · Swarm (PSO+ACO)',
    description:
      'Compare centralized remote filtration against decentralized street-level Bio-Solar Swarm pods. Use the bottom dock (or press H) to adjust Traffic Pollution, Wind Speed, Solar Irradiance, and simulation speed (1x / 2x).',
    highlightView: 'twin',
    icon: <Sliders className="w-5 h-5 text-[#059669]" />,
  },
  {
    id: 'heatmap',
    title: 'D3.js 2D Performance Heatmap Overlay',
    commandBadge: 'Bottom Dock -> Heatmap Toggle · Top-Right 2D Planform',
    description:
      'Real-time D3.js iso-improvement contours project directly onto the 3D street corridor, highlighting peak ΔPM2.5 / Rv% remediation zones driven by active swarm pods, ACO pheromone trails, and wind dispersion.',
    highlightView: 'twin',
    icon: <Layers className="w-5 h-5 text-[#10B981]" />,
  },
  {
    id: 'voice',
    title: 'Voice Crowd Recognition & Fan Scaling',
    commandBadge: 'Voice Crowd Sensor -> Auto Fan Duty Multiplier',
    description:
      'Activate the Voice Population Analyzer to listen via microphone (or speak crowd cues like "130 people" / "rush hour crowd"). Estimated pedestrian population dynamically scales pod BLDC fan speeds (1.00x to 1.85x) and crowd density in 3D.',
    highlightView: 'twin',
    icon: <Mic className="w-5 h-5 text-[#0284C7]" />,
  },
  {
    id: 'pod-auth',
    title: 'Authenticated Individual Pod Power Control',
    commandBadge: 'Click Any 3D Pod or Dashboard Row -> Activate / Deactivate',
    description:
      'Every individual Bio-Solar Pod (BSS-POD-01 to 05) is protected by Firebase Zero-Trust authentication. Activating or deactivating a pod requires operator re-authentication and logs a SHA-256 hash-chained cybersecurity audit record.',
    highlightView: 'dashboard',
    icon: <Lock className="w-5 h-5 text-[#D97706]" />,
  },
  {
    id: 'dashboard',
    title: 'Engineering Operations Dashboard',
    commandBadge: 'Dashboard Tab -> Live Matrix, Charts & Event Stream',
    description:
      'Switch to the Dashboard view (modeled on industrial swarm telemetry consoles) to inspect per-pod PM2.5/CO2 removal, time-series SVG trends, ACO auction events, and cybersecurity ledger integrity.',
    highlightView: 'dashboard',
    icon: <LayoutDashboard className="w-5 h-5 text-[#0F766E]" />,
  },
  {
    id: 'maps-ai',
    title: 'Google Maps Twin, Validation C1–C7 & AI Copilot',
    commandBadge: 'Geospatial Map · Validation Lab · AI Copilot & Video Export',
    description:
      'Explore real-world siting on Google Maps with live Air Quality API lookups, run Table III C1–C7 ablation benchmarks saved to SQLite, query the Gemini engineering assistant, or record a 16:9 WebGL briefing video.',
    highlightView: 'maps',
    icon: <MapPin className="w-5 h-5 text-[#2563EB]" />,
  },
];

interface TutorialOverlayProps {
  onClose: () => void;
  onNavigateView?: (view: 'twin' | 'dashboard' | 'maps' | 'validation' | 'database') => void;
}

export const TutorialOverlay: React.FC<TutorialOverlayProps> = ({
  onClose,
  onNavigateView,
}) => {
  const [stepIdx, setStepIdx] = useState(0);
  const step = TUTORIAL_STEPS[stepIdx];

  const handleNext = () => {
    if (stepIdx < TUTORIAL_STEPS.length - 1) {
      setStepIdx((i) => i + 1);
    } else {
      onClose();
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-label="Interactive Simulation Command Tutorial"
      data-testid="command-tutorial-overlay"
      className="fixed bottom-28 right-4 z-40 w-[min(420px,calc(100vw-2rem))] bg-[#EEF2F6] text-[#1E293B] border border-[#94A3B8] rounded-xl shadow-2xl overflow-hidden"
    >
      {/* Header */}
      <div className="px-4 py-3 bg-[#2D3744] text-white flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-xs font-semibold">
          <Compass className="w-4 h-4 text-[#34D399]" />
          <span>Command Tutorial ({stepIdx + 1} / {TUTORIAL_STEPS.length})</span>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Skip Tutorial"
          className="text-xs text-[#CBD5E1] hover:text-white inline-flex items-center gap-1"
        >
          <span>Dismiss</span>
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Progress Track */}
      <div className="h-1 bg-[#CBD5E1] w-full flex">
        {TUTORIAL_STEPS.map((s, idx) => (
          <div
            key={s.id}
            className={`flex-1 transition-colors ${
              idx <= stepIdx ? 'bg-[#059669]' : 'bg-transparent'
            }`}
          />
        ))}
      </div>

      {/* Step Content */}
      <div className="p-4 space-y-3">
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-lg bg-[#DCE4EC] border border-[#CBD5E1] shrink-0">
            {step.icon}
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-[#0F172A]">{step.title}</h3>
            <div className="mt-0.5 text-[11px] font-mono text-[#0F766E] truncate">
              {step.commandBadge}
            </div>
          </div>
        </div>

        <p className="text-xs leading-relaxed text-[#334155]">{step.description}</p>

        <div className="pt-2 border-t border-[#CBD5E1] flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setStepIdx((i) => Math.max(0, i - 1))}
              disabled={stepIdx === 0}
              className="px-2.5 py-1.5 rounded-md bg-white border border-[#CBD5E1] text-xs font-medium text-[#334155] disabled:opacity-40 inline-flex items-center gap-1 hover:bg-[#F8FAFC]"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
              Back
            </button>
            {step.highlightView && onNavigateView && (
              <button
                type="button"
                onClick={() => onNavigateView(step.highlightView!)}
                className="px-2.5 py-1.5 rounded-md bg-[#DCE4EC] hover:bg-[#CBD5E1] text-xs font-medium text-[#0F172A]"
              >
                Open View
              </button>
            )}
          </div>

          <button
            type="button"
            onClick={handleNext}
            className="px-3.5 py-1.5 rounded-md bg-[#059669] hover:bg-[#047857] text-white text-xs font-semibold inline-flex items-center gap-1"
          >
            {stepIdx < TUTORIAL_STEPS.length - 1 ? (
              <>
                Next
                <ChevronRight className="w-3.5 h-3.5" />
              </>
            ) : (
              'Finish Tour'
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
