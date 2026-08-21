// viz3d.js — persistent WebGL "stage" shared across all research areas.
//
// One renderer / scene / camera lives for the lifetime of the page and is never
// remounted, so navigating between areas can *morph* (crossfade + camera fly)
// instead of tearing down and rebuilding a canvas. React owns layout; this
// module positions a single fixed <canvas> over whichever `.viz-anchor` element
// React currently has on screen.
//
// Layers:
//   • VolumeLayer — GLSL3 ray-marched ENGAWA gas volume. Shared by Home (auto-
//     orbit), CGM (interactive) and ISM (frozen x–y / disk-zoom framing).
//   • IsoLayer    — nested transparent GLB isosurfaces of the MW + LMC CGM with
//     a snapshot timeline (Magellanic).
//
// Public API is exposed as `window.SLViz`; React (app.js) drives it imperatively
// via `SLViz.show(areaId, vizConfig)` plus control setters, and subscribes to
// events with `SLViz.on(evt, cb)`.

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { Line2 } from "three/addons/lines/Line2.js";
import { LineGeometry } from "three/addons/lines/LineGeometry.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";

const VIZ_BASE = "assets/viz/";
const ENGAWA_BASE = VIZ_BASE + "engawa/";
const MAG_BASE = VIZ_BASE + "magellanic/";

// Both layers are normalized so their content sits at the origin with this
// approximate radius — that lets one shared camera frame either layer and keeps
// crossfades visually coherent (no giant zoom between dissimilar scales).
const TARGET_RADIUS = 0.6;

// Volume↔iso hold transitions (see _applyVolumeHold): the volume's apparent
// size ramps monotonically between 1× and this factor — it recedes to this as
// it fades out toward the iso model, and approaches from it when fading back
// in. Tuning knob; smaller = deeper zoom-out.
const VOL_HOLD_ZOOM = 0.35;
// Canonical orientation the volume settles into while zooming out to the
// Magellanic page: edge-on, seen from the -y axis with +z up (the CGM page's
// default view). Only the direction matters.
const VOL_EDGE_POS = new THREE.Vector3(0, -1, 0);

const easeInOut = (p) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);

// ─────────────────────────────────────────── tiny event emitter
class Emitter {
  constructor() { this._h = {}; }
  on(evt, cb) { (this._h[evt] ||= []).push(cb); return () => this.off(evt, cb); }
  off(evt, cb) { this._h[evt] = (this._h[evt] || []).filter((f) => f !== cb); }
  emit(evt, ...a) { (this._h[evt] || []).forEach((f) => { try { f(...a); } catch (e) { console.error(e); } }); }
}

// ════════════════════════════════════════════════════════════════════════════
// VolumeLayer — ray-marched gas volume (ported from ENGAWA viewer.js)
// ════════════════════════════════════════════════════════════════════════════
const CMAP_STOPS = [
  [0.0, [0.015, 0.045, 0.11]], [0.3, [0.04, 0.22, 0.3]],
  [0.52, [0.09, 0.45, 0.46]], [0.66, [0.55, 0.42, 0.3]],
  [0.74, [0.92, 0.45, 0.13]], [0.88, [1.0, 0.72, 0.28]],
  [1.0, [1.0, 1.0, 0.95]],
];
function cmap(t) {
  t = Math.min(1, Math.max(0, t));
  for (let i = 1; i < CMAP_STOPS.length; i++) {
    if (t <= CMAP_STOPS[i][0]) {
      const [t0, c0] = CMAP_STOPS[i - 1];
      const [t1, c1] = CMAP_STOPS[i];
      const f = (t - t0) / (t1 - t0);
      return [0, 1, 2].map((k) => c0[k] + f * (c1[k] - c0[k]));
    }
  }
  return CMAP_STOPS[CMAP_STOPS.length - 1][1];
}
const smoothstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const gauss = (n, mu, sg) => Math.exp(-((n - mu) ** 2) / (2 * sg * sg));

const TF_PRESETS = {
  balanced: (n) => Math.pow(n, 1.6) * 0.9,
  translucent: (n) => smoothstep(0.12, 1.0, n) * 0.45,
  cgm: (n) => gauss(n, 0.4, 0.12) * 0.6 + Math.pow(n, 5) * 0.2,
};
function makeTFTexture(alphaFn) {
  const data = new Uint8Array(256 * 4);
  for (let i = 0; i < 256; i++) {
    const n = i / 255;
    const c = cmap(n);
    data[i * 4 + 0] = Math.round(c[0] * 255);
    data[i * 4 + 1] = Math.round(c[1] * 255);
    data[i * 4 + 2] = Math.round(c[2] * 255);
    data[i * 4 + 3] = Math.round(Math.min(1, Math.max(0, alphaFn(n))) * 255);
  }
  const tex = new THREE.DataTexture(data, 256, 1, THREE.RGBAFormat);
  tex.minFilter = tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}

const VOL_VERT = /* glsl */ `
  out vec3 vOrigin;
  out vec3 vDirection;
  void main() {
    vOrigin = vec3(inverse(modelMatrix) * vec4(cameraPosition, 1.0));
    vDirection = position - vOrigin;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// Like the ENGAWA shader, but premultiplied-alpha output (no opaque bg fill) so
// the volume can crossfade over the scene / another layer. u_master scales the
// whole layer's contribution for transitions.
const VOL_FRAG = /* glsl */ `
  precision highp float;
  precision highp sampler3D;
  in vec3 vOrigin;
  in vec3 vDirection;
  out vec4 outColor;
  uniform sampler3D u_data;   // primary volume (high-res / 200pc)
  uniform sampler3D u_data2;  // comparison volume (low-res / Default)
  uniform float u_split;      // 0..1 screen-x wipe: left of split samples u_data2
  uniform vec2 u_res;         // drawing-buffer size in px (for gl_FragCoord)
  uniform sampler2D u_lut;
  uniform sampler2D u_tf;
  uniform float u_mode;      // 0 = integral (column density), 1 = volume (TF)
  uniform float u_steps;
  uniform float u_vmin;
  uniform float u_vmax;
  uniform float u_projVmin;
  uniform float u_projVmax;
  uniform float u_cbLo;      // colorbar bottom, as a fraction of the [projVmin,projVmax] span
  uniform float u_cbHi;      // colorbar top,    as a fraction of the span (1 = default max)
  uniform float u_gain;
  uniform float u_opacity;
  uniform float u_master;    // 0..1 crossfade scale
  #define LOG10 0.43429448190325176
  vec2 hitBox(vec3 orig, vec3 dir) {
    vec3 bmin = vec3(-0.5), bmax = vec3(0.5);
    vec3 inv = 1.0 / dir;
    vec3 t0 = (bmin - orig) * inv;
    vec3 t1 = (bmax - orig) * inv;
    vec3 tmin = min(t0, t1), tmax = max(t0, t1);
    return vec2(max(max(tmin.x, tmin.y), tmin.z), min(min(tmax.x, tmax.y), tmax.z));
  }
  void main() {
    vec3 rayDir = normalize(vDirection);
    vec2 b = hitBox(vOrigin, rayDir);
    if (b.x > b.y) discard;
    b.x = max(b.x, 0.0);
    float dt = (b.y - b.x) / u_steps;
    vec3 p = vOrigin + b.x * rayDir + 0.5;
    vec3 dstep = rayDir * dt;
    // per-fragment wipe: left of the split shows the comparison (low-res) volume
    bool useLow = (gl_FragCoord.x / u_res.x) < u_split;
    if (u_mode < 0.5) {
      float colsum = 0.0;
      for (float t = 0.0; t < u_steps; t += 1.0) {
        float u = useLow ? texture(u_data2, p).r : texture(u_data, p).r;
        if (u > 0.0019) {
          float n = (u * 255.0 - 1.0) / 254.0;
          float logd = u_vmin + n * (u_vmax - u_vmin);
          colsum += pow(10.0, logd) * dt;
        }
        p += dstep;
      }
      float lc = log(colsum + 1e-30) * LOG10;
      // map column density between a bottom/top window (independently adjustable)
      float span = u_projVmax - u_projVmin;
      float lo = u_projVmin + u_cbLo * span;
      float hi = u_projVmin + u_cbHi * span;
      float v = clamp((lc - lo) / max(hi - lo, 1e-6), 0.0, 1.0);
      vec3 rgb = texture(u_lut, vec2(v, 0.5)).rgb;
      outColor = vec4(rgb * u_master, u_master);
    } else {
      vec4 acc = vec4(0.0);
      float refSteps = 256.0;
      for (float t = 0.0; t < u_steps; t += 1.0) {
        float u = useLow ? texture(u_data2, p).r : texture(u_data, p).r;
        if (u > 0.0019) {
          float n = (u * 255.0 - 1.0) / 254.0;
          vec4 tf = texture(u_tf, vec2(n, 0.5));
          float a = 1.0 - pow(1.0 - clamp(tf.a * u_opacity, 0.0, 1.0), dt * refSteps);
          acc.rgb += (1.0 - acc.a) * a * tf.rgb * u_gain;
          acc.a += (1.0 - acc.a) * a;
          if (acc.a > 0.995) break;
        }
        p += dstep;
      }
      outColor = vec4(acc.rgb * u_master, acc.a * u_master);
    }
  }
`;

// Selectable fields for the CGM viewer. Each maps to a paired set of prebuilt
// volumes (high-res "200pc" run + "Default" run) that share a display range.
const VOLUME_FIELDS = {
  total_gas: { hi: "total_gas_200pc_256", lo: "total_gas_default_256" },
  hi:        { hi: "hi_200pc_256",        lo: "hi_default_256" },
  mgii:      { hi: "mgii_200pc_256",      lo: "mgii_default_256" },
  ovi:       { hi: "ovi_200pc_256",       lo: "ovi_default_256" },
};
const DEFAULT_FIELD = "total_gas";

// Per-field colormap (LUT texture). total_gas + H I share the existing dusk map.
const FIELD_LUT = {
  total_gas: "engawa_lut.png",
  hi:        "engawa_lut.png",
  mgii:      "mgii_lut.png",
  ovi:       "afmhot_lut.png",
};

class VolumeLayer {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.visible = false;
    this.scene.add(this.group);
    this.loaded = false;
    this._loading = null;
    this.mode = 1;            // start in volume (TF) mode
    this.preset = "balanced";
    this.gain = 1.0;
    this.opacity = 1.0;
    // Ray-march steps per fragment. This is the single dominant cost of the whole
    // page: integral mode has no early-out, so EVERY fragment that hits the box
    // runs the full loop (and on home the camera sits right against the box face,
    // so it fills the viewport and nearly every fragment hits).
    // stepsMoving is what the camera fly and drags run at; stepsIdle is the one
    // refined frame drawn after motion stops. They're equal now — dropping steps
    // during a drag was visible as banding/softening (it's sample count, not
    // pixels), and the measurement said we don't need to. Cost is near-linear in
    // step count; on the CGM area (?perf=1) 96 steps ran ~7.5 ms/frame and 400
    // runs ~20 ms (≈49 fps while dragging), which is smooth enough.
    // Re-measure before raising further: integral mode has no early-out, so the
    // worst case is a viewport-filling box (home's morph, or CGM zoomed in).
    this.stepsIdle = 400;
    this.stepsMoving = 400;
    this.split = 0.0;         // 0 = show only primary (high-res) volume everywhere
    this.compare = false;     // does this area wipe between runs? (gates the 2nd cube fetch)
    this.cbLo = 0.0;          // colorbar bottom (fraction of the field's display span)
    this.cbHi = 1.0;          // colorbar top
    this.field = DEFAULT_FIELD;
    this._sets = {};          // field -> { hi:tex, lo:tex|null, meta } (lazy, cached)
    this._loadingHi = {};     // field -> in-flight primary-cube fetch (dedupes concurrent callers)
    this._luts = {};          // lut filename -> texture (lazy, cached)
    this._fieldEpoch = 0;
  }

  // Load (once) and cache a colormap LUT texture by filename.
  async _ensureLut(name) {
    if (this._luts[name]) return this._luts[name];
    const loader = new THREE.TextureLoader();
    const tex = await new Promise((res, rej) =>
      loader.load(ENGAWA_BASE + name,
        (t) => { t.minFilter = t.magFilter = THREE.LinearFilter; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; res(t); },
        undefined, rej));
    this._luts[name] = tex;
    return tex;
  }

  // Load (once) and cache a field's volumes. The comparison (Default-run) cube
  // is only sampled where the wipe is active, so areas that don't set `compare`
  // never fetch it — that's half the bytes on home, which is the first thing
  // anyone loads. Arriving on a compare area later fetches it then.
  async _ensureField(field, wantLo) {
    const cfg = VOLUME_FIELDS[field];
    let set = this._sets[field];
    if (!set) {
      // load() and a field switch can both land here before either resolves —
      // share the one fetch instead of pulling the cube twice
      if (!this._loadingHi[field]) {
        this._loadingHi[field] = this._load3D(ENGAWA_BASE + cfg.hi).then((hi) => {
          this._sets[field] = { hi: hi.tex, lo: null, meta: hi.meta, loading: null };
          this._loadingHi[field] = null;
          return this._sets[field];
        });
      }
      set = await this._loadingHi[field];
    }
    if (wantLo && !set.lo) {
      if (!set.loading) {
        set.loading = this._load3D(ENGAWA_BASE + cfg.lo).then((r) => {
          set.lo = r.tex;
          set.loading = null;
          // if this field is the one on screen, point the wipe at the real cube
          if (this._sets[this.field] === set && this.material) {
            this.material.uniforms.u_data2.value = r.tex;
          }
          return r.tex;
        });
      }
      await set.loading;
    }
    return set;
  }

  // in-flight fetch of the current field's comparison cube, if any (the stage
  // waits on this so an area that wipes doesn't reveal before it lands)
  pending() {
    const set = this._sets[this.field];
    return (set && set.loading) || null;
  }

  // whether this area wipes between the two runs — set before load()
  setCompare(on) {
    this.compare = !!on;
    if (this.compare && this.loaded) this._ensureField(this.field, true);
  }

  // Point the shader at a loaded field's textures + its display range.
  _applySet(set) {
    const m = set.meta;
    const off = Math.log10(m.dims[{ x: 0, y: 1, z: 2 }[m.default_axis || "x"]]);
    const u = this.material.uniforms;
    u.u_data.value = set.hi;
    // no comparison cube on areas that don't wipe (u_split is 0 there, so it's
    // never sampled — but the sampler still has to be bound to something)
    u.u_data2.value = set.lo || set.hi;
    u.u_vmin.value = m.vmin;
    u.u_vmax.value = m.vmax;
    u.u_projVmin.value = m.proj_vmin - off;
    u.u_projVmax.value = m.proj_vmax - off;
    this.meta = m;
  }

  // Switch the displayed ion/field (lazy-loads + caches the pair + its colormap).
  // `cb` is that field's colorbar window: it's applied here, in the same tick as
  // the texture and LUT swap, so it can't re-window the OLD ion's data for the
  // second or two the new cubes take to arrive.
  async setField(field, cb) {
    if (!VOLUME_FIELDS[field] || field === this.field) return;
    const epoch = ++this._fieldEpoch;
    const [set, lut] = await Promise.all([
      this._ensureField(field, this.compare),
      this._ensureLut(FIELD_LUT[field] || "engawa_lut.png"),
    ]);
    if (epoch !== this._fieldEpoch || !this.material) return; // superseded / not ready
    this._applySet(set);
    this.material.uniforms.u_lut.value = lut;
    if (cb) this.setColorbar(cb.lo, cb.hi);
    this.field = field;
  }

  // Decode a cube shipped as grayscale WebP z-slice atlases (built by
  // scripts/build_volume_atlases.py) back into the u8 array the .bin path used
  // to hand over — ~7x fewer bytes on the wire, decoded by the browser's own
  // image codec. Slice z is contiguous in the cube (index = x + y*nx + z*nx*ny)
  // and each slice is one tile, so this is a strided copy, not a re-indexing.
  // Lossy, but the ray-march integrates ~400 samples per pixel so the error
  // averages down: the encoder's --check pass measures what actually reaches
  // the screen (a ~0.2-0.8% mean shift along the colorbar).
  async _decodeAtlas(base, meta) {
    const [nx, ny, nz] = meta.dims;
    const a = meta.atlas;
    const [tw, th] = a.tile;
    const dir = base.slice(0, base.lastIndexOf("/") + 1);
    const vol = new Uint8Array(nx * ny * nz);
    // start every part downloading now, but decode them one at a time: each
    // decode holds an RGBA copy of a 4096x1024 image (16 MB), and holding four
    // of those at once is exactly the spike a phone can't afford
    const blobs = a.parts.map((p) => fetch(dir + p).then((r) => r.blob()));
    for (let pi = 0; pi < a.parts.length; pi++) {
      const bmp = await createImageBitmap(await blobs[pi], {
        colorSpaceConversion: "none",   // never let the browser regrade the data
        premultiplyAlpha: "none",
      });
      const cv = typeof OffscreenCanvas !== "undefined"
        ? new OffscreenCanvas(bmp.width, bmp.height)
        : Object.assign(document.createElement("canvas"), { width: bmp.width, height: bmp.height });
      const ctx = cv.getContext("2d", { colorSpace: "srgb", willReadFrequently: true });
      ctx.drawImage(bmp, 0, 0);
      const aw = bmp.width, ah = bmp.height;   // close() zeroes these — read them first
      const px = ctx.getImageData(0, 0, aw, ah).data;  // RGBA, R=G=B
      bmp.close();
      for (let s = 0; s < a.slices_per_part; s++) {
        const z = pi * a.slices_per_part + s;
        if (z >= nz) break;             // last part may be short
        const ox = (s % a.cols) * tw, oy = Math.floor(s / a.cols) * th;
        let o = z * nx * ny;
        for (let y = 0; y < th; y++) {
          let i = ((oy + y) * aw + ox) * 4;
          for (let x = 0; x < tw; x++, i += 4) {
            const v = px[i];
            vol[o++] = v < 2 ? 0 : v;   // restore the reserved "empty" sentinel
          }
        }
      }
    }
    return vol;
  }

  async _load3D(base) {
    // revalidate the meta: it's ~700 bytes, and a cached copy from before the
    // atlases existed would silently send this visitor back to the 16.78 MB
    // .bin. The cubes themselves stay freely cacheable — their names change
    // when their contents do.
    const meta = await fetch(base + ".meta.json", { cache: "no-cache" }).then((r) => r.json());
    const [nx, ny, nz] = meta.dims;
    // atlases when the cube has been built (the raw .bin stays on disk as the
    // fallback — for a browser without createImageBitmap options, and for a
    // cube that hasn't been re-encoded)
    let vol = null;
    if (meta.atlas) {
      try { vol = await this._decodeAtlas(base, meta); }
      catch (e) { console.warn("atlas decode failed, falling back to .bin", base, e); }
    }
    if (!vol) vol = new Uint8Array(await fetch(base + ".bin").then((r) => r.arrayBuffer()));
    const tex = new THREE.Data3DTexture(vol, nx, ny, nz);
    tex.format = THREE.RedFormat;
    tex.type = THREE.UnsignedByteType;
    tex.minFilter = tex.magFilter = THREE.LinearFilter;
    tex.wrapS = tex.wrapT = tex.wrapR = THREE.ClampToEdgeWrapping;
    tex.unpackAlignment = 1;
    tex.needsUpdate = true;
    return { meta, tex };
  }

  load() {
    if (this._loading) return this._loading;
    this._loading = (async () => {
      const lut = await this._ensureLut(FIELD_LUT[this.field] || "engawa_lut.png");
      this._tf = {};
      for (const [k, fn] of Object.entries(TF_PRESETS)) this._tf[k] = makeTFTexture(fn);

      // primary = high-res (200pc) run; secondary = Default run, revealed by the
      // wipe on the ENGAWA/CGM page. Both share dims + display range. Other ion
      // fields are lazy-loaded on demand via setField().
      const set = await this._ensureField(this.field, this.compare);
      const meta = set.meta;
      this.meta = meta;

      // column-density display range: shader integrates over the unit box
      // (dt = 1/steps), Python summed over N voxels -> offset by log10(N).
      const axis = meta.default_axis || "x";
      const n = meta.dims[{ x: 0, y: 1, z: 2 }[axis]];
      const off = Math.log10(n);

      this.material = new THREE.ShaderMaterial({
        glslVersion: THREE.GLSL3,
        side: THREE.BackSide,
        transparent: true,
        premultipliedAlpha: true,
        depthWrite: false,
        depthTest: false,
        uniforms: {
          u_data: { value: set.hi },
          u_data2: { value: set.lo || set.hi },
          u_split: { value: this.split },
          u_res: { value: new THREE.Vector2(1, 1) },
          u_lut: { value: lut },
          u_tf: { value: this._tf[this.preset] },
          u_mode: { value: this.mode },
          u_steps: { value: this.stepsIdle },
          u_vmin: { value: meta.vmin },
          u_vmax: { value: meta.vmax },
          u_projVmin: { value: meta.proj_vmin - off },
          u_projVmax: { value: meta.proj_vmax - off },
          u_cbLo: { value: this.cbLo },
          u_cbHi: { value: this.cbHi },
          u_gain: { value: this.gain },
          u_opacity: { value: this.opacity },
          u_master: { value: 0.0 },
        },
        vertexShader: VOL_VERT,
        fragmentShader: VOL_FRAG,
      });
      this.mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), this.material);
      this.group.add(this.mesh);
      this.loaded = true;
    })();
    return this._loading;
  }

  setActive(on) { this.group.visible = on; }
  setMaster(a) { if (this.material) this.material.uniforms.u_master.value = a; }
  setSteps(s) { if (this.material) this.material.uniforms.u_steps.value = s; }
  setSplit(f) { this.split = Math.min(1, Math.max(0, f)); if (this.material) this.material.uniforms.u_split.value = this.split; }
  // colorbar bottom/top as fractions of the field's display span (stored so they
  // survive being set before the material exists — load() reads them back)
  setColorbar(lo, hi) {
    if (lo !== undefined && lo !== null) this.cbLo = lo;
    if (hi !== undefined && hi !== null) this.cbHi = hi;
    if (this.material) {
      this.material.uniforms.u_cbLo.value = this.cbLo;
      this.material.uniforms.u_cbHi.value = this.cbHi;
    }
  }
  setRes(w, h) { if (this.material) this.material.uniforms.u_res.value.set(w, h); }

  setMode(m) { this.mode = m; if (this.material) this.material.uniforms.u_mode.value = m; }
  setExposure(g) { this.gain = g; if (this.material) this.material.uniforms.u_gain.value = g; }
  setOpacity(o) { this.opacity = o; if (this.material) this.material.uniforms.u_opacity.value = o; }
  setPreset(name) { if (!TF_PRESETS[name]) return; this.preset = name; if (this.material) this.material.uniforms.u_tf.value = this._tf[name]; }

  // unit box already centered at origin & radius ~0.87; scale to TARGET_RADIUS
  applyFraming() { const s = TARGET_RADIUS / 0.866; this.group.scale.setScalar(s); }
  update() {}
}

// ════════════════════════════════════════════════════════════════════════════
// IsoLayer — nested transparent GLB isosurfaces + snapshot timeline (Magellanic)
// (ported from CGMViewer; shares the stage scene/camera instead of its own)
// ════════════════════════════════════════════════════════════════════════════
class IsoLayer {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();      // holds the active snapshot + framing transform
    this.group.visible = false;
    this.scene.add(this.group);
    this.loaded = false;
    this._loading = null;
    this.timeline = null;
    this.components = {};       // active snapshot: key -> { meshes, baseOpacities, visible }
    this._cache = {};           // timelineIdx -> snapshot group
    this.currentIdx = -1;
    this._master = 1.0;
    this._compVisible = {};     // key -> bool (user toggles, persist across snapshots)
    this._loadEpoch = 0;
    this.onPreload = null;
    this.orbits = null;         // key -> { line, marker, material, points } once loaded
    this._orbitData = null;
    this._orbitsVisible = true;
    this._res = new THREE.Vector2(1, 1);  // drawing-buffer size for LineMaterial
  }

  load() {
    if (this._loading) return this._loading;
    this._loading = (async () => {
      this.timeline = await fetch(MAG_BASE + "timeline.json").then((r) => r.json());
      this.currentIdx = this.timeline.snapshots.length - 1;
      const entry = this.timeline.snapshots[this.currentIdx];
      const base = MAG_BASE + entry.assetBase;
      const manifest = await fetch(base + "manifest.json").then((r) => r.json());
      this._computeFraming(manifest);          // fixed transform reused for all snapshots
      const snap = await this._buildSnapshot(manifest, base);
      this._cache[this.currentIdx] = snap;
      this._activate(this.currentIdx);
      await this._loadOrbits(manifest);
      this.loaded = true;
      this._preloadAll();
    })();
    return this._loading;
  }

  _computeFraming(manifest) {
    const b = manifest.bounds_kpc;
    const min = new THREE.Vector3(...b.min);
    const max = new THREE.Vector3(...b.max);
    this._center = min.clone().add(max).multiplyScalar(0.5);
    const radius = max.clone().sub(min).length() * 0.5;
    this._scale = TARGET_RADIUS / radius;
  }

  async _buildSnapshot(manifest, base) {
    const loader = new GLTFLoader();
    const nComps = manifest.components.length;
    const maxShells = Math.max(...manifest.components.map((c) => c.shells.length));
    const snapGroup = new THREE.Group();
    snapGroup.visible = false;
    // framing: center content at origin and scale to TARGET_RADIUS
    snapGroup.scale.setScalar(this._scale);
    snapGroup.position.copy(this._center).multiplyScalar(-this._scale);
    const comps = {};

    for (let ci = 0; ci < manifest.components.length; ci++) {
      const comp = manifest.components[ci];
      const shellByNode = {};
      comp.shells.forEach((s) => (shellByNode[s.node] = s));
      const gltf = await loader.loadAsync(base + comp.glb);
      const color = new THREE.Color(comp.color);
      const meshes = [];
      const compRenderBase = (nComps - 1 - ci) * maxShells;
      let idx = 0;
      gltf.scene.traverse((obj) => {
        if (!obj.isMesh) return;
        const name = obj.name || (obj.parent && obj.parent.name) || "";
        const shell = shellByNode[name] || comp.shells[idx];
        idx += 1;
        const baseOpacity = shell ? shell.opacity : 0.2;
        obj.material = new THREE.MeshStandardMaterial({
          color, emissive: color.clone().multiplyScalar(0.18),
          roughness: 0.85, metalness: 0.0, transparent: true,
          opacity: baseOpacity, depthWrite: false, side: THREE.DoubleSide,
        });
        obj.renderOrder = compRenderBase + idx;
        meshes.push({ mesh: obj, baseOpacity });
      });
      snapGroup.add(gltf.scene);
      comps[comp.key] = { key: comp.key, name: comp.name, color: comp.color, meshes };
      if (this._compVisible[comp.key] === undefined) this._compVisible[comp.key] = true;
    }
    this.group.add(snapGroup);
    return { group: snapGroup, comps };
  }

  async _preloadAll() {
    const n = this.timeline.snapshots.length;
    for (let d = 1; d < n; d++) {
      const i = this.currentIdx - d;
      if (i < 0 || this._cache[i]) continue;
      const entry = this.timeline.snapshots[i];
      const base = MAG_BASE + entry.assetBase;
      try {
        const manifest = await fetch(base + "manifest.json").then((r) => r.json());
        this._cache[i] = await this._buildSnapshot(manifest, base);
      } catch (e) { console.warn("IsoLayer preload failed", i, e); }
      if (this.onPreload) this.onPreload(Object.keys(this._cache).length, n);
    }
  }

  // Orbit tracks (orbits.json): one polyline per galaxy plus a marker at that
  // galaxy's position for the current snapshot. Optional — if the file isn't
  // published the layer just runs without tracks. Points share the snapshots'
  // frame and units (kpc), so they reuse the same framing transform.
  async _loadOrbits(manifest) {
    let data;
    try {
      const r = await fetch(MAG_BASE + "orbits.json");
      if (!r.ok) return;
      data = await r.json();
    } catch (e) { return; }
    if (!data || !data.tracks) return;
    this._orbitData = data;

    // Trim the tracks to the era the snapshots cover (~1.5 Gyr) — the file
    // holds the full simulation from t=0, but only the timeline's window is
    // shown, so the line matches what the scrubber can reach.
    const times = data.time_gyr;
    let i0 = 0, i1 = times.length - 1;
    if (this.timeline && this.timeline.snapshots.length) {
      const tmin = this.timeline.snapshots[0].time_gyr;
      const tmax = this.timeline.snapshots[this.timeline.snapshots.length - 1].time_gyr;
      while (i0 < i1 && times[i0] < tmin) i0++;
      while (i1 > i0 && times[i1] > tmax) i1--;
    }
    this._orbitTimes = times.slice(i0, i1 + 1);

    const colorByKey = {};
    for (const c of manifest.components) colorByKey[c.key] = c.color;

    const orbitGroup = new THREE.Group();
    orbitGroup.scale.setScalar(this._scale);
    orbitGroup.position.copy(this._center).multiplyScalar(-this._scale);
    this.group.add(orbitGroup);

    this.orbits = {};
    for (const [key, fullPts] of Object.entries(data.tracks)) {
      const pts = (fullPts || []).slice(Math.min(i0, fullPts.length), Math.min(i1 + 1, fullPts.length));
      if (pts.length < 2) continue;
      const color = new THREE.Color(colorByKey[key] || "#ffffff");
      // brighten the track so it reads against its own translucent shells
      const lineColor = color.clone().lerp(new THREE.Color(0xffffff), 0.35);
      const geom = new LineGeometry();
      geom.setPositions(pts.flat());
      const mat = new LineMaterial({
        color: lineColor.getHex(),
        linewidth: 2, // px; Line2 gives real width, unlike THREE.Line
        transparent: true,
        opacity: 0.95,
        depthTest: false, // keep tracks readable through the nested shells
      });
      mat.resolution.copy(this._res);
      const line = new Line2(geom, mat);
      line.computeLineDistances();
      line.renderOrder = 1000;
      orbitGroup.add(line);

      const marker = new THREE.Mesh(
        new THREE.SphereGeometry(7, 20, 14),
        new THREE.MeshBasicMaterial({ color: lineColor, transparent: true, depthTest: false })
      );
      marker.renderOrder = 1001;
      orbitGroup.add(marker);

      this.orbits[key] = { line, marker, material: mat, points: pts };
    }
    this._updateOrbitMarkers();
    this._applyOrbitVisibility();
    this._applyOpacity();
  }

  // Place each marker at the orbit sample nearest the current snapshot's time.
  // Uses the trimmed time array so indices line up with the trimmed points.
  _updateOrbitMarkers() {
    if (!this.orbits || !this._orbitTimes || !this.timeline) return;
    const snap = this.timeline.snapshots[this.currentIdx];
    if (!snap) return;
    const times = this._orbitTimes;
    let best = 0, bestD = Infinity;
    for (let i = 0; i < times.length; i++) {
      const d = Math.abs(times[i] - snap.time_gyr);
      if (d < bestD) { bestD = d; best = i; }
    }
    for (const o of Object.values(this.orbits)) {
      const p = o.points[Math.min(best, o.points.length - 1)];
      o.marker.position.set(p[0], p[1], p[2]);
    }
  }

  setOrbitsVisible(on) { this._orbitsVisible = on; this._applyOrbitVisibility(); }
  _applyOrbitVisibility() {
    if (!this.orbits) return;
    for (const o of Object.values(this.orbits)) {
      o.line.visible = this._orbitsVisible;
      o.marker.visible = this._orbitsVisible;
    }
  }

  // Line2 widths are computed in screen space, so the material needs the current
  // drawing-buffer size or the tracks render at the wrong thickness.
  setRes(w, h) {
    this._res.set(w, h);
    if (this.orbits) {
      for (const o of Object.values(this.orbits)) o.material.resolution.set(w, h);
    }
  }

  _activate(idx) {
    // hide previous snapshot group
    if (this._cache[this.currentIdx] && this._cache[this.currentIdx] !== this._cache[idx]) {
      this._cache[this.currentIdx].group.visible = false;
    }
    const snap = this._cache[idx];
    this.currentIdx = idx;
    this.components = snap.comps;
    snap.group.visible = true;
    this._updateOrbitMarkers();
    this._applyVisibility();
    this._applyOpacity();
  }

  async setSnapshot(idx) {
    if (!this.timeline) return;
    const epoch = ++this._loadEpoch;
    if (this._cache[idx]) { this._activate(idx); return; }
    const entry = this.timeline.snapshots[idx];
    const base = MAG_BASE + entry.assetBase;
    const manifest = await fetch(base + "manifest.json").then((r) => r.json());
    if (epoch !== this._loadEpoch) return;
    this._cache[idx] = await this._buildSnapshot(manifest, base);
    if (epoch !== this._loadEpoch) return;
    this._activate(idx);
  }

  setVisibleComponent(key, on) { this._compVisible[key] = on; this._applyVisibility(); }
  _applyVisibility() {
    for (const c of Object.values(this.components)) {
      const on = this._compVisible[c.key] !== false;
      for (const { mesh } of c.meshes) mesh.visible = on;
    }
  }
  _applyOpacity() {
    for (const c of Object.values(this.components)) {
      for (const { mesh, baseOpacity } of c.meshes) {
        mesh.material.opacity = Math.min(1, baseOpacity * this._master);
      }
    }
    // orbit tracks fade with the layer crossfade too
    if (this.orbits) {
      for (const o of Object.values(this.orbits)) {
        o.material.opacity = 0.95 * this._master;
        o.marker.material.opacity = this._master;
      }
    }
  }

  setActive(on) { this.group.visible = on; }
  setMaster(a) { this._master = a; this._applyOpacity(); }
  applyFraming() {}   // framing baked per snapshot group
  update() {}
}

// ════════════════════════════════════════════════════════════════════════════
// Stage — singleton renderer/scene/camera + anchor tracking + transitions
// ════════════════════════════════════════════════════════════════════════════
class Stage extends Emitter {
  constructor() {
    super();
    this.layers = {};
    this.activeLayer = null;
    this.transition = null;
    this._lastW = 0; this._lastH = 0;
    this._sizeV = new THREE.Vector2(1, 1);
    this._autoRotate = false;
    this._cameraMoving = false;
    this._pending = null;
    this._everShown = false;  // first show() snaps the camera instead of flying
    this._baseDist = 2.175;   // camera→target distance at zoom 1x (per area)
    this._zoom = 1;           // >1 = closer / zoomed in
    // touch devices get two-finger pinch zoom in place of the desktop slider
    this._isCoarsePointer = !!(window.matchMedia && window.matchMedia("(pointer: coarse)").matches);
    this._roll = 0;           // camera roll (rad) around the view axis (per area)
    // ── render-on-demand state ──
    // The volume ray-march is far too expensive to re-run every rAF frame when
    // nothing has changed (it saturates the shared GPU process and freezes the
    // whole browser). So the loop only draws when something actually changed:
    //   _dirty       — a one-off redraw is owed (uniform/camera/size changed)
    //   _owedRefine  — motion just ended; draw ONE frame at the full stepsIdle
    //   _coarseUntil — timestamp until which redraws use the cheap step count
    //                  (set by continuous interactions like the wipe drag)
    this._dirty = true;
    this._owedRefine = false;
    this._coarseUntil = 0;
    this._perf = null;        // perf HUD state (dev only; see setPerf)
  }

  // Request a redraw. `coarse` marks a continuous interaction (a slider/wipe
  // drag), which renders at stepsMoving and then refines once it goes quiet.
  invalidate(coarse) {
    this._dirty = true;
    if (coarse) {
      this._coarseUntil = performance.now() + 200;
      this._owedRefine = true;
    }
  }

  // Roll the camera about its view axis. Called every frame AFTER
  // controls.update() sets the camera position. Only active when rolled (home
  // framing); we re-establish a clean +Z-up orientation then add the roll, so
  // it's idempotent per frame (no accumulation) and leaves OrbitControls' state
  // untouched. roll 0 (interactive pages) => OrbitControls owns the orientation.
  _applyRoll() {
    if (!this._roll || !this.controls) return;
    this.camera.up.set(0, 0, 1);
    this.camera.lookAt(this.controls.target);
    this.camera.rotateZ(this._roll);
  }

  init() {
    const host = document.createElement("div");
    host.id = "viz-stage";
    document.body.appendChild(host);
    this.host = host;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x000000, 0); // transparent: page bg shows through
    this.renderer.sortObjects = true;
    this.renderer.domElement.style.display = "block";
    host.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.005, 100000);
    this.camera.up.set(0, 0, 1); // Z-up; must precede OrbitControls
    this.camera.position.set(1.4, 0.9, 1.4);

    // Controls are (re)attached to the React `.viz-hit` overlay per area so drag
    // events reach them across stacking contexts (see _attachControls). Zoom &
    // pan stay off: the scroll wheel must keep scrolling the page.
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.enableZoom = false;
    this.controls.enablePan = false;
    this.controls.enabled = false;
    // drags (and damping settling out) must redraw — coarse, since they're continuous
    this.controls.addEventListener("change", () => this.invalidate(true));
    this._controlsEl = this.renderer.domElement;

    this.scene.add(new THREE.AmbientLight(0xffffff, 0.9));
    const d1 = new THREE.DirectionalLight(0xffffff, 0.7); d1.position.set(1, 1, 1); this.scene.add(d1);
    const d2 = new THREE.DirectionalLight(0x88aaff, 0.4); d2.position.set(-1, -0.5, -1); this.scene.add(d2);

    this.layers.volume = new VolumeLayer(this.scene);
    this.layers.iso = new IsoLayer(this.scene);
    this.layers.iso.onPreload = (l, t) => this.emit("preload", l, t);

    this._loop();
    if (this._pending) { const p = this._pending; this._pending = null; this.show(p.id, p.cfg); }
  }

  _layerFor(cfg) { return cfg && cfg.layer === "iso" ? this.layers.iso : this.layers.volume; }

  // Opening zoom for an area, with a phone override. The camera's FOV is
  // vertical, so a narrow portrait viewport crops the sides off a wide framing
  // — an area that fills the desktop stage can lose its outskirts entirely.
  // Areas that need it declare `zoomMobile` alongside `zoom` in data.js; the
  // breakpoint matches the one the mobile CSS uses.
  _zoomFor(cfg) {
    const narrow = !!(window.matchMedia && window.matchMedia("(max-width: 720px)").matches);
    if (narrow && cfg.zoomMobile !== undefined) return cfg.zoomMobile;
    return cfg.zoom || 1;
  }

  // Point OrbitControls at the given DOM element (the current React `.viz-hit`
  // overlay). The canvas itself lives in its own stacking context behind the
  // page content, so it can't reliably receive drags — but a hit overlay that
  // is a child of the hero can. r160 OrbitControls can't be re-pointed, so we
  // dispose and recreate, preserving the camera target. Starts disabled; the
  // transition's _applyInteract turns interaction/auto-rotate on at the end.
  _attachControls(el) {
    el = el || this.renderer.domElement;
    if (el === this._controlsEl && this.controls) { this.controls.enabled = false; this.controls.autoRotate = false; return; }
    const target = this.controls ? this.controls.target.clone() : new THREE.Vector3();
    if (this.controls) this.controls.dispose();
    const c = new OrbitControls(this.camera, el);
    c.enableDamping = true;
    c.dampingFactor = 0.08;
    c.enableZoom = false;
    c.enablePan = false;
    c.enabled = false;
    c.autoRotate = false;
    // Touch devices: OrbitControls' constructor sets touch-action:none on the
    // hit overlay, which traps one-finger page scroll over the hero. Instead let
    // one finger scroll the page (touch-action:pan-y) and require TWO fingers to
    // rotate/zoom the model — full interaction is preserved (two-finger drag
    // rotates both axes; pinch dollies where zoom is enabled), scroll is freed.
    if (this._isCoarsePointer) {
      el.style.touchAction = "pan-y";
      c.touches.ONE = null;                       // one finger → page scroll
      c.touches.TWO = THREE.TOUCH.DOLLY_ROTATE;   // two fingers → rotate + pinch
    }
    c.target.copy(target);
    c.update();
    this.controls = c;
    this._controlsEl = el;
  }

  async show(areaId, cfg) {
    cfg = cfg || {};
    const layer = this._layerFor(cfg);
    this._currentCfg = cfg;
    this._currentId = areaId;   // label for the perf HUD

    // First show after init: snap the camera straight to this area's framing,
    // synchronously, before the (slow) layer load. Without this, navigating
    // away while the load is still pending supersedes this show() before any
    // fly runs, and the next transition — and the home movie fade-out that
    // should reveal the model in a match cut — starts from the meaningless
    // init camera pose instead of this area's framing.
    if (!this._everShown) {
      this._everShown = true;
      const cam0 = cfg.camera || {};
      const p = new THREE.Vector3(...(cam0.pos || [1.4, 0.9, 1.4]));
      const t = new THREE.Vector3(...(cam0.target || [0, 0, 0]));
      const z = this._zoomFor(cfg);
      if (z !== 1) p.sub(t).multiplyScalar(1 / z).add(t);
      this.camera.position.copy(p);
      this.controls.target.copy(t);
      this._roll = cfg.roll || 0;
      this.controls.update();
    }

    // Tell the volume whether this area wipes BEFORE loading it: only compare
    // areas need the second (Default-run) cube, and skipping it halves what
    // home — the first page anyone lands on — has to fetch.
    if (layer === this.layers.volume) layer.setCompare(!!cfg.compare);

    if (!layer.loaded) {
      this.emit("loading", areaId, true);
      try { await layer.load(); } catch (e) { console.error("layer load failed", e); }
      layer.applyFraming();
      this.emit("loading", areaId, false);
      if (layer === this.layers.volume) this.emit("volume-ready");
      if (layer === this.layers.iso) this.emit("iso-ready", layer.timeline);
      if (this._currentCfg !== cfg) return; // superseded while loading
    } else if (layer.pending && layer.pending()) {
      // loaded already, but this area needs a cube the last one didn't (home ->
      // CGM). Wait under the same indicator rather than revealing a wipe whose
      // two halves are still the same volume.
      this.emit("loading", areaId, true);
      try { await layer.pending(); } catch (e) { console.error("layer load failed", e); }
      this.emit("loading", areaId, false);
      if (this._currentCfg !== cfg) return; // superseded while loading
    }

    // apply per-area volume settings (mode / preset) before reveal
    if (layer === this.layers.volume) {
      if (cfg.mode !== undefined) layer.setMode(cfg.mode === "integral" ? 0 : 1);
      if (cfg.preset) layer.setPreset(cfg.preset);
      const fld = cfg.field || "total_gas";
      // reset ion selection per area; async (may lazy-load the pair + LUT), so
      // redraw when it lands in case the fly has already finished by then
      // authoritatively apply the default field's color scale here (React's
      // callViz can be a no-op if it runs before SLViz exists on a direct load).
      const fdef = (cfg.fields || []).find((f) => f.key === fld) || {};
      const cb = { lo: fdef.cbLo !== undefined ? fdef.cbLo : 0,
                   hi: fdef.cbHi !== undefined ? fdef.cbHi : 1 };
      // hand the window to setField so a lazy field swap re-windows with the
      // swap; if the field is already current setField no-ops, so apply it here
      layer.setField(fld, cb).then(() => this.invalidate());
      if (layer.field === fld) layer.setColorbar(cb.lo, cb.hi);
      layer.setExposure(cfg.exposure !== undefined ? cfg.exposure : 1);
      // comparison wipe only on areas that ask for it; otherwise show all primary
      layer.setSplit(cfg.compare ? 0.5 : 0);
    }

    const cam = cfg.camera || {};
    const toPos = new THREE.Vector3(...(cam.pos || [1.4, 0.9, 1.4]));
    const toTarget = new THREE.Vector3(...(cam.target || [0, 0, 0]));

    // this area's configured position defines the 1x zoom distance; the area may
    // request a default zoom, and the fly targets that (already-zoomed) distance
    // so there's no pop when the transition completes.
    this._baseDist = toPos.distanceTo(toTarget) || this._baseDist;
    this._zoom = this._zoomFor(cfg);
    if (this._zoom !== 1) toPos.sub(toTarget).multiplyScalar(1 / this._zoom).add(toTarget);

    const fromLayer = this.activeLayer;
    const sameLayer = fromLayer === layer;

    // A second navigation can land while a transition is still in flight. The
    // interrupted transition never reaches its completion block, so finalize
    // its cleanup here: hide the layer that was fading out (unless this new
    // transition uses it — it stayed visible mid-crossfade otherwise) and drop
    // any volume-hold transform, which would otherwise stick to the volume
    // group and skew every subsequent framing (and the new hold would capture
    // the held scale as its native s0).
    const old = this.transition;
    if (old) {
      if (old.volHold) {
        const vg = this.layers.volume.group;
        vg.quaternion.identity();
        vg.scale.setScalar(old.volHold.s0);
        vg.position.set(0, 0, 0);
      }
      if (old.fromLayer && old.fromLayer !== layer && old.fromLayer !== fromLayer) {
        old.fromLayer.setActive(false);
        old.fromLayer.setMaster(1);
      }
    }

    layer.setActive(true);
    if (!sameLayer) layer.setMaster(0);

    // attach OrbitControls to this area's hit overlay (frozen during the fly)
    this._attachControls(document.querySelector(".viz-hit"));

    // interaction state takes effect after the transition completes
    this._pendingInteract = {
      enabled: !!cfg.interactive,
      autoRotate: !!cfg.autoOrbit,
    };
    this.controls.enabled = false; // frozen during the fly
    this.controls.autoRotate = false;

    this.transition = {
      t: 0, dur: sameLayer ? 0.9 : 0.95, sameLayer, areaId,
      // startAt = when the fly itself begins. cfg.flyDelay (seconds) holds at the
      // from-framing first — it lets the model be revealed at the previous area's
      // orientation for a beat (e.g. the home movie→model match cut) before it
      // flies to this framing.
      startAt: performance.now() + (cfg.flyDelay || 0) * 1000,
      fromLayer, toLayer: layer,
      fromPos: this.camera.position.clone(),
      fromTarget: this.controls.target.clone(),
      toPos, toTarget,
      fromRoll: this._roll, toRoll: cfg.roll || 0,
    };
    // Volume↔iso crossfades: decouple the fading/appearing volume model from
    // the camera fly (see _applyVolumeHold). Its apparent orientation slerps
    // between two endpoints with the canonical edge-on view as the shared hub:
    //   fading out:  "as the user left it"  ->  edge-on
    //   fading in:   edge-on  ->  the destination framing (exact at the end)
    // so leaving Magellanic rotates edge-on -> ISM's face-on just like arriving
    // rotates to edge-on. (For CGM the destination IS edge-on, so its fade-in
    // is a constant hold, as before.) The model also recedes toward / emerges
    // from the MW's (off-center) position in the iso scene. Skipped on first
    // load (no fromLayer).
    if (!sameLayer && fromLayer && (fromLayer === this.layers.volume || layer === this.layers.volume)) {
      const tr = this.transition;
      const out = fromLayer === this.layers.volume;
      const qView = (pos, target, roll) => {
        const q = new THREE.Quaternion().setFromRotationMatrix(
          new THREE.Matrix4().lookAt(pos, target, new THREE.Vector3(0, 0, 1)));
        if (roll) q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), roll));
        return q;
      };
      // where the MW sits in the iso scene (stage coords) — the volume slides
      // there as it fades out so it overlaps the MW model it becomes
      const mwPos = new THREE.Vector3();
      if (this.layers.iso.orbits && this.layers.iso.orbits.mw) {
        this.layers.iso.orbits.mw.marker.getWorldPosition(mwPos);
      }
      const qEdgeInv = qView(VOL_EDGE_POS, new THREE.Vector3(0, 0, 0), 0).invert();
      const qRefInv = out ? qView(tr.fromPos, tr.fromTarget, tr.fromRoll).invert()
                          : qView(toPos, toTarget, tr.toRoll).invert();
      tr.volHold = {
        // apparent-orientation slerp endpoints (see _applyVolumeHold):
        // group rot each frame = q_cam · slerp(qAInv, qBInv, e)
        qAInv: out ? qRefInv : qEdgeInv,
        qBInv: out ? qEdgeInv : qRefInv,
        dRef: (out ? tr.fromPos : toPos).distanceTo(out ? tr.fromTarget : toTarget),
        s0: this.layers.volume.group.scale.x,   // native framing scale, restored at the end
        out, mwPos,
      };
    }
    this.activeLayer = layer;
    this.invalidate();
    this.emit("shown", areaId);
  }

  // Dolly the camera along its current view direction to `z`× the area's base
  // distance (z>1 = closer). Ignored mid-fly since the transition drives the
  // camera; the slider is only usable once the view has settled.
  setZoom(z) {
    this._zoom = Math.min(3, Math.max(0.4, z || 1));
    if (this.transition) return;
    const dir = this.camera.position.clone().sub(this.controls.target);
    const len = dir.length() || 1;
    dir.multiplyScalar((this._baseDist / this._zoom) / len);
    this.camera.position.copy(this.controls.target).add(dir);
    this.controls.update();
  }

  // While a volume↔iso crossfade flies the camera between two very different
  // framings, the fading volume model would visibly spin. Counter-rotate the
  // volume group by the camera's rotation away from the hold reference so the
  // model appears locked at its own page's default orientation. Its apparent
  // size is decoupled from the fly too: the linear position lerp cuts the chord
  // between the two framings, so the camera→model distance dips below its final
  // value near the end (which read as a bounce on arrival at the CGM page) — a
  // compensating group scale cancels that and replaces it with a monotonic
  // VOL_HOLD_ZOOM ramp (recede when fading out, approach when fading in).
  // The iso layer is left alone. Runs after controls.update() + _applyRoll()
  // so q_cam is final for the frame.
  _applyVolumeHold() {
    const tr = this.transition;
    if (!tr || !tr.volHold) return;
    const h = tr.volHold;
    const vol = this.layers.volume;
    const e = easeInOut(tr.t);   // same easing as the fly
    // apparent orientation: slerp between the hold's endpoints — out: "as
    // left" -> edge-on; in: edge-on -> destination framing (identity at e=1)
    const qApp = h.qAInv.clone().slerp(h.qBInv, e);
    vol.group.quaternion.copy(this.camera.quaternion).multiply(qApp);
    const zoom = h.out ? 1 + (VOL_HOLD_ZOOM - 1) * e
                       : VOL_HOLD_ZOOM + (1 - VOL_HOLD_ZOOM) * e;
    const d = this.camera.position.distanceTo(this.controls.target);
    // apparent size ∝ scale/distance: track d so the on-screen size follows
    // the zoom ramp exactly. Ends at s0 when fading in (d→dRef, zoom→1).
    vol.group.scale.setScalar(h.s0 * (d / h.dRef) * zoom);
    // slide toward (out) / emerge from (in) the MW's spot in the iso scene
    vol.group.position.copy(h.mwPos).multiplyScalar(h.out ? e : 1 - e);
  }

  _applyInteract() {
    if (!this._pendingInteract) return;
    this.controls.enabled = this._pendingInteract.enabled;
    this.controls.autoRotate = this._pendingInteract.autoRotate;
    this.controls.autoRotateSpeed = 0.6;
    // Touch: enable two-finger pinch zoom only on areas that expose a zoom
    // control (CGM). Bounds mirror the removed desktop slider's factor range
    // (0.6–2.5) mapped to camera distance (baseDist / zoom). Desktop keeps
    // enableZoom = false and uses the slider instead.
    if (this._isCoarsePointer) {
      const ui = (this._currentCfg && this._currentCfg.controlsUI) || [];
      if (ui.includes("zoom")) {
        this.controls.enableZoom = true;
        this.controls.minDistance = this._baseDist / 2.5;
        this.controls.maxDistance = this._baseDist / 0.6;
      } else {
        this.controls.enableZoom = false;
      }
    }
    this._pendingInteract = null;
  }

  _stepTransition() {
    const tr = this.transition;
    if (!tr) return;
    // Wall-clock, NOT accumulated per-frame dt: dt used to be capped at 50ms, so
    // a 0.9s fly needed >=18 frames and any frame slower than that stretched the
    // fly in real time (a slow GPU turned it into a multi-second crawl). Sitting
    // before startAt is the flyDelay hold at the from-framing.
    const now = performance.now();
    if (now < tr.startAt) return;
    tr.t = Math.min(1, (now - tr.startAt) / (tr.dur * 1000));
    const e = easeInOut(tr.t);
    this.camera.position.lerpVectors(tr.fromPos, tr.toPos, e);
    this.controls.target.lerpVectors(tr.fromTarget, tr.toTarget, e);
    this._roll = tr.fromRoll + (tr.toRoll - tr.fromRoll) * e;
    if (!tr.sameLayer) {
      tr.toLayer.setMaster(e);
      if (tr.fromLayer && tr.fromLayer !== tr.toLayer) tr.fromLayer.setMaster(1 - e);
    } else {
      tr.toLayer.setMaster(1);
    }
    if (tr.t >= 1) {
      if (tr.fromLayer && tr.fromLayer !== tr.toLayer) { tr.fromLayer.setActive(false); tr.fromLayer.setMaster(1); }
      tr.toLayer.setMaster(1);
      // drop the hold rotation + scale: for a fade-in the camera has reached
      // the hold's reference framing so this is exact (no pop); for a fade-out
      // the volume is hidden now and must be clean for its next appearance
      if (tr.volHold) {
        this.layers.volume.group.quaternion.identity();
        this.layers.volume.group.scale.setScalar(tr.volHold.s0);
        this.layers.volume.group.position.set(0, 0, 0);
      }
      this.transition = null;
      this._applyInteract();
      if (this._zoom !== 1) this.setZoom(this._zoom); // apply zoom set mid-fly
      this.emit("settled", tr.areaId); // camera fly (reorientation) finished
    }
  }

  // Position the fixed canvas over the current `.viz-anchor`; pause when absent.
  _syncToAnchor() {
    const anchor = document.querySelector(".viz-anchor");
    if (!anchor) { this.host.style.display = "none"; return false; }
    const r = anchor.getBoundingClientRect();
    const vh = window.innerHeight, vw = window.innerWidth;
    if (r.bottom <= 0 || r.top >= vh || r.right <= 0 || r.left >= vw || r.width < 2 || r.height < 2) {
      this.host.style.display = "none";
      return false;
    }
    this.host.style.display = "block";
    this.host.style.left = r.left + "px";
    this.host.style.top = r.top + "px";
    this.host.style.width = r.width + "px";
    this.host.style.height = r.height + "px";
    const w = Math.round(r.width), h = Math.round(r.height);
    if (w !== this._lastW || h !== this._lastH) {
      this.renderer.setSize(w, h);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      this._lastW = w; this._lastH = h;
      this.invalidate(true);   // resizing clears the buffer — redraw (coarse; it may be a drag)
    }
    // Feed the drawing-buffer size to the volume shader every frame so its
    // screen-x wipe (gl_FragCoord.x / u_res.x) matches the DOM divider fraction.
    // Done outside the resize guard because the volume material is created
    // asynchronously — after the last resize — so a size-change hook would miss it.
    const buf = this.renderer.getDrawingBufferSize(this._sizeV);
    if (this.layers.volume) this.layers.volume.setRes(buf.x, buf.y);
    // the iso layer's orbit tracks (Line2) also need the buffer size for their
    // screen-space line widths
    if (this.layers.iso) this.layers.iso.setRes(buf.x, buf.y);
    // the canvas never needs pointer events — interaction goes through the
    // React `.viz-hit` overlay, which OrbitControls is attached to.
    return true;
  }

  // ── perf HUD (dev) ────────────────────────────────────────────────────
  // Enabled with SLViz.perf(true) or ?perf=1. It exists to answer one
  // question: what does a single drag frame actually cost at a given step
  // count? renderer.render() only *submits* work, so wall-clock around it
  // measures almost nothing — the real number comes from the GPU's own timer
  // (EXT_disjoint_timer_query_webgl2) where the browser exposes it.
  //
  // Read it as: gpu ms while moving -> the drag frame budget. Under ~16 ms is
  // a solid 60fps drag, so if 400 steps lands there, stepsMoving is redundant.
  setPerf(on) {
    if (!on) {
      if (this._perf && this._perf.el) this._perf.el.remove();
      this._perf = null;
      return;
    }
    if (this._perf) return;
    const el = document.createElement("div");
    el.id = "viz-perf";
    el.style.cssText =
      "position:fixed;left:10px;top:10px;z-index:99999;pointer-events:none;" +
      "font:11px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre;" +
      "background:rgba(0,0,0,.78);color:#8f8;padding:8px 10px;border-radius:6px;";
    document.body.appendChild(el);
    const gl = this.renderer.getContext();
    this._perf = {
      el, gl,
      // null if the browser won't hand out GPU timings (Safari, some drivers)
      ext: gl.getExtension("EXT_disjoint_timer_query_webgl2") || null,
      inFlight: [],       // timer queries submitted, result not yet available
      active: null,       // query currently open between beginQuery/endQuery
      move: [],           // GPU ms samples for frames drawn while moving
      lastIdle: null,     // GPU ms of the most recent refined (stepsIdle) frame
      cpu: [],            // wall-clock ms around render() — submit cost only
      drawn: 0, ticks: 0, // frames actually rendered vs rAF ticks (idle skipping)
      lastPaint: performance.now(),
    };
  }

  _perfBegin() {
    const p = this._perf;
    if (!p || !p.ext || p.active) return;
    const q = p.gl.createQuery();
    p.gl.beginQuery(p.ext.TIME_ELAPSED_EXT, q);
    p.active = q;
  }

  // Close the open query and drain any finished ones. GPU results land a few
  // frames late, so `moving` is captured per-query rather than read at drain.
  _perfEnd(moving) {
    const p = this._perf;
    if (!p || !p.ext) return;
    if (p.active) {
      p.gl.endQuery(p.ext.TIME_ELAPSED_EXT);
      p.inFlight.push({ q: p.active, moving });
      p.active = null;
    }
    // a disjoint (GPU context switch / power state change) invalidates every
    // outstanding timing — throw them away rather than report garbage
    const disjoint = p.gl.getParameter(p.ext.GPU_DISJOINT_EXT);
    while (p.inFlight.length) {
      const { q, moving: mv } = p.inFlight[0];
      if (!disjoint && !p.gl.getQueryParameter(q, p.gl.QUERY_RESULT_AVAILABLE)) break;
      p.inFlight.shift();
      if (!disjoint) {
        const ms = p.gl.getQueryParameter(q, p.gl.QUERY_RESULT) / 1e6;
        if (mv) { p.move.push(ms); if (p.move.length > 120) p.move.shift(); }
        else p.lastIdle = ms;
      }
      p.gl.deleteQuery(q);
    }
  }

  _perfPaint(now) {
    const p = this._perf;
    if (!p || now - p.lastPaint < 250) return;
    const dt = (now - p.lastPaint) / 1000;
    p.lastPaint = now;
    const fmt = (v, d = 1) => (v === null || v === undefined ? "  —  " : v.toFixed(d));
    const avg = a => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null);
    const p95 = a => (a.length ? [...a].sort((x, y) => x - y)[Math.floor(a.length * 0.95)] : null);
    const vol = this.layers.volume;
    const steps = vol && vol.material ? vol.material.uniforms.u_steps.value : 0;
    const budget = avg(p.move);
    p.el.textContent = [
      `area   ${this._currentId || "—"}   steps ${steps}`,
      `drawn  ${p.drawn} of ${p.ticks} ticks  (${(p.drawn / dt).toFixed(0)}/s drawn)`,
      p.ext
        ? `gpu    ${fmt(budget)} ms avg · ${fmt(p95(p.move))} p95   [moving]`
        : `gpu    unavailable (no timer ext)`,
      p.ext
        ? `       ${fmt(p.lastIdle)} ms  [last refine @ ${vol ? vol.stepsIdle : "?"}]`
        : "",
      `cpu    ${fmt(avg(p.cpu), 2)} ms submit`,
      budget ? `→ ${(1000 / budget).toFixed(0)} fps ceiling while dragging` : "",
    ].filter(Boolean).join("\n");
    p.drawn = 0; p.ticks = 0; p.cpu.length = 0;
  }

  _loop() {
    const tick = () => {
      this._raf = requestAnimationFrame(tick);

      // Keep the canvas glued to the anchor every frame (cheap DOM work) — this
      // is what tracks scrolling, and it must not depend on us drawing anything.
      const visible = this._syncToAnchor();

      // Step the fly on the wall clock, visible or not: it's pure camera math,
      // and gating it on visibility used to strand a transition at t=0 (frozen
      // mid-morph) whenever you navigated while scrolled past the hero.
      if (this.transition) this._stepTransition();
      if (!visible) return;   // offscreen: never touch the GPU

      this.controls.update();
      this._applyRoll();   // add camera roll on top of OrbitControls' orientation
      this._applyVolumeHold();   // volume↔iso fades: keep the volume un-spun

      const camMoved = this.camera.position.distanceToSquared(
        this._prevCamPos || this.camera.position) > 1e-7;
      this._prevCamPos = (this._prevCamPos || new THREE.Vector3()).copy(this.camera.position);
      const moving = !!this.transition || this.controls.autoRotate || camMoved;

      // Adaptive raymarch steps: coarse while moving / interacting, and exactly
      // ONE fine frame once things go quiet. Rendering stepsIdle continuously is
      // what locked up the browser.
      if (moving || performance.now() < this._coarseUntil) {
        this._setSteps(true);
        this._dirty = true;
        this._owedRefine = true;   // owe a refined frame once motion stops
      } else if (this._owedRefine) {
        this._owedRefine = false;
        // Areas whose volume is never seen at rest opt out via `refine: false`
        // (home: an opaque hero movie covers it, and it's only ever glimpsed in
        // motion during the morph). The last coarse frame is already on screen
        // and correct, so the refined one is pure cost for nothing.
        if (!this._currentCfg || this._currentCfg.refine !== false) {
          this._setSteps(false);
          this._dirty = true;
        }
      }

      // drain finished timer queries every tick, not just on drawn frames —
      // the last frame of a drag resolves after the loop has already gone quiet
      if (this._perf) { this._perf.ticks++; this._perfEnd(false); this._perfPaint(performance.now()); }
      if (!this._dirty) return;    // nothing changed — leave the GPU alone
      this._dirty = false;

      if (!this._perf) {
        this.renderer.render(this.scene, this.camera);
        return;
      }
      const t0 = performance.now();
      this._perfBegin();
      this.renderer.render(this.scene, this.camera);
      this._perf.cpu.push(performance.now() - t0);
      this._perf.drawn++;
      this._perfEnd(moving || performance.now() < this._coarseUntil);
    };
    tick();
  }

  _setSteps(coarse) {
    const vol = this.layers.volume;
    if (vol && vol.loaded && this.activeLayer === vol) {
      vol.setSteps(coarse ? vol.stepsMoving : vol.stepsIdle);
    }
  }
}

// ─────────────────────────────────────────── public API (window.SLViz)
const stage = new Stage();
const api = {
  _stage: stage,
  show(areaId, cfg) { if (stage.host) stage.show(areaId, cfg); else stage._pending = { id: areaId, cfg }; },
  on: (e, cb) => stage.on(e, cb),
  off: (e, cb) => stage.off(e, cb),
  // Volume controls. Every mutation must request a redraw — the loop is
  // render-on-demand now, so an un-invalidated change simply never appears.
  // `true` = coarse: continuous drags redraw cheaply, then refine once quiet.
  setVolumeMode: (m) => { stage.layers.volume.setMode(m === "integral" ? 0 : 1); stage.invalidate(); },
  setVolumeExposure: (g) => { stage.layers.volume.setExposure(g); stage.invalidate(true); },
  setVolumeOpacity: (o) => { stage.layers.volume.setOpacity(o); stage.invalidate(true); },
  setVolumePreset: (p) => { stage.layers.volume.setPreset(p); stage.invalidate(); },
  // async: the pair + LUT may still be loading, so redraw once it resolves
  setVolumeField: (f, cb) => stage.layers.volume.setField(f, cb).then(() => stage.invalidate()),
  setVolumeColorbar: (lo, hi) => { stage.layers.volume.setColorbar(lo, hi); stage.invalidate(true); },
  setSplit: (f) => { stage.layers.volume.setSplit(f); stage.invalidate(true); },
  setZoom: (z) => stage.setZoom(z),   // moves the camera -> controls "change" invalidates
  // Re-attach OrbitControls to the current page's .viz-hit overlay. Needed when
  // an area was pre-shown before its page mounted (leaving home: the fly starts
  // with the movie fade), so show() bound controls to an element that has since
  // unmounted. Mid-transition the interact state is applied at transition end
  // (_applyInteract); outside one, restore what the controls had.
  rebindControls: () => {
    const prev = stage.controls ? { en: stage.controls.enabled, ar: stage.controls.autoRotate } : null;
    stage._attachControls(document.querySelector(".viz-hit"));
    if (!stage.transition && prev) {
      stage.controls.enabled = prev.en;
      stage.controls.autoRotate = prev.ar;
    }
  },
  // iso controls
  setIsoVisible: (k, v) => { stage.layers.iso.setVisibleComponent(k, v); stage.invalidate(); },
  setOrbitsVisible: (v) => { stage.layers.iso.setOrbitsVisible(v); stage.invalidate(); },
  setSnapshot: (i) => Promise.resolve(stage.layers.iso.setSnapshot(i)).then(() => stage.invalidate()),
  getTimeline: () => stage.layers.iso.timeline,

  // ── dev / measurement ──
  // SLViz.perf(true) shows the frame-cost HUD; ?perf=1 turns it on at load.
  perf: (on = true) => stage.setPerf(on),
  // Live-tweak the raymarch step counts to test the moving/idle split without
  // an edit-reload cycle. SLViz.steps(400) makes drags cost the same as the
  // refined still frame — the case we're trying to prove is affordable.
  steps: (moving, idle) => {
    const vol = stage.layers.volume;
    if (moving !== undefined) vol.stepsMoving = moving;
    if (idle !== undefined) vol.stepsIdle = idle;
    stage.invalidate(true);
    return { moving: vol.stepsMoving, idle: vol.stepsIdle };
  },
};
window.SLViz = api;

// pick up an area requested before three finished loading (see app.js)
if (window.__slPendingArea) api.show(window.__slPendingArea.id, window.__slPendingArea.cfg);

stage.init();

// after init(): the HUD needs the renderer's GL context
if (/[?&]perf=1/.test(location.search)) stage.setPerf(true);
