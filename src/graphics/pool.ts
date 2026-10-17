import * as THREE from 'three/webgpu';
import { float, positionLocal, positionWorld, texture, uniform, vec2, vec3, mix, transformNormalToView } from 'three/tsl';
import { POOL } from '../game/pool-physics.ts';
import type { PoolPhysics } from '../game/pool-physics.ts';
import type { FacilityShadows } from './facility-shadows.ts';
import type { RefractiveLightField } from './refractive-light.js';

/** One ceramic basin and one bounded, rippling water surface. No new assets. */
export class Pool {
  readonly group = new THREE.Group();
  private readonly basin: THREE.Mesh;
  private readonly water: THREE.Mesh;
  private readonly rippleNodes = Array.from({length: POOL.rippleCount}, () => uniform(new THREE.Vector4(0, 0, POOL.rippleLifetime, 0)));
  private readonly physics: PoolPhysics;

  constructor(physics: PoolPhysics, shadows: FacilityShadows, optics: RefractiveLightField) {
    this.physics = physics;
    this.group.position.set(POOL.x, 0, POOL.z);
    const profile = [
      [0, .00005], [POOL.radius, .00005], [POOL.radius, .008],
      [.077, .010], [.080, .012], [.083, .010], [POOL.outerRadius, .006],
      [POOL.outerRadius, .00005], [0, -.00002],
    ].reverse().map(([x, y]) => new THREE.Vector2(x, y));
    const ceramic = new THREE.MeshPhysicalNodeMaterial({color: '#f3eee0', roughness: .23, clearcoat: .7, clearcoatRoughness: .18});
    // Subtle small tiles make the pool depth visible through its clear water.
    const tile = positionLocal.xz.div(.012).fract().sub(.5).abs();
    const grout = tile.x.max(tile.y).smoothstep(.455, .49);
    const floor = float(1).sub(positionLocal.y.smoothstep(.0002, .003));
    const opticalUV = positionWorld.xz.sub(optics.originNode).div(optics.spanNode);
    const shadowUV = positionWorld.xz.sub(optics.shadowOriginNode).div(optics.shadowSpanNode);
    const contactUV = positionWorld.xz.sub(optics.contactOriginNode).div(optics.shadowSpanNode);
    const shadowInside = float(shadowUV.x.greaterThan(0).and(shadowUV.x.lessThan(1)).and(shadowUV.y.greaterThan(0)).and(shadowUV.y.lessThan(1)));
    const contactInside = float(contactUV.x.greaterThan(0).and(contactUV.x.lessThan(1)).and(contactUV.y.greaterThan(0)).and(contactUV.y.lessThan(1)));
    const opticalInside = float(opticalUV.x.greaterThan(0).and(opticalUV.x.lessThan(1)).and(opticalUV.y.greaterThan(0)).and(opticalUV.y.lessThan(1)));
    const shadow = texture(optics.shadowTexture, shadowUV).r.mul(shadowInside);
    const contact = texture(optics.shadowTexture, contactUV).g.mul(contactInside);
    const tileColor = vec3(.42, .67, .66).mul(float(1).sub(grout.mul(.16)));
    ceramic.colorNode = mix(vec3(.89, .86, .77), tileColor, floor).mul(float(1).sub(shadow.mul(.35).add(contact.mul(.35)).mul(floor)));
    ceramic.emissiveNode = texture(optics.lightTexture, opticalUV).rgb.mul(vec3(.22, .32, .31)).mul(floor).mul(opticalInside);
    this.basin = new THREE.Mesh(new THREE.LatheGeometry(profile, 96), ceramic);
    const casters = new THREE.Group(); casters.add(this.basin);
    this.group.add(casters);
    this.group.updateMatrixWorld(true);
    shadows.add(casters, new THREE.Box3(new THREE.Vector3(-POOL.outerRadius, 0, -POOL.outerRadius), new THREE.Vector3(POOL.outerRadius, POOL.rimHeight, POOL.outerRadius)));

    const waterMaterial = new THREE.MeshPhysicalNodeMaterial({
      // A clear reflective overlay avoids nesting a second screen-space
      // transmission pass around the already-transmissive character.
      color: '#83d3df', roughness: .10, metalness: 0, transparent: true,
      opacity: .3, depthWrite: false, ior: 1.333, clearcoat: 1,
      clearcoatRoughness: .08, alphaTest: .05,
    });
    const distance = positionLocal.xz.length();
    const edge = float(1).sub(distance.div(POOL.radius).pow(8)).max(0);
    let height = float(0).add(0), slope = vec2(0).add(0);
    for (const ripple of this.rippleNodes) {
      const offset = positionLocal.xz.sub(ripple.xy);
      const radius = offset.length().max(.0001);
      const packet = radius.sub(ripple.z.mul(.085));
      const envelope = packet.mul(packet).mul(-7000).exp().mul(ripple.z.mul(-1.8).exp()).mul(ripple.w).mul(.0011);
      const phase = radius.mul(230).sub(ripple.z.mul(22));
      height = height.add(phase.sin().mul(envelope));
      const derivative = phase.cos().mul(230).sub(phase.sin().mul(packet).mul(14000)).mul(envelope);
      slope = slope.add(offset.div(radius).mul(derivative));
    }
    waterMaterial.positionNode = positionLocal.add(vec3(0, height.mul(edge), 0));
    waterMaterial.normalNode = transformNormalToView(vec3(slope.x.mul(edge).negate(), 1, slope.y.mul(edge).negate()).normalize());
    waterMaterial.colorNode = vec3(.28, .63, .68).add(height.mul(edge).mul(100));
    waterMaterial.opacityNode = float(distance.lessThan(POOL.radius)).mul(.3);
    this.water = new THREE.Mesh(new THREE.PlaneGeometry(POOL.radius * 2, POOL.radius * 2, 48, 48).rotateX(-Math.PI / 2), waterMaterial);
    this.water.position.y = POOL.waterLevel;
    this.water.geometry.computeBoundingBox();
    this.water.geometry.boundingBox!.expandByScalar(.002);
    this.group.add(this.water);
  }

  setEnabled(enabled: boolean) {
    this.physics.enabled = enabled;
    this.physics.reset();
    // FacilityShadows observes the mesh visibility directly, including toggles.
    this.basin.visible = enabled; this.water.visible = enabled;
  }

  update() {
    for (let i = 0; i < this.rippleNodes.length; i++) {
      const ripple = this.physics.ripples[i];
      this.rippleNodes[i].value.set(ripple.x, ripple.z, ripple.age, ripple.strength);
    }
  }

  dispose() {
    for (const mesh of [this.basin, this.water]) {
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    }
    this.group.clear();
  }
}
