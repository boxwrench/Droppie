import * as THREE from 'three/webgpu';
import { float, positionLocal, positionWorld, cameraPosition, texture, uniform, uv, vec3, vec4, mix, refract, transformNormalToView } from 'three/tsl';
import { POOL } from '../game/pool-physics.ts';
import type { PoolPhysics } from '../game/pool-physics.ts';
import type { FacilityShadows } from './facility-shadows.ts';
import type { RefractiveLightField } from './refractive-light.js';

/**
 * Pool optics adapted from ScottieFox/caustic-volume's CAUSTIC//LITE (MIT):
 * shared height/slope field, refracted floor rays and area-ratio caustics.
 * See THIRD_PARTY_NOTICES.md for the pinned revision and adaptation notes.
 */
export class Pool {
  readonly group = new THREE.Group();
  private readonly basin: THREE.Mesh;
  private readonly water: THREE.Mesh;
  private readonly field: THREE.DataTexture;
  private readonly fieldPixels: Uint16Array;
  private readonly caustics = new THREE.RenderTarget(256, 256, {type: THREE.HalfFloatType, depthBuffer: false});
  private readonly causticScene = new THREE.Scene();
  private readonly causticCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, .1, 2);
  private readonly causticMesh: THREE.Mesh;
  private readonly physics: PoolPhysics;
  private uploadedRevision = -1;
  private causticRevision = -1;

  constructor(physics: PoolPhysics, shadows: FacilityShadows, optics: RefractiveLightField) {
    this.physics = physics;
    this.group.position.set(POOL.x, 0, POOL.z);
    const surface = physics.surface;
    this.fieldPixels = new Uint16Array(surface.pixels.length);
    this.field = new THREE.DataTexture(this.fieldPixels, surface.size, surface.size, THREE.RGBAFormat, THREE.HalfFloatType);
    this.field.minFilter = this.field.magFilter = THREE.LinearFilter;
    this.field.generateMipmaps = false; this.field.needsUpdate = true;
    const grid = new THREE.PlaneGeometry(POOL.radius * 2, POOL.radius * 2, surface.size - 1, surface.size - 1).rotateX(-Math.PI / 2);
    const waterUV = positionLocal.xz.div(POOL.radius * 2).add(.5);
    const water = texture(this.field, waterUV);
    const waterNormal = vec3(water.g.negate(), 1, water.b.negate()).normalize();

    // Lite refracts one ray per grid vertex onto the floor. Rasterization
    // accumulates overlaps; derivatives give the inverse projected patch area.
    const incident = uniform(new THREE.Vector3().copy(optics.lightDirection).normalize());
    const direction = refract(incident, waterNormal, 1 / 1.333);
    const source = vec3(positionLocal.x, water.r.add(POOL.waterLevel), positionLocal.z);
    const landing = source.add(direction.mul(source.y.div(direction.y.negate().max(.05))));
    const causticMaterial = new THREE.MeshBasicNodeMaterial({
      side: THREE.DoubleSide, transparent: true, blending: THREE.AdditiveBlending,
      depthTest: false, depthWrite: false, toneMapped: false,
    });
    causticMaterial.positionNode = vec3(landing.x.div(POOL.radius), landing.z.div(POOL.radius), 0);
    const sourceUV = uv().toVarying('poolSourceUV');
    const dx = sourceUV.dFdx(), dy = sourceUV.dFdy();
    const focus = dx.x.mul(dy.y).sub(dx.y.mul(dy.x)).abs().mul(256 * 256).min(8);
    const disk = float(sourceUV.sub(.5).length().lessThan(.5));
    causticMaterial.colorNode = vec4(vec3(focus.mul(disk).mul(.9)), 1);
    this.causticMesh = new THREE.Mesh(grid, causticMaterial); this.causticMesh.frustumCulled = false;
    this.causticScene.background = new THREE.Color(0); this.causticScene.add(this.causticMesh);
    this.causticCamera.position.z = 1;

    const profile = [
      [0, .00005], [POOL.radius, .00005], [POOL.radius, POOL.rimHeight - .007],
      [POOL.radius + .001, POOL.rimHeight - .003], [POOL.radius + .004, POOL.rimHeight],
      [POOL.radius + .008, POOL.rimHeight - .002], [POOL.outerRadius, POOL.rimHeight - .007],
      [POOL.outerRadius, .00005], [0, -.00002],
    ].reverse().map(([x, y]) => new THREE.Vector2(x, y));
    const ceramic = new THREE.MeshPhysicalNodeMaterial({roughness: .27, clearcoat: .55, clearcoatRoughness: .19});
    const tiledColor = (point: typeof positionLocal.xz) => {
      const tile = point.div(.016).fract().sub(.5).abs();
      const grout = tile.x.max(tile.y).smoothstep(.455, .49);
      return mix(vec3(.28, .49, .48), vec3(.62, .73, .69), grout);
    };
    const floor = float(1).sub(positionLocal.y.smoothstep(.0002, .004));
    const opticalUV = positionWorld.xz.sub(optics.originNode).div(optics.spanNode);
    const shadowUV = positionWorld.xz.sub(optics.shadowOriginNode).div(optics.shadowSpanNode);
    const shadowInside = float(shadowUV.x.greaterThan(0).and(shadowUV.x.lessThan(1)).and(shadowUV.y.greaterThan(0)).and(shadowUV.y.lessThan(1)));
    const shadow = texture(optics.shadowTexture, shadowUV).r.mul(shadowInside);
    const tileColor = tiledColor(positionLocal.xz);
    const basinUV = positionLocal.xz.div(POOL.radius * 2).add(.5);
    const poolLight = texture(this.caustics.texture, basinUV).rgb;
    ceramic.colorNode = mix(vec3(.89, .86, .77), tileColor, floor).mul(float(1).sub(shadow.mul(.4).mul(floor)));
    const opticalInside = float(opticalUV.x.greaterThan(0).and(opticalUV.x.lessThan(1)).and(opticalUV.y.greaterThan(0)).and(opticalUV.y.lessThan(1)));
    ceramic.emissiveNode = poolLight.mul(tileColor).mul(.32).add(texture(optics.lightTexture, opticalUV).rgb.mul(.14).mul(opticalInside)).mul(floor);
    this.basin = new THREE.Mesh(new THREE.LatheGeometry(profile, 128), ceramic);
    const casters = new THREE.Group(); casters.add(this.basin); this.group.add(casters);
    this.group.updateMatrixWorld(true);
    shadows.add(casters, new THREE.Box3(new THREE.Vector3(-POOL.outerRadius, 0, -POOL.outerRadius), new THREE.Vector3(POOL.outerRadius, POOL.rimHeight, POOL.outerRadius)));

    const waterMaterial = new THREE.MeshPhysicalNodeMaterial({
      color: '#73c7ce', roughness: .075, metalness: .03,
      ior: 1.333, clearcoat: 1, clearcoatRoughness: .06, alphaTest: .05,
    });
    waterMaterial.positionNode = positionLocal.add(vec3(0, water.r, 0));
    waterMaterial.normalNode = transformNormalToView(waterNormal);
    // Refract the tiled receiver analytically, avoiding nested screen-space
    // transmission around the already-translucent character.
    const eye = positionWorld.sub(cameraPosition).normalize();
    const ray = refract(eye, waterNormal, 1 / 1.333);
    const length = water.r.add(POOL.waterLevel).div(ray.y.negate().max(.1));
    const floorPoint = positionWorld.xz.add(ray.xz.mul(length));
    const absorption = vec3(-8, -2.2, -1.4).mul(length).exp();
    const refractedLight = texture(this.caustics.texture, floorPoint.div(POOL.radius * 2).add(.5)).rgb;
    waterMaterial.colorNode = tiledColor(floorPoint).mul(absorption).mul(refractedLight.mul(.35).add(.6));
    waterMaterial.opacityNode = float(positionLocal.xz.length().lessThan(POOL.radius));
    this.water = new THREE.Mesh(grid.clone(), waterMaterial); this.water.position.y = POOL.waterLevel;
    this.water.geometry.computeBoundingBox(); this.water.geometry.boundingBox!.expandByScalar(surface.limit);
    this.group.add(this.water);
  }

  setEnabled(enabled: boolean) {
    this.physics.enabled = enabled; this.physics.reset();
    this.basin.visible = enabled; this.water.visible = enabled;
  }

  update(renderer: THREE.WebGPURenderer) {
    const revision = this.physics.surface.revision;
    if (this.uploadedRevision !== revision) {
      const pixels = this.physics.surface.pixels;
      for (let i = 0; i < pixels.length; i++) this.fieldPixels[i] = THREE.DataUtils.toHalfFloat(pixels[i]);
      this.field.needsUpdate = true; this.uploadedRevision = revision;
    }
    if (!this.physics.enabled || this.causticRevision === revision) return;
    const target = renderer.getRenderTarget(), autoClear = renderer.autoClear;
    try {
      renderer.autoClear = true; renderer.setRenderTarget(this.caustics);
      renderer.render(this.causticScene, this.causticCamera); this.causticRevision = revision;
    } finally { renderer.setRenderTarget(target); renderer.autoClear = autoClear; }
  }

  dispose() {
    for (const mesh of [this.basin, this.water, this.causticMesh]) {
      mesh.geometry.dispose(); (mesh.material as THREE.Material).dispose();
    }
    this.field.dispose(); this.caustics.dispose(); this.group.clear(); this.causticScene.clear();
  }
}
