import * as THREE from 'three/webgpu';
import { texture, positionWorld, float, vec2, vec3, normalMap, reflector } from 'three/tsl';
import type { RefractiveLightField } from './refractive-light.js';
import type { FacilityShadows } from './facility-shadows.ts';
import type { WetSurface } from '../water/wet-surface.ts';

/** Deliberately strong while the mechanism is being proven. */
const WET_REFLECTION=.30;

export async function makeTable(optics:RefractiveLightField,light:{color:THREE.Color;windowFraction:number;irradiance:number},facilities:FacilityShadows,wetness:WetSurface) {
  const loader=new THREE.TextureLoader();
  const urls=[new URL('../assets/wood_texture/wood_base.jpg',import.meta.url).href,
    new URL('../assets/wood_texture/wood_normal.png',import.meta.url).href,
    new URL('../assets/wood_texture/wood_roughness.jpg',import.meta.url).href];
  const [base,normal,roughness]=await Promise.all(urls.map(url=>loader.loadAsync(url)));
  base.colorSpace=THREE.SRGBColorSpace;
  for(const t of [base,normal,roughness]) {t.wrapS=t.wrapT=THREE.RepeatWrapping;t.anisotropy=8;}
  // Orient the grain along narrow hardwood boards, in world metres so the
  // droplet and its refraction share the same continuous floor pattern.
  const along=positionWorld.x.mul(.94).add(positionWorld.z.mul(.342));
  const across=positionWorld.z.mul(.94).sub(positionWorld.x.mul(.342));
  const board=across.add(.016).div(.035);
  const boardId=board.floor();
  const uv=vec2(across,along).div(.65).add(.5);
  const edge=board.fract().sub(.5).abs();
  const longSeam=edge.smoothstep(.482,.498);
  const end=along.div(.21).add(boardId.mul(.381)).fract().sub(.5).abs();
  const endSeam=end.smoothstep(.497,.4995);
  const seam=longSeam.max(endSeam);
  const boardShade=boardId.mul(12.9898).sin().mul(43758.5453).fract().mul(.12).add(.88);
  const opticalUV=positionWorld.xz.sub(optics.originNode).div(optics.spanNode);
  const inside=float(opticalUV.x.greaterThan(0).and(opticalUV.x.lessThan(1)).and(opticalUV.y.greaterThan(0)).and(opticalUV.y.lessThan(1)));
  const shadowUV=positionWorld.xz.sub(optics.shadowOriginNode).div(optics.shadowSpanNode);
  const shadowInside=float(shadowUV.x.greaterThan(0).and(shadowUV.x.lessThan(1)).and(shadowUV.y.greaterThan(0)).and(shadowUV.y.lessThan(1)));
  const shadow=texture(optics.shadowTexture,shadowUV).r.mul(shadowInside);
  const contactUV=positionWorld.xz.sub(optics.contactOriginNode).div(optics.shadowSpanNode);
  const contactInside=float(contactUV.x.greaterThan(0).and(contactUV.x.lessThan(1)).and(contactUV.y.greaterThan(0)).and(contactUV.y.lessThan(1)));
  const contact=texture(optics.shadowTexture,contactUV).g.mul(contactInside);
  // Wet wood reads as gloss far more than as darkness: the roughness drop is
  // the cue, the slight darkening only supports it.
  const wetUV=positionWorld.xz.sub(wetness.originNode).div(wetness.spanNode).add(.5);
  const wetInside=float(wetUV.x.greaterThan(0).and(wetUV.x.lessThan(1)).and(wetUV.y.greaterThan(0)).and(wetUV.y.lessThan(1)));
  const wet=texture(wetness.texture,wetUV).r.mul(wetInside);
  // A low-resolution planar reflection of the room, added to the floor only
  // where the mask says it is wet. Gloss alone cannot carry this scene: the HDR
  // is an evenly lit interior, so a mirror in it returns nearly the luminance of
  // the wood it replaces. Reflecting the actual scene puts Droppie and the
  // window into the puddle, which is contrast the environment map never had.
  const reflection=reflector({resolutionScale:.15,bounces:false});
  reflection.target.rotateX(-Math.PI/2);
  const albedo=texture(base,uv).rgb.mul(vec3(.72,.39,.18)).mul(boardShade).mul(float(1).sub(seam.mul(.70)));
  const material=new THREE.MeshPhysicalNodeMaterial({metalness:0,roughness:.26,clearcoat:.38,clearcoatRoughness:.23});
  const facilityUV=facilities.worldToUVNode.mul(vec3(positionWorld.xz,1)).xy;
  const facilityInside=float(facilityUV.x.greaterThan(0).and(facilityUV.x.lessThan(1)).and(facilityUV.y.greaterThan(0)).and(facilityUV.y.lessThan(1)));
  // A deterministic tent filter softens the finite window's occlusion. No
  // temporal noise, transparent sorting, or nearly coplanar depth comparisons.
  let facilityMask=vec2(0,0).add(0);
  for(let y=-1;y<=1;y++)for(let x=-1;x<=1;x++) {
    const weight=(x===0?2:1)*(y===0?2:1)/16;
    facilityMask=facilityMask.add(texture(facilities.target.texture,facilityUV.add(vec2(x,y).mul(1.5/512))).rg.mul(weight));
  }
  const facilityShadow=facilityMask.x.mul(facilityInside),facilityContact=facilityMask.y.mul(facilityInside);
  const visibility=float(1).sub(shadow).mul(float(1).sub(facilityShadow));
  material.colorNode=albedo.mul(float(1).sub(float(1).sub(visibility).mul(light.windowFraction))).mul(float(1).sub(contact.mul(.40))).mul(float(1).sub(facilityContact.mul(.35))).mul(float(1).sub(wet.mul(.18))).add(reflection.rgb.mul(wet.pow(.7)).mul(WET_REFLECTION));
  // Plane UV-v points toward -Z; the metre-scaled world UV points toward +Z.
  material.normalNode=normalMap(texture(normal,uv),vec2(.27,-.27));
  const dryRoughness=texture(roughness,uv).r.mul(.24).add(.12).add(seam.mul(.22));
  // The floor already carries a fixed clearcoat, and that layer owns the
  // specular response, so wetness is driven almost entirely into the coat and
  // the base roughness barely moves. Dry the coat sits at .38/.23; fully wet it
  // reaches 1.0/.028, which is what actually reads as water.
  material.roughnessNode=dryRoughness.mul(float(1).sub(wet.mul(.15)));
  material.clearcoatNode=float(.38).add(wet.mul(.62)).min(1);
  material.clearcoatRoughnessNode=float(.23).mul(float(1).sub(wet.mul(.97)));
  material.clearcoatNormalNode=normalMap(texture(normal,uv),vec2(.27,-.27).mul(float(1).sub(wet)));
  material.emissiveNode=albedo.mul(texture(optics.lightTexture,opticalUV).rgb).mul(light.irradiance/Math.PI).mul(vec3(light.color.r,light.color.g,light.color.b)).mul(inside).mul(float(1).sub(facilityShadow));
  const mesh=new THREE.Mesh(new THREE.PlaneGeometry(200,200),material);
  mesh.rotation.x=-Math.PI/2;mesh.position.y=-.00005;
  return {mesh,reflectorTarget:reflection.target,dispose:()=>{mesh.geometry.dispose();material.dispose();[base,normal,roughness].forEach(t=>t.dispose());}};
}
