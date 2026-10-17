import { Vector3 } from 'three/webgpu';
import { PHYS } from '../physics/constants.js';

/**
 * Layered disc emission / recycled slots adapted from Daniel Greenheck's
 * threejs-particle-fluids demo/presets/{honey,tarp}.ts, MIT, revision
 * 26ebfd2985ddd5156c932c97697980cfda92ffdf. CPU ballistics replace its SPH
 * buffers. See THIRD_PARTY_NOTICES.md and LICENSES/threejs-particle-fluids-MIT.txt.
 */
export const POUR_PARTICLES = {capacity: 128, spacing: .002, bore: .0028, motionStretch: .025} as const;
export type PourDrop = {active: boolean; position: Vector3; velocity: Vector3; radius: number};

export class PourParticles {
  readonly drops: PourDrop[] = Array.from({length: POUR_PARTICLES.capacity}, () => ({
    active: false, position: new Vector3(), velocity: new Vector3(), radius: 0,
  }));
  readonly hitPoint = new Vector3();
  private readonly disc: number[] = [];
  private readonly lastSource = new Vector3();
  private readonly sweep = new Vector3();
  private readonly axis = new Vector3();
  private readonly side = new Vector3();
  private readonly up = new Vector3();
  private travelled = 0;
  private released = 0;
  private primed = false;
  private count = 0;

  constructor() {
    const {spacing, bore} = POUR_PARTICLES, reach = Math.floor(bore / spacing);
    // The reference releases complete square-lattice layers clipped to a disc.
    for (let i = -reach; i <= reach; i++) for (let j = -reach; j <= reach; j++) {
      if ((i * i + j * j) * spacing * spacing <= bore * bore) this.disc.push(i * spacing, j * spacing);
    }
  }

  get active() { return this.count > 0; }
  get activeCount() { return this.count; }

  clear() {
    for (const drop of this.drops) drop.active = false;
    this.count = 0; this.travelled = 0; this.released = 0; this.primed = false;
  }

  step(dt: number, source: Vector3, velocity: Vector3, flow: number, surfaceY: number) {
    if (!(dt > 0)) return 0;
    // A resumed/background tab must not launch a backlog of liquid.
    if (dt > .5) { this.clear(); this.lastSource.copy(source); return 0; }
    let hits = 0;
    this.hitPoint.set(0, 0, 0);
    for (const drop of this.drops) {
      if (!drop.active) continue;
      const fallTime = (drop.velocity.y + Math.sqrt(drop.velocity.y ** 2 + 2 * PHYS.gravity * Math.max(0, drop.position.y - surfaceY))) / PHYS.gravity;
      const travel = Math.min(dt, Math.max(0, fallTime));
      drop.position.addScaledVector(drop.velocity, travel); drop.position.y -= .5 * PHYS.gravity * travel * travel;
      drop.velocity.y -= PHYS.gravity * travel;
      if (fallTime <= dt) {
        drop.position.y = surfaceY; this.hitPoint.add(drop.position); hits++;
        drop.active = false; this.count--;
      }
    }
    if (hits) this.hitPoint.multiplyScalar(1 / hits);
    const speed = velocity.length();
    this.sweep.copy(source).sub(this.lastSource).divideScalar(dt).clampLength(0, .08);
    if (!this.primed) this.sweep.set(0, 0, 0);
    this.lastSource.copy(source); this.primed = true;
    if (flow <= .02 || speed < .001) { this.travelled = 0; return hits; }
    const {spacing, capacity} = POUR_PARTICLES, perLayer = this.disc.length / 2;
    const emissionSpeed = speed * Math.sqrt(flow);
    this.travelled += emissionSpeed * dt;
    const layers = Math.min(8, Math.floor(this.travelled / spacing));
    this.travelled %= spacing;
    this.axis.copy(velocity).normalize();
    this.side.set(-this.axis.z, 0, this.axis.x).normalize(); this.up.crossVectors(this.side, this.axis).normalize();
    for (let layer = 0; layer < layers; layer++) for (let i = 0; i < perLayer; i++) {
      // As in the tarp emitter, slots wrap and recycle the oldest liquid.
      const drop = this.drops[this.released++ % capacity];
      const age = (this.travelled + (layers - 1 - layer) * spacing) / emissionSpeed;
      if (!drop.active) this.count++;
      drop.active = true; drop.radius = .00135 * Math.sqrt(flow);
      drop.velocity.copy(velocity).add(this.sweep);
      drop.position.copy(source).addScaledVector(this.sweep, -age)
        .addScaledVector(this.side, this.disc[i * 2] * Math.sqrt(flow))
        .addScaledVector(this.up, this.disc[i * 2 + 1] * Math.sqrt(flow))
        .addScaledVector(drop.velocity, age);
      drop.position.y -= .5 * PHYS.gravity * age * age; drop.velocity.y -= PHYS.gravity * age;
    }
    return hits;
  }
}

/** SurfaceField.ts's velocity smear, capped at three particle spacings. */
export function pourMotionStretch(speed: number) {
  return Math.min(Math.max(0, speed) * POUR_PARTICLES.motionStretch, 3 * POUR_PARTICLES.spacing);
}
