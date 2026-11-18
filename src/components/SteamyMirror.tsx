import React, { useEffect, useRef, useState } from 'react';
import { ActiveBrushPoint, FogConfig, FaceBreathData } from '../types';
import {
  eraseFogDot,
  eraseFogBezier,
  eraseFogFeatheredDot,
  eraseFogFeatheredBezier,
  getCondensationPattern,
} from '../utils/condensation';

interface SteamyMirrorProps {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  fogCanvasRef?: React.RefObject<HTMLCanvasElement | null>;
  hands: ActiveBrushPoint[];
  faceData?: FaceBreathData;
  config: FogConfig;
  resetTrigger: number;
}

const STROKE_RELEASE_GRACE_FRAMES = 3;

interface ContinuousStrokeState {
  prevSmoothed: { x: number; y: number } | null;
  lastPoint: { x: number; y: number } | null;
  lastMidpoint: { x: number; y: number } | null;
  releaseGraceFrames: number;
}

interface VaporPuff {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  maxRadius: number;
  growthRate: number;
  opacity: number;
  fadeRate: number;
  rotation: number;
  angularVelocity: number;
  scaleX: number;
  scaleY: number;
}

// Render simulated bathroom backdrop when camera is not ready
export const drawSimulatedBackdrop = (
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number
) => {
  // 1. Warm bathroom ambient gradient
  const bgGrad = ctx.createLinearGradient(0, 0, 0, h);
  bgGrad.addColorStop(0, '#1e293b');
  bgGrad.addColorStop(0.4, '#334155');
  bgGrad.addColorStop(0.85, '#1e293b');
  bgGrad.addColorStop(1, '#0f172a');
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, w, h);

  // 2. Subtle bathroom tile grid lines
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
  ctx.lineWidth = 1;
  const tileSize = 60;
  for (let x = 0; x < w; x += tileSize) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
  }
  for (let y = 0; y < h; y += tileSize) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }

  // 3. Vanity mirror lights glow at top
  const lamp1 = ctx.createRadialGradient(w * 0.3, 40, 5, w * 0.3, 40, 160);
  lamp1.addColorStop(0, 'rgba(254, 243, 199, 0.45)');
  lamp1.addColorStop(0.5, 'rgba(253, 230, 138, 0.15)');
  lamp1.addColorStop(1, 'rgba(253, 230, 138, 0)');
  ctx.fillStyle = lamp1;
  ctx.fillRect(0, 0, w, h * 0.4);

  const lamp2 = ctx.createRadialGradient(w * 0.7, 40, 5, w * 0.7, 40, 160);
  lamp2.addColorStop(0, 'rgba(254, 243, 199, 0.45)');
  lamp2.addColorStop(0.5, 'rgba(253, 230, 138, 0.15)');
  lamp2.addColorStop(1, 'rgba(253, 230, 138, 0)');
  ctx.fillStyle = lamp2;
  ctx.fillRect(0, 0, w, h * 0.4);

  // 4. Subtle human reflection silhouette in mirror
  ctx.save();
  const silGrad = ctx.createRadialGradient(w * 0.5, h * 0.55, 20, w * 0.5, h * 0.55, w * 0.35);
  silGrad.addColorStop(0, 'rgba(15, 23, 42, 0.65)');
  silGrad.addColorStop(0.8, 'rgba(15, 23, 42, 0.25)');
  silGrad.addColorStop(1, 'rgba(15, 23, 42, 0)');
  ctx.fillStyle = silGrad;

  // Head
  ctx.beginPath();
  ctx.arc(w * 0.5, h * 0.44, Math.min(w, h) * 0.14, 0, Math.PI * 2);
  ctx.fill();

  // Shoulders
  ctx.beginPath();
  ctx.ellipse(w * 0.5, h * 0.78, Math.min(w, h) * 0.32, Math.min(w, h) * 0.26, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
};

export const SteamyMirror: React.FC<SteamyMirrorProps> = ({
  videoRef,
  fogCanvasRef: externalFogCanvasRef,
  hands,
  faceData,
  config,
  resetTrigger,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const internalFogCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const fogCanvasRef = externalFogCanvasRef ?? internalFogCanvasRef;
  const maskCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const cursorCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const [dimensions, setDimensions] = useState({
    width: window.innerWidth,
    height: window.innerHeight,
  });

  // Keep references for high-fps render loop without re-triggering rAF
  const handsRef = useRef<ActiveBrushPoint[]>(hands);
  handsRef.current = hands;

  const faceDataRef = useRef<FaceBreathData | undefined>(faceData);
  faceDataRef.current = faceData;

  const configRef = useRef<FogConfig>(config);
  configRef.current = config;

  // Auto-refog accumulator to prevent 8-bit canvas rounding to 0
  const refogAccumulatorRef = useRef<number>(0);

  // Offscreen buffer for pristine blurred mist texture
  const mistBufferCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const prevMouthScreenRef = useRef<{ x: number; y: number } | null>(null);

  // Stroke tracking per hand ID for continuous anti-aliased path interpolation
  const pinchStrokesRef = useRef<Map<number, ContinuousStrokeState>>(new Map());
  const fistStrokesRef = useRef<Map<number, ContinuousStrokeState>>(new Map());

  // Active swirling mist vapor puffs expanding from the mouth position
  const vaporPuffsRef = useRef<VaporPuff[]>([]);

  // Mouse / Touch interaction fallback state
  const isPointerDownRef = useRef(false);
  const pointerStrokeRef = useRef<ContinuousStrokeState>({
    prevSmoothed: null,
    lastPoint: null,
    lastMidpoint: null,
    releaseGraceFrames: 0,
  });

  // Handle window resize
  useEffect(() => {
    const handleResize = () => {
      setDimensions({ width: window.innerWidth, height: window.innerHeight });
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Initialize and resize canvases
  useEffect(() => {
    const { width, height } = dimensions;
    if (width === 0 || height === 0) return;

    const fogCanvas = fogCanvasRef.current;
    const maskCanvas = maskCanvasRef.current;
    const cursorCanvas = cursorCanvasRef.current;

    if (fogCanvas && maskCanvas && cursorCanvas) {
      // Save existing mask content before resize
      const prevMask = document.createElement('canvas');
      prevMask.width = maskCanvas.width;
      prevMask.height = maskCanvas.height;
      const prevCtx = prevMask.getContext('2d');
      if (prevCtx && maskCanvas.width > 0 && maskCanvas.height > 0) {
        prevCtx.drawImage(maskCanvas, 0, 0);
      }

      fogCanvas.width = width;
      fogCanvas.height = height;
      maskCanvas.width = width;
      maskCanvas.height = height;
      cursorCanvas.width = width;
      cursorCanvas.height = height;

      const mctx = maskCanvas.getContext('2d');
      if (mctx) {
        if (prevMask.width > 0 && prevMask.height > 0) {
          // Re-apply preserved mask on resize
          mctx.fillStyle = '#ffffff';
          mctx.fillRect(0, 0, width, height);
          mctx.drawImage(prevMask, 0, 0, width, height);
        } else {
          // Initial full white mask (100% steam fog)
          mctx.fillStyle = '#ffffff';
          mctx.fillRect(0, 0, width, height);
        }
      }
    }
  }, [dimensions]);

  // Reset Fog action
  useEffect(() => {
    if (resetTrigger === 0) return;
    const maskCanvas = maskCanvasRef.current;
    if (!maskCanvas) return;
    const mctx = maskCanvas.getContext('2d');
    if (!mctx) return;

    mctx.save();
    mctx.globalCompositeOperation = 'source-over';
    mctx.fillStyle = '#ffffff';
    mctx.fillRect(0, 0, maskCanvas.width, maskCanvas.height);
    mctx.restore();

    // Reset stroke states and vapor puffs
    pinchStrokesRef.current.clear();
    fistStrokesRef.current.clear();
    vaporPuffsRef.current = [];
    prevMouthScreenRef.current = null;
  }, [resetTrigger]);

  // Handle Hand Tracking Gestures: Pinch-to-Draw with EMA filter, 3-frame grace buffer & quadratic Bezier curve interpolation
  useEffect(() => {
    const maskCanvas = maskCanvasRef.current;
    if (!maskCanvas) return;
    const mctx = maskCanvas.getContext('2d');
    if (!mctx) return;

    const currentHandIds = new Set(hands.map((h) => h.id));

    // Apply 3-frame release grace buffer to any hand strokes that temporarily left the frame
    for (const [id, stroke] of pinchStrokesRef.current.entries()) {
      if (!currentHandIds.has(id)) {
        stroke.releaseGraceFrames += 1;
        if (stroke.releaseGraceFrames > STROKE_RELEASE_GRACE_FRAMES) {
          if (stroke.lastMidpoint && stroke.lastPoint) {
            eraseFogBezier(
              mctx,
              stroke.lastMidpoint.x,
              stroke.lastMidpoint.y,
              stroke.lastPoint.x,
              stroke.lastPoint.y,
              stroke.lastPoint.x,
              stroke.lastPoint.y,
              config.fingerRadius
            );
          }
          pinchStrokesRef.current.delete(id);
        }
      }
    }
    for (const [id, stroke] of fistStrokesRef.current.entries()) {
      if (!currentHandIds.has(id)) {
        stroke.releaseGraceFrames += 1;
        if (stroke.releaseGraceFrames > STROKE_RELEASE_GRACE_FRAMES) {
          fistStrokesRef.current.delete(id);
        }
      }
    }

    hands.forEach((hand) => {
      // 1. PINCH-TO-DRAW RENDERING LOGIC:
      // Hysteresis thresholds (< 0.06 start, > 0.085 release + 3-frame grace buffer)
      if (hand.gesture === 'pinch' && hand.isNear) {
        // Reset fist stroke if switching to pinch
        fistStrokesRef.current.delete(hand.id);

        let stroke = pinchStrokesRef.current.get(hand.id);
        if (!stroke) {
          stroke = {
            prevSmoothed: null,
            lastPoint: null,
            lastMidpoint: null,
            releaseGraceFrames: 0,
          };
          pinchStrokesRef.current.set(hand.id, stroke);
        } else {
          stroke.releaseGraceFrames = 0;
        }

        // 1. Coordinate Smoothing (EMA Filter): Smooth consecutive coordinates without lag
        const alpha = 0.45;
        const currentRawX = hand.x;
        const currentRawY = hand.y;

        let smoothedX: number;
        let smoothedY: number;

        if (stroke.prevSmoothed === null) {
          // First frame of pinch: initialize EMA to current coordinates
          smoothedX = currentRawX;
          smoothedY = currentRawY;
        } else {
          // Eliminate webcam tracking jitter via EMA filter
          smoothedX = stroke.prevSmoothed.x * (1 - alpha) + currentRawX * alpha;
          smoothedY = stroke.prevSmoothed.y * (1 - alpha) + currentRawY * alpha;
        }
        stroke.prevSmoothed = { x: smoothedX, y: smoothedY };

        // 2. Quadratic Bezier Curve Interpolation:
        // Connect consecutive smoothed coordinates using midpoints and quadraticCurveTo
        // with lineCap = 'round', lineJoin = 'round', and globalCompositeOperation = 'destination-out'.
        const radius = config.fingerRadius;

        if (stroke.lastPoint === null || stroke.lastMidpoint === null) {
          // Initial point of the pinch: draw crisp anti-aliased round cap
          eraseFogDot(mctx, smoothedX, smoothedY, radius);
          stroke.lastPoint = { x: smoothedX, y: smoothedY };
          stroke.lastMidpoint = { x: smoothedX, y: smoothedY };
        } else {
          // Compute midpoint between previous smoothed point and current smoothed point
          const midX = (stroke.lastPoint.x + smoothedX) * 0.5;
          const midY = (stroke.lastPoint.y + smoothedY) * 0.5;

          eraseFogBezier(
            mctx,
            stroke.lastMidpoint.x,
            stroke.lastMidpoint.y,
            stroke.lastPoint.x,
            stroke.lastPoint.y,
            midX,
            midY,
            radius
          );

          stroke.lastPoint = { x: smoothedX, y: smoothedY };
          stroke.lastMidpoint = { x: midX, y: midY };
        }
      } else {
        // Apply 3-frame release grace buffer before terminating the pinch stroke
        const existingStroke = pinchStrokesRef.current.get(hand.id);
        if (existingStroke) {
          existingStroke.releaseGraceFrames += 1;
          if (existingStroke.releaseGraceFrames > STROKE_RELEASE_GRACE_FRAMES) {
            if (existingStroke.lastMidpoint && existingStroke.lastPoint) {
              eraseFogBezier(
                mctx,
                existingStroke.lastMidpoint.x,
                existingStroke.lastMidpoint.y,
                existingStroke.lastPoint.x,
                existingStroke.lastPoint.y,
                existingStroke.lastPoint.x,
                existingStroke.lastPoint.y,
                config.fingerRadius
              );
            }
            pinchStrokesRef.current.delete(hand.id);
          }
        }
      }

      // 2. CLOSED-FIST WIPE:
      // Condition: fist gesture active (fingertips curled below PIPs) and within proximity
      if (hand.gesture === 'fist' && hand.isNear) {
        let stroke = fistStrokesRef.current.get(hand.id);
        if (!stroke) {
          stroke = {
            prevSmoothed: null,
            lastPoint: null,
            lastMidpoint: null,
            releaseGraceFrames: 0,
          };
          fistStrokesRef.current.set(hand.id, stroke);
        } else {
          stroke.releaseGraceFrames = 0;
        }

        // Smooth fist center (landmark 9)
        const alpha = 0.45;
        const smoothedX =
          stroke.prevSmoothed === null
            ? hand.x
            : stroke.prevSmoothed.x * (1 - alpha) + hand.x * alpha;
        const smoothedY =
          stroke.prevSmoothed === null
            ? hand.y
            : stroke.prevSmoothed.y * (1 - alpha) + hand.y * alpha;
        stroke.prevSmoothed = { x: smoothedX, y: smoothedY };

        const radius = config.palmRadius;

        if (stroke.lastPoint === null || stroke.lastMidpoint === null) {
          eraseFogFeatheredDot(mctx, smoothedX, smoothedY, radius);
          stroke.lastPoint = { x: smoothedX, y: smoothedY };
          stroke.lastMidpoint = { x: smoothedX, y: smoothedY };
        } else {
          const midX = (stroke.lastPoint.x + smoothedX) * 0.5;
          const midY = (stroke.lastPoint.y + smoothedY) * 0.5;

          eraseFogFeatheredBezier(
            mctx,
            stroke.lastMidpoint.x,
            stroke.lastMidpoint.y,
            stroke.lastPoint.x,
            stroke.lastPoint.y,
            midX,
            midY,
            radius
          );

          stroke.lastPoint = { x: smoothedX, y: smoothedY };
          stroke.lastMidpoint = { x: midX, y: midY };
        }
      } else {
        const existingFist = fistStrokesRef.current.get(hand.id);
        if (existingFist) {
          existingFist.releaseGraceFrames += 1;
          if (existingFist.releaseGraceFrames > STROKE_RELEASE_GRACE_FRAMES) {
            fistStrokesRef.current.delete(hand.id);
          }
        }
      }
    });
  }, [hands, config.fingerRadius, config.palmRadius]);

  // Pointer / Mouse / Touch interaction fallback (quadratic Bezier curve interpolation)
  const handlePointerDown = (e: React.PointerEvent) => {
    isPointerDownRef.current = true;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const maskCanvas = maskCanvasRef.current;
    if (!maskCanvas) return;
    const mctx = maskCanvas.getContext('2d');
    if (!mctx) return;

    const isWipe = e.shiftKey || e.button === 2;
    const radius = isWipe ? config.palmRadius : config.fingerRadius;

    if (isWipe) {
      eraseFogFeatheredDot(mctx, x, y, radius);
    } else {
      eraseFogDot(mctx, x, y, radius);
    }

    pointerStrokeRef.current = {
      prevSmoothed: { x, y },
      lastPoint: { x, y },
      lastMidpoint: { x, y },
      releaseGraceFrames: 0,
    };
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isPointerDownRef.current) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const rawX = e.clientX - rect.left;
    const rawY = e.clientY - rect.top;

    const maskCanvas = maskCanvasRef.current;
    if (!maskCanvas) return;
    const mctx = maskCanvas.getContext('2d');
    if (!mctx) return;

    const isWipe = e.shiftKey;
    const radius = isWipe ? config.palmRadius : config.fingerRadius;

    const stroke = pointerStrokeRef.current;
    const alpha = 0.55;
    const smoothedX = stroke.prevSmoothed
      ? stroke.prevSmoothed.x * (1 - alpha) + rawX * alpha
      : rawX;
    const smoothedY = stroke.prevSmoothed
      ? stroke.prevSmoothed.y * (1 - alpha) + rawY * alpha
      : rawY;
    stroke.prevSmoothed = { x: smoothedX, y: smoothedY };

    if (stroke.lastPoint && stroke.lastMidpoint) {
      const midX = (stroke.lastPoint.x + smoothedX) * 0.5;
      const midY = (stroke.lastPoint.y + smoothedY) * 0.5;

      if (isWipe) {
        eraseFogFeatheredBezier(
          mctx,
          stroke.lastMidpoint.x,
          stroke.lastMidpoint.y,
          stroke.lastPoint.x,
          stroke.lastPoint.y,
          midX,
          midY,
          radius
        );
      } else {
        eraseFogBezier(
          mctx,
          stroke.lastMidpoint.x,
          stroke.lastMidpoint.y,
          stroke.lastPoint.x,
          stroke.lastPoint.y,
          midX,
          midY,
          radius
        );
      }

      stroke.lastPoint = { x: smoothedX, y: smoothedY };
      stroke.lastMidpoint = { x: midX, y: midY };
    } else {
      if (isWipe) {
        eraseFogFeatheredDot(mctx, smoothedX, smoothedY, radius);
      } else {
        eraseFogDot(mctx, smoothedX, smoothedY, radius);
      }
      stroke.lastPoint = { x: smoothedX, y: smoothedY };
      stroke.lastMidpoint = { x: smoothedX, y: smoothedY };
    }
  };

  const handlePointerUp = () => {
    isPointerDownRef.current = false;
    pointerStrokeRef.current = {
      prevSmoothed: null,
      lastPoint: null,
      lastMidpoint: null,
      releaseGraceFrames: 0,
    };
  };

  // Main Rendering, Fog Composition & Breath Re-Fog Loop
  useEffect(() => {
    let animId: number;
    let lastTime = performance.now();

    const render = (time: number) => {
      const dt = Math.min((time - lastTime) / 1000, 0.1);
      lastTime = time;

      const fogCanvas = fogCanvasRef.current;
      const maskCanvas = maskCanvasRef.current;
      const cursorCanvas = cursorCanvasRef.current;
      const video = videoRef.current;
      const currentConfig = configRef.current;
      const currentFace = faceDataRef.current;

      if (fogCanvas && maskCanvas && fogCanvas.width > 0 && fogCanvas.height > 0) {
        const fctx = fogCanvas.getContext('2d');
        const mctx = maskCanvas.getContext('2d');

        if (fctx && mctx) {
          const w = fogCanvas.width;
          const h = fogCanvas.height;

          // Aspect ratio calculation to cover canvas while preserving video aspect
          const videoW = (video && video.videoWidth) || 640;
          const videoH = (video && video.videoHeight) || 480;
          const srcRatio = videoW / videoH;
          const destRatio = w / h;

          let renderW = w;
          let renderH = h;
          let offsetX = 0;
          let offsetY = 0;

          if (destRatio > srcRatio) {
            renderW = w;
            renderH = w / srcRatio;
            offsetY = (h - renderH) / 2;
          } else {
            renderH = h;
            renderW = h * srcRatio;
            offsetX = (w - renderW) / 2;
          }

          // Offscreen mist buffer: pristine blurred mirror feed + mist tint + static condensation
          let mistBuffer = mistBufferCanvasRef.current;
          if (!mistBuffer) {
            mistBuffer = document.createElement('canvas');
            mistBufferCanvasRef.current = mistBuffer;
          }
          if (mistBuffer.width !== w || mistBuffer.height !== h) {
            mistBuffer.width = w;
            mistBuffer.height = h;
          }
          const mbctx = mistBuffer.getContext('2d');
          if (mbctx) {
            mbctx.clearRect(0, 0, w, h);

            // 1. Render webcam feed with exact blur(18px)
            if (video && video.readyState >= 2) {
              mbctx.save();
              mbctx.filter = `blur(${currentConfig.blurAmount}px) brightness(1.06) saturate(0.92)`;
              mbctx.scale(-1, 1);
              mbctx.drawImage(video, -offsetX - renderW, offsetY, renderW, renderH);
              mbctx.restore();
            } else {
              mbctx.save();
              mbctx.filter = `blur(${currentConfig.blurAmount}px)`;
              drawSimulatedBackdrop(mbctx, w, h);
              mbctx.restore();
            }

            // 2. Overlay translucent white mist tint
            mbctx.save();
            const mistAlpha = 0.52 * currentConfig.density;
            mbctx.fillStyle = `rgba(240, 246, 255, ${mistAlpha})`;
            mbctx.fillRect(0, 0, w, h);

            // 3. Completely static condensation texture & micro-droplets pattern
            if (currentConfig.condensationDetail) {
              const pattern = getCondensationPattern(mbctx);
              if (pattern) {
                mbctx.globalAlpha = 0.38 * currentConfig.density;
                mbctx.fillStyle = pattern;
                mbctx.fillRect(0, 0, w, h);
                mbctx.globalAlpha = 1.0;
              }
            }
            mbctx.restore();
          }

          // Compute mirrored mouth coordinates matching scale-x-[-1] video
          let mouthX = currentFace?.mouthX ?? w * 0.5;
          let mouthY = currentFace?.mouthY ?? h * 0.55;

          if (
            currentFace &&
            currentFace.isDetected &&
            currentFace.rawMouthX !== undefined &&
            currentFace.rawMouthY !== undefined
          ) {
            // Mirrored X coordinate: (1 - rawMouthX) matches the scale-x-[-1] video
            const targetMouthX = offsetX + (1 - currentFace.rawMouthX) * renderW;
            const targetMouthY = offsetY + currentFace.rawMouthY * renderH;

            if (prevMouthScreenRef.current) {
              mouthX = prevMouthScreenRef.current.x * 0.65 + targetMouthX * 0.35;
              mouthY = prevMouthScreenRef.current.y * 0.65 + targetMouthY * 0.35;
            } else {
              mouthX = targetMouthX;
              mouthY = targetMouthY;
            }
            prevMouthScreenRef.current = { x: mouthX, y: mouthY };
          } else if (currentFace?.isDetected && prevMouthScreenRef.current) {
            mouthX = prevMouthScreenRef.current.x;
            mouthY = prevMouthScreenRef.current.y;
          } else {
            prevMouthScreenRef.current = null;
          }

          // 1. Mouth-Open Breath Re-Fogging:
          // Restore fog around the mirrored mouth coordinates (13/14 midpoint) by restoring the fog mask
          // with globalCompositeOperation = 'source-over' using a large (320px), high-opacity (alpha = 0.25 per frame)
          // multi-stop radial gradient mask so erased lines re-fog rapidly and naturally.
          if (currentConfig.breathReFog && currentFace && currentFace.isMouthOpen) {
            const openStrength = Math.max(0.7, Math.min(1.2, (currentFace.mouthOpenAmount || 0.4) / 0.45));
            const applyAlpha = 0.25 * openStrength;
            const breathRadius = 320;

            mctx.save();
            mctx.globalCompositeOperation = 'source-over';

            const breathGrad = mctx.createRadialGradient(
              mouthX,
              mouthY,
              0,
              mouthX,
              mouthY,
              breathRadius
            );
            // Multi-stop feathered mist brush: denser in center, seamlessly fades to transparent at edges
            breathGrad.addColorStop(0.0, `rgba(255, 255, 255, ${(applyAlpha * 1.0).toFixed(4)})`);
            breathGrad.addColorStop(0.25, `rgba(255, 255, 255, ${(applyAlpha * 0.88).toFixed(4)})`);
            breathGrad.addColorStop(0.5, `rgba(255, 255, 255, ${(applyAlpha * 0.60).toFixed(4)})`);
            breathGrad.addColorStop(0.72, `rgba(255, 255, 255, ${(applyAlpha * 0.30).toFixed(4)})`);
            breathGrad.addColorStop(0.88, `rgba(255, 255, 255, ${(applyAlpha * 0.10).toFixed(4)})`);
            breathGrad.addColorStop(1.0, 'rgba(255, 255, 255, 0)');

            mctx.fillStyle = breathGrad;
            mctx.beginPath();
            mctx.arc(mouthX, mouthY, breathRadius, 0, Math.PI * 2);
            mctx.fill();
            mctx.restore();

            // Spawn subtle swirling mist vapor puffs expanding outward from the mirrored mouth position
            const puffCount = Math.random() < 0.45 ? 1 : 0;
            for (let i = 0; i < puffCount; i++) {
              const spreadAngle = (Math.random() - 0.5) * Math.PI * 0.75;
              const speed = 0.8 + Math.random() * 1.5;
              const offsetDist = Math.random() * 14;
              const offsetAngle = Math.random() * Math.PI * 2;

              vaporPuffsRef.current.push({
                x: mouthX + Math.cos(offsetAngle) * offsetDist,
                y: mouthY + Math.sin(offsetAngle) * offsetDist * 0.5,
                vx: Math.sin(spreadAngle) * speed * 0.85 + (Math.random() - 0.5) * 0.35,
                vy: -0.55 - Math.cos(spreadAngle) * speed * 0.7, // warm vapor rises upward from lips
                radius: 22 + Math.random() * 18,
                maxRadius: 110 + Math.random() * 80 * openStrength,
                growthRate: 1.4 + Math.random() * 1.6,
                opacity: 0.14 + Math.random() * 0.08,
                fadeRate: 0.0045 + Math.random() * 0.0035,
                rotation: Math.random() * Math.PI * 2,
                angularVelocity: (Math.random() - 0.5) * 0.04,
                scaleX: 0.9 + Math.random() * 0.25,
                scaleY: 0.8 + Math.random() * 0.3,
              });
            }

            if (vaporPuffsRef.current.length > 70) {
              vaporPuffsRef.current.splice(0, vaporPuffsRef.current.length - 70);
            }
          }

          // 2. Slow Passive Auto-Refog: gradual fog opacity regeneration
          if (currentConfig.autoRefog && currentConfig.autoRefogSpeed > 0) {
            refogAccumulatorRef.current += currentConfig.autoRefogSpeed * dt;
            if (refogAccumulatorRef.current >= 0.0039) {
              const applyAlpha = Math.min(0.04, refogAccumulatorRef.current);
              refogAccumulatorRef.current -= applyAlpha;

              mctx.save();
              mctx.globalCompositeOperation = 'source-over';
              mctx.fillStyle = `rgba(255, 255, 255, ${applyAlpha.toFixed(4)})`;
              mctx.fillRect(0, 0, w, h);
              mctx.restore();
            }
          }

          // 3. Clear fog canvas
          fctx.clearRect(0, 0, w, h);

          // 4. Draw blurred mist buffer and apply erased mask with destination-in
          if (mistBuffer) {
            fctx.drawImage(mistBuffer, 0, 0);
            fctx.globalCompositeOperation = 'destination-in';
            fctx.drawImage(maskCanvas, 0, 0);
            fctx.globalCompositeOperation = 'source-over';
          }
        }
      }

      // 5. Visible Breath Vapor Puff Effect on temporary overlay canvas:
      // Subtle, semi-transparent swirling mist particles expanding outward from the mouth position,
      // fading out smoothly when the mouth closes. Keep all status text/badges hidden.
      if (cursorCanvas) {
        const cctx = cursorCanvas.getContext('2d');
        if (cctx) {
          cctx.clearRect(0, 0, cursorCanvas.width, cursorCanvas.height);

          if (vaporPuffsRef.current.length > 0) {
            cctx.save();
            vaporPuffsRef.current.forEach((puff) => {
              puff.x += puff.vx * (dt * 60);
              puff.y += puff.vy * (dt * 60);
              puff.radius += puff.growthRate * (dt * 60);
              puff.rotation += puff.angularVelocity * (dt * 60);
              puff.opacity -= puff.fadeRate * (dt * 60);

              puff.vx *= 0.985;
              puff.vy -= 0.015; // gentle thermal lift

              if (puff.opacity > 0.005) {
                cctx.save();
                cctx.translate(puff.x, puff.y);
                cctx.rotate(puff.rotation);
                cctx.scale(puff.scaleX, puff.scaleY);

                const puffGrad = cctx.createRadialGradient(
                  0, 0, 0,
                  0, 0, puff.radius
                );
                puffGrad.addColorStop(0.0, `rgba(255, 255, 255, ${(puff.opacity * 0.45).toFixed(3)})`);
                puffGrad.addColorStop(0.25, `rgba(245, 250, 255, ${(puff.opacity * 0.32).toFixed(3)})`);
                puffGrad.addColorStop(0.55, `rgba(235, 245, 255, ${(puff.opacity * 0.16).toFixed(3)})`);
                puffGrad.addColorStop(0.8, `rgba(220, 240, 255, ${(puff.opacity * 0.05).toFixed(3)})`);
                puffGrad.addColorStop(1.0, 'rgba(210, 235, 255, 0)');

                cctx.fillStyle = puffGrad;
                cctx.beginPath();
                cctx.arc(0, 0, puff.radius, 0, Math.PI * 2);
                cctx.fill();
                cctx.restore();
              }
            });
            cctx.restore();

            // Smoothly remove fully faded or over-expanded puffs
            vaporPuffsRef.current = vaporPuffsRef.current.filter(
              (puff) => puff.opacity > 0.005 && puff.radius < puff.maxRadius * 1.5
            );
          }
        }
      }

      animId = requestAnimationFrame(render);
    };

    animId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(animId);
  }, [videoRef, fogCanvasRef]);

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 w-full h-full overflow-hidden bg-slate-950 cursor-default select-none"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onContextMenu={(e) => e.preventDefault()}
    >
      {/* 1. Mirrored live webcam feed fullscreen */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className="absolute inset-0 w-full h-full object-cover scale-x-[-1] pointer-events-none"
      />

      {/* 2. Hidden In-Memory Mask Canvas (erased with destination-out) */}
      <canvas ref={maskCanvasRef} className="hidden" />

      {/* 3. Visible Fog Canvas (Webcam with blur(18px) + mist tint + static condensation grain, masked) */}
      <canvas
        ref={fogCanvasRef}
        className="absolute inset-0 w-full h-full pointer-events-none"
        style={{
          opacity: Math.max(0.2, config.density),
          transition: 'opacity 0.2s ease-out',
        }}
      />

      {/* 4. Real-time Cursor, Depth Gauge, & Breath Overlay */}
      <canvas ref={cursorCanvasRef} className="absolute inset-0 w-full h-full pointer-events-none" />
    </div>
  );
};
