# Droplet

A mobile-first WebGPU soft-body toy: one translucent blue water droplet on warm hardwood.

## Play

**[boxwrench.github.io/Droppie](https://boxwrench.github.io/Droppie/)**

Tap the droplet to hop, drag its body or tip to stretch, and let go to throw. Works
on a phone or a desktop browser, but it needs WebGPU: iOS 18+ Safari, Chrome or Edge
121+, and Android Chrome on a recent device. Firefox and older iOS show the
"needs a WebGPU-capable browser" notice instead.

The first visit pulls about 24 MB of textures and an HDR environment, so give it a
moment on a cold connection; afterwards the browser cache makes it near-instant.

`.github/workflows/pages.yml` rebuilds and redeploys the site on every push to `main`.

## Run

```sh
npm ci
npm run dev -- --host 0.0.0.0
```

Open localhost in a WebGPU-capable browser. Phones require HTTPS (an ordinary LAN HTTP address cannot enable WebGPU). No account or external API is needed.

Tap the droplet to hop. Drag its body or tip to stretch; release to throw. Drag empty floor to orbit, pinch or scroll to zoom. Space hops, R resets, Escape releases. Sound unlocks on interaction; the top-right buttons mute and reset.

## Verify and build

```sh
npm run test:physics
npm run lint
npm run build
```

Optional browser checks: start the dev server, then run `node scripts/preview-check.mjs` (expects Chrome at `/usr/bin/google-chrome`). It checks desktop grab/release/reset/mute and mobile touch loading, and writes screenshots to `/tmp/droplet-*.png`.

The static production output is in `dist/`. `npm run build:model` regenerates the deterministic droplet mesh, tetrahedral cage, surface embeddings, and smaller optical proxy.

## Foundation

Adapted from [scottstts/Jelly-Baby](https://github.com/scottstts/Jelly-Baby), baseline commit `528e15bb9248f1f15eaaa838fd260860d0d2825c`. The original source was inspected and its build architecture retained. The upstream repository remains the reference for unchanged solver, WebAssembly kernel, optical worker, caustic pipeline, HDR and wood assets. The generated humanoid was replaced with a droplet. Walking, facilities, flavor selection and joystick are absent from the running demo; source modules remain available as upstream reference.

The demo retains fixed-step XPBD, volume/orientation constraints, force-limited barycentric grabs, surface-bound face, thickness absorption, refraction, GPU caustics, contact shadows and procedural audio. Device tiers cap DPR and optical update frequency; sustained slow frames reduce visual workload without lowering physics fidelity. Idle physics and unchanged optical calculations sleep.

## Scope

Implements the plan's core demo. Physical phone performance, thermal behavior and Safari hardware compatibility still need device testing; software browser emulation does not establish a 60 FPS mobile guarantee. Advanced roadmap features and offline caching are not included.
