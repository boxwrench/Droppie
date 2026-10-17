import assert from 'node:assert/strict';
import { Vector3 } from 'three/webgpu';
import { SoftBody } from '../src/physics/soft-body.js';
import { PHYS } from '../src/physics/constants.js';
import { Locomotion } from '../src/game/locomotion.ts';
import { PoolPhysics, POOL } from '../src/game/pool-physics.ts';
import { PoolSurface } from '../src/water/pool-surface.ts';
import { PourBucket, BUCKET } from '../src/game/pour-bucket.ts';
import { PourParticles, POUR_PARTICLES, pourMotionStretch } from '../src/water/pour-particles.ts';
import { loadModel } from './load-model.mjs';

function setup(offset = 0, offsetZ = 0) {
  const body = new SoftBody(loadModel());
  for (let j = 0; j < body.x.length; j += 3) { body.x[j] += offset; body.x[j + 2] += offsetZ; }
  body.updateCenter();
  const rig = new Locomotion(body), pool = new PoolPhysics(body);
  const bucket = new PourBucket(body, pool);
  const step = (count) => {
    for (let i = 0; i < count; i++) {
      rig.step(PHYS.step); bucket.step(PHYS.step); pool.step(PHYS.step); body.step(PHYS.step); pool.afterStep(); bucket.afterStep(PHYS.step); rig.afterStep();
      assert(body.isFinite(), 'pool interaction remains finite');
      assert(body.minimumJacobian() > .1, 'pool contact preserves cage orientation');
    }
    body.updateSurface();
  };
  return {body, rig, pool, bucket, step};
}

// The additive water pass must have no effect on the original dry playground.
{
  const wet = setup(.3), dry = setup(.3);
  dry.pool.enabled = false; dry.pool.reset();
  wet.rig.jump(); dry.rig.jump(); wet.step(240); dry.step(240);
  assert.deepEqual(wet.body.x, dry.body.x, 'outside pool positions exactly match dry physics');
  assert.deepEqual(wet.body.velocity, dry.body.velocity, 'outside pool velocities exactly match dry physics');
  assert.equal(wet.pool.submerged, 0);
  assert(!wet.pool.active, 'dry movement generates no water effects');
}

{
  const {body, rig, pool, step} = setup();
  let splashes = 0;
  pool.onSplash = () => splashes++;
  step(960);
  assert(body.sleeping, 'shallow water preserves idle sleep');
  assert(pool.submerged > 0, 'resting droplet touches water');
  assert.equal(splashes, 0, 'settling does not trigger repeated splashes');
  for (let trial = 0; trial < 3; trial++) {
    if (trial) step(960);
    rig.jump(); step(240);
  }
  assert(splashes >= 3 && splashes <= 6, 'each hop splashes on entry, with at most one smaller rebound splash');
  assert(pool.active, 're-entry produces visible ripples');
  assert(body.volumeRatio() > .8 && body.volumeRatio() < 1.2, 'water forces retain volume');
  step(4800);
  assert(body.sleeping && !pool.active, 'body sleeps and ripples finish');
  const asleep = body.x.slice(); step(120);
  assert.deepEqual(body.x, asleep, 'water does not keep nudging a sleeping body');
  for (let i = 0; i < 30; i++) pool.disturb(0, 0, 2);
  assert.equal(pool.surface.queuedImpulses, 8, 'pending wave impulses remain bounded');
  pool.reset();
  assert(!pool.active, 'reset clears all ripples');
  const before = body.x.slice();
  pool.enabled = false; pool.reset(); pool.step(PHYS.step); pool.afterStep();
  assert.deepEqual(body.x, before, 'turning pool off does not move the body');
  assert.equal(pool.submerged, 0);
}

// Start across the wall from each side and above it. Use the real visible
// surface to check the contact result, not only the coarse mechanical cage.
for (const offset of [POOL.radius - .009, POOL.outerRadius + .009, (POOL.radius + POOL.outerRadius) / 2]) {
  const {body, pool, step} = setup(offset);
  step(720);
  let penetration = 0;
  const positions = body.surface.positions;
  for (let i = 0; i < positions.length; i += 3) {
    const y = positions[i + 1];
    if (y < PHYS.floor || y > POOL.rimHeight) continue;
    const radius = Math.hypot(positions[i] - POOL.x, positions[i + 2] - POOL.z);
    penetration = Math.max(penetration, Math.min(radius - POOL.radius, POOL.outerRadius - radius, POOL.rimHeight - y));
  }
  assert(penetration < .0015, `visible surface clears pool rim (${penetration}m)`);
  assert(body.volumeRatio() > .8 && body.volumeRatio() < 1.2, 'rim contact retains volume');
  pool.enabled = false;
}

// Drag the real tip binding from the tabletop over the rim, then release into
// the water. This exercises the existing grab solver together with new contacts.
{
  const approach = POOL.outerRadius + .07;
  const {body, pool, step} = setup(approach);
  step(480);
  const positions = body.surface.positions;
  let tip = 0;
  for (let i = 0; i < positions.length / 3; i++) if (positions[i * 3 + 1] > positions[tip * 3 + 1]) tip = i;
  const weights = body.surface.stencils[tip], point = new Vector3();
  for (const [id, weight] of weights) point.addScaledVector(new Vector3().fromArray(body.x, id * 3), weight);
  body.grab = {weights, point: point.clone(), target: point.clone(), lambda: new Float64Array(3)};
  for (let i = 0; i < 360; i++) {
    body.grab.target.set(point.x - approach * Math.min(1, i / 240), point.y + .05, point.z);
    step(1);
  }
  body.grab = null; body.wake(); step(1440);
  assert(Math.hypot(body.center.x, body.center.z) < POOL.radius - .015, 'dragging can enter the pool over its rim');
  assert(pool.submerged > 0, 'released character reaches the water');
  assert(body.volumeRatio() > .8 && body.volumeRatio() < 1.2, 'rim crossing and release retain volume');
}

// This is now a propagated wave field, not a timed collection of visual rings.
{
  const surface = new PoolSurface(POOL.radius, POOL.waterLevel);
  surface.step(1 / 60);
  assert.equal(surface.energy, 0, 'undisturbed surface stays flat');
  surface.disturb(.045, 0, 1);
  for (let i = 0; i < 30; i++) surface.step(1 / 60);
  assert(surface.maxHeight > .0002, 'tap produces millimetre-scale moving waves');
  assert(surface.maxHeight <= surface.limit + 1e-8, 'wave height stays inside pool freeboard');
  assert(surface.pixels.every(Number.isFinite), 'height and normal texture remains finite');
  const n = surface.size, center = Math.floor(n / 2);
  assert(Math.abs(surface.pixels[(center * n + center) * 4]) > .00001, 'disturbance propagates away from its tap location');
  for (let i = 0; i < 1800; i++) surface.step(1 / 60);
  assert(!surface.active, 'reflected waves eventually damp to rest');
  surface.setHull(-.02, 0, .03, .008); surface.reset();
  surface.setHull(.02, 0, .03, .008); surface.step(1 / 60);
  assert(surface.active && surface.maxHeight > .0001, 'moving hull generates a wake without a tap or landing');
  surface.reset();
  assert.equal(surface.energy, 0, 'reset clears the simulation texture');
}

// Pouring disturbs the existing pool while leaving the resting character alone.
{
  const {body, pool, bucket, step} = setup();
  step(960);
  assert.equal(bucket.phase, 'ready', 'idle play never tips the distant bucket');
  const resting = body.x.slice();
  assert(bucket.knock(), 'first knock starts the cycle');
  assert(!bucket.knock(), 'another knock cannot stack a second pour');
  step(240);
  assert.equal(bucket.phase, 'pouring');
  assert(bucket.fill > 0 && bucket.fill < 1 && bucket.flow > .5, 'bucket visibly empties while pouring');
  assert(bucket.impacts > 0 && pool.active && pool.surface.energy > .00001, 'stream impacts drive propagated waves');
  assert(Math.abs(bucket.impact.y - POOL.waterLevel) < 1e-9 && Math.hypot(bucket.impact.x, bucket.impact.z) < POOL.radius, 'ballistic stream lands inside the water');
  assert.deepEqual(body.x, resting, 'pour effects do not move a sleeping character');
  step(1680);
  assert.equal(bucket.phase, 'ready', 'bucket automatically returns after a short delay');
  assert.equal(bucket.fill, 1); assert.equal(bucket.angle, 0); assert.equal(bucket.flow, 0);
  assert(bucket.impacts > 10 && bucket.impacts <= 24, 'pour emits a bounded number of impacts');
  assert(bucket.knock(), 'refilled bucket can be knocked again');
  step(240); bucket.reset(); pool.reset();
  assert.equal(bucket.phase, 'ready'); assert.equal(bucket.flow, 0); assert.equal(bucket.impacts, 0);
  bucket.knock(); bucket.step(2);
  assert.equal(bucket.phase, 'pouring', 'effect clock can advance independently of physics frames');
  assert(bucket.impacts <= 3, 'a long frame cannot queue a burst of catch-up splashes');
  bucket.step(10);
  assert.equal(bucket.phase, 'ready', 'long absence finishes the cycle without a slow catch-up');
  assert.equal(bucket.flow, 0); assert.equal(bucket.fill, 1);
  pool.enabled = false;
  assert(!bucket.knock(), 'disabled pool has no bucket interaction');
}

// Pull the actual soft body toward a stool leg, over the existing pool lip.
{
  const {body, bucket, step} = setup();
  step(480);
  const positions = body.surface.positions;
  let tip = 0;
  for (let i = 0; i < positions.length / 3; i++) if (positions[i * 3 + 1] > positions[tip * 3 + 1]) tip = i;
  const weights = body.surface.stencils[tip], point = new Vector3();
  for (const [id, weight] of weights) point.addScaledVector(new Vector3().fromArray(body.x, id * 3), weight);
  body.grab = {weights, point: point.clone(), target: point.clone(), lambda: new Float64Array(3)};
  for (let i = 0; i < 600 && !bucket.knocks; i++) {
    const progress = Math.min(1, i / 360);
    body.grab.target.set((BUCKET.x + BUCKET.inwardX * .015) * progress, point.y + .035 * Math.sin(progress * Math.PI), (BUCKET.z + BUCKET.inwardZ * .015) * progress);
    step(1);
  }
  assert.equal(bucket.knocks, 1, 'contact with the stool tips the bucket without tapping or debug triggers');
  assert(body.volumeRatio() > .8 && body.volumeRatio() < 1.2, 'stool collision preserves soft-body volume');
  body.grab = null; body.wake(); step(480);
  assert.equal(bucket.knocks, 1, 'remaining near the stool cannot repeatedly retrigger the pour');
}

// The reference emitter releases travelling droplets, not beads teleported
// along a curve. Impacts happen only after flight, and the tail drains at stop.
{
  const emitter = new PourParticles(), source = new Vector3(.08, .11, -.04), velocity = new Vector3(-.1, -.02, 0);
  let hits = 0;
  for (let i = 0; i < 12; i++) {
    source.x += .0002;
    hits += emitter.step(1 / 120, source, velocity, 1, POOL.waterLevel);
  }
  assert.equal(hits, 0, 'water cannot splash before completing its flight');
  assert(emitter.activeCount > 0 && emitter.activeCount <= POUR_PARTICLES.capacity, 'emission storage stays bounded');
  assert(emitter.drops.some(drop => drop.active && drop.velocity.x > -.09), 'droplets inherit the moving lip velocity');
  for (let i = 0; i < 100; i++) hits += emitter.step(1 / 120, source, velocity, 0, POOL.waterLevel);
  assert(hits > 0 && !emitter.active, 'remaining droplets fall into the pool after emission stops');
  assert(emitter.drops.every(drop => [...drop.position.toArray(), ...drop.velocity.toArray()].every(Number.isFinite)), 'particle state stays finite');
  assert(pourMotionStretch(100) <= POUR_PARTICLES.spacing * 3, 'fast droplets cannot stretch across the scene');
  emitter.step(.1, source, velocity, 1, POOL.waterLevel); emitter.step(5, source, velocity, 1, POOL.waterLevel);
  assert(!emitter.active, 'long frame clears the emitter without a catch-up burst');
}

console.log('Pool physics passed: dry equivalence, sleep, entries, bounded waves, rim contacts, bucket recovery, real stool bump and reference pour emission/tail.');
