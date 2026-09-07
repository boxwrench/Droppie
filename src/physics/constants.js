export const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
export const PHYS = {
  // Water has a high bulk modulus and almost no shear modulus. Keeping bulk
  // high while holding shear low is what makes the body read as liquid that
  // flattens and spreads on impact rather than as rubber that bounces back.
  density: 1050, shear: 240, bulk: 65000, damping: 3,
  gravity: 2.4, step: 1 / 240, iterations: 3,
  staticFriction: .65, dynamicFriction: .42, restitution: .065,
  floor: .00015, maxGrabForce: 2.8,
  sleepSpeed: .015,
  // Shape memory: how hard the body is pulled back onto its rest silhouette
  // around the moving mass center. This sits on top of the FEM and dominates
  // how solid the droplet feels, so it is the main knob for wet versus rubbery.
  shapeMemory: 30, shapeDamping: 1.5,
};
