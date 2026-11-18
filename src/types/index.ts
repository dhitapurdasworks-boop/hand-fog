export type HandGesture = 'pinch' | 'fist' | 'idle' | 'pointing' | 'palm';

export interface ActiveBrushPoint {
  id: number;
  x: number;
  y: number;
  rawX: number;
  rawY: number;
  prevX: number | null;
  prevY: number | null;
  radius: number;
  gesture: HandGesture;
  confidence: number;
  // Proximity depth attributes
  handScale: number; // 2D distance between wrist (0) and middle MCP (9) in normalized coords
  isNear: boolean;   // true if handScale >= proximityThreshold (~15cm from camera)
  // Distance between thumb tip (4) and index tip (8)
  pinchDist: number;
  isPinching: boolean;
  // Raw landmarks for visual guides
  thumbTipScreen?: { x: number; y: number };
  indexTipScreen?: { x: number; y: number };
  landmark9Screen?: { x: number; y: number };
}

export interface FaceBreathData {
  isDetected: boolean;
  isMouthOpen: boolean;
  mouthOpenAmount: number; // 0.0 to 1.0 (jawOpen blendshape score or normalized lip distance ratio)
  mouthX: number;          // canvas pixel X of mirrored mouth center
  mouthY: number;          // canvas pixel Y of mouth center
  rawMouthX?: number;      // normalized mouth center X [0, 1]
  rawMouthY?: number;      // normalized mouth center Y [0, 1]
  faceRadius?: number;     // approximate pixel radius of face
}

export interface FogConfig {
  density: number;             // 0.0 to 1.0 (default 0.85)
  blurAmount: number;          // in pixels (default 18)
  autoRefog: boolean;          // whether fog slowly regenerates over time
  autoRefogSpeed: number;      // normal auto-refog speed (default 0.008)
  fingerRadius: number;        // radius for small pinch drawing brush (default 18)
  palmRadius: number;          // radius for large closed-fist wiping brush (default 90)
  condensationDetail: boolean; // subtle water grain toggle (default true)
  proximityThreshold: number;  // normalized wrist-to-MCP9 scale threshold (default 0.18 ~15cm)
  breathReFog: boolean;        // mouth-open breath re-fog toggle (default true)
  breathReFogSpeed: number;    // rate of rapid steam condensation during breath (default 0.24)
}
