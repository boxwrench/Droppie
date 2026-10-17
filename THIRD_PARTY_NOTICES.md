# Pool water references and adapted code

## CAUSTIC//VOLUME / CAUSTIC//LITE

- Author: Scottie (ScottieFox).
- Source: https://github.com/ScottieFox/caustic-volume
- Pinned revision: `d87351bff19831aa9d11c0679605fad6797b133f`.
- Original file: `lite/index.html`.
- Licence: MIT; full notice in [LICENSES/caustic-volume-MIT.txt](LICENSES/caustic-volume-MIT.txt).

`src/water/pool-surface.ts` adapts the actual `stepRipples` two-height wave
stencil, Gaussian drop impulses and before/after hull displacement. Metres replace
the reference's millimetre field, a circular reflecting boundary replaces the
rectangular tank, and the deformed Droppie supplies the changing hull footprint.
The bounded CPU grid uploads height and slope to a WebGPU texture.

`src/graphics/pool.ts` adapts the reference's ray projection onto the tiled floor
and derivative-based area-ratio caustics to Three.js TSL and a WebGPU render
target. The pool samples the same field for displacement, normals and floor
refraction. The original duck, environment, assets and full sandbox are not used.

## Three.js Particle Fluids — pour emission and motion stretch

- Author: Daniel Greenheck.
- Source: https://github.com/dgreenheck/threejs-particle-fluids
- Pinned revision: `26ebfd2985ddd5156c932c97697980cfda92ffdf`.
- Original files: `demo/presets/honey.ts`, `demo/presets/tarp.ts`,
  `src/fluids/render/SurfaceField.ts`.
- Licence: MIT; full notice in
  [LICENSES/threejs-particle-fluids-MIT.txt](LICENSES/threejs-particle-fluids-MIT.txt).

`src/water/pour-particles.ts` adapts the actual disc-clipped lattice emission,
spacing-based layer release, moving-source velocity and recycled particle slots
from the honey/tarp demos. CPU ballistic particles replace the GPU/SPH particle
buffers. Its capped velocity stretch adapts `SurfaceField.ts`'s motion-smear
distance; `src/graphics/pour-bucket.ts` applies it to instanced droplet geometry.
Particle crossings drive the existing pool waves and splash effects.

The stream's thickness-dependent appearance was compared with
`FluidSurfaceRenderer.ts`'s Beer-Lambert absorption; Three's existing physical
material supplies that optical model here. The upstream SPH solver, voxel field
and ray-marched surface renderer are not imported. The pinned package requires
Three.js r184 and Droppie uses r185, so this is a selective source adaptation.
Droppie retains its existing XPBD character solver.

Existing Jelly-Baby-derived code and assets retain the terms documented in the
README. This notice adds attribution for the pool and pour adaptations.
