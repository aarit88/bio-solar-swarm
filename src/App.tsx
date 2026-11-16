/**
 * Bio-Solar Swarm Studio: Decentralized Bio-Solar Network for Urban Air Remediation
 * Secured Full-Stack Shell:
 * - Zero-Trust Firebase Auth Gate (Google + Email/Password)
 * - 5-Second Centered Intro Splash + Auto-Displaying Command Tutorials
 * - Voice-Driven Crowd Population & Fan Duty Scaling
 * - Navibots-Inspired Engineering Dashboard, 3D Digital Twin, Google Maps & Gemini Copilot
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { doc, getDoc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import {
  AlertTriangle,
  Bot,
  Check,
  ChevronDown,
  ChevronUp,
  Compass,
  Gauge,
  Layers,
  LogOut,
  MailCheck,
  Pause,
  Play,
  SlidersHorizontal,
  Sun,
  Wind,
} from 'lucide-react';
import { AiCopilotPanel } from './components/AiCopilotPanel';
import { AuthGate } from './components/AuthGate';
import { DashboardView, TelemetryHistoryPoint } from './components/DashboardView';
import { GeoMapsView } from './components/GeoMapsView';
import { HardwareDbModal } from './components/HardwareDbModal';
import { NodeInspectorDrawer } from './components/NodeInspectorDrawer';
import { PodAuthModal } from './components/PodAuthModal';
import { SplashOverlay } from './components/SplashOverlay';
import { SwarmHeatmapOverlay } from './components/SwarmHeatmapOverlay';
import { TutorialOverlay } from './components/TutorialOverlay';
import { ValidationLabModal } from './components/ValidationLabModal';
import { VoicePopulationPanel } from './components/VoicePopulationPanel';
import { useAuth } from './contexts/AuthContext';
import { db, handleFirestoreError, OperationType } from './lib/firebase';
import { CameraPreset, SwarmViewport, ViewportCameraMatrices } from './scene/SwarmViewport';
import { createInitialSnapshot, stepSimulationSnapshot } from './simulation/swarm';
import {
  AlgalStrain,
  ControlMode,
  EnvironmentParams,
  SimulationSnapshot,
  TreatmentConfig,
} from './simulation/types';

const INITIAL_ENV: EnvironmentParams = {
  trafficPollution: 58,
  windSpeedMs: 1.6,
  windAngleDeg: 35,
  solarIrradianceWm2: 740,
  ambientTempC: 28,
  ambientHumidityPct: 56,
  activeMode: 'swarm_pso_aco',
  strain: 'Chlorella_sorokiniana_RMT01',
  treatmentConfig: {
    particulateStage: true,
    chemicalAdsorptionStage: true,
    biologicalPbrStage: true,
  },
  simSpeed: 1,
  populationCount: 28,
  voiceActivityDb: 53.5,
  voiceDetectedTranscript: '',
};

type ActiveView =
  | 'twin'
  | 'dashboard'
  | 'maps'
  | 'inspector'
  | 'validation'
  | 'database'
  | 'ai';

export default function App() {
  const { user, loading, logout, authFetch, getFreshIdToken, resendVerificationEmail } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen bg-[#CBD5DF] text-[#1E293B] flex items-center justify-center p-6">
        <div className="bg-[#EEF2F6] border border-[#B8C4D0] rounded-xl px-8 py-6 text-center shadow-lg">
          <div className="text-xs font-mono uppercase tracking-wider text-[#059669] font-semibold">
            Zero-Trust Verification
          </div>
          <div className="mt-1 text-base font-bold text-[#0F172A]">
            Authenticating Bio-Solar Swarm Session...
          </div>
        </div>
      </div>
    );
  }

  if (!user) {
    return <AuthGate />;
  }

  return (
    <AuthenticatedSimulationShell
      userEmail={user.email || user.uid}
      userUid={user.uid}
      emailVerified={user.emailVerified}
      onLogout={logout}
      authFetch={authFetch}
      getFreshIdToken={getFreshIdToken}
      onResendVerification={resendVerificationEmail}
    />
  );
}

interface AuthenticatedShellProps {
  userEmail: string;
  userUid: string;
  emailVerified: boolean;
  onLogout: () => Promise<void>;
  authFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  getFreshIdToken: (forceRefresh?: boolean) => Promise<string>;
  onResendVerification: () => Promise<void>;
}

const AuthenticatedSimulationShell: React.FC<AuthenticatedShellProps> = ({
  userEmail,
  userUid,
  emailVerified,
  onLogout,
  authFetch,
  getFreshIdToken,
  onResendVerification,
}) => {
  const [environment, setEnvironment] = useState<EnvironmentParams>(INITIAL_ENV);
  const envRef = useRef<EnvironmentParams>(INITIAL_ENV);

  const initialSnap = useRef<SimulationSnapshot | null>(null);
  if (!initialSnap.current) {
    initialSnap.current = createInitialSnapshot(INITIAL_ENV);
  }
  const snapshotRef = useRef<SimulationSnapshot>(initialSnap.current);
  const [snapshot, setSnapshot] = useState<SimulationSnapshot>(initialSnap.current);

  const [history, setHistory] = useState<TelemetryHistoryPoint[]>([]);
  const [paused, setPaused] = useState(false);
  const [dockCollapsed, setDockCollapsed] = useState(false);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<ActiveView>('twin');
  const [cameraPreset, setCameraPreset] = useState<CameraPreset>('overview');
  const [cameraTrigger, setCameraTrigger] = useState(0);
  const [wsConnected, setWsConnected] = useState(false);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);

  // 5-second centered splash + auto-displaying command tutorial
  const [showSplash, setShowSplash] = useState(true);
  const [showTutorial, setShowTutorial] = useState(true);

  // Individual pod auth modal
  const [pendingPodAuth, setPendingPodAuth] = useState<{
    nodeId: string;
    targetEnabled: boolean;
  } | null>(null);

  // Google Maps Quota Banner (Case A Quota Defense)
  const [mapsQuotaExceeded, setMapsQuotaExceeded] = useState(false);

  // D3.js 2D Performance Heatmap Overlay state + camera matrices ref
  const [showHeatmap, setShowHeatmap] = useState(true);
  const cameraMatricesRef = useRef<ViewportCameraMatrices | null>(null);

  // Reference to WebGL canvas for 16:9 video briefing export
  const webglCanvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    envRef.current = environment;
  }, [environment]);

  useEffect(() => {
    const onQuota = () => setMapsQuotaExceeded(true);
    window.addEventListener('gmp-quota-exceeded', onQuota);
    return () => window.removeEventListener('gmp-quota-exceeded', onQuota);
  }, []);

  // Keyboard shortcut H to collapse/expand bottom control dock
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (
        e.key.toLowerCase() === 'h' &&
        !(e.target instanceof HTMLInputElement) &&
        !(e.target instanceof HTMLSelectElement) &&
        !(e.target instanceof HTMLTextAreaElement)
      ) {
        setDockCollapsed((prev) => !prev);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Load persisted node enabled states from authenticated SQLite registry
  useEffect(() => {
    let active = true;
    authFetch('/api/v1/nodes')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!active || !data?.nodes) return;
        const enabledById = new Map<string, boolean>();
        for (const row of data.nodes) {
          enabledById.set(String(row.node_id), row.enabled !== 0);
        }
        const syncedNodes = snapshotRef.current.nodes.map((n) => ({
          ...n,
          enabled: enabledById.has(n.node_id) ? Boolean(enabledById.get(n.node_id)) : n.enabled,
        }));
        const patched = { ...snapshotRef.current, nodes: syncedNodes };
        snapshotRef.current = patched;
        setSnapshot(patched);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [authFetch]);

  // 4 Hz Simulation Physics & Swarm Loop + 1 Hz Dashboard History Sampling
  useEffect(() => {
    if (paused) return;
    let subTick = 0;
    const interval = window.setInterval(() => {
      const dt = 0.25 * envRef.current.simSpeed;
      const next = stepSimulationSnapshot(snapshotRef.current, envRef.current, dt);
      snapshotRef.current = next;
      setSnapshot(next);

      subTick += 1;
      if (subTick % 4 === 0) {
        const meanFanPct =
          next.nodes.reduce((s, n) => s + (n.enabled !== false ? n.fan_duty * 100 : 0), 0) /
          Math.max(1, next.nodes.length);
        const pt: TelemetryHistoryPoint = {
          timeLabel: `${Math.round(next.simTimeSec)}s`,
          aqi: next.pedestrianAqi,
          pm25: next.pedestrianPm25,
          population: next.populationCount,
          meanFanPct: Math.round(meanFanPct),
          pvPowerW: Math.round(next.totalPvPowerW),
          loadPowerW: Math.round(next.totalLoadPowerW),
        };
        setHistory((prev) => [...prev.slice(-39), pt]);
      }
    }, 250);
    return () => clearInterval(interval);
  }, [paused]);

  // Periodic authenticated SQLite telemetry batch logging every 12 seconds
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (paused) return;
      authFetch('/api/v1/telemetry/batch', {
        method: 'POST',
        body: JSON.stringify({ nodes: snapshotRef.current.nodes }),
      }).catch(() => {});
    }, 12000);
    return () => clearInterval(timer);
  }, [paused, authFetch]);

  // Authenticated WebSocket IEEE 1451.1.6 Telemetry Stream
  useEffect(() => {
    let socket: WebSocket | null = null;
    let reconnectTimer = 0;
    let unmounted = false;

    const connect = async () => {
      if (unmounted) return;
      try {
        const token = await getFreshIdToken(false);
        if (unmounted) return;
        const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${proto}//${window.location.host}/ws/telemetry?token=${encodeURIComponent(token)}`;
        socket = new WebSocket(wsUrl);
        socket.onopen = () => setWsConnected(true);
        socket.onclose = () => {
          setWsConnected(false);
          if (!unmounted) {
            reconnectTimer = window.setTimeout(connect, 5000);
          }
        };
        socket.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data);
            if (msg.type === 'hil_telemetry' && msg.packet) {
              const p = msg.packet;
              const current = snapshotRef.current;
              const updatedNodes = current.nodes.map((n) => {
                if (n.node_id !== p.node_id) return n;
                return {
                  ...n,
                  hardware_source: 'physical_hil' as const,
                  cin: { ...n.cin, pm25: p.pm25_in, no2: p.no2_in, co2: p.co2_in },
                  cout: { ...n.cout, pm25: p.pm25_out, no2: p.no2_out, co2: p.co2_out },
                  pm25_removal_pct: p.pm25_removal_pct,
                  battery_soc: p.battery_soc,
                  pbr: { ...n.pbr, ph: p.ph, co2_mass_rate_gh: p.co2_mass_rate_gh },
                  safety_override: p.safety_override,
                };
              });
              const patched = { ...current, nodes: updatedNodes };
              snapshotRef.current = patched;
              setSnapshot(patched);
            } else if (msg.type === 'node_power_changed' && typeof msg.node_id === 'string') {
              const current = snapshotRef.current;
              const updatedNodes = current.nodes.map((n) =>
                n.node_id === msg.node_id ? { ...n, enabled: Boolean(msg.enabled) } : n
              );
              const patched = { ...current, nodes: updatedNodes };
              snapshotRef.current = patched;
              setSnapshot(patched);
            }
          } catch {
            // ignore malformed frames
          }
        };
      } catch {
        if (!unmounted) {
          reconnectTimer = window.setTimeout(connect, 5000);
        }
      }
    };

    connect();
    return () => {
      unmounted = true;
      clearTimeout(reconnectTimer);
      socket?.close();
    };
  }, [getFreshIdToken]);

  const handleSelectNode = useCallback((nodeId: string | null) => {
    setSelectedNodeId(nodeId);
    if (nodeId) {
      setActiveView('inspector');
    }
  }, []);

  const handleControlModeChange = (mode: ControlMode) => {
    setEnvironment((prev) => ({ ...prev, activeMode: mode }));
  };

  const handleStrainChange = (strain: AlgalStrain) => {
    setEnvironment((prev) => ({ ...prev, strain }));
  };

  const handleTreatmentConfigChange = (treatmentConfig: TreatmentConfig) => {
    setEnvironment((prev) => ({ ...prev, treatmentConfig }));
  };

  const handleVoicePopulationUpdate = useCallback(
    (populationCount: number, voiceActivityDb: number, voiceDetectedTranscript: string) => {
      setEnvironment((prev) => ({
        ...prev,
        populationCount,
        voiceActivityDb,
        voiceDetectedTranscript,
      }));
    },
    []
  );

  const handleToggleFault = (nodeId: string, fault: 'ph' | 'battery' | 'reset') => {
    const nextNodes = snapshotRef.current.nodes.map((n) => {
      if (n.node_id !== nodeId) return n;
      if (fault === 'reset') {
        return { ...n, manual_fault_ph_drift: false, manual_fault_low_batt: false };
      }
      if (fault === 'ph') {
        return { ...n, manual_fault_ph_drift: !n.manual_fault_ph_drift };
      }
      return { ...n, manual_fault_low_batt: !n.manual_fault_low_batt };
    });
    const updated = { ...snapshotRef.current, nodes: nextNodes };
    snapshotRef.current = updated;
    setSnapshot(updated);
  };

  const handleRequestTogglePodPower = useCallback((nodeId: string, nextEnabled: boolean) => {
    setPendingPodAuth({ nodeId, targetEnabled: nextEnabled });
  }, []);

  const handlePodAuthSuccess = async (nodeId: string, enabled: boolean, auditHash: string) => {
    const targetNode = snapshotRef.current.nodes.find((n) => n.node_id === nodeId);
    const nextNodes = snapshotRef.current.nodes.map((n) =>
      n.node_id === nodeId ? { ...n, enabled } : n
    );
    const updated = { ...snapshotRef.current, nodes: nextNodes };
    snapshotRef.current = updated;
    setSnapshot(updated);
    setPendingPodAuth(null);
    setSaveNotice(`${nodeId} ${enabled ? 'Activated' : 'Deactivated'} (#${auditHash.slice(0, 6)})`);
    window.setTimeout(() => setSaveNotice(null), 3500);

    // Sync pod state and immutable audit record to Firestore when operator email is verified
    if (emailVerified && targetNode) {
      const podPath = `pods/${nodeId}`;
      try {
        const podRef = doc(db, 'pods', nodeId);
        const existingPod = await getDoc(podRef);
        const reasonText = enabled ? 'Authorized operator activation' : 'Authorized operator isolation';
        if (!existingPod.exists()) {
          await setDoc(podRef, {
            podId: nodeId,
            label: targetNode.label.slice(0, 80),
            zone: targetNode.zone.slice(0, 80),
            enabled,
            lastOperatorUid: userUid,
            lastReason: reasonText,
            updatedAt: serverTimestamp(),
          });
        } else {
          await updateDoc(podRef, {
            enabled,
            lastOperatorUid: userUid,
            lastReason: reasonText,
            updatedAt: serverTimestamp(),
          });
        }
      } catch (err) {
        try {
          handleFirestoreError(err, OperationType.WRITE, podPath);
        } catch {
          // structured log emitted
        }
      }

      const logId = `log_${Date.now()}_${nodeId.replace(/[^a-zA-Z0-9_-]/g, '')}`;
      const logPath = `audit_logs/${logId}`;
      try {
        await setDoc(doc(db, 'audit_logs', logId), {
          logId,
          actorUid: userUid,
          action: enabled ? 'POD_ACTIVATED' : 'POD_DEACTIVATED',
          targetPodId: nodeId,
          entryHash: auditHash.padEnd(16, '0').slice(0, 128),
          status: 'allowed',
          createdAt: serverTimestamp(),
        });
      } catch (err) {
        try {
          handleFirestoreError(err, OperationType.CREATE, logPath);
        } catch {
          // structured log emitted
        }
      }
    }
  };

  const handleCameraPreset = (preset: CameraPreset) => {
    setCameraPreset(preset);
    setCameraTrigger((t) => t + 1);
  };

  const handleSaveRun = async () => {
    const snap = snapshotRef.current;
    const modeTitle =
      snap.environment.activeMode === 'centralized_tower'
        ? 'Central Tower'
        : snap.environment.activeMode === 'fixed_duty'
        ? 'Fixed Duty'
        : snap.environment.activeMode === 'independent_local'
        ? 'Independent Local'
        : 'Swarm PSO+ACO';
    const name = `${modeTitle} · ${snap.populationCount} pax · ${snap.environment.trafficPollution}% Load`;

    try {
      const resp = await authFetch('/api/v1/runs', {
        method: 'POST',
        body: JSON.stringify({
          name,
          control_mode: snap.environment.activeMode,
          traffic_pollution: snap.environment.trafficPollution,
          wind_speed_ms: snap.environment.windSpeedMs,
          solar_irradiance_wm2: snap.environment.solarIrradianceWm2,
          pedestrian_aqi: snap.pedestrianAqi,
          verified_reduction_pct: snap.verifiedReductionRvPct,
          total_co2_g: snap.totalCo2CapturedG,
          net_power_w: snap.totalNetPowerW,
        }),
      });

      if (emailVerified) {
        const sessionId = `run_${Date.now()}`;
        try {
          await setDoc(doc(db, 'sessions', sessionId), {
            sessionId,
            ownerUid: userUid,
            name: name.slice(0, 120),
            controlMode: snap.environment.activeMode,
            populationCount: Math.round(snap.populationCount),
            pedestrianAqi: Number(snap.pedestrianAqi),
            verifiedReductionPct: Number(snap.verifiedReductionRvPct),
            netPowerW: Number(snap.totalNetPowerW),
            createdAt: serverTimestamp(),
          });
        } catch (err) {
          try {
            handleFirestoreError(err, OperationType.CREATE, `sessions/${sessionId}`);
          } catch {
            // logged cleanly
          }
        }
      }

      if (resp.ok) {
        setSaveNotice(`Saved "${name}"`);
        window.setTimeout(() => setSaveNotice(null), 3000);
      }
    } catch {
      setSaveNotice('Database save error');
      window.setTimeout(() => setSaveNotice(null), 3000);
    }
  };

  const handleHilPacketSent = (nodeId: string, pm25In: number, pm25Out: number, batterySoc: number) => {
    const nextNodes = snapshotRef.current.nodes.map((n) => {
      if (n.node_id !== nodeId) return n;
      return {
        ...n,
        hardware_source: 'physical_hil' as const,
        cin: { ...n.cin, pm25: pm25In },
        cout: { ...n.cout, pm25: pm25Out },
        battery_soc: batterySoc,
      };
    });
    const updated = { ...snapshotRef.current, nodes: nextNodes };
    snapshotRef.current = updated;
    setSnapshot(updated);
  };

  const inspectedNode =
    snapshot.nodes.find((n) => n.node_id === selectedNodeId) ?? snapshot.nodes[0];

  const aqiBadgeColor =
    snapshot.pedestrianAqi <= 50
      ? 'text-[#34D399]'
      : snapshot.pedestrianAqi <= 100
      ? 'text-[#FBBF24]'
      : 'text-[#F87171]';

  const modeSummaryTitle =
    environment.activeMode === 'centralized_tower'
      ? 'Centralized Purifier · 1 Remote Tower Active'
      : environment.activeMode === 'fixed_duty'
      ? 'Fixed Duty · 5 Street Pods (Constant 65%)'
      : environment.activeMode === 'independent_local'
      ? 'Independent Local · 5 Uncoordinated Pods'
      : 'Decentralized Swarm · 5 Coordinated Bio-Solar Pods';

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-[#B4C1CD]">
      {/* Full-Bleed 3D WebGL Viewport (preserved across views for instant 16:9 recording) */}
      <SwarmViewport
        snapshotRef={snapshotRef}
        selectedNodeId={selectedNodeId}
        onSelectNode={handleSelectNode}
        cameraPreset={cameraPreset}
        cameraTrigger={cameraTrigger}
        paused={paused}
        onCanvasReady={(c) => {
          webglCanvasRef.current = c;
        }}
        cameraMatricesRef={cameraMatricesRef}
      />

      {/* D3.js 2D Performance Heatmap Overlay */}
      <SwarmHeatmapOverlay
        snapshot={snapshot}
        cameraMatricesRef={cameraMatricesRef}
        visible={
          showHeatmap &&
          (activeView === 'twin' || activeView === 'inspector' || activeView === 'ai')
        }
        rightDrawerOpen={activeView === 'inspector' || activeView === 'ai'}
      />

      {/* Top Engineering Header Navigation */}
      <header className="fixed top-0 left-0 right-0 h-12 z-30 bg-[#2D3744] border-b border-[#435060] px-4 flex items-center justify-between gap-4 text-[#F1F5F9]">
        {/* Wordmark */}
        <a
          href="#top"
          onClick={(e) => {
            e.preventDefault();
            setActiveView('twin');
          }}
          className="text-sm sm:text-base font-semibold tracking-tight text-white whitespace-nowrap shrink-0"
        >
          Bio-Solar Swarm
        </a>

        {/* Primary View Navigation */}
        <nav className="hidden lg:flex items-center gap-5 text-xs font-medium text-[#CBD5E1]">
          {(
            [
              ['twin', '3D Twin'],
              ['dashboard', 'Dashboard'],
              ['maps', 'Geospatial Map'],
              ['inspector', 'Node Inspector'],
              ['validation', 'Validation C1–C7'],
              ['database', 'DB & Security'],
            ] as const
          ).map(([viewKey, label]) => (
            <button
              key={viewKey}
              type="button"
              onClick={() => {
                if (viewKey === 'inspector' && !selectedNodeId) {
                  setSelectedNodeId(snapshot.nodes[0].node_id);
                }
                setActiveView((prev) => (prev === viewKey && viewKey !== 'twin' ? 'twin' : viewKey));
              }}
              className={`whitespace-nowrap shrink-0 pb-0.5 transition-colors ${
                activeView === viewKey
                  ? 'text-white border-b-2 border-[#10B981]'
                  : 'hover:text-white'
              }`}
            >
              {label}
            </button>
          ))}
        </nav>

        {/* Right Actions & Authenticated Operator Session */}
        <div className="flex items-center gap-2 shrink-0">
          {saveNotice && (
            <span className="hidden sm:inline-flex items-center gap-1 text-xs text-[#6EE7B7] font-medium whitespace-nowrap">
              <Check className="w-3.5 h-3.5" />
              {saveNotice}
            </span>
          )}
          <button
            type="button"
            onClick={() => setShowTutorial((s) => !s)}
            className="hidden sm:inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-[#3B4859] hover:bg-[#475569] text-white text-xs font-medium whitespace-nowrap"
          >
            <Compass className="w-3.5 h-3.5 text-[#34D399]" />
            Command Tour
          </button>
          <button
            type="button"
            onClick={() => setActiveView((v) => (v === 'ai' ? 'twin' : 'ai'))}
            className={`px-2.5 py-1.5 rounded-md text-xs font-medium inline-flex items-center gap-1 whitespace-nowrap ${
              activeView === 'ai'
                ? 'bg-[#0284C7] text-white'
                : 'bg-[#3B4859] hover:bg-[#475569] text-white'
            }`}
          >
            <Bot className="w-3.5 h-3.5" />
            AI &amp; Video
          </button>
          <button
            type="button"
            onClick={handleSaveRun}
            className="px-3 py-1.5 rounded-md bg-[#059669] hover:bg-[#047857] text-white text-xs font-semibold transition-colors whitespace-nowrap"
          >
            Save Run
          </button>
          <div className="hidden xl:flex items-center px-2 py-1 rounded bg-[#1E2630] border border-[#435060] text-[11px] font-mono text-[#CBD5E1] max-w-[170px] truncate">
            {userEmail}
          </div>
          <button
            type="button"
            onClick={onLogout}
            aria-label="Sign Out"
            title="Sign Out"
            className="p-1.5 rounded-md bg-[#3B4859] hover:bg-[#DC2626] text-white transition-colors"
          >
            <LogOut className="w-3.5 h-3.5" />
          </button>
        </div>
      </header>

      {/* Google Maps Quota Exceeded Banner (Case A Quota Defense) */}
      {mapsQuotaExceeded && (
        <div
          role="alert"
          className="fixed top-12 left-0 right-0 z-40 bg-[#991B1B] text-white px-4 py-2 text-xs flex items-center justify-between gap-3 shadow-md"
        >
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>
              Google Maps Platform quota exceeded. Check billing and usage quotas at{' '}
              <a
                href="https://console.cloud.google.com/google/maps-apis/quotas"
                target="_blank"
                rel="noreferrer"
                className="underline font-semibold"
              >
                Google Cloud Maps Quotas
              </a>
              .
            </span>
          </div>
          <button
            type="button"
            onClick={() => setMapsQuotaExceeded(false)}
            className="px-2 py-0.5 rounded bg-white/15 hover:bg-white/25 text-xs"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Email Verification Notice (for newly registered unverified email accounts) */}
      {!emailVerified && (
        <div className="fixed top-12 left-0 right-0 z-30 bg-[#FEF3C7] border-b border-[#F59E0B] text-[#78350F] px-4 py-1.5 text-xs flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <MailCheck className="w-4 h-4 shrink-0" />
            <span>
              Verify your email ({userEmail}) to enable Firestore cloud ledger sync alongside SQLite.
            </span>
          </div>
          <button
            type="button"
            onClick={onResendVerification}
            className="px-2.5 py-1 rounded bg-[#B45309] text-white text-[11px] font-semibold shrink-0"
          >
            Resend Verification
          </button>
        </div>
      )}

      {/* Compact Mobile View Switcher (<lg screens) */}
      <div className="fixed top-14 left-3 right-3 z-20 flex lg:hidden items-center gap-1 overflow-x-auto pb-1">
        {(
          [
            ['twin', '3D'],
            ['dashboard', 'Dashboard'],
            ['maps', 'Map'],
            ['inspector', 'Pod'],
            ['validation', 'C1–C7'],
            ['database', 'DB/Sec'],
          ] as const
        ).map(([viewKey, label]) => (
          <button
            key={viewKey}
            type="button"
            onClick={() => {
              if (viewKey === 'inspector' && !selectedNodeId) {
                setSelectedNodeId(snapshot.nodes[0].node_id);
              }
              setActiveView(viewKey);
            }}
            className={`px-2.5 py-1.5 rounded-md text-xs font-medium whitespace-nowrap border ${
              activeView === viewKey
                ? 'bg-[#059669] text-white border-[#047857]'
                : 'bg-[#2D3744]/95 text-white border-[#465466]'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Left-Side 3D Twin Telemetry + Voice Population Card (Zero Center Occlusion) */}
      {(activeView === 'twin' || activeView === 'inspector' || activeView === 'ai') && (
        <div className="fixed top-24 lg:top-16 left-3 right-3 md:left-4 md:right-auto z-20 md:w-[375px] space-y-2.5 pointer-events-auto">
          <div
            aria-label="Live Urban Air Remediation Telemetry"
            className="bg-[#2D3744]/95 border border-[#465466] rounded-xl px-4 py-3 text-[#F1F5F9] shadow-lg"
          >
            <div className="text-[11px] font-medium text-[#CBD5E1] truncate">{modeSummaryTitle}</div>
            <div className="mt-2 grid grid-cols-2 gap-4">
              <div>
                <div className="text-[10px] uppercase tracking-wider text-[#94A3B8]">
                  Pedestrian Zone AQI
                </div>
                <div className={`text-lg font-mono tabular-nums font-semibold ${aqiBadgeColor}`}>
                  {snapshot.aqiCategory} ({snapshot.pedestrianAqi})
                </div>
                <div className="text-[11px] font-mono tabular-nums text-[#CBD5E1]">
                  PM2.5 {snapshot.pedestrianPm25.toFixed(1)} µg/m³ · Rv +{snapshot.verifiedReductionRvPct.toFixed(1)}%
                </div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wider text-[#94A3B8]">
                  Network Power &amp; CO₂
                </div>
                <div className="text-lg font-mono tabular-nums font-semibold text-white">
                  {snapshot.activeNodeCount > 0 ? `${snapshot.activeNodeCount} Pods Active` : '1 Tower (3.8 kW)'}
                </div>
                <div className="text-[11px] font-mono tabular-nums text-[#CBD5E1]">
                  PV +{snapshot.totalPvPowerW.toFixed(0)}W / Load {snapshot.totalLoadPowerW.toFixed(0)}W · {snapshot.totalCo2CapturedG.toFixed(1)}g
                </div>
              </div>
            </div>
          </div>

          <VoicePopulationPanel
            populationCount={environment.populationCount}
            voiceActivityDb={environment.voiceActivityDb}
            transcript={environment.voiceDetectedTranscript}
            onUpdateVoicePopulation={handleVoicePopulationUpdate}
          />
        </div>
      )}

      {/* Collapsible Bottom Control Dock on 3D Twin */}
      {(activeView === 'twin' || activeView === 'inspector' || activeView === 'ai') && (
        <div
          className={`fixed left-1/2 -translate-x-1/2 bottom-4 z-20 w-[min(960px,95vw)] transition-transform duration-300 ${
            dockCollapsed ? 'translate-y-[calc(100%-30px)]' : 'translate-y-0'
          }`}
        >
          <div className="flex justify-center">
            <button
              type="button"
              onClick={() => setDockCollapsed((c) => !c)}
              aria-expanded={!dockCollapsed}
              className="px-3.5 py-1 rounded-t-lg bg-[#2D3744]/95 border border-b-0 border-[#465466] text-[11px] font-medium text-[#E2E8F0] hover:text-white inline-flex items-center gap-1.5"
            >
              <SlidersHorizontal className="w-3 h-3" />
              {dockCollapsed ? 'Show Controls (H)' : 'Hide Controls (H)'}
              {dockCollapsed ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>
          </div>

          <div className="bg-[#2D3744]/95 border border-[#465466] rounded-xl px-4 py-3 text-[#F1F5F9] shadow-xl space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div
                className="flex flex-wrap items-center gap-1 bg-[#1E2630] p-1 rounded-lg w-full sm:w-auto"
                role="group"
                aria-label="Control Policy Mode"
              >
                {(
                  [
                    ['centralized_tower', 'Central Tower'],
                    ['fixed_duty', 'Fixed Duty'],
                    ['independent_local', 'Independent'],
                    ['swarm_pso_aco', 'Swarm (PSO+ACO)'],
                  ] as const
                ).map(([modeKey, label]) => (
                  <button
                    key={modeKey}
                    type="button"
                    onClick={() => handleControlModeChange(modeKey)}
                    className={`px-2.5 py-1 rounded-md text-xs font-medium whitespace-nowrap shrink-0 transition-colors ${
                      environment.activeMode === modeKey
                        ? 'bg-[#059669] text-white'
                        : 'text-[#CBD5E1] hover:text-white hover:bg-[#2D3744]'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-1.5 flex-wrap">
                {(
                  [
                    ['overview', 'Street View'],
                    ['pod_closeup', 'Pod Close-Up'],
                    ['tower_compare', 'Tower vs Swarm'],
                    ['top_map', 'Top Map'],
                  ] as const
                ).map(([presetKey, label]) => (
                  <button
                    key={presetKey}
                    type="button"
                    onClick={() => handleCameraPreset(presetKey)}
                    className={`px-2.5 py-1 rounded-md text-xs font-medium whitespace-nowrap shrink-0 border transition-colors ${
                      cameraPreset === presetKey
                        ? 'bg-[#3B4859] border-[#64748B] text-white'
                        : 'bg-transparent border-[#465466] text-[#CBD5E1] hover:text-white'
                    }`}
                  >
                    {label}
                  </button>
                ))}

                <button
                  type="button"
                  onClick={() => setShowHeatmap((h) => !h)}
                  aria-pressed={showHeatmap}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium inline-flex items-center gap-1 whitespace-nowrap shrink-0 border transition-colors ${
                    showHeatmap
                      ? 'bg-[#059669] border-[#047857] text-white'
                      : 'bg-transparent border-[#465466] text-[#CBD5E1] hover:text-white'
                  }`}
                >
                  <Layers className="w-3.5 h-3.5" />
                  Heatmap
                </button>

                <button
                  type="button"
                  onClick={() => setPaused((p) => !p)}
                  aria-label={paused ? 'Resume Simulation' : 'Pause Simulation'}
                  className="px-2.5 py-1 rounded-md bg-[#3B4859] hover:bg-[#4B5B70] text-white text-xs font-medium inline-flex items-center gap-1 whitespace-nowrap shrink-0"
                >
                  {paused ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
                  {paused ? 'Resume' : 'Pause'}
                </button>

                <button
                  type="button"
                  onClick={() =>
                    setEnvironment((prev) => ({ ...prev, simSpeed: prev.simSpeed === 1 ? 2 : 1 }))
                  }
                  className="px-2 py-1 rounded-md bg-[#1E2630] text-[#CBD5E1] hover:text-white text-xs font-mono tabular-nums whitespace-nowrap shrink-0"
                >
                  {environment.simSpeed}x
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-1 border-t border-[#3E4B5B] text-xs">
              <label className="flex items-center gap-2.5">
                <Gauge className="w-3.5 h-3.5 text-[#FBBF24] shrink-0" />
                <span className="text-[#CBD5E1] whitespace-nowrap">Pollution</span>
                <input
                  type="range"
                  min={10}
                  max={100}
                  value={environment.trafficPollution}
                  onChange={(e) =>
                    setEnvironment((prev) => ({ ...prev, trafficPollution: Number(e.target.value) }))
                  }
                  className="flex-1 accent-[#10B981] cursor-pointer"
                />
                <span className="font-mono tabular-nums w-9 text-right">
                  {environment.trafficPollution}%
                </span>
              </label>

              <label className="flex items-center gap-2.5">
                <Wind className="w-3.5 h-3.5 text-[#38BDF8] shrink-0" />
                <span className="text-[#CBD5E1] whitespace-nowrap">Wind</span>
                <input
                  type="range"
                  min={0.2}
                  max={6.0}
                  step={0.2}
                  value={environment.windSpeedMs}
                  onChange={(e) =>
                    setEnvironment((prev) => ({ ...prev, windSpeedMs: Number(e.target.value) }))
                  }
                  className="flex-1 accent-[#38BDF8] cursor-pointer"
                />
                <span className="font-mono tabular-nums w-12 text-right">
                  {environment.windSpeedMs.toFixed(1)}m/s
                </span>
              </label>

              <label className="flex items-center gap-2.5">
                <Sun className="w-3.5 h-3.5 text-[#FDE047] shrink-0" />
                <span className="text-[#CBD5E1] whitespace-nowrap">Solar</span>
                <input
                  type="range"
                  min={0}
                  max={1000}
                  step={20}
                  value={environment.solarIrradianceWm2}
                  onChange={(e) =>
                    setEnvironment((prev) => ({
                      ...prev,
                      solarIrradianceWm2: Number(e.target.value),
                    }))
                  }
                  className="flex-1 accent-[#FBBF24] cursor-pointer"
                />
                <span className="font-mono tabular-nums w-14 text-right">
                  {environment.solarIrradianceWm2}W/m²
                </span>
              </label>
            </div>
          </div>
        </div>
      )}

      {/* Full-View Engineering Dashboard */}
      {activeView === 'dashboard' && (
        <DashboardView
          snapshot={snapshot}
          history={history}
          onSelectNode={(id) => {
            setSelectedNodeId(id);
            setActiveView('inspector');
          }}
          onRequestTogglePodPower={handleRequestTogglePodPower}
        />
      )}

      {/* Geospatial Google Maps Twin */}
      {activeView === 'maps' && (
        <GeoMapsView
          snapshot={snapshot}
          onSelectNode={(id) => {
            setSelectedNodeId(id);
            setActiveView('inspector');
          }}
        />
      )}

      {/* Contextual Side Drawer: Node Hardware & PBR Inspector */}
      {activeView === 'inspector' && inspectedNode && (
        <NodeInspectorDrawer
          node={inspectedNode}
          allNodes={snapshot.nodes}
          onSelectNode={(id) => setSelectedNodeId(id)}
          onClose={() => setActiveView('twin')}
          strain={environment.strain}
          onChangeStrain={handleStrainChange}
          treatmentConfig={environment.treatmentConfig}
          onChangeTreatmentConfig={handleTreatmentConfigChange}
          onToggleFault={handleToggleFault}
          onRequestTogglePodPower={handleRequestTogglePodPower}
        />
      )}

      {/* Contextual Side Drawer: AI Copilot & 16:9 WebGL Video Briefing */}
      {activeView === 'ai' && (
        <AiCopilotPanel
          snapshot={snapshot}
          canvasRef={webglCanvasRef}
          onClose={() => setActiveView('twin')}
        />
      )}

      {/* Modal: Table III Controlled Validation Suite (C1-C7) */}
      {activeView === 'validation' && (
        <ValidationLabModal environment={environment} onClose={() => setActiveView('twin')} />
      )}

      {/* Modal: SQLite DB, Hardware HIL, Security Audit & E2E Software Tests */}
      {activeView === 'database' && (
        <HardwareDbModal
          snapshot={snapshot}
          wsConnected={wsConnected}
          onClose={() => setActiveView('twin')}
          onHilPacketSent={handleHilPacketSent}
        />
      )}

      {/* Operator Re-Authentication Modal for Individual Pod Power Toggle */}
      {pendingPodAuth && (
        <PodAuthModal
          nodeId={pendingPodAuth.nodeId}
          targetEnabled={pendingPodAuth.targetEnabled}
          onConfirmSuccess={handlePodAuthSuccess}
          onCancel={() => setPendingPodAuth(null)}
        />
      )}

      {/* 5-Second Centered Intro Splash */}
      {showSplash && <SplashOverlay onComplete={() => setShowSplash(false)} />}

      {/* Auto-Displaying Step-by-Step Command Tutorial */}
      {showTutorial && !showSplash && (
        <TutorialOverlay
          onClose={() => setShowTutorial(false)}
          onNavigateView={(view) => setActiveView(view)}
        />
      )}
    </div>
  );
};
