/**
 * Utility for static condensation textures and smooth anti-aliased path erasure
 * on steamy mirror glass without smudging, melting, or liquid drips.
 */

// Offscreen canvas pattern for static condensation grain
let cachedNoisePattern: CanvasPattern | null = null;
let cachedNoiseCanvas: HTMLCanvasElement | null = null;

/**
 * Generates an offscreen noise & micro-droplet pattern that simulates
 * moisture texture on cold bathroom mirror glass.
 * Completely static: generated once and cached.
 */
export function getCondensationPattern(ctx: CanvasRenderingContext2D): CanvasPattern | null {
  if (cachedNoisePattern) return cachedNoisePattern;

  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const pctx = canvas.getContext('2d');
  if (!pctx) return null;

  // Transparent base
  pctx.clearRect(0, 0, size, size);

  // 1. Subtle fine-grain mist noise
  const imgData = pctx.createImageData(size, size);
  const data = imgData.data;
  for (let i = 0; i < data.length; i += 4) {
    const noise = (Math.random() - 0.5) * 35;
    data[i] = 255; // R
    data[i + 1] = 255; // G
    data[i + 2] = 255; // B
    data[i + 3] = Math.max(0, Math.min(255, 30 + noise)); // A
  }
  pctx.putImageData(imgData, 0, 0);

  // 2. Sprinkle subtle condensation micro-droplets
  const numDroplets = 160;
  for (let i = 0; i < numDroplets; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const radius = 0.8 + Math.random() * 2.0;

    const dropGrad = pctx.createRadialGradient(
      x - radius * 0.3,
      y - radius * 0.3,
      radius * 0.1,
      x,
      y,
      radius
    );
    dropGrad.addColorStop(0, 'rgba(255, 255, 255, 0.45)');
    dropGrad.addColorStop(0.7, 'rgba(220, 235, 250, 0.2)');
    dropGrad.addColorStop(1, 'rgba(180, 205, 225, 0.05)');

    pctx.beginPath();
    pctx.fillStyle = dropGrad;
    pctx.arc(x, y, radius, 0, Math.PI * 2);
    pctx.fill();
  }

  cachedNoiseCanvas = canvas;
  cachedNoisePattern = ctx.createPattern(canvas, 'repeat');
  return cachedNoisePattern;
}

/**
 * Erase fog at a single point (single dot or tap) with smooth anti-aliased round cap.
 * Uses globalCompositeOperation = 'destination-out'.
 */
export function eraseFogDot(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number
) {
  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillStyle = '#000000';
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/**
 * Connect consecutive smoothed points using quadratic Bezier midpoints
 * and HTML5 Canvas continuous paths (lineCap = 'round', lineJoin = 'round')
 * with globalCompositeOperation = 'destination-out'.
 * Completely crisp, clean, and anti-aliased without melting or smudging.
 */
export function eraseFogBezier(
  ctx: CanvasRenderingContext2D,
  startMidX: number,
  startMidY: number,
  controlX: number,
  controlY: number,
  endMidX: number,
  endMidY: number,
  radius: number
) {
  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';
  ctx.strokeStyle = '#000000';
  ctx.fillStyle = '#000000';
  ctx.lineWidth = radius * 2;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  ctx.beginPath();
  ctx.moveTo(startMidX, startMidY);
  ctx.quadraticCurveTo(controlX, controlY, endMidX, endMidY);
  ctx.stroke();

  // Round end-cap for perfect anti-aliasing continuity
  ctx.beginPath();
  ctx.arc(endMidX, endMidY, radius, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

/**
 * Smooth quadratic Bezier curve interpolation between two points using their midpoint.
 */
export function eraseFogLine(
  ctx: CanvasRenderingContext2D,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  radius: number
) {
  const midX = (fromX + toX) * 0.5;
  const midY = (fromY + toY) * 0.5;
  eraseFogBezier(ctx, fromX, fromY, midX, midY, toX, toY, radius);
}

/**
 * Erase fog with a soft, feathered multi-stop radial gradient for closed-fist wiping.
 * Inner core (0% to 40% radius) is fully erased (rgba(0,0,0,1)),
 * fading through 70% (rgba(0,0,0,0.4)) down to 100% (rgba(0,0,0,0)) at the outer edge.
 */
export function eraseFogFeatheredDot(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number
) {
  if (radius <= 0) return;
  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';

  const grad = ctx.createRadialGradient(x, y, 0, x, y, radius);
  grad.addColorStop(0.0, 'rgba(0, 0, 0, 1)');
  grad.addColorStop(0.4, 'rgba(0, 0, 0, 1)');
  grad.addColorStop(0.7, 'rgba(0, 0, 0, 0.4)');
  grad.addColorStop(1.0, 'rgba(0, 0, 0, 0)');

  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/**
 * Interpolate a feathered closed-fist wipe along a quadratic Bezier curve
 * by stamping the multi-stop radial gradient densely along the curve.
 */
export function eraseFogFeatheredBezier(
  ctx: CanvasRenderingContext2D,
  startMidX: number,
  startMidY: number,
  controlX: number,
  controlY: number,
  endMidX: number,
  endMidY: number,
  radius: number
) {
  if (radius <= 0) return;

  const approxLen =
    Math.hypot(controlX - startMidX, controlY - startMidY) +
    Math.hypot(endMidX - controlX, endMidY - controlY);
  const stepDist = Math.max(4, radius * 0.22);
  const steps = Math.max(1, Math.ceil(approxLen / stepDist));

  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';

  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const invT = 1 - t;
    const x = invT * invT * startMidX + 2 * invT * t * controlX + t * t * endMidX;
    const y = invT * invT * startMidY + 2 * invT * t * controlY + t * t * endMidY;

    const grad = ctx.createRadialGradient(x, y, 0, x, y, radius);
    grad.addColorStop(0.0, 'rgba(0, 0, 0, 1)');
    grad.addColorStop(0.4, 'rgba(0, 0, 0, 1)');
    grad.addColorStop(0.7, 'rgba(0, 0, 0, 0.4)');
    grad.addColorStop(1.0, 'rgba(0, 0, 0, 0)');

    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}
