import assert from 'node:assert/strict';
import { Vector3 } from 'three/webgpu';
import { SoftBody } from '../src/physics/soft-body.js';
import { PHYS } from '../src/physics/constants.js';
import { Locomotion } from '../src/game/locomotion.ts';
import { PoolPhysics, POOL } from '../src/game/pool-physics.ts';
import { loadModel } from './load-model.mjs';

function setup(offset = 0) {
  const body = new SoftBody(loadModel());
  for (let j = 0; j < body.x.length; j += 3) body.x[j] += offset;
  body.updateCenter();
  const rig = new Locomotion(body), pool = new PoolPhysics(body);
  const step = (count) => {
    for (let i = 0; i < count; i++) {
      rig.step(PHYS.step); pool.step(PHYS.step); body.step(PHYS.step); pool.afterStep(); rig.afterStep();
      assert(body.isFinite(), 'pool interaction remains finite');
      assert(body.minimumJacobian() > .1, 'pool contact preserves cage orientation');
    }
    body.updateSurface();
  };
  return {body, rig, pool, step};
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
  assert(splashes >= 3 && splashes <= 4, 'each hop and re-entry produces one bounded splash');
  assert(pool.active, 're-entry produces visible ripples');
  assert(body.volumeRatio() > .8 && body.volumeRatio() < 1.2, 'water forces retain volume');
  step(1440);
  assert(body.sleeping && !pool.active, 'body sleeps and ripples finish');
  const asleep = body.x.slice(); step(120);
  assert.deepEqual(body.x, asleep, 'water does not keep nudging a sleeping body');
  for (let i = 0; i < 30; i++) pool.disturb(0, 0, 2);
  assert.equal(pool.ripples.length, POOL.rippleCount, 'ripple storage remains bounded');
  assert(pool.ripples.every(ripple => ripple.strength <= 1));
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
  const {body, pool, step} = setup(.14);
  step(480);
  const positions = body.surface.positions;
  let tip = 0;
  for (let i = 0; i < positions.length / 3; i++) if (positions[i * 3 + 1] > positions[tip * 3 + 1]) tip = i;
  const weights = body.surface.stencils[tip], point = new Vector3();
  for (const [id, weight] of weights) point.addScaledVector(new Vector3().fromArray(body.x, id * 3), weight);
  body.grab = {weights, point: point.clone(), target: point.clone(), lambda: new Float64Array(3)};
  for (let i = 0; i < 360; i++) {
    body.grab.target.set(point.x - .14 * Math.min(1, i / 240), point.y + .025, point.z);
    step(1);
  }
  body.grab = null; body.wake(); step(1440);
  assert(Math.hypot(body.center.x, body.center.z) < POOL.radius - .015, 'dragging can enter the pool over its rim');
  assert(pool.submerged > 0, 'released character reaches the water');
  assert(body.volumeRatio() > .8 && body.volumeRatio() < 1.2, 'rim crossing and release retain volume');
}

console.log('Pool physics passed: dry equivalence, sleep, repeated entries, reset, bounded ripples, rim contacts and drag into water.');
