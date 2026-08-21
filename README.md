# Scott Lucchini — research website

Personal academic site for a computational astrophysicist: a single-page React app
with a persistent 3D/WebGL "stage" that renders gas-simulation visualizations in the
header of each research area.

## Serving & tooling

- **Served by local Apache** from `/Library/WebServer/Documents/new_website`, reachable at
  `http://localhost/new_website/`. There is **no dev server**.
- **No build step.** React is loaded from a CDN (UMD build) and the app is written as
  **pre-compiled `React.createElement(...)` calls** — there is *no JSX source to compile*.
  Edit `app.js` directly in that form. Sanity-check with `node --check app.js`.
- `three.js` is loaded as an ES module via an import map in `index.html`.
- WebGL can't be reliably verified headless here; verify visually in a browser
  (hard-refresh to bust cache). A plain reload is **not** enough — `viz3d.js`/`app.js` are
  served with no `Cache-Control`, so Chrome will happily run a cached copy and you'll
  "verify" the old code. ⌘⇧R.
- **The React/content layer *can* be checked headless**, though, which is what you want
  after a `data.js` content edit — `node --check` only catches syntax, and the crash mode
  that matters here (a missing field blanking the whole site) is a *runtime* throw. Recipe:
  fetch the React UMD build plus `react-dom-server-legacy.browser.production.min.js` from
  unpkg, run `data.js` → `viz.js` → `app.js` in a `vm` context with `window`/`self`/
  `document`/`localStorage` stubbed, swap `ReactDOM.createRoot` for a stub that captures
  the tree, then `renderToStaticMarkup` it. **Render every area, not just the default:**
  the initial index comes from `localStorage.getItem("sl_area")`, so a stub returning
  `null` only ever renders *home* — which has no `papers` at all, and will happily report
  "OK" while a broken publication card sits two tabs over. Parameterise that stub and loop
  0–3. Grepping the returned markup for `paper-title` / `paper-link` / `ph-img` also
  confirms ordering, links and figure paths without opening a browser.
- **To test on a phone:** browse to the dev machine's own address on port 80 (`en0`); get it
  from `ipconfig getifaddr en0`. Check first whether that address is public rather than
  LAN-private, and remember that `DocumentRoot` is the *parent* directory — every sibling
  of `new_website/` is reachable the same way. Serve it only as long as you need it.

## File map

| File | Purpose |
|------|---------|
| `index.html` | Entry point; loads React (CDN), `data.js`, `viz.js`, `app.js`, and `viz3d.js` (module) + the three.js import map. |
| `data.js` | `AREAS` array — all page content **and** per-area viz config (`viz`, `heroVideo`, `movie`, camera, etc.). |
| `app.js` | React UI (as `React.createElement`). Renders areas, hero, and viz control overlays; drives the 3D stage imperatively via `window.SLViz`. |
| `viz3d.js` | The persistent WebGL stage (`window.SLViz`): `Stage` + `VolumeLayer` + `IsoLayer`. |
| `viz.js` | Older/auxiliary viz helpers + `Placeholder`, the figure slot (a real image when given a `src`, otherwise a striped stand-in). |
| `styles.css` | All styles. |
| `assets/` | Paper figures (one per publication) + site imagery. |
| `assets/web/` | Web-sized derivatives of the oversized figures (see below). |
| `assets/viz/` | Prebuilt viz assets (see below). |
| `scripts/` | Local asset-build scripts (`build_sne_assets.py` — ISM SNe lens data; `build_volume_atlases.py` — WebP slice atlases for the ENGAWA cubes). |
| `raw_data/` | Source HDF5 grids + hero/section MP4 movies. |
| `engawa/` | Standalone ENGAWA public-data-release page — `index.html` with its **own inline `<style>`**, independent of `styles.css` — plus `README`, the data README that ships to the Globus collection root. |

## The 3D stage (`viz3d.js` → `window.SLViz`)

One renderer/scene/camera lives for the page lifetime and **morphs** between areas
(crossfade + camera fly) instead of remounting. A single fixed `<canvas>` (`#viz-stage`,
`z-index:1`) is positioned over whichever `.viz-anchor` React currently shows; the canvas
sits **behind** all React DOM (`#root` is `z-index:2`), which is transparent so the model
shows through. The canvas hides only when the anchor is absent or scrolled offscreen.
**Every page (home included) uses ONE shared anchor height** (`.viz-anchor` +
`.hero-viz-full`/`.home-hero`/`.viz-overlay`, all `clamp(460px, 78vh, 820px)`): the canvas
is glued to the anchor rect, so a per-area height makes the model visibly jump at
navigation whenever nothing opaque covers it. The shared value is home's — the model spans
a fixed *fraction* of canvas height (fixed vertical FOV), so area pages look the same at
any height, but home's hero movie scales with *width*, so changing home's height would
break the movie↔model match cut.

Layers:
- **`VolumeLayer`** — GLSL3 ray-marched gas volume. Loads **two** 3D textures (a "200pc"
  high-res run + a "Default" run) and picks one **per fragment** by screen-x vs `u_split`
  for a vertical resolution-comparison wipe. Modes: `integral` (column density) / `volume`
  (transfer function). Supports **switchable fields/ions** (`total_gas`, `hi`, `mgii`,
  `ovi`) via `setField()` — each is a paired hi/lo set lazy-loaded and cached in `_sets`,
  with its own display range (see `VOLUME_FIELDS`). Switching swaps `u_data`/`u_data2`, the
  range uniforms, **and the colormap LUT** (`FIELD_LUT` / `_ensureLut`): total_gas + H I use
  `engawa_lut.png` (dusk), Mg II uses `mgii_lut.png` (custom cividis+black ramp), O VI uses
  `afmhot_lut.png`. LUTs are 256×1 RGB PNGs sampled by `u_lut` in `integral`/column mode.
  The **comparison cube is fetched only when the area sets `compare`** — `Stage.show()` calls
  `layer.setCompare()` before `load()`, so home (which never moves the wipe) loads one cube
  instead of two; navigating to CGM pulls the second under the loading indicator, and
  `u_data2` is bound to `u_data` until it lands. `setField(field, cb)` takes that field's
  colorbar window and applies it **in the same tick as the texture + LUT swap** — applying it
  on click instead re-windowed the *outgoing* ion's data for the second or two the new cubes
  took to arrive, which read as the image changing twice. The button that's loading carries a
  spinner (`.vc-fields button.is-loading`, `busyField` in `VolumeControls`), delayed 0.15s so
  an ion already in GPU memory never flickers one.
- **`IsoLayer`** — nested transparent GLB isosurfaces with a snapshot timeline (Magellanic).

Key `SLViz` methods (called from `app.js`): `show(areaId, cfg)`, `setVolumeMode`,
`setVolumeExposure`, `setVolumeOpacity`, `setVolumePreset`, `setVolumeField`,
`setVolumeColorbar(lo, hi)`, `setSplit`, `setZoom`; iso layer: `setIsoVisible(key, on)`,
`setOrbitsVisible(on)`, `setSnapshot(i)`, `getTimeline()`; `rebindControls()` re-attaches
OrbitControls to the current page's `.viz-hit` (used when an area was pre-shown before its
page mounted — see the leaving-home flow).
The stage emits `"loading"`, `"volume-ready"`, `"iso-ready"`, `"preload"`, **`"shown"`**
(fired when a camera fly *begins*, after any layer load), and **`"settled"`** (fired when a
camera fly *finishes*). `"shown"`/`"settled"` bracket the fly and are used to sequence the
hero movies against the 3D reorientation (see the home + ISM notes below).

**Rendering is on-demand.** The volume ray-march is by far the most expensive thing on the
page (integral mode has *no* early-out, so every fragment that hits the box runs the full
`u_steps` loop, and on home the camera sits right against the box face, filling the
viewport, so nearly every fragment hits). Drawing that every rAF
frame saturates the shared GPU process and freezes the entire browser — so `_loop` only
calls `renderer.render()` when something changed:
- `Stage.invalidate(coarse)` marks a redraw; **every** mutation must call it (the `SLViz`
  api wrappers do). `coarse: true` = a continuous drag → render at `stepsMoving`, then
  refine once quiet. An un-invalidated change simply never appears.
- While moving/interacting it renders at `stepsMoving` (`96`); once quiet it draws **one**
  frame at `stepsIdle` (`400`), then stops touching the GPU entirely.
- Per-area **`cfg.refine: false`** (`data.js`) skips even that one refined frame, for areas
  whose volume is never seen at rest. Set on **home** (an opaque hero movie covers it).
- `_syncToAnchor()` still runs every frame (cheap DOM work) so the canvas tracks scrolling.

**Transition timing knobs** (all hand-tuned):
- `Stage.transition.dur` (`viz3d.js`) — camera-fly duration in seconds (`0.9` same-layer /
  `0.95` cross-layer crossfade). The fly is stepped on the **wall clock** (`transition.startAt`
  + `performance.now()`), not accumulated per-frame `dt` — a `dt` cap used to make the fly
  frame-count-bound, so slow frames stretched it to several real seconds. It's also stepped
  while the hero is scrolled offscreen (only the *render* is skipped), so a fly can't strand
  at `t=0`.
- Per-area **`cfg.flyDelay`** (`data.js`) → folded into `transition.startAt` — seconds to sit
  at the *from* framing before the fly begins. Lets the model be seen at the previous
  orientation for a beat before it flies. Set on **cgm** (`0.1`).
- `HERO_REVEAL_DELAY` (`app.js`, `HomePanel`) — ms after `"shown"` before the home movie
  begins fading back in on *return* to home; paired with the `.home-hero-bg` opacity
  `transition` duration in `styles.css`.

**Volume↔iso "hold" transitions** (`Stage._applyVolumeHold`). During a crossfade between
the volume and iso layers, the volume model is *decoupled from the camera fly* so it
doesn't spin or bounce: each frame its group gets rotation `q_cam · slerp(qAInv, qBInv, e)`
— apparent orientation slerps "as the user left it" → **edge-on** (`VOL_EDGE_POS`, the CGM
default view) when fading out, and edge-on → the destination framing when fading in
(exactly identity at the end, so the hold releases with no pop). Its apparent size ignores
the camera's chord-cutting distance dip and follows a monotonic ramp to/from
`VOL_HOLD_ZOOM` (`0.35`), and it translates to overlap the **MW's position** in the iso
scene (read live from the MW orbit marker) so the CGM model recedes onto / emerges from
the MW it represents. All state (rotation/scale/position) resets exactly at transition
end. **Superseded transitions are finalized in `show()`**: a second navigation mid-flight
runs the interrupted transition's cleanup (hide the fading-out layer unless the new
transition reuses it; reset the hold transform *before* the new hold captures its
reference scale) — without this the old layer stayed visible and the stale transform
skewed every later framing. Also, the **first `show()` after init snaps the camera**
synchronously to that area's framing (`_everShown`), so navigating away while the first
layer is still loading never transitions from the meaningless init pose.

## Per-area behavior (`data.js`)

- **home** — looping hero **movie** (`heroVideo`) with the **total-gas (200pc) volume
  rendered behind it** (opaque movie covers the canvas; the volume uses the CGM total-gas
  color limits via a `fields` entry). The home camera matches the movie's view (from
  `website_movie.py`): direction `normalize(0,-100,64)` (`CAM`), pulled in to ~0.45 so the disk
  is prominent, plus a **camera `roll`** (`+0.4` rad) to reproduce the movie's tilt — the movie
  camera is *sheared* (`RIGHT`·`VIEW`≠0), so only inclination + roll are matched, not the exact
  shear. Roll is a general per-area `cfg.roll`, interpolated during transitions
  and applied in the render loop via `_applyRoll` (post-`controls.update()`, so OrbitControls
  state is untouched). The volume loads on home.
  - **Leaving home** (`App.go`): the movie fade and the model fly start **together at
    click** — `go()` *pre-shows* the target on the stage (imperative `SLViz.show`; the
    stage doesn't care what page React renders) while the movie fades in place
    (`leaving` prop → `viz-faded`), and defers the React page swap by `HOME_LEAVE_MS`
    (250 ms) so the movie survives long enough to dissolve. The swap's idx-effect then
    skips its duplicate `show()` (which would restart the fly mid-flight; `preShownRef`)
    and calls `SLViz.rebindControls()` instead, since OrbitControls were bound to the
    unmounted page's `.viz-hit`. Extra clicks mid-fade retarget both the pending swap and
    the fly. Home content exits instantly at the swap, like every other page.
  - **Returning to home reverses the morph:** the movie is held hidden (`viz-faded`) while the
    model flies back to home framing, then faded **in** over it. `HomePanel` starts the fade
    `HERO_REVEAL_DELAY` ms after the `"shown"` event (fly start), so it begins *just before* the
    fly settles, leaving a short overlap where the reorienting model shows through. This only
    happens when *navigating* to home (`morphIn`); a direct/first load shows the movie at once
    (tracked by `navigatedRef` in `App`, which flips on the first `go()`).
- **magellanic** — `IsoLayer` GLB isosurfaces + snapshot time scrubber. Assets
  (`assets/viz/magellanic/`, ~57 MB) are synced from the proof-of-concept project at
  `…/claude_projects/website_viz/magellanic/` (its `preprocess/` scripts regenerate them
  from simulation HDF5): 17 snapshots `snap_190…snap_347` (~1.5 Gyr), each a per-snap
  `manifest.json` + `mw.glb`/`lmc.glb`, plus `timeline.json` and `orbits.json`.
  - **Orbit tracks**: one `Line2` polyline per galaxy (component color lerped 35% toward
    white; screen-px width, so the stage feeds the drawing-buffer size to
    `IsoLayer.setRes` every frame) + a sphere marker at the sample nearest the current
    snapshot's time. `depthTest:false` + high `renderOrder` keep them readable through the
    shells; they share the snapshots' framing transform and are **trimmed to the
    timeline's time window** (computed from the loaded timeline, not hardcoded). Legend
    has a third "Orbits" toggle (`setOrbitsVisible`; `.legend-line` gradient glyph).
  - Default camera is the **y–z projection**: `pos [2.27, 0, 0]` (+x axis, z up, y right),
    `zoom: 1.45`. All snapshots preload in the background (`"preload"` events →
    "preloading n/17" under the scrubber).
  - **Scrubber direction** (`TimeBar`, reversed 2026-08-21): the slider reads
    left-to-right in time — position 0 is the earliest snapshot (t ≈ −1.54 Gyr) and the
    far right is **t = 0**, so slider position *is* the snapshot index passed to
    `setSnapshot`. The state variable `v` still counts snapshots *back* from the present
    (`v = 0` → t = 0) and is deliberately left that way: `TimeBar` mounts before
    `timeline` loads, so it cannot seed its initial state from `n`, and `useState(0)`
    keeps it opening at the present without an extra effect.
- **cgm** (the "ENGAWA" page) — interactive `VolumeLayer`. Has a **Species** picker
  (`field`/`fields`: Total gas, H I, Mg II, O VI — each with its own colormap and color-scale
  `cbLo`/`cbHi` defaults, applied on switch) and a **Zoom** slider (`controlsUI:
  ["field","zoom"]`, opening at `zoom: 1.5`). The picker is one **button per ion** in a 2×2
  grid (`.vc-fields`), driven off the same `fields` array — it's **single-select**, since the
  shader binds one ion pair (`u_data`/`u_data2`) at a time; showing two ions at once would
  need a shader change, not a UI one. The color scale is a two-handle bottom/top of
  the colorbar (as fractions of each field's auto span); the **Scale min/max** sliders are
  currently **hidden** (add `"colorbar"` to `controlsUI` to show them) but the per-ion
  defaults are still applied. Also has the **comparison wipe** (`compare: true`,
  `compareLabels`). Its camera is **edge-on from −y** (`pos: [0,-1.1,0]`) — the same azimuth as
  the home model, so arriving from home is the smallest movement (tilt down to edge-on +
  un-roll, no azimuthal spin). A small **`flyDelay`** (`0.1`s) holds at the home framing first,
  so the movie→model match cut registers for a beat before the model flies edge-on.
  - The default field's color scale is applied authoritatively in `Stage.show()` (reads
    `cfg.fields`), because React's `callViz` can no-op on a direct load if it runs before
    `window.SLViz` exists; React still drives colorbar on live ion switches.
  - Per-area `zoom` is honored by `Stage.show()`, which flies the camera to the
    already-zoomed distance (no pop) while keeping the configured position as the 1× base.
  - **No `lede`.** The CGM page opens straight onto the ENGAWA `release` callout, so the
    intro paragraph was dropped (2026-08-18). `.hero-foot` — the lede's wrapper, which
    also draws the divider under the viz via `::before` — is therefore rendered only
    `area.lede &&` in `app.js`; without that gate an area with no lede keeps an empty
    wrapper, i.e. a stray rule plus ~40 px of padding. ism and magellanic still have one.
- **ism** — `VolumeLayer` reorients to the disk face-on, then **crossfades to a looping
  movie** (`movie: …`) once the stage emits `"settled"` (see `HeroMovie` in `app.js`).
  Camera `pos: [0,-0.02,-0.95]` — face-on **from below (−z)**, which mirrors the disk so
  the volume model's spiral winding matches the I11 movie's (different simulations that
  wind opposite ways seen from +z). Still the **same −y azimuth** as home/cgm (see the
  azimuth rule below), so cgm→ism is a pure polar tilt (90° → ~178°) with no spin. The
  small −y offset keeps it off the exact pole, where `lookAt` with `up=+z` is degenerate.
  `zoom: 2.5` (effective 0.38) pulls the disk in hard toward the movie's framing. A
  `fields` entry mirrors the CGM total-gas `cbLo`/`cbHi` so the model keeps the same
  colors it left the CGM page with (without it, `Stage.show()` resets to the full span).
  - The movie (`.hero-movie`, `styles.css`) is square (1024²) in a much wider hero box, so
    it's `object-fit: contain` + `transform: scale()` — **scale = 1/fraction-shown**, so
    `1.25` shows 80% of the movie's height. Raise to zoom in. Square-in-wide-box means it
    pillarboxes; a `background: #000` covers the whole hero box (the element scales past
    it), hiding the 3D model behind it and blending into the movie's own black edges.
  - **SNe magnifier** (`movieLens: { base, mag, dia, fade, dot }` → `SneLens` in `app.js`):
    a circular `dia`-px canvas showing a `mag`× crop of the **playing `<video>` itself**
    (movie frame `f` == snapshot `21+f`, same 30 kpc FOV/orientation as the sne-viz
    export, so no extra image data is shipped), plus supernovae as fading yellow dots
    (`fade` movie frames, default 20 ≈ 0.67 s; `dot` = marker radius in css px).
    The panel is **docked beside the movie, not under the cursor** — the cursor instead
    carries a small ring (`.sne-reticle`) drawn at exactly `dia/mag` css px, the true
    footprint of the crop, so ring→panel reads as a correspondence and the magnifier
    never covers what it magnifies. The ring is rendered **before** the panel in the DOM:
    both are `z-index: 2`, and a pinned ring co-rotates far enough to sweep under the
    panel. A caption above the panel states the magnification and the region's physical
    width in kpc.
    - **Placement** is half CSS, half JS (`layout()`). Wide viewports use the CSS dock
      (right gutter, vertically centred). Below `CORNER_W` (1150px) the movie square
      (side = hero height × 1.25) leaves no gutter, so JS overrides `top`/`right`/
      `transform` to put it in the top-right corner, hard against the edge, sized to
      clear both `.arrow-r` (vertically centred, so a tall panel hanging from the top
      reaches into it) and the hero title. The title's reach is **measured with a
      `Range` over the `<h1>`'s contents** — the element itself is a full-width flex
      item, so its own rect says nothing about where the words end. On a collision it
      takes whichever leaves the bigger panel: drop below the title band, or stay put
      and narrow past the title's right edge.
    Assets in `assets/viz/ism/` (~5 MB, fetched once on first ISM hover-capable visit):
    `sne_xy.bin` (u16 x,y per event over the extent, sorted by fire movie-frame),
    `sne_offsets.bin` (u32 per-frame index), `sne_meta.json`, `rotation.json`. Dots
    drift with the disk by rotating the birth position with the rotation curve
    (dphi per 2 movie frames vs R) — median residual vs the true tracked positions is
    ~4 pc/slot. Rebuild with `python3 scripts/build_sne_assets.py` (reads the sne-viz
    static export from the sne-viz project on this machine, which itself
    comes from the cluster pipeline in `…/claude_projects/website_viz/interactive_sne_movie/`
    — see that project's CLAUDE.md).
    **Click pins** the sample point in the co-rotating frame (anchor advanced by
    dφ(R)·Δslots from its pin-time frame — exact under pure rotation, works backwards
    while scrubbing), so the ring drifts with the disk while the parked panel keeps
    showing it; clicking the pinned ring or pressing Esc releases it. Pinned state shows
    a solid accent ring. Hovering the panel **freezes** the sample rather than
    magnifying whatever sits behind the panel.
    - **Touch** (`fine = matchMedia("(pointer: fine)")`): there is no hover, so touch is
      pin-only — a tap drops the region and it co-rotates from there, tap it again (or
      elsewhere) to release/move. Taps run off `pointerdown`/`pointerup`, not `click`:
      iOS is unreliable about synthesizing `click` on a plain `<div>`, and the down/up
      pair distinguishes a tap from a scroll drag (>12px) or a long press (>600ms), so
      one-finger page scrolling over the hero still works. `pointermove` ignores
      `pointerType === "touch"` for the same reason. The panel takes a larger share of
      the width on touch, and the release radius is bigger (a thin ring is a poor finger
      target). The hint copy switches to "tap to magnify · tap again to release" and
      moves above the scrubber (`@media (pointer: coarse)`).
  - **Movie scrubber** (`MovieScrub` in `app.js`, rendered with any `movie:` area):
    bottom-center slider seeks the video (pauses while dragging, resumes on release),
    with a play/pause button, a ½×/1× `playbackRate` toggle (30 fps source → 15/30 fps
    effective, **1× default** since 2026-08-21 — no re-encode needed) and a frame counter
    matching the SNe frame numbering. ½× is there for reading the SNe lens.

**Camera azimuth rule.** All three volume areas sit at azimuth **−90°** (the `x=0, −y`
half-plane): home `[0,-0.38,0.24]`, cgm `[0,-1.1,0]`, ism `[0,-0.02,-0.95]`. Transitions
`lerp` camera *position* linearly, so a shared azimuth keeps every fly in the `x=0` plane —
a pure tilt with **no azimuthal spin**. Give a new area an off-axis camera and it will
visibly spin on arrival (ism used to be at `+45°`, i.e. a 135° swing from cgm). The
Magellanic camera is deliberately off this axis (`[2.27,0,0]`, the y–z projection) — its
transitions are volume↔iso crossfades where the volume hold (above) hides the swing.
Note the linear lerp cuts the chord on big tilts (the camera dips closer mid-fly than the
endpoint); volume↔iso holds compensate via the `VOL_HOLD_ZOOM` ramp, and same-layer tilts
absorb it into the fly's feel — slerping direction and lerping distance separately would
fix it properly, at the cost of re-tuning every transition.

## Mobile

The breakpoint is **`max-width: 720px`** (one `@media` block near the end of the
Responsive section in `styles.css`); `(pointer: coarse)` is used separately, for things
that are about *touch* rather than *width*.

- **Viz controls** stack to a single column and step down a size — `.vc-fields` goes to
  `grid-template-columns: 1fr`, the panel to `max-width: min(160px, 46vw)`. Without the
  narrower panel the stacked buttons would each be ~230 px wide.
- **Navigation is the header tabs only.** The prev/next `.arrow` buttons, the `← / →`
  `.foot-hint`, and the `.foot-dots` are all `display: none` — the arrows sit on top of a
  stage that is mostly viz at this width, and the hint describes a keyboard that isn't
  there. The keyboard handler itself is untouched, so desktop still has it.
- **Gesture guard** (`TouchGestureHint` in `app.js` + `.touch-gesture`): one finger scrolls
  the page past the viz (see `_attachControls`), which reads as a dead model. So a
  one-finger `touchmove` over `.hero-viz-full` dims the viz and names the second finger —
  the Google Maps pattern. Two fingers dismiss it instantly; lifting the last finger clears
  it at once (only the CSS fade outlives the touch). It listens on `touchmove`, not
  `touchstart`, so a tap isn't treated as a thwarted gesture, and it ignores `.viz-divider`
  (a legitimate one-finger control). It is `pointer-events: none`, so the two-finger gesture
  it asks for still reaches `.viz-hit` underneath. Replaced an earlier timed pill that said
  the same thing on arrival whether or not anyone had tried to touch.
- **Opening zoom**: an area may declare **`zoomMobile`** beside `zoom` in `data.js`,
  resolved by `Stage._zoomFor(cfg)`. The camera's FOV is vertical, so a narrow portrait
  viewport crops the sides off a wide framing — cgm opens at `1.15` instead of `1.5`.
  `_zoomFor` keys on `max-width: 720px`, not pointer type: the reason to pull back is the
  narrow viewport, so a phone in landscape keeps the desktop framing.

## The ENGAWA release page (`engawa/index.html`)

A **self-contained** page — its own inline `<style>`, its own `:root` tokens, `--maxw:
1080px` (the main site is 1280). It shares nothing with `styles.css`, so anything meant to
match the main site has to be **kept in sync by hand**:

- **Header.** `.brand-name`/`.brand-role`/`.topnav a` mirror `.brand-name`/`.brand-role`/
  `.tab` in `styles.css` (18.2 / 13.3 / 16.4 px), and `.topnav a` carries `.tab`'s whole box
  — `9px 15px` in a 999 px radius, 4 px apart, pill on hover — because that box is what sets
  the header's height. `.topnav a` also needs **`line-height: normal`**: this page sets
  `1.6` on `body` where the main site leaves it unset, and that alone made the header 4.7 px
  taller. Gutters are `clamp(20px, 4vw, 56px)` on both `.topbar` and `.wrap`, matching the
  main site's `.topbar`/`.content`.
  - The wordmark is a link but must not behave like prose: `.brand a, .brand a:hover` kill
    the page-wide `a:hover { text-decoration: underline }`.
  - The back arrow is an **inline SVG**, not `←`. A text arrow sits on the line box's
    baseline and drops low wherever the font stack falls back for U+2190 (it does on iOS);
    an icon that is its own flex item is centred by `align-items`.
  - On phones the header keeps the desktop layout — one row, full wordmark left, back link
    centred right. `.brand-role` and `.topnav a` are `white-space: nowrap` (without it both
    wrapped below 393 px and the topbar jumped 74.5 → 96 px). Below 380 px the wordmark
    leaves no room for the label, so `.back-label` hides and the link is the arrow alone
    (the anchor keeps `aria-label="Main site"`).
- **`.hero-inner` is also a `.wrap`**, so it must use **`padding-block`**, never the
  `padding` shorthand — the shorthand resets `.wrap`'s horizontal gutter to 0, which is
  invisible above 1080 px (where `.wrap` is capped and centred) and runs the whole hero
  flush to the screen edge below it.
- **The overview aside** starts level with the `<h2>`, not the eyebrow above it, via
  `#overview .two > .aside { margin-top: calc(var(--eyebrow-size) * var(--eyebrow-lh) +
  var(--eyebrow-gap)) }` — those three live on `:root` precisely so the offset can't drift
  from the eyebrow's own metrics. It is `#overview`-scoped because the Data access section
  also uses `.two`/`.aside` but has no eyebrow in its left column.
- **The file-structure panel** documents the real Globus tree (galaxy → run, with Au6
  nesting under `output/` while the others fold the run into the directory name). It was
  fabricated from the paper's description until 2026-08-19, when it was rebuilt from a
  `tree -d` of the collection. Keep `engawa/README` in step with it — same tree, same
  snapshot numbering, same filenames.
- **Still unresolved:** `data.js`'s release blurb and the page's own overview list both
  advertise **"projected ion grids"**, and nothing in the collection corresponds to them
  (the nearest thing is `colt/colt_NNN.hdf5`). Either relabel or drop.
- **Also open (2026-08-21): there are now two ENGAWA papers.** The CGM page carries the
  methods paper (arXiv:2603.05584) *and* the halo dispersion-measure paper
  (arXiv:2607.20601), but `engawa/index.html` and `engawa/README` still reference only the
  first — five places between them, including the BibTeX block and the "Read the paper"
  button. Decide whether the release page cites both, and whether the DM paper's Python
  package (`github.com/slucchini/l26halodm`) belongs in the data-access section.

## Typography scale (`styles.css`)

There is no root font scale — **every `font-size` is a literal px value** (or a `clamp()`
of them), so bumping `html { font-size }` does nothing. Rescaling means editing the
declarations. On 2026-08-17 everything was scaled ×1.10, with the topbar (`.brand-name`,
`.brand-role`, `.tab`, `.tab .tab-i`, `.tab-l`) taking a further ×1.10 (≈1.21 total), and
the three display headings — `.hero-title`, `.home-hero-title`, `.home-name` — deliberately
**left at their original sizes**. When scaling a `clamp()`, scale the `vw` term too, or the
size stops growing anywhere between the two ends.

## Hero scrim (`styles.css`)

`.hero-viz-scrim` (z-index 1) fades the viz into the page at **both** ends: the top fade
darkens the model behind `.hero-title` (which sits at the *top* of the panel via
`.hero-overlay { align-items: flex-start }`, z-index 3, above the scrim), strongest over
the title band (~0–15% of the panel) and gone by ~34%; the bottom fade runs to solid.
Both ends use **`var(--bg)`, never literal black** — the light theme's `--bg` is
near-white, so a hardcoded black would break it.

## Publication cards (`app.js` `PaperCard`)

Order inside `.pub-text` is **title → citation → summary → links** (reworked 2026-08-18):

- The old `.paper-head` strip above the title — a `.paper-badge` journal chip plus
  `.paper-year` — is **gone**, along with its three CSS rules. Nothing was lost: every
  `cite` string already ends in the journal and year (`— ApJ, 974, 105 (2024)`). The
  `tag` and `year` fields are **still present on every paper in `data.js`**, unused, so
  restoring the badge is a markup change and not a data-entry job.
- `.paper-cite` moved up under the title, and swapped `margin-top` for `margin-bottom`
  since it now needs the gap *below* it.
- Each title carries a **`>` marker** hanging in the left margin (`.paper-title::before`),
  accent-hued and in the mono face. It's positioned `right: 100%` so the glyph's right
  edge pins to the title's left edge and the gap is exactly `margin-right`, whatever the
  glyph measures — and the title itself stays **flush left** with the cite and summary.
  The whole hang must fit inside `.content`'s horizontal padding, which floors at **20px**
  on narrow screens, hence the clamped gap; a fixed one risks running off the edge.
- The section heading above the list is **"Publications"** (was "Selected publications").
- **`links` is optional** (2026-08-21). A paper in prep has no arXiv or DOI to point at
  yet, so `PaperCard` reads `p.links || []` and omits the whole `.paper-links` row when
  it's empty — an empty `<div>` would still carry its `margin-top: 13px` and leave a gap
  under the summary. Before this, `p.links.map(...)` ran unguarded: adding the one paper
  on the site without a `links` array threw during render, and because that's an uncaught
  throw inside the React tree it blanked the **entire site**, not just the one card. The
  failure looks exactly like a `data.js` syntax error but isn't — `node --check data.js`
  passes. `figures` was already optional and behaves the same way (`.pub.no-fig` drops the
  two-column grid), so a paper can legitimately carry neither.

### Subscripts in copy (`data.js`)

Astronomy notation wants ⊙ set as a subscript, and `p.summary` is passed to
`React.createElement` as a **child**, so an HTML string in the data would be escaped.
Two helpers at the top of `data.js` handle it:

```js
const sub  = s => React.createElement("sub", null, s);
const rich = (...parts) => React.createElement(React.Fragment, null, ...parts);
// summary: rich("…most clouds to ~0.1 Z", sub("⊙"), ", with the lowest-metallicity …")
```

A **fragment, not an array**, so the static parts don't trip React's missing-key warning.
Four fields use it (three summaries + one `stats` value). Any field converted this way is
no longer a string — fine as a React child, `[object Object]` in a template literal or an
`aria-label`. Browser-default `<sub>` is `vertical-align: sub` + `font-size: smaller`,
which grows the line box and opens a gap mid-paragraph, so `styles.css` offsets it
manually instead (a bare `sub` rule; the standalone `/engawa` page has its own styles and
keeps browser defaults, so ⊙ renders slightly differently there).

## Publication figures

Each paper in `data.js` carries `figures: [{ kind, src, caption }]`. With a `src` the slot
renders a real `<img class="ph-img">` (lazy, async-decoded); without one it falls back to
the striped placeholder, whose `kind` (`image` / `movie` / `interactive`) sets its label —
that's the stand-in for media not yet made. As of 2026-08-21 all **13** papers have exactly
one real figure and no placeholders remain in `data.js`.

Sizing rules that matter (`.ph-img`, `styles.css`), all learned the hard way:

- **Neither dimension is pinned** (`width: auto; max-width: 100%; height: auto`). These
  figures range from a portrait magazine cover to wide plots; constraining both (a
  `max-height` + `object-fit: contain`) letterboxes the page's ground colour in around the
  image — uneven bands on whichever two sides don't fit, which is not the same thing as the
  deliberate even frame below. Each figure renders at its own pixel size, shrunk only when
  it would overflow the column.
- **`align-self: start`** is required: `.ph` is a flex column, and a stretched flex item
  ignores `width: auto` — without it a 300px cover is blown up to the full column width.
- **The white background stays.** Matplotlib PNGs are often exported with a transparent
  background and black text (`HVC_origins.png` is — alpha range 0–255), which would vanish
  on the dark theme. Natural sizing keeps it from letterboxing, so it only ever shows
  *through* an image. Check before assuming a figure is opaque:
  `python3 -c "from PIL import Image; im=Image.open(f); print(im.mode, 'A' in im.getbands() and im.getchannel('A').getextrema())"`.
- **The white frame around each figure is deliberate** (2026-08-18): `border: 5px solid
  #fff`, square corners — the old `border-radius: 11px` is gone. Distinct from the
  letterboxing above, which was the ground colour leaking in around a constrained image;
  this is a uniform band on all four sides, so figures read as printed plates against the
  dark theme. `box-sizing: border-box` is set site-wide (`styles.css` `*` rule), so the
  band eats into `max-width: 100%` instead of pushing a full-width figure past the column.
  The class is shared, so this hits every real figure on the site — scope it to
  `.pub-figs .ph-img` if it should ever apply to publication figures only.

Originals live in `assets/` untouched. Five were too heavy to ship (`MC_review.png` is
17 MB / 4800×3180), so `assets/web/` holds JPEG derivatives that those cards point at
instead. Regenerate with

```bash
sips -s format jpeg -s formatOptions 80 assets/<name>.png --out assets/web/<name>.jpg
# add -Z 1600 only if the source is wider than 1600 px
```

**`formatOptions 80`, not 82** — it's the value whose quantization tables match the
existing files (`[2,2,2,3,4,5,7,8]` vs their `[2,2,2,3,4,5,6,8]`); the sips presets are
too far off (`high` is visibly coarser, `best` balloons to 1.7 MB). Verify a match with
`python3 -c "from PIL import Image; print(list(Image.open(f).quantization[0][:8]))"`.

**Don't upscale.** `-Z 1600` resizes in *both* directions, so a source already under
1600 px gets enlarged for no added detail — `ionized_HVCs` was upscaled 1534→1600 that
way. `engawa.jpg` was regenerated at its native 1389×1299 on 2026-08-18 and is the
current reference for the recipe. The figures are CSS-sized, so nothing depends on the
derivatives sharing a width.

**Not every heavy PNG wants a JPEG** (2026-08-21). The derivative pays off on
*photographic* sources — sky images, dense volume renders, all-sky maps — where PNG can't
exploit the smooth gradients: `mc_hvs` went 2.0 MB → 360 KB, `engawa_DMs` 1.5 MB → 251 KB.
On a **sparse line/scatter plot** it's a bad trade: mostly flat white, which PNG stores
almost for free, and JPEG rings around the axis text and markers. `first_second_passage.png`
(263 KB, on par with `new_orbits.png`) is deliberately left as a PNG for that reason.

**Check alpha before converting.** JPEG has no alpha, so a genuinely transparent source
gets flattened against *something* — and matplotlib's black axis text on a transparent
ground would disappear into it. Both figures converted on 2026-08-21 carried an RGBA
channel that was **fully opaque** (`getextrema() == (255, 255)`), so flattening was a
no-op; `HVC_origins.png` is the counter-example whose alpha genuinely varies (0–255).
Use the one-liner in the white-background bullet above.

Paper **titles and citations are the real published ones** (verified against the arXiv
API, `au:"Scott Lucchini"` — note `au:"Lucchini_S"` returns nothing), not paraphrases.

## Favicon

Source of truth is `assets/icon.jpg` (1280², an illustrated spiral galaxy). Shipped as a
**raster set, not an SVG** — it's an illustration, so there's nothing sensible to vectorise:
`favicon-16.png`, `favicon-32.png`, `favicon-48.png`, `apple-touch-icon.png` (180²), linked
from `index.html` and (root-relative, since it sits a directory down) `engawa/index.html`.

Two things the source needs before it can be an icon, both easy to get wrong:

- **The white background has to be cut out.** The JPEG has no alpha and the disc sits on
  white, which shows as a white square around the circle on a dark browser tab. The disc
  measures centre (639.5, 641.0), radius ≈ 561; crop square to that, then mask to a circle
  with the edge pulled in ~2 px so no white rim survives the resample. Sanity-check by
  averaging the pixels just inside the rim — they should come out dark blue (≈ 59, 68, 120),
  not white.
- **The small sizes are cropped in progressively** ("optical scaling"). Shrinking the whole
  disc to 16 px gives a dot with an orange speck, and the dark navy rim vanishes against a
  dark tab. Crop to a fraction of the disc radius instead: **0.60 at 16 px, 0.72 at 32 px,
  0.85 at 48 px**, full disc for the 180 px apple-touch icon (which also needs an *opaque*
  full-bleed square — `#090e19` — because iOS applies its own mask). Each size also gets a
  light unsharp pass and ~1.2× saturation, since downsampling flattens both.

Accept that at 16 px this reads as a coloured swirl rather than a legible galaxy — that's
inherent to a detailed illustration at that size, and no crop fixes it.

**If you ever add an SVG icon back, remove these PNG links or the SVG will win** — browsers
prefer `type="image/svg+xml"` when both are listed, so a stale `favicon.svg` silently
overrides the whole raster set.

## Regenerating the volume viz assets from HDF5

The header volume is a raw `uint8` 3D grid (`.bin`) + a `.meta.json`, generated from
Arepo/ENGAWA HDF5 density grids (dataset `/rho`, number density in cm⁻³). Tooling on this
machine: `python3` (Framework build) with `h5py`/`numpy`, and HDF5 CLIs under
`/usr/local/hdf5/1.12.1/bin/` (`h5ls`, `h5dump`).

To replace the CGM comparison volumes, convert **both** runs with a **shared** display
range so the wipe is a fair resolution-only comparison. For each grid:

1. `logrho = log10(rho)`.
2. Shared `vmin` = ~1st percentile of combined `logrho` (transparency floor),
   `vmax` = combined max.
3. Encode `uint8`: byte `0` = below-floor/transparent; `1..255` =
   `round(clip((logrho-vmin)/(vmax-vmin),0,1)*254)+1`.
4. Write **x-fastest** order (`index = x + y*nx + z*nx*ny`), i.e. `array.transpose(2,1,0)`
   in C order.
5. `proj_vmin`/`proj_vmax` come from `log10(sum(10**logrho, axis=0))` (column map)
   percentiles; the shader offsets these by `log10(N)` internally.

Output to `assets/viz/engawa/` as `<field>_<run>_256.{bin,meta.json}`, e.g.
`total_gas_200pc_256` / `total_gas_default_256`, and likewise `hi_*`, `mgii_*`, `ovi_*`.
Source HDF5 datasets: `/rho` (total gas), `/rho_nh` (H I), `/rho_mg` (Mg II), `/rho_ovi`
(O VI) in `raw_data/grid_rho{,_nh,_mg,_ovi}_256_{200pc,Default}.h5`. Each **ion pair** gets
its **own** shared range (ranges differ by orders of magnitude between ions); ions with
many empty cells (Mg II, O VI) map exactly-zero density to byte 0 (transparent). All `256³`,
`200 kpc` FOV. Filename↔field mapping lives in `VOLUME_FIELDS` in `viz3d.js`.

**After regenerating any `.bin`, re-run `python3 scripts/build_volume_atlases.py`** — the
site loads the WebP atlases, not the `.bin`, and a stale atlas would silently keep serving
the old data (see below).

### WebP slice atlases (what the site actually downloads)

The `.bin` cubes are 16.78 MB each and the CGM page needs a pair, so they ship as lossy
grayscale WebP z-slice atlases instead: `<name>_a0..a3.webp`, 4096×1024 each (16×4 tiles of
256², 64 z-slices per part), built by `scripts/build_volume_atlases.py`. **134 MB → 20 MB**
over the wire; home drops from 33.55 MB to 1.93 MB. Four parts rather than one 4096²
atlas because 4096² is exactly iOS Safari's 16,777,216-px canvas-area limit.

Why lossy is safe: the ray-march integrates ~400 samples per pixel, so per-voxel error
averages down. The script's check pass reports what reaches the screen — at the default
q85, a **0.2–0.8 % mean shift along the colorbar** (p99 0.9–3.2 %), below the quantization
already baked into the u8 encoding. Sparse/brick structures were measured and rejected:
even Mg II, at 71 % empty voxels, has 88 % of its 8³ bricks occupied.

`viz3d.js:_decodeAtlas` reverses it: `createImageBitmap` with **`colorSpaceConversion:
"none"`** (a color-managed decode would silently regrade the data), draw to a canvas, take
the R channel, clamp `< 2` back to `0` to restore the empty sentinel. ~370 ms per cube on
an M-series Mac. The `.bin` files stay on disk as the fallback — `_load3D` uses them when
a cube has no `atlas` block in its meta, or if the decode throws. The `.meta.json` is
fetched with `cache: "no-cache"`, since a visitor holding a pre-atlas cached copy would
otherwise keep pulling the 16.78 MB `.bin`.

The comparison (Default-run) cube is fetched **only for areas with `compare: true`** in
`data.js` — home and the third volume area never sample `u_data2`, so they load one cube;
navigating to CGM pulls the second one then, under the loading indicator.

## Load weight, and what's left to optimize

Optimization pass of 2026-08-18, prompted by slow loads over the network on a phone. Where
things stand per cold visit:

| | before | now |
|---|---|---|
| home (first page anyone hits) | 33.55 MB | **1.93 MB** |
| CGM direct load | 33.55 MB | **2.93 MB** |
| switching ion (H I / Mg II / O VI) | 33.55 MB each | 4.17 / 5.85 / 7.06 MB |
| all 8 cubes | 134 MB | 20 MB |

Two ideas were measured and **rejected**, so they don't get re-proposed:

- *Convert the float cubes to ints* — already done; they have always been `uint8` over a
  shared log range with `0` reserved as the empty sentinel.
- *Exploit sparsity with a brick/octree structure* — the zeros are scattered, not clustered.
  Even Mg II, at 71 % empty **voxels**, has 88 % of its 8³ **bricks** occupied (total gas
  91 %, H I 94 %, O VI 99 %). A sparse structure would buy 5–20 % for a much more complex
  shader with an indirection per sample. Thresholding before a lossy encode also *hurts* —
  the hard edges cost bits (H I went 2.77 → 4.02 MB).

Still on the table, roughly by value:

1. **A 128³ tier for phones.** 8× less texture memory and a much cheaper ray-march, not just
   a smaller download. Quality is **per-field**, which is the catch: measured colorbar shift
   vs the 256³ cube is 0.10 % mean / 0.66 % p99 for total gas (279 KB at q85) and 0.15 % /
   1.30 % for O VI, but **4.33 % / 27.6 % for H I** — halving the grid genuinely destroys
   H I's thin filaments. So: fine for home and the CGM default, not a blanket swap.
   **Gotcha:** `proj_vmin`/`proj_vmax` were measured as a sum over 256 voxels while
   `_applySet` offsets by `log10(dims[axis])`, so a 128³ cube must have its `proj_*` shifted
   by `-log10(2)` or the whole image lands 0.3 dex (≈ 15 % of the colorbar) off.
2. ~~**Re-encode the ISM movie.**~~ **Done 2026-08-21** — 77 MB → **17.6 MB** (`libx264
   -preset slow -crf 26`, 1024², 30 fps, 2480 frames preserved; original kept locally as
   `I11_highcadence_gas_movie.orig.mp4`, gitignored). The `<video>` still carries
   `preload="auto"`, so this is the single biggest win on first load of the ISM area.
   **The old "< 8 MB with no visible loss" estimate here was wrong** — measured, this
   content is high-entropy turbulence and doesn't compress that far: CRF 30 lands at 9.4 MB
   but visibly smears the bright filaments. **Don't downscale it and don't push CRF past
   ~26**: the SNe magnifier samples the video element at 3×, so it is the only pixel source
   and compression artifacts get magnified with it. Check any future re-encode by cropping
   ~160 px at 3× (that's roughly what the lens shows) and comparing against the original,
   not by SSIM alone — CRF 26/30 differ by only 0.014 SSIM but are obviously different in
   the lens.
3. **Compress the Magellanic GLBs.** `IsoLayer._preloadAll()` pulls all 17 snapshots (~57 MB)
   with uncompressed float32 positions/normals and uint32 indices, no Draco/meshopt
   (`extensionsUsed` is absent). 5–10× available; preloading neighbours-first instead of all
   at once would also stop it competing for bandwidth on arrival.
4. **Decode off the main thread.** `_decodeAtlas` costs ~370 ms per cube on an M-series Mac
   (fetch + decode + gather), likely 2–3× that on a phone. A worker would hide it.
   `ImageDecoder` (WebCodecs) would skip the canvas round-trip where supported.
5. **Server config.** Nothing is compressed on the wire — no `Content-Encoding` on the JS or
   CSS either. `mod_deflate` and `mod_expires` are available but not loaded in the Apache config, and
   `.htaccess` overrides are disabled — enabling either needs a privileged config edit +
   restart. Note gzip does almost
   nothing for the cubes now (WebP is already compressed) and only reached 1.6× on the raw
   `.bin`; the win here is JS/CSS/JSON plus real `Cache-Control` for repeat visits.
6. **Progressive upgrade.** Load 128³ first, swap to 256³ in the background once it arrives.
7. **Figures.** `assets/HVC_origins.png` (947 KB) and `assets/perch_bubbles.png` (1.4 MB)
   are RGBA PNGs sitting next to `assets/web/`, where the other large figures are already
   ~250–420 KB JPEGs. `HVC_origins` needs care — its alpha genuinely varies, so a JPEG
   flatten has to composite against white on purpose, not by accident.

Movies (hero + ISM) are plain MP4s in `raw_data/`, referenced by `heroVideo`/`movie` in
`data.js`; they are muted + looping (required for autoplay).
