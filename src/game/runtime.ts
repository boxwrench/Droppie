import * as THREE from 'three/webgpu';
import { SoftBody } from '../physics/soft-body.js';
import { PHYS } from '../physics/constants.js';
import { loadBabyCage } from '../physics/baby-cage.ts';
import { RefractiveLightField } from '../graphics/refractive-light.js';
import { Baby, ABSORPTION } from '../graphics/baby.ts';
import { loadEnvironment } from '../graphics/environment.ts';
import { makeTable } from '../graphics/table.ts';
import { Locomotion } from './locomotion.ts';
import { Input } from './input.ts';
import { JellySound } from './sound.ts';
import { createRenderer, resizeView } from '../graphics/renderer.ts';
import { OpticalTransport } from '../graphics/transport.ts';
import { createComposite } from '../graphics/composite.ts';
import { FixedStepper } from './fixed-step.ts';
import { FacilityShadows } from '../graphics/facility-shadows.ts';
import { WetSurface } from '../water/wet-surface.ts';
import { SplashParticles } from '../water/splash-particles.ts';
import { Puddle } from '../water/puddle.ts';
import { quality, observeFrame } from '../graphics/quality.ts';

export async function startGame(stage:(s:string)=>void,fail:(e:unknown)=>void) {
  stage('Starting WebGPU');
  const renderer=await createRenderer(fail);
  document.querySelector('#viewport')!.appendChild(renderer.domElement);
  // Construct audio before the remaining async scene work so the first mobile
  // gesture can unlock Web Audio even while assets and shaders are settling.
  const sound=new JellySound();
  const scene=new THREE.Scene();
  scene.background=new THREE.Color('#e8d9c3');scene.fog=new THREE.Fog('#e8d9c3',2,12);
  const camera=new THREE.PerspectiveCamera(36,1,.001,40);
  camera.position.set(.015,.115,.175);
  stage('Reading the light');
  const environment=await loadEnvironment(renderer,scene);
  stage('Shaping Droppie');
  const body=new SoftBody(await loadBabyCage());
  const baby=new Baby(body);scene.add(baby.group);
  const optics=new RefractiveLightField(body.cage.opticalSurface,environment.incoming,ABSORPTION);
  const facilityShadows=new FacilityShadows(environment.incoming);
  const wetness=new WetSurface();
  const splash=new SplashParticles(wetness);scene.add(splash.mesh);
  const puddle=new Puddle(wetness);scene.add(puddle.mesh);
  const table=await makeTable(optics,environment,facilityShadows,wetness);scene.add(table.mesh);
  scene.add(table.reflectorTarget);
  const composite=createComposite(renderer,scene,camera);
  const rig=new Locomotion(body);
  rig.onContact=(speed,foot)=>{
    sound.contact(speed,foot);wetness.impact(body.center,speed);
    // Only a real landing sprays; a gentle touch just wets the wood.
    if(speed>.22)splash.burst(body.center,Math.min(speed,.9)*.55,4+Math.round(Math.min(speed,.9)*5),rig.velocity);
  };
  const physicsClock=new FixedStepper(PHYS.step);
  let lastTime=0,disposed=false;
  const reset=()=>{sound.stopFacilities();input.clear();rig.reset();body.reset();input.recenter();baby.resetFace();physicsClock.reset();wetness.clear();splash.clear();puddle.hide();};
  const input=new Input(camera,renderer.domElement,body,baby.mesh,rig,sound,reset);
  if(import.meta.env.DEV)Object.defineProperty(window,'dropletDebug',{configurable:true,get:()=>({
    center:body.center.toArray(),sleeping:body.sleeping,grabs:body.grabs.length,volume:body.volumeRatio(),
    camera:camera.position.toArray(),finite:body.isFinite(),quality:{...quality},
    thickness:[Math.min(...body.surface.geometry.attributes.opticalThickness.array),Math.max(...body.surface.geometry.attributes.opticalThickness.array)],
    showPuddle:(radius?:number)=>puddle.show(body.center,radius??.052),
    hidePuddle:()=>puddle.hide(),
    forceWetTrail:()=>{for(let i=-6;i<=6;i++)wetness.add({x:body.center.x+i*.012,z:body.center.z+i*.006,radius:.05,strength:1,lifetime:600});},
    splash:(count?:number,speed?:number)=>splash.burst(body.center,speed??.55,count??24,rig.velocity),
  })});
  const transport=new OpticalTransport(optics,body,camera,environment.incoming,fail);
  const resize=()=>resizeView(renderer,camera,input.controls);
  let resizeFrame=0;
  const resizeObserver=new ResizeObserver(()=>{
    cancelAnimationFrame(resizeFrame);resizeFrame=requestAnimationFrame(resize);
  });
  resizeObserver.observe(document.querySelector('#viewport')!);resize();
  document.querySelector('#reset')!.addEventListener('click',event=>{
    reset();if((event as MouseEvent).detail>0)(event.currentTarget as HTMLButtonElement).blur();
  });
  document.querySelector('#sound')!.addEventListener('click',event=>{
    const muted=sound.toggle(),button=document.querySelector('#sound')!;
    button.setAttribute('aria-pressed',String(muted));button.setAttribute('aria-label',muted?'Enable sound':'Mute sound');
    button.classList.toggle('muted',muted);void sound.unlock().catch(()=>{});
    if((event as MouseEvent).detail>0)(event.currentTarget as HTMLButtonElement).blur();
  });
  stage('Settling in');
  // Let contact establish itself before displaying the first frame.
  for(let i=0;i<80;i++){rig.step(PHYS.step);body.step(PHYS.step);}
  body.updateSurface();baby.update();input.update(1);
  facilityShadows.update(renderer);
  optics.update(renderer,body,true);
  await transport.update();
  stage('Compiling the material');
  await renderer.compileAsync(scene,camera);
  stage('Drawing the first frame');
  composite.render();
  // Fence first-frame GPU work so validation/OOM cannot masquerade as a successful boot.
  const backend=renderer.backend as unknown as {device:GPUDevice};
  await backend.device.queue.onSubmittedWorkDone();
  lastTime=performance.now();
  const renderedCamera=new THREE.Vector3(Infinity,Infinity,Infinity);
  const renderedRotation=new THREE.Quaternion();
  const lastWet=new THREE.Vector2(body.center.x,body.center.z);
  let renderedSurface=-1,renderedFace=-1,renderedThickness=-1,renderedDpr=-1;
  let renderedSize='';
  const frame=(time:number)=>{
    if(disposed)return;
    try {
      const dt=Math.min(.05,Math.max(0,(time-lastTime)/1000));lastTime=time;
      if(document.hidden){physicsClock.reset();return;}
      const steps=physicsClock.advance(dt,()=>{
        input.step(PHYS.step);rig.step(PHYS.step);
        body.step(PHYS.step);input.afterPhysicsStep();rig.afterStep();
      });
      if(steps&&body.surfaceDirty) {
        if(!body.isFinite())throw new Error('The soft-body simulation produced an invalid state');
        body.updateSurface();
      }
      baby.update(dt);
      if(observeFrame(dt))resize();
      transport.rate=quality.opticalHz;
      // Wetness comes from the part of him actually touching the wood, not from
      // his centre of mass: as he squishes and slides the mark follows the
      // trailing contact patch instead of looking like stamps dropped from above.
      let sx=0,sz=0,weight=0;
      for(let i=0;i<body.contact.length;i++) {
        const c=body.contact[i];if(c<=0)continue;
        const w=c*body.mass[i];sx+=body.x[i*3]*w;sz+=body.x[i*3+2]*w;weight+=w;
      }
      if(weight>0) {
        const wx=sx/weight,wz=sz/weight;
        if(Math.hypot(wx-lastWet.x,wz-lastWet.y)>.0025) {
          wetness.add({x:wx,z:wz,radius:.024,strength:.8,lifetime:4});
          lastWet.set(wx,wz);
        }
      }
      wetness.update(dt,body.center);
      splash.update(dt);
      puddle.update(dt);
      input.update(dt);
      sound.listen(camera);
      transport.follow();
      optics.update(renderer,body);
      table.mesh.position.x=body.center.x;table.mesh.position.z=body.center.z;
      void transport.update().catch(fail);
      const faceVersion=baby.group.children.reduce((sum,child)=>sum+(((child as THREE.Mesh).geometry?.attributes.position as THREE.BufferAttribute|undefined)?.version??0),0);
      const thicknessVersion=body.surface.geometry.attributes.opticalThickness.version;
      const size=renderer.domElement.width+','+renderer.domElement.height;
      if(!body.sleeping||wetness.drying||splash.active||puddle.visible||renderedSurface!==body.surfaceRevision||renderedFace!==faceVersion||
        renderedThickness!==thicknessVersion||renderedDpr!==renderer.getPixelRatio()||renderedSize!==size||
        renderedCamera.distanceToSquared(camera.position)>1e-12||renderedRotation.angleTo(camera.quaternion)>1e-6) {
        composite.render();renderedSurface=body.surfaceRevision;renderedFace=faceVersion;
        renderedThickness=thicknessVersion;renderedDpr=renderer.getPixelRatio();renderedSize=size;
        renderedCamera.copy(camera.position);renderedRotation.copy(camera.quaternion);
      }
    }catch(error){fail(error);}
  };
  await renderer.setAnimationLoop(frame);
  const dispose=()=>{
    if(disposed)return;disposed=true;
    void renderer.setAnimationLoop(null);input.dispose();sound.dispose();transport.dispose();resizeObserver.disconnect();cancelAnimationFrame(resizeFrame);
    facilityShadows.dispose();composite.dispose();baby.dispose();table.dispose();wetness.dispose();splash.dispose();puddle.dispose();environment.dispose();optics.dispose();renderer.dispose();
  };
  window.addEventListener('pagehide',event=>{if(!event.persisted)dispose();});
  if(import.meta.hot)import.meta.hot.dispose(dispose);
  return {stop:dispose};
}
