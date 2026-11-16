import React, { useEffect, useState } from 'react';

interface SplashOverlayProps {
  onComplete: () => void;
}

/**
 * Centered 5-second engineering intro splash on simulation launch:
 * Displays "Bio-Solar Swarm" centrally and smoothly fades out within 5 seconds.
 */
export const SplashOverlay: React.FC<SplashOverlayProps> = ({ onComplete }) => {
  const [fading, setFading] = useState(false);

  useEffect(() => {
    const fadeTimer = window.setTimeout(() => setFading(true), 3800);
    const doneTimer = window.setTimeout(() => onComplete(), 4900);
    return () => {
      clearTimeout(fadeTimer);
      clearTimeout(doneTimer);
    };
  }, [onComplete]);

  return (
    <div
      data-testid="bio-solar-splash"
      aria-live="polite"
      className={`fixed inset-0 z-50 flex items-center justify-center transition-opacity duration-1000 ${
        fading ? 'opacity-0 pointer-events-none' : 'opacity-100 bg-[#25303C]/65'
      }`}
    >
      <div className="bg-[#EEF2F6]/95 border border-[#B8C4D0] rounded-xl px-10 py-7 shadow-2xl text-center max-w-md mx-4">
        <div className="text-[11px] font-mono uppercase tracking-[0.22em] text-[#059669] font-semibold">
          Decentralized Cyber-Physical Network
        </div>
        <h1 className="mt-2 text-3xl sm:text-4xl font-bold tracking-tight text-[#0F172A]">
          Bio-Solar Swarm
        </h1>
        <p className="mt-2 text-xs text-[#475569]">
          Initializing IEEE 1451 Smart Transducers, Monod PBR Kinetics &amp; PSO+ACO Urban Twin
        </p>
        <div className="mt-4 w-full h-1 bg-[#CBD5E1] rounded-full overflow-hidden">
          <div className="h-full bg-[#059669] animate-[pulse_1.6s_ease-in-out_infinite] w-full" />
        </div>
      </div>
    </div>
  );
};
