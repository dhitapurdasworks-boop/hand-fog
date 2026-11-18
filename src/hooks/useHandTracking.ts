import { useEffect, useRef, useState, useCallback } from 'react';
import {
  FilesetResolver,
  HandLandmarker,
  FaceLandmarker,
  NormalizedLandmark,
  FaceLandmarkerResult,
} from '@mediapipe/tasks-vision';
import { ActiveBrushPoint, HandGesture, FaceBreathData } from '../types';

interface UseHandTrackingOptions {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  canvasWidth: number;
  canvasHeight: number;
  fingerRadius?: number;
  palmRadius?: number;
  proximityThreshold?: number; // default ~0.18 (~15cm from camera)
  onHandsDetected?: (hands: ActiveBrushPoint[]) => void;
  onFaceBreathDetected?: (faceData: FaceBreathData) => void;
}

// Pinch hysteresis & grace buffer constants to prevent mid-stroke breaks
const PINCH_START_THRESHOLD = 0.06;
const PINCH_RELEASE_THRESHOLD = 0.085;
const PINCH_RELEASE_GRACE_FRAMES = 3;
const FACE_DETECTION_INTERVAL = 3; // Run FaceLandmarker every 3rd rAF frame

interface HandPinchState {
  isPinching: boolean;
  releaseGraceFrames: number;
  nearGraceFrames: number;
  missingFrames: number;
  wasNear: boolean;
}

// Distance helper between 2 landmarks in 3D
function dist3D(a: NormalizedLandmark, b: NormalizedLandmark): number {
  return Math.hypot(a.x - b.x, a.y - b.y, (a.z || 0) - (b.z || 0));
}

export function useHandTracking({
  videoRef,
  canvasWidth,
  canvasHeight,
  fingerRadius = 18,
  palmRadius = 90,
  proximityThreshold = 0.18,
  onHandsDetected,
  onFaceBreathDetected,
}: UseHandTrackingOptions) {
  const [isLoading, setIsLoading] = useState(true);
  const [isReady, setIsReady] = useState(false);
  const [isFaceReady, setIsFaceReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [detectedHands, setDetectedHands] = useState<ActiveBrushPoint[]>([]);
  const [faceData, setFaceData] = useState<FaceBreathData>({
    isDetected: false,
    isMouthOpen: false,
    mouthOpenAmount: 0,
    mouthX: 0,
    mouthY: 0,
  });
  const [currentMaxHandScale, setCurrentMaxHandScale] = useState<number>(0);
  const [fps, setFps] = useState(0);

  const handLandmarkerRef = useRef<HandLandmarker | null>(null);
  const faceLandmarkerRef = useRef<FaceLandmarker | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const lastTimestampRef = useRef<number>(0);
  const detectionTickRef = useRef<number>(0);
  const prevPositionsRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinchStateRef = useRef<Map<number, HandPinchState>>(new Map());
  const prevMouthRef = useRef<{ x: number; y: number } | null>(null);

  // Proximity threshold ref for access inside loop without restarting rAF
  const proximityThresholdRef = useRef(proximityThreshold);
  proximityThresholdRef.current = proximityThreshold;

  // FPS calculation
  const frameCountRef = useRef(0);
  const lastFpsTimeRef = useRef(performance.now());

  // Initialize MediaPipe HandLandmarker and FaceLandmarker
  useEffect(() => {
    let isCancelled = false;

    async function initVisionModels() {
      try {
        setIsLoading(true);
        setError(null);

        // 1. Resolve WASM assets (local files in /wasm first, fallback to CDN)
        let fileset;
        const baseUrl = (import.meta.env.BASE_URL || '/').replace(/\/$/, '');
        const localWasmPath = `${window.location.origin}${baseUrl}/wasm`;
        try {
          fileset = await FilesetResolver.forVisionTasks(localWasmPath);
        } catch (localWasmErr) {
          console.warn('Local WASM fileset failed, falling back to CDN...', localWasmErr);
          fileset = await FilesetResolver.forVisionTasks(
            'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.3/wasm'
          );
        }

        if (isCancelled) return;

        // Model paths
        const localHandModelPath = `${window.location.origin}${baseUrl}/models/hand_landmarker.task`;
        const remoteHandModelPath =
          'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

        const localFaceModelPath = `${window.location.origin}${baseUrl}/models/face_landmarker.task`;
        const remoteFaceModelPath =
          'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

        // 2. Initialize HandLandmarker (minTrackingConfidence: 0.4 for ultra-responsive cursive tracking)
        let handLandmarker: HandLandmarker | null = null;
        try {
          handLandmarker = await HandLandmarker.createFromOptions(fileset, {
            baseOptions: {
              modelAssetPath: localHandModelPath,
              delegate: 'GPU',
            },
            runningMode: 'VIDEO',
            numHands: 2,
            minHandDetectionConfidence: 0.5,
            minHandPresenceConfidence: 0.5,
            minTrackingConfidence: 0.4,
          });
        } catch (gpuErr) {
          console.warn('GPU HandLandmarker failed, trying CPU fallback...', gpuErr);
          try {
            handLandmarker = await HandLandmarker.createFromOptions(fileset, {
              baseOptions: {
                modelAssetPath: localHandModelPath,
                delegate: 'CPU',
              },
              runningMode: 'VIDEO',
              numHands: 2,
              minHandDetectionConfidence: 0.5,
              minHandPresenceConfidence: 0.5,
              minTrackingConfidence: 0.4,
            });
          } catch (cpuErr) {
            console.warn('Local hand model failed, fetching remote model...', cpuErr);
            handLandmarker = await HandLandmarker.createFromOptions(fileset, {
              baseOptions: {
                modelAssetPath: remoteHandModelPath,
                delegate: 'GPU',
              },
              runningMode: 'VIDEO',
              numHands: 2,
              minHandDetectionConfidence: 0.5,
              minHandPresenceConfidence: 0.5,
              minTrackingConfidence: 0.4,
            });
          }
        }

        if (isCancelled) {
          if (handLandmarker) handLandmarker.close();
          return;
        }

        handLandmarkerRef.current = handLandmarker;
        setIsReady(true);

        // 3. Initialize FaceLandmarker with blendshapes for mouth-open (jawOpen) detection
        let faceLandmarker: FaceLandmarker | null = null;
        try {
          faceLandmarker = await FaceLandmarker.createFromOptions(fileset, {
            baseOptions: {
              modelAssetPath: localFaceModelPath,
              delegate: 'GPU',
            },
            outputFaceBlendshapes: true,
            runningMode: 'VIDEO',
            numFaces: 1,
            minFaceDetectionConfidence: 0.5,
            minFacePresenceConfidence: 0.5,
            minTrackingConfidence: 0.5,
          });
        } catch (gpuFaceErr) {
          console.warn('GPU FaceLandmarker failed, trying CPU fallback...', gpuFaceErr);
          try {
            faceLandmarker = await FaceLandmarker.createFromOptions(fileset, {
              baseOptions: {
                modelAssetPath: localFaceModelPath,
                delegate: 'CPU',
              },
              outputFaceBlendshapes: true,
              runningMode: 'VIDEO',
              numFaces: 1,
              minFaceDetectionConfidence: 0.5,
              minFacePresenceConfidence: 0.5,
              minTrackingConfidence: 0.5,
            });
          } catch (remoteFaceErr) {
            console.warn('Local face model failed, fetching remote...', remoteFaceErr);
            try {
              faceLandmarker = await FaceLandmarker.createFromOptions(fileset, {
                baseOptions: {
                  modelAssetPath: remoteFaceModelPath,
                  delegate: 'GPU',
                },
                outputFaceBlendshapes: true,
                runningMode: 'VIDEO',
                numFaces: 1,
                minFaceDetectionConfidence: 0.5,
                minFacePresenceConfidence: 0.5,
                minTrackingConfidence: 0.5,
              });
            } catch (finalFaceErr) {
              console.error('FaceLandmarker initialization failed:', finalFaceErr);
            }
          }
        }

        if (isCancelled) {
          if (faceLandmarker) faceLandmarker.close();
          return;
        }

        if (faceLandmarker) {
          faceLandmarkerRef.current = faceLandmarker;
          setIsFaceReady(true);
        }

        setIsLoading(false);
      } catch (err: any) {
        console.error('Failed to initialize Vision models:', err);
        if (!isCancelled) {
          setError(err?.message || 'Failed to initialize vision tracker');
          setIsLoading(false);
        }
      }
    }

    initVisionModels();

    return () => {
      isCancelled = true;
      if (handLandmarkerRef.current) {
        handLandmarkerRef.current.close();
        handLandmarkerRef.current = null;
      }
      if (faceLandmarkerRef.current) {
        faceLandmarkerRef.current.close();
        faceLandmarkerRef.current = null;
      }
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
      }
    };
  }, []);

  // Process landmarks, hand gestures, and proximity depth
  const processHand = useCallback(
    (
      landmarks: NormalizedLandmark[],
      handIndex: number,
      renderW: number,
      renderH: number,
      offsetX: number,
      offsetY: number
    ): ActiveBrushPoint => {
      const wrist = landmarks[0];
      const thumbTip = landmarks[4];

      const indexPip = landmarks[6];
      const indexTip = landmarks[8];

      const middleMcp = landmarks[9];
      const middlePip = landmarks[10];
      const middleTip = landmarks[12];

      const ringPip = landmarks[14];
      const ringTip = landmarks[16];

      const pinkyPip = landmarks[18];
      const pinkyTip = landmarks[20];

      // 1. Proximity Depth Calculation (~15cm from camera)
      // 2D Euclidean distance between wrist landmark 0 and middle-finger MCP 9 in normalized screen coords
      const handScale = Math.hypot(wrist.x - middleMcp.x, wrist.y - middleMcp.y);
      const prevPinchState = pinchStateRef.current.get(handIndex) ?? {
        isPinching: false,
        releaseGraceFrames: 0,
        nearGraceFrames: 0,
        missingFrames: 0,
        wasNear: false,
      };

      // 2. Pinch-to-Draw calculation with Hysteresis & 3-Frame Release Grace Buffer:
      // Start pinching when normalized distance between index (8) and thumb (4) < 0.06
      // Release pinch only when distance > 0.085 (plus a 3-frame release grace buffer)
      const pinchDist2D = Math.hypot(indexTip.x - thumbTip.x, indexTip.y - thumbTip.y);
      const pinchDist3D = dist3D(indexTip, thumbTip);
      const pinchDist = Math.min(pinchDist2D, pinchDist3D);

      let isPinch = prevPinchState.isPinching;
      let releaseGraceFrames = prevPinchState.releaseGraceFrames;

      if (!isPinch) {
        if (pinchDist < PINCH_START_THRESHOLD) {
          isPinch = true;
          releaseGraceFrames = 0;
        }
      } else {
        if (pinchDist <= PINCH_RELEASE_THRESHOLD) {
          isPinch = true;
          releaseGraceFrames = 0;
        } else {
          releaseGraceFrames += 1;
          if (releaseGraceFrames <= PINCH_RELEASE_GRACE_FRAMES) {
            isPinch = true;
          } else {
            isPinch = false;
            releaseGraceFrames = 0;
          }
        }
      }

      // Proximity hysteresis + grace buffer during active pinch so fast wrist rotation never drops stroke
      const rawIsNear = handScale >= proximityThresholdRef.current;
      const pinchHoldNear =
        isPinch && prevPinchState.wasNear && handScale >= proximityThresholdRef.current * 0.82;
      let isNear = rawIsNear || pinchHoldNear;
      let nearGraceFrames = prevPinchState.nearGraceFrames;

      if (isNear) {
        nearGraceFrames = 0;
      } else if (prevPinchState.wasNear && isPinch) {
        nearGraceFrames += 1;
        if (nearGraceFrames <= PINCH_RELEASE_GRACE_FRAMES) {
          isNear = true;
        }
      }

      pinchStateRef.current.set(handIndex, {
        isPinching: isPinch,
        releaseGraceFrames,
        nearGraceFrames,
        missingFrames: 0,
        wasNear: isNear,
      });

      // 3. Closed-Fist calculation:
      // All four fingertips (8, 12, 16, 20) are curled below their PIP joints (6, 10, 14, 18)
      // Hand axis from wrist (0) to middle MCP (9)
      const handDirX = middleMcp.x - wrist.x;
      const handDirY = middleMcp.y - wrist.y;
      const handLen = Math.hypot(handDirX, handDirY);
      const dirX = handLen > 0.001 ? handDirX / handLen : 0;
      const dirY = handLen > 0.001 ? handDirY / handLen : -1;

      const isCurledBelowPip = (tip: NormalizedLandmark, pip: NormalizedLandmark) => {
        // Vertical check in screen space (y increases downwards)
        const belowInScreen = tip.y >= pip.y - 0.015;
        // Dot product projection along hand's extension axis: negative means curled back toward palm/wrist
        const dot = (tip.x - pip.x) * dirX + (tip.y - pip.y) * dirY;
        const curledAlongHandAxis = dot < 0.02;
        // Tip is closer to wrist than PIP
        const closerToWrist = dist3D(tip, wrist) <= dist3D(pip, wrist) * 1.08;

        return belowInScreen || curledAlongHandAxis || closerToWrist;
      };

      const indexCurled = isCurledBelowPip(indexTip, indexPip);
      const middleCurled = isCurledBelowPip(middleTip, middlePip);
      const ringCurled = isCurledBelowPip(ringTip, ringPip);
      const pinkyCurled = isCurledBelowPip(pinkyTip, pinkyPip);
      const isClosedFist = indexCurled && middleCurled && ringCurled && pinkyCurled;

      // 4. Gesture Classification:
      // 1) Pinch-to-Draw: small drawing brush at midpoint of index tip (8) and thumb tip (4) with hysteresis (< 0.06 start, > 0.085 release + 3-frame grace)
      // 2) Closed-Fist Wipe: large wiping brush centered at landmark 9 when all four fingertips are curled below PIP joints
      // 3) Relaxed/Open Hand: do nothing
      let gesture: HandGesture = 'idle';
      let targetX = indexTip.x;
      let targetY = indexTip.y;
      let radius = fingerRadius;

      if (isPinch) {
        gesture = 'pinch';
        // Midpoint of index tip (8) and thumb tip (4)
        targetX = (indexTip.x + thumbTip.x) * 0.5;
        targetY = (indexTip.y + thumbTip.y) * 0.5;
        radius = fingerRadius;
      } else if (isClosedFist) {
        gesture = 'fist';
        // Centered at landmark 9 (middle MCP)
        targetX = middleMcp.x;
        targetY = middleMcp.y;
        radius = palmRadius;
      } else {
        // Relaxed/Open Hand: do nothing
        gesture = 'idle';
        targetX = indexTip.x;
        targetY = indexTip.y;
        radius = fingerRadius;
      }

      // Compute mirrored position: (1 - targetX) for horizontal mirror
      const rawX = offsetX + (1 - targetX) * renderW;
      const rawY = offsetY + targetY * renderH;

      // Apply light exponential moving average (smoothing) to eliminate jitter while staying responsive during fast cursive movement
      const prev = prevPositionsRef.current.get(handIndex);
      let mappedX = rawX;
      let mappedY = rawY;

      if (prev) {
        const d = Math.hypot(rawX - prev.x, rawY - prev.y);
        if (d < 320) {
          const smoothFactor = gesture === 'pinch' ? 0.72 : 0.55;
          mappedX = prev.x * (1 - smoothFactor) + rawX * smoothFactor;
          mappedY = prev.y * (1 - smoothFactor) + rawY * smoothFactor;
        }
      }

      const prevX = prev ? prev.x : null;
      const prevY = prev ? prev.y : null;

      prevPositionsRef.current.set(handIndex, { x: mappedX, y: mappedY });

      // Visual helper points for screen overlay
      const thumbTipScreen = {
        x: offsetX + (1 - thumbTip.x) * renderW,
        y: offsetY + thumbTip.y * renderH,
      };
      const indexTipScreen = {
        x: offsetX + (1 - indexTip.x) * renderW,
        y: offsetY + indexTip.y * renderH,
      };
      const landmark9Screen = {
        x: offsetX + (1 - middleMcp.x) * renderW,
        y: offsetY + middleMcp.y * renderH,
      };

      return {
        id: handIndex,
        x: mappedX,
        y: mappedY,
        rawX,
        rawY,
        prevX,
        prevY,
        radius,
        gesture,
        confidence: 0.9,
        handScale,
        isNear,
        pinchDist,
        isPinching: isPinch,
        thumbTipScreen,
        indexTipScreen,
        landmark9Screen,
      };
    },
    [fingerRadius, palmRadius]
  );

  // Main tracking loop
  useEffect(() => {
    if (!isReady || !handLandmarkerRef.current) return;

    let isRunning = true;

    const detect = () => {
      if (!isRunning) return;

      const video = videoRef.current;
      const handLandmarker = handLandmarkerRef.current;
      const faceLandmarker = faceLandmarkerRef.current;

      if (
        video &&
        video.readyState >= 2 &&
        handLandmarker &&
        !video.paused &&
        !video.ended &&
        canvasWidth > 0 &&
        canvasHeight > 0
      ) {
        // Ensure strictly monotonically increasing timestamp for MediaPipe VIDEO mode on every rAF
        let timestamp = performance.now();
        if (timestamp <= lastTimestampRef.current) {
          timestamp = lastTimestampRef.current + 1;
        }
        lastTimestampRef.current = timestamp;
        detectionTickRef.current += 1;

        try {
          // Aspect ratio calculation to cover canvas while preserving video aspect
          const videoW = video.videoWidth || 640;
          const videoH = video.videoHeight || 480;
          const srcRatio = videoW / videoH;
          const destRatio = canvasWidth / canvasHeight;

          let renderW = canvasWidth;
          let renderH = canvasHeight;
          let offsetX = 0;
          let offsetY = 0;

          if (destRatio > srcRatio) {
            renderW = canvasWidth;
            renderH = canvasWidth / srcRatio;
            offsetY = (canvasHeight - renderH) / 2;
          } else {
            renderH = canvasHeight;
            renderW = canvasHeight * srcRatio;
            offsetX = (canvasWidth - renderW) / 2;
          }

          // 1. Run HandLandmarker on every requestAnimationFrame for ultra-responsive cursive tracking
          const handResults = handLandmarker.detectForVideo(video, timestamp);
          const activeHands: ActiveBrushPoint[] = [];
          let maxScale = 0;

          if (handResults.landmarks && handResults.landmarks.length > 0) {
            const currentIndices = new Set(handResults.landmarks.map((_, i) => i));
            for (const key of prevPositionsRef.current.keys()) {
              if (!currentIndices.has(key)) {
                const st = pinchStateRef.current.get(key);
                if (st && st.missingFrames < PINCH_RELEASE_GRACE_FRAMES) {
                  st.missingFrames += 1;
                } else {
                  prevPositionsRef.current.delete(key);
                  pinchStateRef.current.delete(key);
                }
              }
            }

            handResults.landmarks.forEach((handLandmarks, idx) => {
              const brush = processHand(
                handLandmarks,
                idx,
                renderW,
                renderH,
                offsetX,
                offsetY
              );
              activeHands.push(brush);
              if (brush.handScale > maxScale) {
                maxScale = brush.handScale;
              }
            });
          } else {
            for (const [key, st] of pinchStateRef.current.entries()) {
              if (st.missingFrames < PINCH_RELEASE_GRACE_FRAMES) {
                st.missingFrames += 1;
              } else {
                prevPositionsRef.current.delete(key);
                pinchStateRef.current.delete(key);
              }
            }
          }

          setDetectedHands(activeHands);
          setCurrentMaxHandScale(maxScale);
          if (onHandsDetected) {
            onHandsDetected(activeHands);
          }

          // 2. Run FaceLandmarker every 3rd frame to keep hand tracking FPS high and unthrottled
          if (faceLandmarker && detectionTickRef.current % FACE_DETECTION_INTERVAL === 0) {
            const faceResults: FaceLandmarkerResult = faceLandmarker.detectForVideo(
              video,
              timestamp
            );

            let isMouthOpen = false;
            let mouthOpenAmount = 0;
            let mouthX = canvasWidth * 0.5;
            let mouthY = canvasHeight * 0.55;
            let isFaceDetected = false;
            let detectedRawMouthX: number | undefined;
            let detectedRawMouthY: number | undefined;

            if (faceResults.faceLandmarks && faceResults.faceLandmarks.length > 0) {
              isFaceDetected = true;
              const lm = faceResults.faceLandmarks[0];

              // 1. Blendshapes detection: jawOpen > 0.35
              if (faceResults.faceBlendshapes && faceResults.faceBlendshapes.length > 0) {
                const jawShape = faceResults.faceBlendshapes[0].categories.find(
                  (c) => c.categoryName === 'jawOpen'
                );
                if (jawShape) {
                  mouthOpenAmount = jawShape.score;
                  if (jawShape.score > 0.35) {
                    isMouthOpen = true;
                  }
                }
              }

              // Upper lip (13) and lower lip (14)
              const upperLip = lm[13] || lm[0];
              const lowerLip = lm[14] || lm[17];
              const chin = lm[152];
              const nose = lm[1];
              const forehead = lm[10];

              // 2. Reliable Fallback: Vertical distance between upper lip (13) and lower lip (14) normalized by face height
              const faceH = (forehead && chin)
                ? Math.hypot(chin.x - forehead.x, chin.y - forehead.y)
                : (chin && nose)
                ? Math.hypot(chin.x - nose.x, chin.y - nose.y) * 1.8
                : 0.35;

              const verticalLipDist = Math.abs(lowerLip.y - upperLip.y);
              const normalizedLipDist = faceH > 0.02 ? verticalLipDist / faceH : 0;

              // When normalized vertical lip distance > 0.055, reliably trigger mouth opening
              if (normalizedLipDist > 0.055) {
                isMouthOpen = true;
                const fallbackScore = Math.min(1.0, 0.35 + ((normalizedLipDist - 0.055) / 0.12) * 0.65);
                mouthOpenAmount = Math.max(mouthOpenAmount, fallbackScore);
              }

              // Screen coordinates with horizontal mirror (1 - x) to match mirrored webcam feed
              const rawMouthX = (upperLip.x + lowerLip.x) * 0.5;
              const rawMouthY = (upperLip.y + lowerLip.y) * 0.5;
              detectedRawMouthX = rawMouthX;
              detectedRawMouthY = rawMouthY;

              const targetMouthX = offsetX + (1 - rawMouthX) * renderW;
              const targetMouthY = offsetY + rawMouthY * renderH;

              // Smooth mouth coordinates across frames to prevent micro-jitter
              if (prevMouthRef.current) {
                mouthX = prevMouthRef.current.x * 0.65 + targetMouthX * 0.35;
                mouthY = prevMouthRef.current.y * 0.65 + targetMouthY * 0.35;
              } else {
                mouthX = targetMouthX;
                mouthY = targetMouthY;
              }
              prevMouthRef.current = { x: mouthX, y: mouthY };

              // Calculate approximate face pixel radius for natural breath scaling
              let faceRadius = 180;
              if (chin && forehead) {
                const hDist = Math.hypot(chin.x - forehead.x, chin.y - forehead.y) * renderH;
                faceRadius = Math.max(90, Math.min(320, hDist * 0.45));
              }
            } else {
              prevMouthRef.current = null;
            }

            const newFaceData: FaceBreathData = {
              isDetected: isFaceDetected,
              isMouthOpen,
              mouthOpenAmount,
              mouthX,
              mouthY,
              rawMouthX: detectedRawMouthX,
              rawMouthY: detectedRawMouthY,
              faceRadius: isFaceDetected ? 180 : undefined,
            };

            setFaceData(newFaceData);
            if (onFaceBreathDetected) {
              onFaceBreathDetected(newFaceData);
            }
          }

          // Calculate FPS
          frameCountRef.current++;
          if (timestamp - lastFpsTimeRef.current >= 1000) {
            setFps(
              Math.round((frameCountRef.current * 1000) / (timestamp - lastFpsTimeRef.current))
            );
            frameCountRef.current = 0;
            lastFpsTimeRef.current = timestamp;
          }
        } catch (detErr) {
          console.warn('Vision detection tick warning:', detErr);
        }
      }

      animFrameRef.current = requestAnimationFrame(detect);
    };

    animFrameRef.current = requestAnimationFrame(detect);

    return () => {
      isRunning = false;
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
      }
    };
  }, [
    isReady,
    videoRef,
    canvasWidth,
    canvasHeight,
    processHand,
    onHandsDetected,
    onFaceBreathDetected,
  ]);

  return {
    isLoading,
    isReady,
    isFaceReady,
    error,
    detectedHands,
    faceData,
    currentMaxHandScale,
    fps,
  };
}
