import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Mic, MicOff, Radio, Users, Volume2, Fan } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import {
  classifyCrowdBand,
  computePopulationFanMultiplier,
  estimatePopulationFromAcousticAndSpeech,
} from '../simulation/voicePopulation';

interface VoicePopulationPanelProps {
  populationCount: number;
  voiceActivityDb: number;
  transcript: string;
  onUpdateVoicePopulation: (populationCount: number, voiceActivityDb: number, transcript: string) => void;
}

interface SpeechRecognitionAlternativeLike {
  transcript: string;
}

interface SpeechRecognitionResultLike {
  isFinal: boolean;
  0: SpeechRecognitionAlternativeLike;
}

interface SpeechRecognitionEventLike {
  results: ArrayLike<SpeechRecognitionResultLike>;
}

interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((ev: SpeechRecognitionEventLike) => void) | null;
  onerror: ((ev: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

function encodeFloat32ToBase64Pcm16(input: Float32Array): string {
  const buffer = new ArrayBuffer(input.length * 2);
  const view = new DataView(buffer);
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]));
    view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export const VoicePopulationPanel: React.FC<VoicePopulationPanelProps> = ({
  populationCount,
  voiceActivityDb,
  transcript,
  onUpdateVoicePopulation,
}) => {
  const { getFreshIdToken } = useAuth();
  const [listening, setListening] = useState(false);
  const [geminiLiveActive, setGeminiLiveActive] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string>('Standby — microphone or acoustic preset ready');
  const [liveReasoning, setLiveReasoning] = useState<string>('');

  const popRef = useRef(populationCount);
  const transcriptRef = useRef(transcript);
  popRef.current = populationCount;
  transcriptRef.current = transcript;

  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const rafRef = useRef<number>(0);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const liveWsRef = useRef<WebSocket | null>(null);
  const playbackCtxRef = useRef<AudioContext | null>(null);
  const nextPlaybackTimeRef = useRef<number>(0);

  const playBase64Pcm24k = useCallback((base64: string) => {
    try {
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const int16 = new Int16Array(bytes.buffer);
      const float32 = new Float32Array(int16.length);
      for (let i = 0; i < int16.length; i++) float32[i] = int16[i] / 32768;

      if (!playbackCtxRef.current || playbackCtxRef.current.state === 'closed') {
        playbackCtxRef.current = new AudioContext({ sampleRate: 24000 });
        nextPlaybackTimeRef.current = 0;
      }
      const ctx = playbackCtxRef.current;
      const buf = ctx.createBuffer(1, float32.length, 24000);
      buf.copyToChannel(float32, 0);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(ctx.destination);
      const startAt = Math.max(ctx.currentTime, nextPlaybackTimeRef.current);
      src.start(startAt);
      nextPlaybackTimeRef.current = startAt + buf.duration;
    } catch {
      // Ignore audio playback issues on headless devices
    }
  }, []);

  const stopListening = useCallback(() => {
    setListening(false);
    setGeminiLiveActive(false);
    cancelAnimationFrame(rafRef.current);
    try {
      recognitionRef.current?.stop();
    } catch {
      // ignore
    }
    recognitionRef.current = null;
    try {
      processorRef.current?.disconnect();
    } catch {
      // ignore
    }
    processorRef.current = null;
    mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
    mediaStreamRef.current = null;
    if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
      audioCtxRef.current.close().catch(() => {});
    }
    audioCtxRef.current = null;
    if (liveWsRef.current) {
      liveWsRef.current.close();
      liveWsRef.current = null;
    }
    setStatusMessage('Voice capture stopped');
  }, []);

  useEffect(() => {
    return () => {
      stopListening();
      if (playbackCtxRef.current && playbackCtxRef.current.state !== 'closed') {
        playbackCtxRef.current.close().catch(() => {});
      }
    };
  }, [stopListening]);

  const startListening = async () => {
    if (listening) {
      stopListening();
      return;
    }
    setStatusMessage('Requesting microphone permission...');

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, sampleRate: 16000 },
      });
      mediaStreamRef.current = stream;

      const audioCtx = new AudioContext({ sampleRate: 16000 });
      audioCtxRef.current = audioCtx;
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);

      const timeData = new Float32Array(analyser.fftSize);
      let lastUiPush = 0;

      const sampleMeter = () => {
        if (!audioCtxRef.current) return;
        analyser.getFloatTimeDomainData(timeData);
        let sumSq = 0;
        for (let i = 0; i < timeData.length; i++) {
          sumSq += timeData[i] * timeData[i];
        }
        const rms = Math.sqrt(sumSq / timeData.length);
        const now = performance.now();
        if (now - lastUiPush > 380) {
          lastUiPush = now;
          const est = estimatePopulationFromAcousticAndSpeech(
            rms,
            transcriptRef.current,
            popRef.current
          );
          onUpdateVoicePopulation(est.estimatedPopulation, est.dbSpl, transcriptRef.current);
          setLiveReasoning(est.reason);
        }
        rafRef.current = requestAnimationFrame(sampleMeter);
      };
      rafRef.current = requestAnimationFrame(sampleMeter);

      // Browser Web Speech API for immediate local voice keyword & crowd number detection
      const SpeechCtor =
        (window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike })
          .SpeechRecognition ||
        (window as unknown as { webkitSpeechRecognition?: new () => SpeechRecognitionLike })
          .webkitSpeechRecognition;

      if (SpeechCtor) {
        const rec = new SpeechCtor();
        rec.continuous = true;
        rec.interimResults = true;
        rec.lang = 'en-US';
        rec.onresult = (event) => {
          let latestText = '';
          for (let i = 0; i < event.results.length; i++) {
            latestText = event.results[i][0].transcript;
          }
          if (latestText.trim()) {
            const est = estimatePopulationFromAcousticAndSpeech(0.18, latestText, popRef.current);
            onUpdateVoicePopulation(est.estimatedPopulation, est.dbSpl, latestText.trim());
            setLiveReasoning(est.reason);
          }
        };
        rec.onerror = () => {};
        rec.start();
        recognitionRef.current = rec;
      }

      // Connect optional Gemini 3.8 Live API WebSocket bridge
      try {
        const idToken = await getFreshIdToken();
        const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const ws = new WebSocket(`${proto}//${window.location.host}/ws/live?token=${encodeURIComponent(idToken)}`);
        liveWsRef.current = ws;

        ws.onopen = () => {
          setGeminiLiveActive(true);
          setStatusMessage('Listening · Acoustic SPL + Web Speech + Gemini 3.8 Live active');
          const processor = audioCtx.createScriptProcessor(4096, 1, 1);
          processorRef.current = processor;
          source.connect(processor);
          processor.connect(audioCtx.destination);
          processor.onaudioprocess = (ev) => {
            if (ws.readyState !== WebSocket.OPEN) return;
            const input = ev.inputBuffer.getChannelData(0);
            ws.send(JSON.stringify({ audio: encodeFloat32ToBase64Pcm16(input) }));
          };
        };

        ws.onmessage = (msgEv) => {
          try {
            const msg = JSON.parse(msgEv.data);
            if (msg.type === 'population_update') {
              const nextPop = Number(msg.populationCount || popRef.current);
              const est = estimatePopulationFromAcousticAndSpeech(0.3, String(msg.reason || ''), nextPop);
              onUpdateVoicePopulation(nextPop, est.dbSpl, String(msg.reason || transcriptRef.current));
              setLiveReasoning(`Gemini Live: ${msg.reason}`);
            } else if (msg.type === 'input_transcript' && msg.text) {
              const est = estimatePopulationFromAcousticAndSpeech(0.22, String(msg.text), popRef.current);
              onUpdateVoicePopulation(est.estimatedPopulation, est.dbSpl, String(msg.text));
            } else if (msg.type === 'audio' && msg.audio) {
              playBase64Pcm24k(String(msg.audio));
            } else if (msg.type === 'error') {
              setGeminiLiveActive(false);
              setStatusMessage('Listening · Local Acoustic SPL & Web Speech active');
            }
          } catch {
            // ignore
          }
        };

        ws.onclose = () => {
          setGeminiLiveActive(false);
        };
      } catch {
        setStatusMessage('Listening · Local Acoustic SPL & Web Speech active');
      }

      setListening(true);
      setStatusMessage('Listening · Acoustic SPL & Voice Crowd Recognition active');
    } catch (err) {
      setListening(false);
      setStatusMessage(
        err instanceof Error
          ? `Mic unavailable (${err.message}) — use calibrated voice presets below`
          : 'Mic unavailable — use calibrated voice presets below'
      );
    }
  };

  const applySimulatedVoiceCommand = (cueText: string, simRms: number) => {
    const est = estimatePopulationFromAcousticAndSpeech(simRms, cueText, populationCount);
    onUpdateVoicePopulation(est.estimatedPopulation, est.dbSpl, cueText);
    setLiveReasoning(est.reason);
    setStatusMessage(`Processed voice cue: "${cueText}"`);
  };

  const crowdBand = classifyCrowdBand(populationCount);
  const fanMult = computePopulationFanMultiplier(populationCount);

  return (
    <section
      aria-label="Voice Recognition Population & Fan Speed Controller"
      data-testid="voice-population-panel"
      className="bg-[#2D3744]/95 border border-[#465466] rounded-xl px-3.5 py-2.5 text-[#F1F5F9] shadow-lg space-y-2"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[10px] font-mono uppercase tracking-wider text-[#94A3B8] flex items-center gap-1.5">
            <Radio className="w-3 h-3 text-[#34D399]" />
            Voice Crowd Sensor · Auto Fan Scaling
          </div>
          <div className="text-xs font-medium text-white truncate">{statusMessage}</div>
        </div>

        <button
          type="button"
          onClick={startListening}
          data-testid="voice-mic-toggle"
          className={`px-3 py-1.5 rounded-md text-xs font-semibold inline-flex items-center gap-1.5 shrink-0 transition-colors ${
            listening
              ? 'bg-[#DC2626] hover:bg-[#B91C1C] text-white'
              : 'bg-[#0284C7] hover:bg-[#0369A1] text-white'
          }`}
        >
          {listening ? <MicOff className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5" />}
          {listening ? 'Stop Mic' : 'Start Voice Mic'}
        </button>
      </div>

      {/* Key Metrics */}
      <div className="grid grid-cols-3 gap-2 text-xs bg-[#1E2630] rounded-lg p-2 border border-[#3E4B5B]">
        <div>
          <div className="text-[10px] text-[#94A3B8] flex items-center gap-1">
            <Users className="w-3 h-3 text-[#38BDF8]" />
            Population
          </div>
          <div className="font-mono tabular-nums font-semibold text-white">
            {populationCount} <span className="text-[10px] text-[#34D399]">({crowdBand})</span>
          </div>
        </div>
        <div>
          <div className="text-[10px] text-[#94A3B8] flex items-center gap-1">
            <Volume2 className="w-3 h-3 text-[#FBBF24]" />
            Acoustic SPL
          </div>
          <div className="font-mono tabular-nums font-semibold text-[#FDE047]">
            {voiceActivityDb.toFixed(1)} dB
          </div>
        </div>
        <div>
          <div className="text-[10px] text-[#94A3B8] flex items-center gap-1">
            <Fan className="w-3 h-3 text-[#34D399]" />
            Fan Scale
          </div>
          <div className="font-mono tabular-nums font-semibold text-[#34D399]">
            {fanMult.toFixed(2)}x Duty
          </div>
        </div>
      </div>

      {/* Calibrated Voice Scenarios (for instant validation & no-mic environments) */}
      <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
        <span className="text-[#94A3B8] mr-1">Voice Cues:</span>
        <button
          type="button"
          onClick={() => applySimulatedVoiceCommand('Quiet street 14 people', 0.04)}
          className="px-2 py-0.5 rounded bg-[#3B4859] hover:bg-[#475569] text-[#E2E8F0]"
        >
          "Quiet (~14)"
        </button>
        <button
          type="button"
          onClick={() => applySimulatedVoiceCommand('Moderate market crowd 70 people', 0.24)}
          className="px-2 py-0.5 rounded bg-[#3B4859] hover:bg-[#475569] text-[#E2E8F0]"
        >
          "Market (~70)"
        </button>
        <button
          type="button"
          onClick={() => applySimulatedVoiceCommand('Rush hour surge 145 pedestrians', 0.65)}
          className="px-2 py-0.5 rounded bg-[#059669] hover:bg-[#047857] text-white font-medium"
        >
          "Rush Surge (~145)"
        </button>
        {geminiLiveActive && (
          <span className="ml-auto text-[10px] font-mono text-[#6EE7B7]">Gemini Live Connected</span>
        )}
      </div>

      {(transcript || liveReasoning) && (
        <div className="text-[11px] font-mono text-[#CBD5E1] truncate border-t border-[#3E4B5B] pt-1">
          {liveReasoning || `Heard: "${transcript}"`}
        </div>
      )}
    </section>
  );
};
