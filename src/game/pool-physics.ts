import { Vector3 } from 'three/webgpu';
import type { SoftBody } from '../physics/soft-body.js';
import { PHYS } from '../physics/constants.js';
import { FacilityCollision } from '../physics/facility-collision.ts';

/** A shallow dish on the existing floor; metres, not a second fluid solver. */
export const POOL = {
  x: 0, z: 0, radius: .076, outerRadius: .084,
  waterLevel: .007, rimHeight: .012,
  rippleCount: 6, rippleLifetime: 2.4,
} as const;

export class PoolPhysics {
  enabled = true;
  submerged = 0;
  readonly ripples: {x: number; z: number; age: number; strength: number}[] = Array.from({length: POOL.rippleCount}, () => ({x: 0, z: 0, age: POOL.rippleLifetime, strength: 0}));
  onSplash: (origin: Vector3, speed: number, velocity: Vector3) => void = () => {};
  private readonly collision: FacilityCollision;
  private readonly velocity = new Vector3();
  private readonly origin = new Vector3();
  private wet = false;
  private elapsed = 1;
  private trailX = 0;
  private trailZ = 0;
  private nextRipple = 0;
  readonly body: SoftBody;

  constructor(body: SoftBody) {
    this.body = body;
    this.collision = new FacilityCollision(body);
    this.reset();
  }

  contains(x: number, z: number) {
    return this.enabled && Math.hypot(x - POOL.x, z - POOL.z) < POOL.radius;
  }

  get active() {
    return this.enabled && this.ripples.some(ripple => ripple.age < POOL.rippleLifetime);
  }

  reset() {
    for (const ripple of this.ripples) { ripple.age = POOL.rippleLifetime; ripple.strength = 0; }
    this.elapsed = 1;
    this.nextRipple = 0;
    this.submerged = this.immersion();
    this.wet = this.submerged > .002;
    this.trailX = this.body.center.x;
    this.trailZ = this.body.center.z;
  }

  private immersion() {
    if (!this.enabled) return 0;
    const body = this.body;
    let mass = 0;
    for (let i = 0; i < body.mass.length; i++) {
      const j = i * 3;
      if (this.contains(body.x[j], body.x[j + 2])) {
        mass += body.mass[i] * Math.max(0, Math.min(1, (POOL.waterLevel - body.x[j + 1]) / .004));
      }
    }
    return mass / body.totalMass;
  }

  disturb(x: number, z: number, strength: number) {
    if (!this.contains(x, z)) return;
    const ripple = this.ripples[this.nextRipple];
    ripple.x = x - POOL.x; ripple.z = z - POOL.z;
    ripple.age = 0; ripple.strength = Math.max(0, Math.min(1, strength));
    this.nextRipple = (this.nextRipple + 1) % this.ripples.length;
  }

  /** Apply gentle submerged drag and buoyancy before the existing XPBD step. */
  step(h: number) {
    if (!this.enabled) return;
    for (const ripple of this.ripples) ripple.age = Math.min(POOL.rippleLifetime, ripple.age + h);
    this.elapsed += h;
    const b = this.body;
    if (b.sleeping) return;
    this.velocity.set(0, 0, 0);
    for (let i = 0; i < b.mass.length; i++) {
      const j = i * 3, weight = b.mass[i] / b.totalMass;
      this.velocity.x += b.velocity[j] * weight;
      this.velocity.y += b.velocity[j + 1] * weight;
      this.velocity.z += b.velocity[j + 2] * weight;
      if (!this.contains(b.x[j], b.x[j + 2])) continue;
      const wet = Math.max(0, Math.min(1, (POOL.waterLevel - b.x[j + 1]) / .004));
      if (!wet) continue;
      // Water is slightly less dense than Droppie. The shallow pool slows the
      // submerged nodes without making the character float above the floor.
      const drag = Math.exp(-10 * wet * h);
      b.velocity[j] *= drag;
      b.velocity[j + 1] = b.velocity[j + 1] * drag + PHYS.gravity * (1000 / PHYS.density) * wet * h;
      b.velocity[j + 2] *= drag;
    }
  }

  afterStep() {
    if (!this.enabled || this.body.sleeping) return;
    const b = this.body;
    // Broad phase covers the character's visible bounds, including a pulled tip.
    let min = Infinity, max = 0, low = Infinity;
    for (let i = 0; i < b.x.length; i += 3) {
      const d = Math.hypot(b.x[i] - POOL.x, b.x[i + 2] - POOL.z);
      min = Math.min(min, d); max = Math.max(max, d); low = Math.min(low, b.x[i + 1]);
    }
    if (min < POOL.outerRadius + .008 && max > POOL.radius - .008 && low < POOL.rimHeight + .002) {
      this.collision.resolveAnnulus(POOL.x, POOL.z, POOL.radius, POOL.outerRadius, PHYS.floor, POOL.rimHeight);
    }
    this.submerged = this.immersion();
    const wet = this.submerged > .002;
    const speed = Math.max(0, -this.velocity.y) + Math.hypot(this.velocity.x, this.velocity.z) * .45;
    if (wet && !this.wet && this.elapsed > .16 && speed > .04) {
      // Clamp an edge entry to the water, rather than dropping its ripple just
      // outside the disk when only the leading edge of the body is submerged.
      const dx = b.center.x - POOL.x, dz = b.center.z - POOL.z;
      const scale = Math.min(1, (POOL.radius - .006) / Math.max(.001, Math.hypot(dx, dz)));
      this.origin.set(POOL.x + dx * scale, POOL.waterLevel, POOL.z + dz * scale);
      this.disturb(this.origin.x, this.origin.z, Math.min(1, speed / .35));
      if (speed > .12) this.onSplash(this.origin, speed, this.velocity);
      this.elapsed = 0;
      this.trailX = b.center.x; this.trailZ = b.center.z;
    } else if (wet && this.elapsed > .14 && Math.hypot(b.center.x - this.trailX, b.center.z - this.trailZ) > .008) {
      this.disturb(b.center.x, b.center.z, .22);
      this.elapsed = 0;
      this.trailX = b.center.x; this.trailZ = b.center.z;
    }
    this.wet = wet;
  }
}
