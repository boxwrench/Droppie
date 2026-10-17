# Pool — larger, deeper and reference-based

The pool has a 29 cm inner diameter and 1.5 cm water depth (Droppie is about
6 cm tall). This replaces the first 15.2 cm dish and 0.7 cm water depth. The
portrait and desktop cameras start far enough back to frame the larger basin;
zoom still brings Droppie closer.

Tap empty water to stir it. Tap Droppie or press Space to hop and splash; drag
and release as before. The wave button toggles the pool. Reset clears water and
splash effects and restores Droppie while preserving the chosen pool setting.
Dragging the floor still orbits; a drag or pinch must not also register a water
poke.

## Actual reference reuse

The first pool used six independently authored fading ripple packets. This
revision replaces those with an adaptation of **ScottieFox's CAUSTIC//LITE** at
`d87351bff19831aa9d11c0679605fad6797b133f`. See
[THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md) and the included MIT licence.

- `src/water/pool-surface.ts`: the reference's actual two-height wave-equation
  stencil, Gaussian impulses and old/new moving-hull displacement, converted to
  metres and a circular reflecting boundary. An 80x80 CPU grid uploads height
  and slope through a filterable half-float WebGPU texture. The solver advances
  at 60 Hz, separately from the 240 Hz character solver.
- `src/graphics/pool.ts`: a TSL adaptation of the reference's refracted light-ray
  projection and derivative-based area-ratio caustics. Surface displacement,
  normals and bottom refraction use the same height field. The basin shader
  refracts its tiled receiver and applies depth absorption. A separate transparent
  surface adds water tint and reflections, allowing Droppie's submerged geometry
  to remain visible. This avoids drawing two tile images and avoids a second
  nested screen-transmission pass. The basin uses the existing facility shadow pass.
- `src/game/pool-physics.ts`: submerged drag/buoyancy and the deformed character's
  changing hull footprint drive the water. Entry and rebound can trigger bounded
  splash particles and sound. Wave heights stay within the pool's freeboard;
  waves reflect from the wall and damp to rest. Sleeping Droppie is not nudged.
- `src/physics/facility-collision.ts`: the hollow lip resolves skin contacts from
  both sides. A denser pool-specific skin sample catches the taller wall. Held
  bodies step onto the lip; a body initially astride it is depenetrated with a
  volume-preserving translation.

Three.js Particle Fluids was evaluated directly. Its current implementation
requires r184; Droppie uses r185. It is not installed or represented as the
active solver. Droppie keeps the existing XPBD solver, floor and grab behavior.
This is a height-field pool, not a 3D particle liquid: it does not pour, overturn
or merge Droppie into the water.

## Preview and checks

Run `npm run preview:pool`, then open http://localhost:5180/ in a WebGPU browser.
This review server disables hot reload and uses its own dependency cache so
Firefox checks are not interrupted by module reloads while files are edited.
Reload manually after edits. Ordinary `npm run dev` is still available.

- `npm run test:pool`: dry-physics equivalence, rest/sleep, repeated water entries,
  bounded impulses, reset, rim contacts, dragging over the lip, propagated wave
  response, wake generation and damping.
- `npm run test:pool:browser`: Playwright Chromium, with software WebGPU.
- `DROPPIE_BROWSER=firefox npm run test:pool:browser`: Playwright Firefox with
  WebGPU enabled in its isolated test profile. Checks water-tap energy, landing
  splashes, grab/release, orbit, reset, toggle, sound and responsive layouts.
- The existing physics, multitouch, deformation, collision and performance
  checks, plus typecheck, lint and build, cover integration regressions.

Firefox successfully created a WebGPU adapter and rendered this revision in
Playwright. The system Firefox is 156.0.1; the matching Playwright test browser
is its separate bundled Firefox. These checks do not establish native GPU
performance on a phone. The earlier regular Chrome adapter limitation remains
separate from this pool revision.
