import { Vector3 } from 'three/webgpu';
import type { SoftBody } from '../physics/soft-body.js';
import { FacilityCollision, type CollisionBox } from '../physics/facility-collision.ts';
import { PHYS } from '../physics/constants.js';
import { POOL, type PoolPhysics } from './pool-physics.ts';

export const BUCKET = {
  x: .098, z: -.042, inwardX: -.96, inwardZ: -.28,
  seatHeight: .066, seatRadius: .034, baseY: .074,
  radius: .025, height: .050, pivotOffset: .022,
  tipAngle: .96, emptyAngle: 1.5, tipTime: .55, pourTime: 2.6, waitTime: 1.4,
  returnTime: .85, refillTime: .65,
} as const;

export type BucketPhase = 'ready' | 'tipping' | 'pouring' | 'waiting' | 'resetting' | 'refilling';
const smooth = (value: number) => { const t = Math.max(0, Math.min(1, value)); return t * t * (3 - 2 * t); };

/** Authored tipping motion, ballistic pour and real contacts with the stool. */
export class PourBucket {
  phase: BucketPhase = 'ready';
  angle = 0;
  fill = 1;
  flow = 0;
  elapsed = 0;
  knocks = 0;
  impacts = 0;
  readonly source = new Vector3();
  readonly impact = new Vector3();
  readonly velocity = new Vector3();
  flightTime = 0;
  onKnock: () => void = () => {};
  onImpact: (point: Vector3, strength: number) => void = () => {};
  private readonly pool: PoolPhysics;
  private readonly body: SoftBody;
  private readonly collision: FacilityCollision;
  private readonly boxes: CollisionBox[] = [];
  private pulseTime = 0;
  private clearTime = .5;
  private armed = true;

  constructor(body: SoftBody, pool: PoolPhysics) {
    this.body = body; this.pool = pool;
    this.collision = new FacilityCollision(body);
    const xAxis = new Vector3(BUCKET.inwardX, 0, BUCKET.inwardZ);
    const yAxis = new Vector3(0, 1, 0), zAxis = new Vector3(-BUCKET.inwardZ, 0, BUCKET.inwardX);
    const box = (lx: number, y: number, lz: number, hx: number, hy: number, hz: number) => {
      this.boxes.push({center: new Vector3(BUCKET.x, y, BUCKET.z).addScaledVector(xAxis, lx).addScaledVector(zAxis, lz),
        xAxis, yAxis, zAxis, halfSize: new Vector3(hx, hy, hz)});
    };
    for (const lx of [-.021, .021]) for (const lz of [-.021, .021]) box(lx, BUCKET.seatHeight / 2, lz, .004, BUCKET.seatHeight / 2, .004);
    box(0, BUCKET.seatHeight + .004, 0, .029, .004, .029);
    this.updateJet();
  }

  get active() { return this.phase !== 'ready'; }
  get enabled() { return this.pool.enabled; }

  knock() {
    if (!this.enabled || this.active) return false;
    this.phase = 'tipping'; this.elapsed = 0; this.pulseTime = 0;
    this.armed = false; this.knocks++; this.onKnock();
    return true;
  }

  reset() {
    this.phase = 'ready'; this.angle = 0; this.fill = 1; this.flow = 0;
    this.elapsed = 0; this.pulseTime = 0; this.armed = true; this.clearTime = .5;
    this.knocks = 0; this.impacts = 0; this.updateJet();
  }

  step(dt: number) {
    if (!this.enabled || !this.active) return;
    this.elapsed += dt;
    let t = this.elapsed;
    this.flow = 0;
    if (t < BUCKET.tipTime) {
      this.phase = 'tipping'; this.angle = BUCKET.tipAngle * smooth(t / BUCKET.tipTime);
    } else if ((t -= BUCKET.tipTime) < BUCKET.pourTime) {
      this.phase = 'pouring'; this.angle = BUCKET.tipAngle + (BUCKET.emptyAngle - BUCKET.tipAngle) * smooth(t / BUCKET.pourTime);
      this.fill = 1 - t / BUCKET.pourTime;
      this.flow = smooth(t / .16) * smooth((BUCKET.pourTime - t) / .55);
    } else if ((t -= BUCKET.pourTime) < BUCKET.waitTime) {
      this.phase = 'waiting'; this.angle = BUCKET.emptyAngle; this.fill = 0;
    } else if ((t -= BUCKET.waitTime) < BUCKET.returnTime) {
      this.phase = 'resetting'; this.angle = BUCKET.emptyAngle * (1 - smooth(t / BUCKET.returnTime)); this.fill = 0;
    } else if ((t -= BUCKET.returnTime) < BUCKET.refillTime) {
      this.phase = 'refilling'; this.angle = 0; this.fill = smooth(t / BUCKET.refillTime);
    } else {
      this.phase = 'ready'; this.angle = 0; this.fill = 1; this.elapsed = 0;
    }
    this.updateJet();
    if (this.flow <= .02) return;
    this.pulseTime += Math.min(dt, .25);
    // A bounded series of small impulses drives the existing reference wave
    // solver. No accumulating water level, extra liquid solver or timer queue.
    while (this.pulseTime >= .12) {
      this.pulseTime -= .12;
      this.pool.disturb(this.impact.x, this.impact.z, .22 * this.flow);
      this.impacts++; this.onImpact(this.impact, this.flow);
    }
  }

  afterStep(dt: number) {
    if (!this.enabled) return;
    let contact = false;
    let nearby = false;
    if (!this.body.sleeping) for (let i = 0; i < this.body.x.length; i += 3) {
      if (Math.abs(this.body.x[i] - BUCKET.x) < .055 && Math.abs(this.body.x[i + 2] - BUCKET.z) < .055 && this.body.x[i + 1] < BUCKET.baseY + BUCKET.height + .01) { nearby = true; break; }
    }
    if (nearby) {
      contact = this.collision.resolveBoxes(this.boxes, .001);
      if (!this.active) contact = this.collision.resolveCylinderBarrier(BUCKET.x, BUCKET.z, BUCKET.radius,
        BUCKET.baseY, BUCKET.baseY + BUCKET.height, .001) || contact;
    }
    this.clearTime = contact ? 0 : this.clearTime + dt;
    if (!this.active && this.clearTime > .35) this.armed = true;
    if (contact) {
      if (this.armed) this.knock();
      this.armed = false;
    }
  }

  private updateJet() {
    const c = Math.cos(this.angle), s = Math.sin(this.angle), edge = BUCKET.radius - BUCKET.pivotOffset;
    const along = BUCKET.pivotOffset + edge * c + BUCKET.height * s;
    this.source.set(BUCKET.x + BUCKET.inwardX * along, BUCKET.baseY + BUCKET.height * c - edge * s, BUCKET.z + BUCKET.inwardZ * along);
    this.velocity.set(BUCKET.inwardX * .13, -.025, BUCKET.inwardZ * .13);
    const height = Math.max(0, this.source.y - POOL.waterLevel);
    this.flightTime = (this.velocity.y + Math.sqrt(this.velocity.y ** 2 + 2 * PHYS.gravity * height)) / PHYS.gravity;
    this.sampleStream(1, this.impact);
  }

  sampleStream(fraction: number, out: Vector3) {
    const t = fraction * this.flightTime;
    out.copy(this.source).addScaledVector(this.velocity, t);
    out.y -= .5 * PHYS.gravity * t * t;
    return out;
  }
}
