import React, { useRef, useState } from 'react';
import {
  Bot,
  Download,
  ExternalLink,
  Film,
  Send,
  Sparkles,
  Square,
  X,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { SimulationSnapshot } from '../simulation/types';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  modelUsed?: string;
  mapSources?: Array<{ title: string; uri: string }>;
}

interface AiCopilotPanelProps {
  snapshot: SimulationSnapshot;
  canvasRef: React.MutableRefObject<HTMLCanvasElement | null>;
  onClose: () => void;
}

export const AiCopilotPanel: React.FC<AiCopilotPanelProps> = ({
  snapshot,
  canvasRef,
  onClose,
}) => {
  const { authFetch } = useAuth();
  const [mode, setMode] = useState<'grounded' | 'fast'>('grounded');
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'init',
      role: 'assistant',
      text: 'Bio-Solar Swarm Engineering Copilot ready. Query remediation physics, crowd-adaptive fan duty, or Google Maps corridor siting.',
    },
  ]);

  // 16:9 WebGL Video Briefing Recorder
  const [recording, setRecording] = useState(false);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [narrationScript, setNarrationScript] = useState<string>('');
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordTimerRef = useRef<number>(0);

  const buildSnapshotContext = () => ({
    mode: snapshot.environment.activeMode,
    pedestrianAqi: snapshot.pedestrianAqi,
    pedestrianPm25: snapshot.pedestrianPm25,
    verifiedReductionRvPct: snapshot.verifiedReductionRvPct,
    populationCount: snapshot.populationCount,
    populationFanMultiplier: snapshot.populationFanMultiplier,
    activeNodeCount: snapshot.activeNodeCount,
    totalNetPowerW: snapshot.totalNetPowerW,
    totalCo2CapturedG: snapshot.totalCo2CapturedG,
  });

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = prompt.trim();
    if (!trimmed || busy) return;

    const userMsg: ChatMessage = { id: `u-${Date.now()}`, role: 'user', text: trimmed };
    setMessages((prev) => [...prev, userMsg]);
    setPrompt('');
    setBusy(true);

    try {
      const resp = await authFetch('/api/v1/gemini/chat', {
        method: 'POST',
        body: JSON.stringify({
          prompt: trimmed,
          mode,
          snapshotContext: buildSnapshotContext(),
          lat: 12.9756,
          lng: 77.6066,
        }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        throw new Error(data.error || `HTTP ${resp.status}`);
      }
      setMessages((prev) => [
        ...prev,
        {
          id: `a-${Date.now()}`,
          role: 'assistant',
          text: String(data.text || ''),
          modelUsed: String(data.modelUsed || ''),
          mapSources: Array.isArray(data.mapSources) ? data.mapSources : [],
        },
      ]);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          id: `e-${Date.now()}`,
          role: 'assistant',
          text: err instanceof Error ? err.message : 'Failed to query Gemini Copilot.',
        },
      ]);
    } finally {
      setBusy(false);
    }
  };

  const startBriefingRecording = async () => {
    const sourceCanvas = canvasRef.current;
    if (!sourceCanvas || recording) return;

    setRecording(true);
    setVideoUrl(null);

    // Fetch narration script concurrently
    authFetch('/api/v1/gemini/video-script', {
      method: 'POST',
      body: JSON.stringify({ snapshotContext: buildSnapshotContext() }),
    })
      .then((r) => r.json())
      .then((d) => {
        if (d.script) setNarrationScript(String(d.script));
      })
      .catch(() => {});

    // Create dedicated 16:9 (1280x720) compositing canvas for crisp 16:9 briefing export
    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = 1280;
    exportCanvas.height = 720;
    const ctx = exportCanvas.getContext('2d');
    const chunks: Blob[] = [];
    const stream = exportCanvas.captureStream(24);
    const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
      ? 'video/webm;codecs=vp9'
      : 'video/webm';
    const recorder = new MediaRecorder(stream, { mimeType });
    recorderRef.current = recorder;

    recorder.ondataavailable = (ev) => {
      if (ev.data.size > 0) chunks.push(ev.data);
    };
    recorder.onstop = () => {
      cancelAnimationFrame(recordTimerRef.current);
      const blob = new Blob(chunks, { type: 'video/webm' });
      setVideoUrl(URL.createObjectURL(blob));
      setRecording(false);
    };

    const drawFrame = () => {
      if (ctx) {
        ctx.drawImage(sourceCanvas, 0, 0, 1280, 720);
        ctx.fillStyle = 'rgba(30, 41, 59, 0.84)';
        ctx.fillRect(24, 24, 470, 82);
        ctx.fillStyle = '#FFFFFF';
        ctx.font = 'bold 18px sans-serif';
        ctx.fillText('Bio-Solar Swarm · Digital Twin Briefing', 38, 52);
        ctx.font = '14px monospace';
        ctx.fillStyle = '#6EE7B7';
        ctx.fillText(
          `AQI ${snapshot.pedestrianAqi} | Rv +${snapshot.verifiedReductionRvPct.toFixed(1)}% | Crowd ${snapshot.populationCount} pax`,
          38,
          82
        );
      }
      if (recorder.state === 'recording') {
        recordTimerRef.current = requestAnimationFrame(drawFrame);
      }
    };

    recorder.start(250);
    recordTimerRef.current = requestAnimationFrame(drawFrame);
    window.setTimeout(() => {
      if (recorder.state === 'recording') recorder.stop();
    }, 6000);
  };

  const stopBriefingRecording = () => {
    if (recorderRef.current && recorderRef.current.state === 'recording') {
      recorderRef.current.stop();
    }
  };

  return (
    <aside
      aria-label="AI Engineering Copilot and Video Briefing"
      data-testid="ai-copilot-panel"
      className="fixed top-14 right-4 bottom-4 w-[min(440px,calc(100vw-2rem))] z-30 bg-[#EEF2F6] text-[#1E293B] border border-[#B8C4D0] rounded-xl shadow-2xl flex flex-col overflow-hidden"
    >
      <div className="px-4 py-3 bg-[#2D3744] text-white flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2 text-xs font-semibold">
          <Bot className="w-4 h-4 text-[#34D399]" />
          <span>Gemini Engineering Copilot &amp; 16:9 Briefing</span>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close AI Copilot"
          className="text-[#CBD5E1] hover:text-white"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Mode Switch + 16:9 Video Briefing Recorder */}
      <div className="px-4 py-2.5 bg-[#DCE4EC] border-b border-[#CBD5E1] space-y-2 shrink-0">
        <div className="flex items-center gap-1.5 text-xs">
          <button
            type="button"
            onClick={() => setMode('grounded')}
            className={`flex-1 py-1.5 px-2 rounded-md font-medium ${
              mode === 'grounded'
                ? 'bg-[#059669] text-white'
                : 'bg-white text-[#334155] border border-[#CBD5E1]'
            }`}
          >
            <Sparkles className="w-3 h-3 inline mr-1" />
            Maps Grounded (Gemini 4H)
          </button>
          <button
            type="button"
            onClick={() => setMode('fast')}
            className={`flex-1 py-1.5 px-2 rounded-md font-medium ${
              mode === 'fast'
                ? 'bg-[#0284C7] text-white'
                : 'bg-white text-[#334155] border border-[#CBD5E1]'
            }`}
          >
            Fast Telemetry (Flash Lite)
          </button>
        </div>

        <div className="flex items-center justify-between gap-2 bg-white border border-[#CBD5E1] rounded-lg px-3 py-2 text-xs">
          <div className="min-w-0">
            <div className="font-semibold text-[#0F172A] flex items-center gap-1">
              <Film className="w-3.5 h-3.5 text-[#0F766E]" />
              16:9 Twin Video Briefing (.webm)
            </div>
            <div className="text-[11px] text-[#64748B] truncate">
              Captures 6s 1280×720 3D WebGL + Gemini narration
            </div>
          </div>
          {!recording ? (
            <button
              type="button"
              onClick={startBriefingRecording}
              className="px-2.5 py-1.5 rounded bg-[#2D3744] hover:bg-[#1E293B] text-white font-semibold shrink-0"
            >
              Record 16:9
            </button>
          ) : (
            <button
              type="button"
              onClick={stopBriefingRecording}
              className="px-2.5 py-1.5 rounded bg-[#DC2626] text-white font-semibold inline-flex items-center gap-1 shrink-0"
            >
              <Square className="w-3 h-3" />
              Stop
            </button>
          )}
        </div>

        {videoUrl && (
          <div className="bg-white border border-[#6EE7B7] rounded-lg p-2.5 space-y-2 text-xs">
            <video src={videoUrl} controls className="w-full rounded aspect-video bg-black" />
            {narrationScript && (
              <p className="text-[11px] text-[#334155] bg-[#F8FAFC] p-2 rounded border border-[#E2E8F0]">
                <strong>Briefing Script:</strong> {narrationScript}
              </p>
            )}
            <a
              href={videoUrl}
              download={`bio-solar-swarm-briefing-${Date.now()}.webm`}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-[#059669] text-white font-semibold"
            >
              <Download className="w-3.5 h-3.5" />
              Download 16:9 WebM
            </a>
          </div>
        )}
      </div>

      {/* Chat Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3 text-xs">
        {messages.map((m) => (
          <div
            key={m.id}
            className={`rounded-lg p-3 ${
              m.role === 'user'
                ? 'bg-[#2D3744] text-white ml-6'
                : 'bg-white border border-[#CBD5E1] text-[#1E293B] mr-4'
            }`}
          >
            <div className="whitespace-pre-wrap leading-relaxed">{m.text}</div>
            {m.modelUsed && (
              <div className="mt-1.5 text-[10px] font-mono text-[#64748B]">Model: {m.modelUsed}</div>
            )}
            {m.mapSources && m.mapSources.length > 0 && (
              <div className="mt-2 pt-2 border-t border-[#E2E8F0] space-y-1">
                <div className="text-[10px] font-semibold uppercase text-[#0F766E]">
                  Google Maps Grounding Sources
                </div>
                {m.mapSources.map((src, i) => (
                  <a
                    key={`${src.uri}-${i}`}
                    href={src.uri}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1 text-[11px] text-[#0284C7] hover:underline"
                  >
                    <ExternalLink className="w-3 h-3 shrink-0" />
                    <span className="truncate">{src.title}</span>
                  </a>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Prompt Input */}
      <form onSubmit={handleSend} className="p-3 bg-[#DCE4EC] border-t border-[#CBD5E1] flex gap-2 shrink-0">
        <input
          type="text"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Ask about pod fan scaling, siting, or AQI..."
          className="flex-1 px-3 py-2 rounded-lg bg-white border border-[#CBD5E1] text-xs text-[#0F172A]"
        />
        <button
          type="submit"
          disabled={busy || !prompt.trim()}
          aria-label="Send query to Gemini"
          className="px-3 py-2 rounded-lg bg-[#059669] hover:bg-[#047857] text-white disabled:opacity-50"
        >
          <Send className="w-4 h-4" />
        </button>
      </form>
    </aside>
  );
};
