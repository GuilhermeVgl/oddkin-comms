export type SpringState = { x: number; y: number; vx: number; vy: number };

/** One animation frame of a damped spring pulling (x, y) towards its target. */
export function stepSpring(
  state: SpringState,
  targetX: number,
  targetY: number,
  stiffness = 0.22,
  damping = 0.7,
): SpringState {
  const vx = (state.vx + (targetX - state.x) * stiffness) * damping;
  const vy = (state.vy + (targetY - state.y) * stiffness) * damping;
  return { x: state.x + vx, y: state.y + vy, vx, vy };
}

/** How far a dragged card leans (degrees) given how fast it moves sideways. */
export function tiltFor(velocityX: number, maxDegrees = 9): number {
  return Math.max(-maxDegrees, Math.min(maxDegrees, velocityX * 0.5));
}
