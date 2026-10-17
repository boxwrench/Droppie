import * as THREE from 'three/webgpu';
import { positionLocal, positionWorld, uniform, vec3, vec4 } from 'three/tsl';
import { BUCKET, type PourBucket } from '../game/pour-bucket.ts';
import { PHYS } from '../physics/constants.js';
import type { FacilityShadows } from './facility-shadows.ts';

const RINGS = 25, SIDES = 8;

/** Enamel pail on a little wooden stool, plus one reusable water-stream mesh. */
export class BucketVisual {
  readonly group = new THREE.Group();
  readonly pickables: THREE.Mesh[] = [];
  private readonly solids = new THREE.Group();
  private readonly stool = new THREE.Group();
  private readonly pivot = new THREE.Group();
  private readonly water: THREE.Mesh;
  private readonly stream: THREE.Mesh;
  private readonly droplets: THREE.InstancedMesh;
  private readonly physics: PourBucket;
  private readonly center = new THREE.Vector3();
  private readonly normal = new THREE.Vector3();
  private readonly tangent = new THREE.Vector3();
  private readonly side = new THREE.Vector3(-BUCKET.inwardZ, 0, BUCKET.inwardX);
  private readonly matrix = new THREE.Matrix4();
  private readonly scale = new THREE.Vector3();
  private readonly rotation = new THREE.Quaternion();
  private readonly waterInverse = uniform(new THREE.Matrix4());

  constructor(physics: PourBucket, shadows: FacilityShadows) {
    this.physics = physics;
    this.group.add(this.solids);
    this.solids.position.set(BUCKET.x, 0, BUCKET.z);
    this.solids.rotation.y = Math.atan2(-BUCKET.inwardZ, BUCKET.inwardX);
    this.solids.add(this.stool, this.pivot);
    this.pivot.position.set(BUCKET.pivotOffset, BUCKET.baseY, 0);
    const wood = new THREE.MeshPhysicalNodeMaterial({color: '#b58b56', roughness: .48, clearcoat: .16});
    const grain = positionLocal.y.mul(180).add(positionLocal.x.mul(2300)).sin().mul(.045).add(.955);
    wood.colorNode = vec3(wood.color.r, wood.color.g, wood.color.b).mul(grain);
    const cream = new THREE.MeshPhysicalNodeMaterial({color: '#f0e4c8', roughness: .28, clearcoat: .45});
    const enamel = new THREE.MeshPhysicalNodeMaterial({color: '#dc8062', roughness: .24, clearcoat: .85, clearcoatRoughness: .18});
    const metal = new THREE.MeshStandardNodeMaterial({color: '#9a9b90', metalness: .8, roughness: .25});
    const add = (parent: THREE.Group, geometry: THREE.BufferGeometry, material: THREE.Material, x: number, y: number, z: number) => {
      const mesh = new THREE.Mesh(geometry, material); mesh.position.set(x, y, z); parent.add(mesh); this.pickables.push(mesh); return mesh;
    };
    for (const x of [-.021, .021]) for (const z of [-.021, .021]) {
      add(this.stool, new THREE.CylinderGeometry(.004, .0048, BUCKET.seatHeight, 12), wood, x, BUCKET.seatHeight / 2, z);
      add(this.stool, new THREE.SphereGeometry(.0017, 8, 6), metal, x, BUCKET.seatHeight + .0083, z);
    }
    add(this.stool, new THREE.CylinderGeometry(BUCKET.seatRadius, BUCKET.seatRadius, .008, 48), wood, 0, BUCKET.seatHeight + .004, 0);
    for (const z of [-.021, .021]) {
      const brace = add(this.stool, new THREE.CylinderGeometry(.002, .002, .042, 10), wood, 0, .023, z); brace.rotation.z = Math.PI / 2;
    }
    for (const x of [-.021, .021]) {
      const brace = add(this.stool, new THREE.CylinderGeometry(.002, .002, .042, 10), wood, x, .029, 0); brace.rotation.x = Math.PI / 2;
    }
    const profile = [[0, .001], [.018, .001], [BUCKET.radius, BUCKET.height], [BUCKET.radius - .002, BUCKET.height], [.0165, .004], [0, .004]];
    add(this.pivot, new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), 48), enamel, -BUCKET.pivotOffset, 0, 0);
    for (const [radius, y] of [[BUCKET.radius, BUCKET.height], [.0185, .002]]) {
      const ring = add(this.pivot, new THREE.TorusGeometry(radius, .0015, 8, 48), cream, -BUCKET.pivotOffset, y, 0); ring.rotation.x = Math.PI / 2;
    }
    const handle = add(this.pivot, new THREE.TorusGeometry(BUCKET.radius * .96, .0013, 8, 32, Math.PI), metal,
      -BUCKET.pivotOffset, BUCKET.height - .007, 0); handle.rotation.y = Math.PI / 2;
    for (const z of [-BUCKET.radius, BUCKET.radius]) add(this.pivot, new THREE.SphereGeometry(.0025, 10, 8), cream, -BUCKET.pivotOffset, BUCKET.height - .007, z);

    // A horizontal free surface, clipped against the tilted bucket interior.
    // It must not rotate with the shell like a blue lid.
    const waterMaterial = new THREE.MeshPhysicalNodeMaterial({color: '#61b9ce', roughness: .08, clearcoat: 1, metalness: .04,
      transparent: true, opacity: .8, depthWrite: false});
    const local = this.waterInverse.mul(vec4(positionWorld, 1)).xyz;
    const innerRadius = local.y.sub(.004).div(BUCKET.height - .004).mul(.0065).add(.0165);
    waterMaterial.maskNode = local.y.greaterThan(.004).and(local.y.lessThan(BUCKET.height - .001)).and(
      local.x.add(BUCKET.pivotOffset).pow2().add(local.z.pow2()).lessThan(innerRadius.pow2()),
    );
    this.water = new THREE.Mesh(new THREE.CircleGeometry(1, 40).rotateX(-Math.PI / 2), waterMaterial);
    this.water.scale.setScalar(.06); this.group.add(this.water);
    this.group.updateMatrixWorld(true);
    shadows.add(this.solids, new THREE.Box3(new THREE.Vector3(BUCKET.x - .11, 0, BUCKET.z - .06), new THREE.Vector3(BUCKET.x + .07, .16, BUCKET.z + .13)));

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(RINGS * SIDES * 3), 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(RINGS * SIDES * 3), 3));
    const indices = [];
    for (let ring = 0; ring < RINGS - 1; ring++) for (let side = 0; side < SIDES; side++) {
      const a = ring * SIDES + side, b = ring * SIDES + (side + 1) % SIDES;
      indices.push(a, b, a + SIDES, b, b + SIDES, a + SIDES);
    }
    geometry.setIndex(indices);
    const streamMaterial = new THREE.MeshPhysicalNodeMaterial({color: '#70c7e3', roughness: .07, transmission: .65,
      ior: 1.333, thickness: .007, clearcoat: 1, side: THREE.DoubleSide});
    this.stream = new THREE.Mesh(geometry, streamMaterial); this.stream.frustumCulled = false; this.stream.renderOrder = 1;
    this.group.add(this.stream);
    this.droplets = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 8, 6), streamMaterial, 10);
    this.droplets.frustumCulled = false; this.group.add(this.droplets);
    this.update();
  }

  update() {
    const p = this.physics;
    this.group.visible = p.enabled;
    this.solids.traverse(object => { if (object instanceof THREE.Mesh) object.visible = p.enabled; });
    this.pivot.rotation.z = -p.angle;
    this.stool.rotation.z = p.phase === 'tipping' ? Math.sin(p.elapsed * 32) * .025 * (1 - p.elapsed / BUCKET.tipTime) : 0;
    this.water.visible = p.enabled && p.fill > .02;
    this.pivot.updateWorldMatrix(true, false);
    this.waterInverse.value.copy(this.pivot.matrixWorld).invert();
    this.water.position.set(-BUCKET.pivotOffset, .025, 0).applyMatrix4(this.pivot.matrixWorld);
    const c = Math.cos(p.angle), s = Math.sin(p.angle);
    const bottom = BUCKET.baseY + .004 * c + (BUCKET.pivotOffset - .0165) * s;
    const lip = BUCKET.baseY + BUCKET.height * c - (BUCKET.radius - BUCKET.pivotOffset) * s;
    const level = Math.min(BUCKET.baseY + .043 * c + BUCKET.pivotOffset * s, lip - .001);
    this.water.position.y = bottom + Math.max(0, level - bottom) * Math.sqrt(p.fill);
    this.stream.visible = this.droplets.visible = p.enabled && p.flow > .02;
    if (!this.stream.visible) return;
    const positions = this.stream.geometry.attributes.position as THREE.BufferAttribute;
    const normals = this.stream.geometry.attributes.normal as THREE.BufferAttribute;
    for (let ring = 0; ring < RINGS; ring++) {
      const fraction = ring / (RINGS - 1);
      p.sampleStream(fraction, this.center);
      this.tangent.copy(p.velocity); this.tangent.y -= PHYS.gravity * fraction * p.flightTime; this.tangent.normalize();
      this.normal.crossVectors(this.tangent, this.side).normalize();
      const radius = .0033 * Math.sqrt(p.flow) * (1 - fraction * .42) * (1 + Math.sin(fraction * 22 - p.elapsed * 28) * .09);
      for (let side = 0; side < SIDES; side++) {
        const angle = side / SIDES * Math.PI * 2, c = Math.cos(angle), s = Math.sin(angle), i = ring * SIDES + side;
        const nx = this.side.x * c + this.normal.x * s, ny = this.normal.y * s, nz = this.side.z * c + this.normal.z * s;
        positions.setXYZ(i, this.center.x + nx * radius, this.center.y + ny * radius, this.center.z + nz * radius);
        normals.setXYZ(i, nx, ny, nz);
      }
    }
    positions.needsUpdate = normals.needsUpdate = true;
    for (let i = 0; i < this.droplets.count; i++) {
      const fraction = ((p.elapsed * 1.8 + i / this.droplets.count) % 1) * .9 + .1;
      p.sampleStream(fraction, this.center);
      this.center.addScaledVector(this.side, Math.sin(i * 17 + p.elapsed * 9) * .003 * fraction);
      const radius = (.001 + (i % 3) * .00035) * Math.sqrt(p.flow);
      this.scale.set(radius, radius * 1.5, radius); this.matrix.compose(this.center, this.rotation, this.scale);
      this.droplets.setMatrixAt(i, this.matrix);
    }
    this.droplets.instanceMatrix.needsUpdate = true;
  }

  prepareCompile() {
    // Warm the first pour's shaders during startup, without drawing the stream.
    this.stream.visible = this.droplets.visible = true;
  }

  dispose() {
    const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>();
    this.group.traverse(object => {
      if (object instanceof THREE.Mesh) { geometries.add(object.geometry); materials.add(object.material as THREE.Material); }
    });
    geometries.forEach(geometry => geometry.dispose()); materials.forEach(material => material.dispose());
    this.droplets.dispose(); this.pickables.length = 0;
    this.group.clear(); this.group.removeFromParent();
  }
}
