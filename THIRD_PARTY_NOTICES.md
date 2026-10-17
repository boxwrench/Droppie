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

Three.js Particle Fluids was evaluated as another option. Its pinned checkout
requires Three.js r184, while this project uses r185; none of its code was copied
or imported. Droppie retains its existing XPBD character solver.

Existing Jelly-Baby-derived code and assets retain the terms documented in the
README. This notice adds attribution for the pool adaptation.
