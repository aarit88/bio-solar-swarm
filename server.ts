/**
 * Bio-Solar Swarm Studio: Secured Full-Stack Express + WebSocket + Vite Server
 * - Zero-Trust Firebase ID Token Authentication (`firebase-admin`)
 * - Helmet security headers + Express Rate Limiting + Input Validation
 * - SHA-256 Hash-Chained Cybersecurity Audit Log in SQLite
 * - Individual Pod Power Activation/Deactivation API + WebSocket Broadcast
 * - Google Maps Platform Air Quality Server Proxy
 * - Gemini 4 Hydrogen (Maps Grounding) + Gemini 3.1 Flash Lite + Gemini 3.8 Live Voice Bridge
 */

import {
  FunctionDeclaration,
  GoogleGenAI,
  LiveServerMessage,
  Modality,
  Type,
} from '@google/genai';
import express from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import helmet from 'helmet';
import http from 'node:http';
import { isIP } from 'node:net';
import path from 'node:path';
import { createServer as createViteServer } from 'vite';
import { WebSocket, WebSocketServer } from 'ws';
import {
  AuthenticatedRequest,
  createRequireAuth,
  verifyOperatorToken,
} from './src/middleware/auth';
import { BioSwarmDatabase } from './src/server/db';
import {
  applySafetyRuleEngine,
  computeCo2MassRateGh,
  computeRemovalEfficiencyPct,
  createInitialNodes,
} from './src/simulation/physics';
import { runControlledValidationSuite } from './src/simulation/swarm';
import { EnvironmentParams, SmartTransducerNodeState } from './src/simulation/types';

const PORT = 3000;
const app = express();
app.set('trust proxy', 1);

// Cybersecurity HTTP headers (CSP disabled for Vite/Google Maps/Firebase scripts; frameguard off for AI Studio iframe)
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    frameguard: false,
    crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
  })
);
app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));

// Rate limiting across all /api routes (supports Cloud Run X-Forwarded-For & RFC 7239 Forwarded headers)
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 240,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const fwd = req.headers.forwarded;
    if (typeof fwd === 'string') {
      const bracketedV6 = fwd.match(/for="?\[([a-fA-F0-9:]+)\](?::\d+)?"?/i);
      const v4OrPlain = fwd.match(/for="?([0-9.]+)(?::\d+)?"?/i);
      const candidate = bracketedV6?.[1] ?? v4OrPlain?.[1];
      if (candidate && isIP(candidate)) {
        return ipKeyGenerator(candidate);
      }
    }
    return ipKeyGenerator(req.ip || req.socket.remoteAddress || '127.0.0.1');
  },
  message: { error: 'Too many requests; rate limit enforced for cyber-physical protection.' },
});
app.use('/api/', apiLimiter);

const db = new BioSwarmDatabase();
const requireAuth = createRequireAuth(db);
const server = http.createServer(app);

// WebSocket servers (noServer mode so /ws/telemetry and /ws/live multiplex cleanly with Vite)
const telemetryWss = new WebSocketServer({ noServer: true });
const liveWss = new WebSocketServer({ noServer: true });
const wsClients = new Set<WebSocket>();

function getGeminiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') return null;
  return new GoogleGenAI({
    apiKey,
    httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
  });
}

function getMapsApiKey(): string {
  const k = process.env.GOOGLE_MAPS_API_KEY || process.env.VITE_GOOGLE_MAPS_API_KEY || '';
  return k === 'MY_GOOGLE_MAPS_API_KEY' ? '' : k;
}

function broadcastTelemetryEvent(payload: unknown) {
  const raw = JSON.stringify(payload);
  for (const client of wsClients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(raw);
    }
  }
}

telemetryWss.on('connection', (socket) => {
  wsClients.add(socket);
  socket.send(
    JSON.stringify({
      type: 'connected',
      protocol: 'IEEE-1451.1.6-WS-AUTH',
      timestamp: Date.now(),
    })
  );
  socket.on('close', () => {
    wsClients.delete(socket);
  });
});

// Gemini 3.8 Live Voice Population & Fan Scaling Bridge
const setPopulationAndFanBoostDecl: FunctionDeclaration = {
  name: 'setPopulationAndFanBoost',
  description:
    'Updates the estimated pedestrian crowd population count in the Bio-Solar Swarm simulation based on detected crowd speech or voice commands, automatically scaling pod fan duty speeds.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      populationCount: {
        type: Type.NUMBER,
        description: 'Estimated number of pedestrians on the street corridor (5 to 180).',
      },
      reason: {
        type: Type.STRING,
        description: 'Short explanation of the acoustic or spoken crowd observation.',
      },
    },
    required: ['populationCount', 'reason'],
  },
};

liveWss.on('connection', (clientWs) => {
  const ai = getGeminiClient();
  if (!ai) {
    clientWs.send(
      JSON.stringify({
        type: 'error',
        error: 'GEMINI_API_KEY is not configured on the server. Using local browser acoustic/speech recognition.',
      })
    );
    clientWs.close();
    return;
  }

  let closed = false;
  const sessionPromise = ai.live.connect({
    model: 'gemini-3.8-live',
    config: {
      responseModalities: [Modality.AUDIO],
      speechConfig: {
        voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Zephyr' } },
      },
      inputAudioTranscription: {},
      outputAudioTranscription: {},
      tools: [{ functionDeclarations: [setPopulationAndFanBoostDecl] }],
      systemInstruction:
        'You are the Bio-Solar Swarm Acoustic & Environmental Operations Copilot. Listen to street crowd audio or operator voice commands. Whenever the operator describes crowd size, pedestrian count, or busy/quiet street activity, immediately call setPopulationAndFanBoost with an accurate integer populationCount (5 to 180) and concisely confirm the fan duty adjustment.',
    },
    callbacks: {
      onmessage: (message: LiveServerMessage) => {
        if (closed || clientWs.readyState !== WebSocket.OPEN) return;
        const content = message.serverContent;
        if (content?.inputTranscription?.text) {
          clientWs.send(JSON.stringify({ type: 'input_transcript', text: content.inputTranscription.text }));
        }
        if (content?.outputTranscription?.text) {
          clientWs.send(JSON.stringify({ type: 'output_transcript', text: content.outputTranscription.text }));
        }
        for (const part of content?.modelTurn?.parts ?? []) {
          if (part.inlineData?.data) {
            clientWs.send(JSON.stringify({ type: 'audio', audio: part.inlineData.data }));
          }
        }
        if (content?.interrupted) {
          clientWs.send(JSON.stringify({ type: 'interrupted' }));
        }
        for (const call of message.toolCall?.functionCalls ?? []) {
          if (call.name === 'setPopulationAndFanBoost') {
            const rawCount = Number((call.args as Record<string, unknown>)?.populationCount ?? 40);
            const populationCount = Math.max(5, Math.min(180, Math.round(rawCount)));
            const reason = String((call.args as Record<string, unknown>)?.reason ?? 'Voice crowd estimate');
            clientWs.send(JSON.stringify({ type: 'population_update', populationCount, reason }));
            sessionPromise
              .then((s) =>
                s.sendToolResponse({
                  functionResponses: [
                    {
                      id: call.id,
                      name: call.name,
                      response: { accepted: true, populationCount, reason },
                    },
                  ],
                })
              )
              .catch(() => {});
          }
        }
      },
      onerror: (err: unknown) => {
        if (clientWs.readyState === WebSocket.OPEN) {
          clientWs.send(
            JSON.stringify({
              type: 'error',
              error: err instanceof Error ? err.message : 'Gemini Live stream error',
            })
          );
        }
      },
      onclose: () => {
        if (clientWs.readyState === WebSocket.OPEN) {
          clientWs.send(JSON.stringify({ type: 'live_closed' }));
        }
      },
    },
  });

  clientWs.on('message', (raw) => {
    try {
      const parsed = JSON.parse(raw.toString());
      if (parsed.audio) {
        sessionPromise
          .then((s) =>
            s.sendRealtimeInput({
              audio: { data: String(parsed.audio), mimeType: 'audio/pcm;rate=16000' },
            })
          )
          .catch(() => {});
      } else if (parsed.text) {
        sessionPromise
          .then((s) => s.sendRealtimeInput({ text: String(parsed.text) }))
          .catch(() => {});
      }
    } catch {
      // ignore malformed frames
    }
  });

  clientWs.on('close', () => {
    closed = true;
    sessionPromise.then((s) => s.close()).catch(() => {});
  });
});

server.on('upgrade', async (req, socket, head) => {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    if (url.pathname !== '/ws/telemetry' && url.pathname !== '/ws/live') {
      return; // let Vite handle non-app upgrades if any
    }
    const token = url.searchParams.get('token') || '';
    if (!token) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }
    await verifyOperatorToken(token);
    const targetWss = url.pathname === '/ws/live' ? liveWss : telemetryWss;
    targetWss.handleUpgrade(req, socket, head, (ws) => {
      targetWss.emit('connection', ws, req);
    });
  } catch {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
  }
});

// -----------------------------------------------------------------------------
// Public Lightweight Health Check (Exposes NO telemetry, nodes, or activity)
// -----------------------------------------------------------------------------
app.get('/api/v1/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'bio-solar-swarm-studio',
    authRequired: true,
    protocol: 'IEEE-1451.0-2024 / 1451.1.6-2025',
    timestamp: Date.now(),
  });
});

// -----------------------------------------------------------------------------
// Strictly Authenticated API Endpoints (Firebase ID Token Required)
// -----------------------------------------------------------------------------

app.get('/api/v1/nodes', requireAuth, (_req, res) => {
  res.json({
    nodes: db.listNodes(),
    stats: db.getStats(),
  });
});

app.post('/api/v1/nodes/register', requireAuth, (req: AuthenticatedRequest, res) => {
  const body = req.body ?? {};
  if (!body.node_id || typeof body.node_id !== 'string' || !/^[a-zA-Z0-9_-]{3,40}$/.test(body.node_id)) {
    return res.status(400).json({ error: 'Valid node_id (3-40 alphanumeric/hyphen/underscore chars) is required' });
  }
  const registered = db.upsertNode({
    node_id: body.node_id,
    label: typeof body.label === 'string' ? body.label.slice(0, 80) : undefined,
    zone: typeof body.zone === 'string' ? body.zone.slice(0, 80) : undefined,
    x: typeof body.x === 'number' ? body.x : undefined,
    z: typeof body.z === 'number' ? body.z : undefined,
    strain: typeof body.strain === 'string' ? body.strain : undefined,
    calibration_id: typeof body.calibration_id === 'string' ? body.calibration_id.slice(0, 60) : undefined,
    hardware_mode: body.hardware_mode === 'simulated' ? 'simulated' : 'physical_hil',
    firmware_version: typeof body.firmware_version === 'string' ? body.firmware_version.slice(0, 60) : undefined,
  });

  db.appendSecurityAudit({
    actor_uid: req.operator!.uid,
    actor_email: req.operator!.email,
    action: 'NODE_REGISTERED',
    target: registered.node_id,
    status: 'allowed',
    ip_addr: req.ip || 'unknown',
    detail: `Registered ${registered.hardware_mode} pod (${registered.calibration_id})`,
  });

  broadcastTelemetryEvent({ type: 'node_registered', node: registered });
  return res.status(201).json({ node: registered });
});

// Individual Pod Authenticated Activation / Deactivation Endpoint
app.post('/api/v1/nodes/:nodeId/power', requireAuth, (req: AuthenticatedRequest, res) => {
  const nodeId = String(req.params.nodeId || '');
  if (!/^[a-zA-Z0-9_-]{3,40}$/.test(nodeId)) {
    return res.status(400).json({ error: 'Invalid nodeId format' });
  }
  const { enabled, reason } = req.body ?? {};
  if (typeof enabled !== 'boolean') {
    return res.status(400).json({ error: 'Boolean enabled flag is required' });
  }
  const cleanReason =
    typeof reason === 'string' && reason.trim().length > 0
      ? reason.trim().slice(0, 180)
      : enabled
      ? 'Authorized operator activation'
      : 'Authorized operator deactivation';

  const updated = db.setNodeEnabled(nodeId, enabled);
  if (!updated) {
    return res.status(404).json({ error: `Pod ${nodeId} not found in TEDS registry` });
  }

  const command = db.enqueueNodeCommand({
    node_id: nodeId,
    target_fan_duty: enabled ? 0.65 : 0,
    bypass_pbr: enabled ? 0 : 1,
    control_mode: enabled ? 'swarm_pso_aco' : 'operator_isolated',
  });

  const auditEntry = db.appendSecurityAudit({
    actor_uid: req.operator!.uid,
    actor_email: req.operator!.email,
    action: enabled ? 'POD_ACTIVATED' : 'POD_DEACTIVATED',
    target: nodeId,
    status: 'allowed',
    ip_addr: req.ip || 'unknown',
    detail: `${cleanReason} (verified UID ${req.operator!.uid})`,
  });

  broadcastTelemetryEvent({
    type: 'node_power_changed',
    node_id: nodeId,
    enabled,
    operator: req.operator!.email,
    auditEntry,
  });

  return res.json({
    node: updated,
    enabled,
    command,
    auditEntry,
    stats: db.getStats(),
  });
});

// Hardware-In-the-Loop (HIL) IEEE 1451.1.6 Telemetry Ingestion
app.post('/api/v1/hardware/telemetry', requireAuth, (req: AuthenticatedRequest, res) => {
  const payload = req.body ?? {};
  if (!payload.node_id || typeof payload.pm25_in !== 'number' || typeof payload.pm25_out !== 'number') {
    return res.status(400).json({
      error: 'Invalid IEEE 1451 telemetry packet. Required: node_id, pm25_in, pm25_out.',
    });
  }

  const nodeId = String(payload.node_id).slice(0, 40);
  const ts = typeof payload.timestamp === 'number' ? payload.timestamp : Date.now();
  const pm25In = Number(payload.pm25_in);
  const pm25Out = Number(payload.pm25_out);
  const no2In = Number(payload.no2_in ?? 48);
  const no2Out = Number(payload.no2_out ?? 21);
  const co2In = Number(payload.co2_in ?? 520);
  const co2Out = Number(payload.co2_out ?? 445);
  const flowM3h = Number(payload.flow_m3_h ?? 72);
  const fanPowerW = Number(payload.fan_power_w ?? 6.2);
  const pvHarvestW = Number(payload.pv_harvest_w ?? 36.4);
  const batterySoc = Number(payload.battery_soc ?? 78);
  const ph = Number(payload.ph ?? 7.35);
  const algaeScore = Number(payload.algae_state ?? 0.94);
  const mediaScore = Number(payload.media_state ?? 88);
  const controlMode = String(payload.control_mode ?? 'swarm_pso_aco');
  const confidenceScore = Number(payload.confidence_score ?? 0.97);

  const reg = db.upsertNode({
    node_id: nodeId,
    hardware_mode: 'physical_hil',
    calibration_id: payload.calibration_id ? String(payload.calibration_id) : undefined,
  });

  const dummyEnv: EnvironmentParams = {
    trafficPollution: 55,
    windSpeedMs: 1.5,
    windAngleDeg: 30,
    solarIrradianceWm2: 700,
    ambientTempC: Number(payload.temperature ?? 28),
    ambientHumidityPct: Number(payload.humidity ?? 55),
    activeMode: 'swarm_pso_aco',
    strain: 'Chlorella_sorokiniana_RMT01',
    treatmentConfig: { particulateStage: true, chemicalAdsorptionStage: true, biologicalPbrStage: true },
    simSpeed: 1,
    populationCount: 24,
    voiceActivityDb: 52,
    voiceDetectedTranscript: '',
  };
  const protoNode = createInitialNodes(dummyEnv)[0];
  protoNode.node_id = nodeId;
  protoNode.enabled = reg.enabled === 1;
  protoNode.battery_soc = batterySoc;
  protoNode.pbr.ph = ph;
  protoNode.media.carbon_kmno4_remaining_pct = mediaScore;
  protoNode.confidence_score = confidenceScore;

  const requestedDuty = Math.min(1, Math.max(0.15, (pm25In - 15) / 110));
  const safety = applySafetyRuleEngine(requestedDuty, protoNode, dummyEnv.treatmentConfig);

  const rowId = db.insertSingleTelemetry({
    node_id: nodeId,
    timestamp: ts,
    pm25_in: pm25In,
    pm25_out: pm25Out,
    no2_in: no2In,
    no2_out: no2Out,
    co2_in: co2In,
    co2_out: co2Out,
    flow_m3_h: flowM3h,
    fan_power_w: fanPowerW,
    pv_harvest_w: pvHarvestW,
    battery_soc: batterySoc,
    ph,
    algae_score: algaeScore,
    media_score: mediaScore,
    control_mode: controlMode,
    safety_override: safety.override,
    confidence_score: confidenceScore,
    source: 'physical_hil',
  });

  const command = db.enqueueNodeCommand({
    node_id: nodeId,
    target_fan_duty: Math.round(safety.safeDuty * 1000) / 1000,
    bypass_pbr: safety.pbrIsolated ? 1 : 0,
    control_mode: controlMode,
  });

  db.appendSecurityAudit({
    actor_uid: req.operator!.uid,
    actor_email: req.operator!.email,
    action: 'HIL_TELEMETRY_INGESTED',
    target: nodeId,
    status: 'allowed',
    ip_addr: req.ip || 'unknown',
    detail: `PM2.5 ${pm25In}->${pm25Out} ug/m3, Batt ${batterySoc}%`,
  });

  const hilPacket = {
    rowId,
    node_id: nodeId,
    timestamp: ts,
    pm25_in: pm25In,
    pm25_out: pm25Out,
    no2_in: no2In,
    no2_out: no2Out,
    co2_in: co2In,
    co2_out: co2Out,
    flow_m3_h: flowM3h,
    fan_power_w: fanPowerW,
    pv_harvest_w: pvHarvestW,
    battery_soc: batterySoc,
    ph,
    algae_score: algaeScore,
    media_score: mediaScore,
    pm25_removal_pct: computeRemovalEfficiencyPct(pm25In, pm25Out),
    co2_mass_rate_gh: computeCo2MassRateGh(co2In, co2Out, flowM3h, Number(payload.temperature ?? 28)),
    safety_override: safety.override,
    command,
  };

  broadcastTelemetryEvent({ type: 'hil_telemetry', packet: hilPacket });

  return res.status(201).json({
    accepted: true,
    rowId,
    verified_eta_pm25_pct: hilPacket.pm25_removal_pct,
    verified_co2_mass_rate_gh: hilPacket.co2_mass_rate_gh,
    command,
    stats: db.getStats(),
  });
});

app.get('/api/v1/nodes/:nodeId/command', requireAuth, (req, res) => {
  const cmd = db.getLatestCommandForNode(String(req.params.nodeId));
  if (!cmd) {
    return res.json({
      node_id: req.params.nodeId,
      target_fan_duty: 0.5,
      bypass_pbr: 0,
      control_mode: 'swarm_pso_aco',
      status: 'default',
    });
  }
  return res.json(cmd);
});

app.post('/api/v1/telemetry/batch', requireAuth, (req, res) => {
  const nodes = req.body?.nodes as SmartTransducerNodeState[] | undefined;
  if (!Array.isArray(nodes) || nodes.length === 0 || nodes.length > 50) {
    return res.status(400).json({ error: 'nodes array (1-50 items) is required' });
  }
  const inserted = db.insertTelemetryBatch(nodes);
  broadcastTelemetryEvent({ type: 'telemetry_persisted', count: inserted, timestamp: Date.now() });
  return res.status(201).json({ inserted, stats: db.getStats() });
});

app.get('/api/v1/telemetry/history', requireAuth, (req, res) => {
  const limit = Math.min(250, Math.max(1, Number(req.query.limit ?? 50)));
  const nodeId = typeof req.query.nodeId === 'string' && req.query.nodeId ? req.query.nodeId : undefined;
  res.json({
    rows: db.getTelemetryHistory(limit, nodeId),
    stats: db.getStats(),
  });
});

app.get('/api/v1/runs', requireAuth, (_req, res) => {
  res.json({ runs: db.listSimulationRuns(25), stats: db.getStats() });
});

app.post('/api/v1/runs', requireAuth, (req: AuthenticatedRequest, res) => {
  const b = req.body ?? {};
  if (!b.name || !b.control_mode) {
    return res.status(400).json({ error: 'name and control_mode are required' });
  }
  const saved = db.saveSimulationRun({
    name: String(b.name).slice(0, 120),
    control_mode: String(b.control_mode).slice(0, 40),
    traffic_pollution: Number(b.traffic_pollution ?? 55),
    wind_speed_ms: Number(b.wind_speed_ms ?? 1.8),
    solar_irradiance_wm2: Number(b.solar_irradiance_wm2 ?? 720),
    pedestrian_aqi: Number(b.pedestrian_aqi ?? 50),
    verified_reduction_pct: Number(b.verified_reduction_pct ?? 40),
    total_co2_g: Number(b.total_co2_g ?? 12),
    net_power_w: Number(b.net_power_w ?? 100),
  });

  db.appendSecurityAudit({
    actor_uid: req.operator!.uid,
    actor_email: req.operator!.email,
    action: 'SIMULATION_RUN_SAVED',
    target: saved.name,
    status: 'info',
    ip_addr: req.ip || 'unknown',
    detail: `Saved AQI ${saved.pedestrian_aqi}, Rv +${saved.verified_reduction_pct}%`,
  });

  return res.status(201).json({ run: saved, stats: db.getStats() });
});

app.post('/api/v1/validations/run', requireAuth, (req, res) => {
  const env: EnvironmentParams = {
    trafficPollution: Number(req.body?.trafficPollution ?? 65),
    windSpeedMs: Number(req.body?.windSpeedMs ?? 1.6),
    windAngleDeg: Number(req.body?.windAngleDeg ?? 35),
    solarIrradianceWm2: Number(req.body?.solarIrradianceWm2 ?? 720),
    ambientTempC: Number(req.body?.ambientTempC ?? 28),
    ambientHumidityPct: Number(req.body?.ambientHumidityPct ?? 55),
    activeMode: 'swarm_pso_aco',
    strain: req.body?.strain === 'Spirulina_platensis' ? 'Spirulina_platensis' : 'Chlorella_sorokiniana_RMT01',
    treatmentConfig: { particulateStage: true, chemicalAdsorptionStage: true, biologicalPbrStage: true },
    simSpeed: 1,
    populationCount: Number(req.body?.populationCount ?? 24),
    voiceActivityDb: Number(req.body?.voiceActivityDb ?? 52),
    voiceDetectedTranscript: '',
  };
  const results = runControlledValidationSuite(env);
  db.saveValidationResults(results);
  return res.status(201).json({ results, stats: db.getStats() });
});

app.get('/api/v1/security/audit', requireAuth, (req, res) => {
  const limit = Math.min(100, Math.max(10, Number(req.query.limit ?? 40)));
  res.json({
    logs: db.listSecurityAuditLogs(limit),
    integrity: db.verifyAuditChainIntegrity(),
    stats: db.getStats(),
  });
});

app.post('/api/v1/tests/run', requireAuth, (req: AuthenticatedRequest, res) => {
  const checks: Array<{ id: string; name: string; passed: boolean; detail: string }> = [];

  try {
    const nodes = db.listNodes();
    checks.push({
      id: 'E2E-01',
      name: 'SQLite Node TEDS Registry Seeded (>= 5 Nodes)',
      passed: nodes.length >= 5 && nodes.every((n) => n.calibration_id.startsWith('IEEE1451')),
      detail: `Verified ${nodes.length} nodes with IEEE 1451 calibration IDs.`,
    });

    const dummyEnv: EnvironmentParams = {
      trafficPollution: 70,
      windSpeedMs: 1.5,
      windAngleDeg: 30,
      solarIrradianceWm2: 700,
      ambientTempC: 28,
      ambientHumidityPct: 55,
      activeMode: 'swarm_pso_aco',
      strain: 'Chlorella_sorokiniana_RMT01',
      treatmentConfig: { particulateStage: true, chemicalAdsorptionStage: true, biologicalPbrStage: true },
      simSpeed: 1,
      populationCount: 45,
      voiceActivityDb: 64,
      voiceDetectedTranscript: '',
    };
    const testNode = createInitialNodes(dummyEnv)[0];
    testNode.battery_soc = 11;
    const safety = applySafetyRuleEngine(0.95, testNode, dummyEnv.treatmentConfig);
    checks.push({
      id: 'E2E-02',
      name: 'Local Safety Rule Engine Low-Battery Override',
      passed: safety.override === 'LOW_BATTERY_FAN_CAP' && safety.safeDuty <= 0.2,
      detail: `Requested 95% duty capped to ${Math.round(safety.safeDuty * 100)}% (${safety.override}).`,
    });

    const phNode = createInitialNodes(dummyEnv)[1];
    phNode.pbr.ph = 5.1;
    const phSafety = applySafetyRuleEngine(0.75, phNode, dummyEnv.treatmentConfig);
    checks.push({
      id: 'E2E-03',
      name: 'PBR Biological Strain pH Isolation Guard',
      passed: phSafety.pbrIsolated && phSafety.override === 'PBR_PH_ISOLATED',
      detail: `Detected pH=5.1 outside Chlorella band -> PBR isolated (${phSafety.override}).`,
    });

    const valResults = runControlledValidationSuite(dummyEnv);
    const allValPassed = valResults.every((v) => v.passed);
    checks.push({
      id: 'E2E-04',
      name: 'Table III Controlled Validation Protocols (C1–C7)',
      passed: allValPassed,
      detail: `${valResults.filter((v) => v.passed).length}/7 controlled comparisons passed.`,
    });

    const insertedId = db.insertSingleTelemetry({
      node_id: 'BSS-POD-01',
      timestamp: Date.now(),
      pm25_in: 84.2,
      pm25_out: 23.1,
      no2_in: 62.0,
      no2_out: 21.5,
      co2_in: 545.0,
      co2_out: 440.0,
      flow_m3_h: 82.0,
      fan_power_w: 6.8,
      pv_harvest_w: 38.5,
      battery_soc: 81.2,
      ph: 7.34,
      algae_score: 0.95,
      media_score: 90.0,
      control_mode: 'swarm_pso_aco',
      safety_override: null,
      confidence_score: 0.98,
      source: 'simulated',
    });
    const latest = db.getTelemetryHistory(1, 'BSS-POD-01')[0];
    checks.push({
      id: 'E2E-05',
      name: 'SQLite Telemetry Round-Trip Persistence',
      passed: Boolean(latest && latest.id === insertedId),
      detail: `Persisted & queried telemetry row #${insertedId} (eta_PM2.5=${computeRemovalEfficiencyPct(84.2, 23.1)}%).`,
    });

    const auditIntegrity = db.verifyAuditChainIntegrity();
    checks.push({
      id: 'E2E-06',
      name: 'Cybersecurity SHA-256 Audit Chain & Auth Gate',
      passed: auditIntegrity.valid && Boolean(req.operator?.uid),
      detail: `Hash chain valid (${auditIntegrity.totalEntries} entries), verified UID ${req.operator?.uid}.`,
    });
  } catch (err) {
    checks.push({
      id: 'E2E-ERR',
      name: 'Runtime Exception',
      passed: false,
      detail: err instanceof Error ? err.message : String(err),
    });
  }

  return res.json({
    allPassed: checks.every((c) => c.passed),
    checks,
    stats: db.getStats(),
    timestamp: Date.now(),
  });
});

// -----------------------------------------------------------------------------
// Google Maps Platform Config & Air Quality Server Proxy
// -----------------------------------------------------------------------------
app.get('/api/v1/maps/config', requireAuth, (_req, res) => {
  const apiKey = getMapsApiKey();
  res.json({
    configured: Boolean(apiKey),
    apiKey,
    mapId: 'DEMO_MAP_ID',
  });
});

app.post('/api/v1/maps/air-quality', requireAuth, async (req, res) => {
  const apiKey = getMapsApiKey();
  if (!apiKey) {
    return res.status(503).json({
      error: 'Google Maps API key not configured in environment.',
      configured: false,
    });
  }

  const lat = Number(req.body?.lat ?? 12.9716);
  const lng = Number(req.body?.lng ?? 77.5946);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return res.status(400).json({ error: 'Valid lat/lng coordinates are required.' });
  }

  try {
    const resp = await fetch(
      `https://airquality.googleapis.com/v1/currentConditions:lookup?key=${encodeURIComponent(apiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          location: { latitude: lat, longitude: lng },
          extraComputations: [
            'HEALTH_RECOMMENDATIONS',
            'DOMINANT_POLLUTANT_CONCENTRATION',
            'POLLUTANT_CONCENTRATION',
            'LOCAL_AQI',
          ],
          languageCode: 'en',
        }),
      }
    );

    const data = await resp.json().catch(() => ({}));
    if (
      resp.status === 429 ||
      data?.error?.status === 'RESOURCE_EXHAUSTED' ||
      String(data?.error?.message || '').toLowerCase().includes('quota')
    ) {
      return res.status(429).json({
        quotaExceeded: true,
        error: data?.error?.message || 'Google Maps Platform Air Quality API quota exceeded.',
      });
    }

    if (!resp.ok) {
      return res.status(resp.status).json({
        error: data?.error?.message || 'Air Quality API lookup failed.',
        details: data?.error,
      });
    }

    return res.json(data);
  } catch (err) {
    return res.status(502).json({
      error: err instanceof Error ? err.message : 'Failed to reach Google Air Quality API.',
    });
  }
});

// -----------------------------------------------------------------------------
// Gemini AI Engineering Copilot (Free-Tier Models Only: gemini-4-hydrogen & gemini-3.1-flash-lite)
// -----------------------------------------------------------------------------
app.post('/api/v1/gemini/chat', requireAuth, async (req, res) => {
  const ai = getGeminiClient();
  if (!ai) {
    return res.status(503).json({
      error: 'GEMINI_API_KEY is not configured on the server.',
    });
  }

  const prompt = String(req.body?.prompt ?? '').trim();
  const mode = req.body?.mode === 'fast' ? 'fast' : 'grounded';
  const snapshotContext = req.body?.snapshotContext ?? {};
  const lat = typeof req.body?.lat === 'number' ? req.body.lat : 12.9716;
  const lng = typeof req.body?.lng === 'number' ? req.body.lng : 77.5946;

  if (!prompt || prompt.length > 2000) {
    return res.status(400).json({ error: 'Prompt (1-2000 characters) is required.' });
  }

  try {
    if (mode === 'fast') {
      const response = await ai.models.generateContent({
        model: 'gemini-3.1-flash-lite',
        contents: [
          {
            role: 'user',
            parts: [
              {
                text: `You are the Bio-Solar Swarm engineering telemetry analyst. Keep answers concise, technical, and grounded in the live simulation snapshot:\n${JSON.stringify(
                  snapshotContext
                )}\n\nOperator Question: ${prompt}`,
              },
            ],
          },
        ],
      });
      return res.json({
        text: response.text || 'No response text generated.',
        modelUsed: 'gemini-3.1-flash-lite',
        mapSources: [],
      });
    }

    // Grounded Google Maps engineering deployment mode (gemini-4-hydrogen, NO responseMimeType/responseSchema)
    const response = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: `You are the Bio-Solar Swarm Urban Remediation Systems Engineer. Using the live digital twin state below and Google Maps geographic context around (${lat}, ${lng}), advise on pod siting, crowd-adaptive fan duty, PBR algal health, and remediation efficacy.\n\nLive Twin Snapshot:\n${JSON.stringify(
                snapshotContext
              )}\n\nOperator Query: ${prompt}`,
            },
          ],
        },
      ],
      config: {
        tools: [{ googleMaps: {} }],
        toolConfig: {
          retrievalConfig: {
            latLng: { latitude: lat, longitude: lng },
          },
        },
      },
    });

    const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
    const mapSources: Array<{ title: string; uri: string }> = [];
    for (const chunk of chunks) {
      if (chunk.maps?.uri) {
        mapSources.push({
          title: chunk.maps.title || 'Google Maps Location',
          uri: chunk.maps.uri,
        });
      }
    }

    return res.json({
      text: response.text || 'No response text generated.',
      modelUsed: 'gemini-4-hydrogen',
      mapSources,
    });
  } catch (err) {
    return res.status(502).json({
      error: err instanceof Error ? err.message : 'Gemini request failed.',
    });
  }
});

app.post('/api/v1/gemini/video-script', requireAuth, async (req, res) => {
  const ai = getGeminiClient();
  const snapshotContext = req.body?.snapshotContext ?? {};

  if (!ai) {
    return res.json({
      script: `Bio-Solar Swarm engineering briefing: Active mode ${snapshotContext.mode || 'Swarm PSO+ACO'}, estimated street crowd ${snapshotContext.populationCount || 24} pedestrians, pedestrian AQI ${snapshotContext.pedestrianAqi || 48}, verified PM2.5 reduction ${snapshotContext.verifiedReductionRvPct || 42}%.`,
      modelUsed: 'local-fallback',
    });
  }

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: `Write a crisp 60-word spoken engineering briefing narration script for a 16:9 digital twin recording based strictly on this telemetry snapshot: ${JSON.stringify(
        snapshotContext
      )}`,
    });
    return res.json({
      script: response.text || '',
      modelUsed: 'gemini-4-hydrogen',
    });
  } catch (err) {
    return res.status(502).json({
      error: err instanceof Error ? err.message : 'Failed to generate video narration script.',
    });
  }
});

async function startServer() {
  const isProd = process.env.NODE_ENV === 'production';

  if (!isProd) {
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: false },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  server.listen(PORT, '127.0.0.1', () => {
    console.log(`Bio-Solar Swarm server listening on http://localhost:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start Bio-Solar Swarm server:', err);
  process.exit(1);
});
