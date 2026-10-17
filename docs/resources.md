# Graphics and water resources

Start here before adding water or rendering features. Inspect the actual linked
source, check its licence and compatibility, and adapt a small relevant part.
Record direct reuse in [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md).

The broader catalog is [Waterscape's resource library](https://github.com/boxwrench/waterscape/blob/main/resources/README.md)
(local checkout: `/ai/github/waterscape/resources/README.md`). It contains
alternatives for fluids, surfaces, foam, caustics and WebGPU rendering.

| Reference | What Droppie uses | Source to inspect |
| --- | --- | --- |
| [CAUSTIC//LITE](https://github.com/ScottieFox/caustic-volume) | Actual wave stencil, hull displacement, refracted floor rays and caustics | `lite/index.html` at `d87351bff19831aa9d11c0679605fad6797b133f` |
| [Three.js Particle Fluids](https://github.com/dgreenheck/threejs-particle-fluids) | Actual layered nozzle emission, slot recycling and capped motion stretch for pouring | `demo/presets/honey.ts`, `demo/presets/tarp.ts`, `src/fluids/render/SurfaceField.ts` at `26ebfd2985ddd5156c932c97697980cfda92ffdf` |
| [Jelly-Baby](https://github.com/scottstts/Jelly-Baby) | Original XPBD, grab, optical transport and sound foundations | Baseline `528e15bb9248f1f15eaaa838fd260860d0d2825c`; see the main README |

The Particle Fluids package at the pinned revision targets Three r184; Droppie
uses r185. Its selected emitter/stretch code is adapted locally, with its MIT
notice retained. Its full SPH solver and voxel renderer are not installed.

The pour uses a bounded ballistic particle emitter and a thin continuous core.
It does not simulate a free fluid volume inside the bucket or replace the pool's
height field. See [pool and bucket details](pool.md) for scope and verification.
