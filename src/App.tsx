import React, { useRef, useState, useEffect, useCallback } from 'react';
import { SteamyMirror, drawSimulatedBackdrop } from './components/SteamyMirror';
import { FloatingControls } from './components/FloatingControls';
import { useHandTracking } from './hooks/useHandTracking';
import { FogConfig } from './types';
import { CameraOff } from 'lucide-react';

export const App: React.FC = () => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const fogCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const isDownloadingRef = useRef<boolean>(false);

  // Configuration state: Proximity threshold & Mouth-open Breath Re-Fog
  const [config, setConfig] = useState<FogConfig>({
    density: 0.90,
    blurAmount: 18, // Exact 18px blur as required
    autoRefog: true,
    autoRefogSpeed: 0.008,
    fingerRadius: 8, // Small drawing brush for pinch-to-draw
    palmRadius: 70,   // Large wiping brush for closed-fist wipe
    condensationDetail: true,
    proximityThreshold: 0.18, // Normalized distance (~15cm from camera)
    breathReFog: true,        // Mouth-open breath re-fog (jawOpen > 0.25)
    breathReFogSpeed: 0.24,   // Rapid condensation speed when mouth is open
  });

  // Action triggers
  const [resetTrigger, setResetTrigger] = useState(0);
  const [shutterFlash, setShutterFlash] = useState(false);

  // Camera & permission state
  const [hasCamera, setHasCamera] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [windowDimensions, setWindowDimensions] = useState({
    width: window.innerWidth,
    height: window.innerHeight,
  });

  // Keep window dimensions updated
  useEffect(() => {
    const handleResize = () => {
      setWindowDimensions({ width: window.innerWidth, height: window.innerHeight });
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Request Webcam Feed
  const startCamera = useCallback(async () => {
    setCameraError(null);
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('Camera API is not supported on this browser or context.');
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1920, min: 640 },
          height: { ideal: 1080, min: 480 },
          facingMode: 'user',
        },
        audio: false,
      });

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setHasCamera(true);
    } catch (err: any) {
      console.warn('Camera access denied or unavailable:', err);
      setCameraError(err?.message || 'Could not access camera feed.');
      setHasCamera(false);
    }
  }, []);

  // Start camera on mount
  useEffect(() => {
    startCamera();

    return () => {
      if (videoRef.current && videoRef.current.srcObject) {
        const stream = videoRef.current.srcObject as MediaStream;
        stream.getTracks().forEach((track) => track.stop());
      }
    };
  }, [startCamera]);

  // Hook for MediaPipe Hand & Face Tracking
  const {
    isReady: isModelReady,
    isFaceReady,
    error: modelError,
    detectedHands,
    faceData,
    currentMaxHandScale,
    fps,
  } = useHandTracking({
    videoRef,
    canvasWidth: windowDimensions.width,
    canvasHeight: windowDimensions.height,
    fingerRadius: config.fingerRadius,
    palmRadius: config.palmRadius,
    proximityThreshold: config.proximityThreshold,
  });

  // Handle Snapshot download strictly once inside the button's onClick handler
  const handleDownloadSnapshot = useCallback(() => {
    if (isDownloadingRef.current) return;
    isDownloadingRef.current = true;

    setShutterFlash(true);
    setTimeout(() => setShutterFlash(false), 250);

    try {
      const fogCanvas = fogCanvasRef.current;
      const video = videoRef.current;
      const width = fogCanvas?.width || window.innerWidth;
      const height = fogCanvas?.height || window.innerHeight;

      const snapCanvas = document.createElement('canvas');
      snapCanvas.width = width;
      snapCanvas.height = height;
      const sctx = snapCanvas.getContext('2d');

      if (sctx && fogCanvas) {
        // 1. Draw clear mirrored video background
        if (video && video.readyState >= 2) {
          const videoW = video.videoWidth || 640;
          const videoH = video.videoHeight || 480;
          const srcRatio = videoW / videoH;
          const destRatio = width / height;

          let renderW = width;
          let renderH = height;
          let offsetX = 0;
          let offsetY = 0;

          if (destRatio > srcRatio) {
            renderW = width;
            renderH = width / srcRatio;
            offsetY = (height - renderH) / 2;
          } else {
            renderH = height;
            renderW = height * srcRatio;
            offsetX = (width - renderW) / 2;
          }

          sctx.save();
          sctx.scale(-1, 1);
          sctx.drawImage(video, -offsetX - renderW, offsetY, renderW, renderH);
          sctx.restore();
        } else {
          drawSimulatedBackdrop(sctx, width, height);
        }

        // 2. Draw composite fog canvas with crisp erased areas on top
        sctx.drawImage(fogCanvas, 0, 0);

        // 3. Watermark
        sctx.font = '500 13px system-ui, sans-serif';
        sctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
        sctx.textAlign = 'right';
        sctx.fillText('Steamy Bathroom Mirror • Hand & Breath Tracking', width - 24, height - 20);

        // Convert canvas to PNG Blob & Object URL synchronously for single download
        const dataUrl = snapCanvas.toDataURL('image/png');
        const parts = dataUrl.split(',');
        const mimeMatch = parts[0].match(/:(.*?);/);
        const mime = mimeMatch ? mimeMatch[1] : 'image/png';
        const byteString = atob(parts[1]);
        const ab = new ArrayBuffer(byteString.length);
        const ia = new Uint8Array(ab);
        for (let i = 0; i < byteString.length; i++) {
          ia[i] = byteString.charCodeAt(i);
        }
        const blob = new Blob([ab], { type: mime });
        const objectUrl = URL.createObjectURL(blob);

        const link = document.createElement('a');
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        link.download = `steamy-mirror-${timestamp}.png`;
        link.href = objectUrl;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(objectUrl);
      }
    } finally {
      setTimeout(() => {
        isDownloadingRef.current = false;
      }, 800);
    }
  }, []);

  const handleResetFog = () => {
    setResetTrigger((prev) => prev + 1);
  };

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-black select-none font-sans">
      {/* Steamy Mirror Canvas Engine */}
      <SteamyMirror
        videoRef={videoRef}
        fogCanvasRef={fogCanvasRef}
        hands={detectedHands}
        faceData={faceData}
        config={config}
        resetTrigger={resetTrigger}
      />

      {/* Camera permission prompt fallback if denied */}
      {!hasCamera && (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center p-6 bg-slate-950/80 backdrop-blur-md text-white text-center">
          <div className="w-16 h-16 rounded-3xl bg-slate-800/80 border border-white/10 flex items-center justify-center mb-4 text-sky-400 shadow-2xl">
            <CameraOff className="w-8 h-8" />
          </div>
          <h2 className="text-2xl font-bold tracking-tight mb-2 text-white">
            Camera Permission Required
          </h2>
          <p className="max-w-md text-slate-300 text-sm mb-6 leading-relaxed">
            Allow camera access to turn your screen into a steamy bathroom mirror with hand wiping and breath re-fog tracking.
          </p>
          <div className="flex items-center gap-3">
            <button
              onClick={startCamera}
              className="px-6 py-2.5 rounded-full font-semibold text-sm bg-sky-500 hover:bg-sky-400 active:scale-95 text-white shadow-xl shadow-sky-500/25 transition-all"
            >
              Allow Camera
            </button>
            <button
              onClick={() => setHasCamera(true)}
              className="px-4 py-2.5 rounded-full font-semibold text-xs text-slate-400 hover:text-white hover:bg-white/10 transition-all"
            >
              Continue in Demo / Mouse Mode
            </button>
          </div>
          {cameraError && (
            <p className="mt-4 text-xs text-rose-400/90 font-mono bg-rose-500/10 px-3 py-1.5 rounded-lg border border-rose-500/20">
              {cameraError}
            </p>
          )}
        </div>
      )}

      {/* Floating Controls */}
      <FloatingControls
        config={config}
        onConfigChange={setConfig}
        onResetFog={handleResetFog}
        onDownloadSnapshot={handleDownloadSnapshot}
        hands={detectedHands}
        faceData={faceData}
        currentMaxHandScale={currentMaxHandScale}
        fps={fps}
        isHandTrackerReady={isModelReady}
        isFaceTrackerReady={isFaceReady}
        handTrackerError={modelError}
        hasCamera={hasCamera}
        onRequestCamera={startCamera}
      />

      {/* Camera Shutter Flash Animation */}
      {shutterFlash && (
        <div className="fixed inset-0 z-50 bg-white pointer-events-none animate-shutter-flash" />
      )}
    </div>
  );
};
