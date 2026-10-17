# Shallow pool — first addition

The pool is a small ceramic dish on the existing tabletop. Droppie starts in its
shallow water. Tap or press Space to hop and splash; drag and release as before.
The wave button toggles the pool and returns to the dry playground. Reset clears
water effects and restores Droppie while keeping the chosen pool setting.

`src/game/pool-physics.ts` owns the pool dimensions, gentle submerged drag and
buoyancy, water-entry detection and six reusable ripple slots. It runs around the
existing fixed-rate XPBD solver. Water forces only touch submerged nodes within
the pool and do not wake a sleeping body. The shared facility contact code has an
additive hollow-rim shape so the basin can be approached from either side and
jumped over. The original floor, material constants and grab solver are unchanged.

`src/graphics/pool.ts` builds the ceramic basin and a small tessellated water
surface using the existing Three.js dependency and environment. Finite ripple
packets deform the surface and its lighting normals. The basin uses the existing
facility shadow pass. Water entries reuse the existing bounded splash particles
and sound effects. No external assets or new dependencies are needed.

This is a shallow-water toy approximation. It does not simulate a fluid volume,
merge Droppie into the water, pour water or model a deep swimming pool. The first
step deliberately retains the current character simulation and controls.

Verify with `npm run test:pool`, the existing physics/input checks, typecheck,
lint, build and `npm run test:pool:browser` (with the dev server on port 5180,
or set `DROPPIE_URL`). Browser checks should include pool
on/off, hop/re-entry, dragging, reset, sound, portrait and landscape. Software
WebGPU screenshots do not establish performance on a phone's native GPU.

Implementation validation: pool physics, original physics, multitouch,
deformation, facility collision, performance and orientation checks passed.
The orientation compiler on this machine is selected with
`CLANG=/usr/bin/clang-18`. Typecheck, lint and production build passed. Desktop
and mobile software-WebGPU checks passed without browser or GPU errors; their
screenshots were reviewed for framing and basin geometry.

The regular Chrome session currently fails before scene construction with
`Unable to create WebGPU adapter`. The existing published Droppie fails with the
same error there, so this is a browser/adapter limitation shared by the baseline.
The automated browser uses an isolated software-WebGPU configuration; normal
interactive preview requires a browser with a working WebGPU adapter.
