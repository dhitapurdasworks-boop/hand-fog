import React, { useRef, useState } from 'react';
import {
  RotateCcw,
  Sliders,
  Download,
  Maximize2,
  Minimize2,
  Sparkles,
  Camera,
  Hand,
  PenTool,
  Info,
  ChevronDown,
  Wind,
  Target,
} from 'lucide-react';
import { FogConfig, ActiveBrushPoint, FaceBreathData } from '../types';

interface FloatingControlsProps {
  config: FogConfig;
  onConfigChange: (newConfig: FogConfig) => void;
  onResetFog: () => void;
  onDownloadSnapshot: () => void;
  hands: ActiveBrushPoint[];
  faceData?: FaceBreathData;
  currentMaxHandScale: number;
  fps: number;
  isHandTrackerReady: boolean;
  isFaceTrackerReady: boolean;
  handTrackerError: string | null;
  hasCamera: boolean;
  onRequestCamera: () => void;
}

export const FloatingControls: React.FC<FloatingControlsProps> = ({
  config,
  onConfigChange,
  onResetFog,
  onDownloadSnapshot,
  hands,
  faceData,
  currentMaxHandScale,
  fps,
  isHandTrackerReady,
  isFaceTrackerReady,
  hasCamera,
  onRequestCamera,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const isDownloadingRef = useRef(false);

  const handleSnapshotClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (isDownloadingRef.current) return;
    isDownloadingRef.current = true;
    try {
      onDownloadSnapshot();
    } finally {
      setTimeout(() => {
        isDownloadingRef.current = false;
      }, 800);
    }
  };

  // Toggle fullscreen
  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement
        .requestFullscreen()
        .then(() => setIsFullscreen(true))
        .catch(() => {});
    } else {
      document
        .exitFullscreen()
        .then(() => setIsFullscreen(false))
        .catch(() => {});
    }
  };

  // Determine current active gesture & proximity status
  const nearHands = hands.filter((h) => h.isNear);
  const activePinch = nearHands.some((h) => h.gesture === 'pinch');
  const activeFist = nearHands.some((h) => h.gesture === 'fist');
  const hoveringHands = hands.filter((h) => !h.isNear && h.gesture !== 'idle');
  const activeHand = hands[0];

  return (
    <>
      {/* Top Left: Live Hand & Breath Tracking Status Pill */}
      <div className="fixed top-4 left-4 z-40 flex items-center gap-2 select-none">
        <div className="glass-panel px-3.5 py-2 rounded-full flex items-center gap-2.5 text-xs font-medium text-slate-200 shadow-xl border border-white/10 backdrop-blur-md">
          <div className="flex items-center gap-1.5">
            <span
              className={`w-2 h-2 rounded-full ${
                !hasCamera
                  ? 'bg-amber-400 animate-pulse'
                  : isHandTrackerReady
                  ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]'
                  : 'bg-amber-400 animate-ping'
              }`}
            />
            <span className="font-semibold text-slate-100">
              {!hasCamera ? 'No Camera' : isHandTrackerReady ? "Dhita's project" : 'Loading Vision...'}
            </span>
          </div>

          {isHandTrackerReady && hasCamera && (
            <>
              <div className="w-[1px] h-3 bg-white/20" />

              {/* Real-time status: Pinch Draw vs Fist Wipe vs Idle vs Hover (No breath notifications) */}
              <div className="flex items-center gap-1.5">
                {activePinch ? (
                  <span className="inline-flex items-center gap-1 text-sky-300 font-semibold animate-pulse">
                    <PenTool className="w-3.5 h-3.5" /> Pinch Drawing
                    {activeHand?.pinchDist !== undefined && (
                      <span className="text-[10px] font-mono text-sky-200/80">
                        ({activeHand.pinchDist.toFixed(3)})
                      </span>
                    )}
                  </span>
                ) : activeFist ? (
                  <span className="inline-flex items-center gap-1 text-amber-300 font-semibold animate-pulse">
                    <Hand className="w-3.5 h-3.5" /> Fist Wiping
                  </span>
                ) : hoveringHands.length > 0 ? (
                  <span className="inline-flex items-center gap-1 text-amber-400/90 font-medium">
                    <Target className="w-3.5 h-3.5" /> Move Closer (~15cm)
                  </span>
                ) : hands.length > 0 ? (
                  <span className="inline-flex items-center gap-1 text-slate-400">
                    <Hand className="w-3 h-3 text-slate-500" /> Open Hand (Idle)
                  </span>
                ) : (
                  <span className="text-slate-400">Pinch to Draw • Fist to Wipe</span>
                )}
              </div>

              <div className="w-[1px] h-3 bg-white/20" />
              <span className="text-slate-400 font-mono text-[11px]">{fps} FPS</span>
            </>
          )}

          <button
            onClick={() => setShowHelp(!showHelp)}
            aria-label="Gesture instructions"
            className="ml-0.5 text-slate-400 hover:text-white transition-colors p-0.5 rounded-full hover:bg-white/10"
          >
            <Info className="w-3.5 h-3.5" />
          </button>
        </div>

        {!hasCamera && (
          <button
            onClick={onRequestCamera}
            className="glass-button px-3 py-2 rounded-full text-xs font-medium text-white flex items-center gap-1.5 shadow-lg bg-sky-500/80 hover:bg-sky-500 transition-all"
          >
            <Camera className="w-3.5 h-3.5" /> Enable Camera
          </button>
        )}
      </div>

      {/* Gesture Help Modal */}
      {showHelp && (
        <div className="fixed top-16 left-4 z-50 w-84 glass-panel p-4 rounded-2xl text-xs text-slate-200 shadow-2xl border border-white/15 backdrop-blur-xl animate-fade-in">
          <div className="flex items-center justify-between pb-2 mb-2 border-b border-white/10">
            <span className="font-semibold text-slate-100 flex items-center gap-1.5">
              <Sparkles className="w-4 h-4 text-sky-400" /> Mirror Gestures Guide
            </span>
            <button
              onClick={() => setShowHelp(false)}
              className="text-slate-400 hover:text-white text-base leading-none"
            >
              &times;
            </button>
          </div>
          <div className="space-y-3">
            {/* 1. Pinch-to-Draw */}
            <div className="flex items-start gap-2.5">
              <div className="p-1.5 rounded-lg bg-sky-500/20 text-sky-300 mt-0.5">
                <PenTool className="w-4 h-4" />
              </div>
              <div>
                <p className="font-semibold text-white">1. Pinch-to-Draw</p>
                <p className="text-slate-400 text-[11px]">
                  Pinch thumb tip (4) and index tip (8) together (start &lt; 0.06, release &gt; 0.085) within ~15cm of camera to draw smooth cursive lines.
                </p>
              </div>
            </div>

            {/* 2. Closed-Fist Wipe */}
            <div className="flex items-start gap-2.5">
              <div className="p-1.5 rounded-lg bg-amber-500/20 text-amber-300 mt-0.5">
                <Hand className="w-4 h-4" />
              </div>
              <div>
                <p className="font-semibold text-white">2. Closed-Fist Wipe</p>
                <p className="text-slate-400 text-[11px]">
                  Close all four fingertips (8, 12, 16, 20) below PIP joints into a fist within ~15cm to wipe with large brush centered at landmark 9.
                </p>
              </div>
            </div>

            {/* 3. Relaxed/Open Hand */}
            <div className="flex items-start gap-2.5">
              <div className="p-1.5 rounded-lg bg-slate-500/20 text-slate-300 mt-0.5">
                <Hand className="w-4 h-4" />
              </div>
              <div>
                <p className="font-semibold text-white">3. Relaxed / Open Hand</p>
                <p className="text-slate-400 text-[11px]">
                  Does nothing! Keeps the fog intact when your hand is open or relaxed.
                </p>
              </div>
            </div>

            {/* 4. Mouth-Open Breath */}
            <div className="flex items-start gap-2.5">
              <div className="p-1.5 rounded-lg bg-sky-500/20 text-sky-300 mt-0.5">
                <Wind className="w-4 h-4" />
              </div>
              <div>
                <p className="font-semibold text-white">4. Mouth-Open Breath Re-Fog</p>
                <p className="text-slate-400 text-[11px]">
                  Open mouth (jawOpen &gt; 0.25) toward the screen to rapidly re-fog the mirror with warm steam plumes, simulating breathing on cold glass.
                </p>
              </div>
            </div>

            <div className="pt-1 text-[11px] text-slate-400 italic">
              💡 Tip: Click/drag with mouse or trackpad also erases steam directly (Shift+drag for large wipe)!
            </div>
          </div>
        </div>
      )}

      {/* Bottom Center: Minimal Floating Controls */}
      <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 flex flex-col items-center gap-2 select-none">
        {/* Expanded Options Drawer */}
        {isExpanded && (
          <div className="glass-panel p-4 rounded-2xl shadow-2xl border border-white/15 backdrop-blur-xl w-84 text-xs text-slate-200 space-y-3.5 mb-1 animate-slide-up max-h-[75vh] overflow-y-auto">
            {/* Mouth-Open Breath Re-Fog Settings */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-medium text-slate-300 flex items-center gap-1.5">
                  <Wind className="w-3.5 h-3.5 text-sky-400" /> Breath Re-Fog (jawOpen &gt; 0.25)
                </span>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={config.breathReFog}
                    onChange={(e) =>
                      onConfigChange({
                        ...config,
                        breathReFog: e.target.checked,
                      })
                    }
                    className="sr-only peer"
                  />
                  <div className="w-8 h-4 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-sky-500"></div>
                </label>
              </div>

              {config.breathReFog && (
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-[11px] text-slate-400">
                    <span>Breath Condensation Power</span>
                    <span className="font-mono text-slate-400">
                      {Math.round(config.breathReFogSpeed * 100)}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min="0.1"
                    max="0.45"
                    step="0.02"
                    value={config.breathReFogSpeed}
                    onChange={(e) =>
                      onConfigChange({
                        ...config,
                        breathReFogSpeed: parseFloat(e.target.value),
                      })
                    }
                    className="w-full h-1 bg-slate-700/80 rounded appearance-none cursor-pointer accent-sky-400"
                  />
                </div>
              )}
            </div>

            {/* Passive Auto-Refog */}
            <div className="pt-2 border-t border-white/10 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="font-medium text-slate-300 flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-amber-400" /> Slow Passive Auto-Refog
                </span>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={config.autoRefog}
                    onChange={(e) =>
                      onConfigChange({
                        ...config,
                        autoRefog: e.target.checked,
                      })
                    }
                    className="sr-only peer"
                  />
                  <div className="w-8 h-4 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-amber-500"></div>
                </label>
              </div>

              {config.autoRefog && (
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-[11px] text-slate-400">
                    <span>Passive Speed</span>
                    <span className="font-mono">
                      {config.autoRefogSpeed <= 0.005
                        ? 'Gentle'
                        : config.autoRefogSpeed <= 0.012
                        ? 'Moderate'
                        : 'Fast'}
                    </span>
                  </div>
                  <input
                    type="range"
                    min="0.002"
                    max="0.02"
                    step="0.002"
                    value={config.autoRefogSpeed}
                    onChange={(e) =>
                      onConfigChange({
                        ...config,
                        autoRefogSpeed: parseFloat(e.target.value),
                      })
                    }
                    className="w-full h-1 bg-slate-700/80 rounded appearance-none cursor-pointer accent-amber-400"
                  />
                </div>
              )}
            </div>

            {/* Brush Sizes */}
            <div className="pt-2 border-t border-white/10 grid grid-cols-2 gap-3">
              <div>
                <span className="text-[11px] text-slate-400 block mb-1">Pinch Brush Size</span>
                <input
                  type="range"
                  min="10"
                  max="40"
                  value={config.fingerRadius}
                  onChange={(e) =>
                    onConfigChange({
                      ...config,
                      fingerRadius: parseInt(e.target.value, 10),
                    })
                  }
                  className="w-full h-1 bg-slate-700/80 rounded appearance-none cursor-pointer accent-sky-400"
                />
              </div>
              <div>
                <span className="text-[11px] text-slate-400 block mb-1">Fist Brush Size</span>
                <input
                  type="range"
                  min="50"
                  max="140"
                  value={config.palmRadius}
                  onChange={(e) =>
                    onConfigChange({
                      ...config,
                      palmRadius: parseInt(e.target.value, 10),
                    })
                  }
                  className="w-full h-1 bg-slate-700/80 rounded appearance-none cursor-pointer accent-amber-400"
                />
              </div>
            </div>
          </div>
        )}

        {/* Minimal Floating Controls Bar: Reset Fog, Fog Density, Proximity Threshold, Download Snapshot */}
        <div className="glass-panel px-3.5 py-2 rounded-full flex items-center gap-2 shadow-2xl border border-white/15 backdrop-blur-xl">
          {/* 1. Reset Fog */}
          <button
            onClick={onResetFog}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold text-slate-200 hover:text-white hover:bg-white/15 active:scale-95 transition-all"
            title="Reset Fog (Re-steam the entire mirror)"
          >
            <RotateCcw className="w-4 h-4 text-sky-400" />
            <span>Reset Fog</span>
          </button>

          <div className="w-[1px] h-4 bg-white/20" />

          {/* 2. Fog Density Slider */}
          <div className="flex items-center gap-2 px-1">
            <span className="text-[11px] font-medium text-slate-300 flex items-center gap-1" title="Fog Density">
              <Sliders className="w-3.5 h-3.5 text-sky-400" />
              Density:
            </span>
            <input
              type="range"
              min="0.1"
              max="1.0"
              step="0.05"
              value={config.density}
              onChange={(e) =>
                onConfigChange({
                  ...config,
                  density: parseFloat(e.target.value),
                })
              }
              className="w-18 h-1.5 bg-slate-700/90 rounded-lg appearance-none cursor-pointer accent-sky-400"
              title={`Fog Density: ${Math.round(config.density * 100)}%`}
            />
            <span className="font-mono text-[10px] text-slate-400 w-7 text-right">
              {Math.round(config.density * 100)}%
            </span>
          </div>

          <div className="w-[1px] h-4 bg-white/20" />

          {/* 3. Proximity Threshold Slider */}
          <div className="flex items-center gap-2 px-1">
            <span
              className="text-[11px] font-medium text-slate-300 flex items-center gap-1"
              title="Proximity Threshold (~15cm from camera)"
            >
              <Target
                className={`w-3.5 h-3.5 ${
                  currentMaxHandScale >= config.proximityThreshold
                    ? 'text-emerald-400'
                    : 'text-slate-400'
                }`}
              />
              Proximity:
            </span>
            <input
              type="range"
              min="0.10"
              max="0.30"
              step="0.01"
              value={config.proximityThreshold}
              onChange={(e) =>
                onConfigChange({
                  ...config,
                  proximityThreshold: parseFloat(e.target.value),
                })
              }
              className="w-18 h-1.5 bg-slate-700/90 rounded-lg appearance-none cursor-pointer accent-emerald-400"
              title={`Proximity Threshold: ${config.proximityThreshold.toFixed(2)} (~15cm)`}
            />
            <span
              className={`font-mono text-[10px] px-1 py-0.5 rounded ${
                currentMaxHandScale >= config.proximityThreshold
                  ? 'bg-emerald-500/20 text-emerald-300'
                  : 'text-slate-400'
              }`}
            >
              {config.proximityThreshold.toFixed(2)}
            </span>
          </div>

          <div className="w-[1px] h-4 bg-white/20" />

          {/* 4. Download Snapshot (PNG) */}
          <button
            type="button"
            onClick={handleSnapshotClick}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold text-white bg-sky-500/85 hover:bg-sky-500 active:scale-95 shadow-md shadow-sky-500/20 transition-all"
            title="Download Snapshot (PNG)"
          >
            <Download className="w-4 h-4" />
            <span>Snapshot</span>
          </button>

          <div className="w-[1px] h-4 bg-white/20" />

          {/* Extra options drawer toggle */}
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className={`p-1.5 rounded-full text-slate-300 hover:text-white hover:bg-white/15 transition-all ${
              isExpanded ? 'bg-white/20 text-white' : ''
            }`}
            title="More Options: Breath Re-Fog rate, passive speed & brush sizes"
          >
            {isExpanded ? <ChevronDown className="w-4 h-4" /> : <Sliders className="w-4 h-4" />}
          </button>

          {/* Fullscreen Toggle */}
          <button
            onClick={toggleFullscreen}
            className="p-1.5 rounded-full text-slate-300 hover:text-white hover:bg-white/15 transition-all"
            title={isFullscreen ? 'Exit Fullscreen' : 'Enter Fullscreen'}
          >
            {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </button>
        </div>
      </div>
    </>
  );
};
