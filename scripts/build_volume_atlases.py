#!/usr/bin/env python3
"""Re-ship the ENGAWA volume cubes as WebP slice atlases (~8x smaller on the wire).

The cubes are already the compact encoding: u8 over a log range, with 0 reserved
as an "empty" sentinel (the shader skips u <= 0.0019). What they are NOT is
compressed — 256**3 = 16.78 MB each, served raw, and the CGM page pulls a pair.
Generic compression barely helps (gzip only reaches ~10 MB) and the cubes are not
sparse in any way a block structure could exploit: even for Mg II, which is 71%
empty voxels, 88% of 8**3 bricks contain something.

What does work is a lossy image codec, because the browser has a hardware decoder
for it and because the ray-march integrates ~400 samples per pixel, so per-voxel
error averages down. Measured on total_gas at q85: mean per-voxel error is 1.8
LSB, but the reprojected column density lands within 0.03 dex (p99) of the
original — about 1% of the colorbar span, i.e. below the quantization already
baked into the u8 encoding. The --check pass below reports this per cube.

Output, alongside the existing .bin (which stays as the fallback path):

  <name>_a0.webp .. _a3.webp   z-slices tiled into 4 images of 4096x1024
                               (16 cols x 4 rows of 256px tiles, 64 slices each)
  <name>.meta.json             gains an "atlas" block; every other key untouched

Slice z is contiguous in the cube (index = x + y*nx + z*nx*ny), so a tile is a
straight strided copy of one slice — the viewer reverses it in _load3D.

Why 4 parts and not one 4096x4096 atlas: that is exactly 16,777,216 px, which is
precisely iOS Safari's canvas area limit. Four parts also decode in parallel.

Usage: python3 scripts/build_volume_atlases.py [--quality 85] [--only NAME] [-n]
"""
import argparse
import io
import json
import os

import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CUBES = os.path.join(ROOT, "assets", "viz", "engawa")

MAX_W = 4096        # atlas width cap (and iOS texture/canvas friendliness)
PARTS = 4           # split so no single image approaches the 16.7 Mpx canvas cap
QUALITY = 85        # see --check output before lowering this


def tiling(nx, nz):
    """cols per row, slices per part, for a cube with nx-wide slices."""
    cols = max(1, MAX_W // nx)
    per_part = -(-nz // PARTS)          # ceil
    rows = -(-per_part // cols)
    return cols, per_part, rows


def build_atlas(cube, part, cols, per_part, rows):
    """Tile this part's z-slices into one 2D array."""
    nz, ny, nx = cube.shape
    at = np.zeros((rows * ny, cols * nx), np.uint8)
    for s in range(per_part):
        z = part * per_part + s
        if z >= nz:
            break                        # last part may be short; pad stays 0
        r, c = divmod(s, cols)
        at[r * ny:(r + 1) * ny, c * nx:(c + 1) * nx] = cube[z]
    return at


def encode(at, quality):
    """Grayscale WebP bytes. No ICC profile — the viewer decodes with color
    management off, and a profile would make the browser regrade the data."""
    buf = io.BytesIO()
    Image.fromarray(at, "L").save(buf, "WEBP", quality=quality, method=6)
    return buf.getvalue()


def unatlas(parts, dims, cols, per_part):
    """Reverse of build_atlas — same walk the viewer's _load3D does."""
    nx, ny, nz = dims
    out = np.zeros((nz, ny, nx), np.uint8)
    for pi, data in enumerate(parts):
        at = np.asarray(Image.open(io.BytesIO(data)).convert("L"))
        for s in range(per_part):
            z = pi * per_part + s
            if z >= nz:
                break
            r, c = divmod(s, cols)
            tile = at[r * ny:(r + 1) * ny, c * nx:(c + 1) * nx]
            out[z] = np.where(tile < 2, 0, tile)   # restore the empty sentinel
    return out


# Colorbar windows the CGM area applies per field (mirrors data.js `fields`);
# diagnostic only — the render path reads them from data.js as before.
COLORBAR = {"total_gas": (0.02, 0.76), "hi": (-0.12, 0.92),
            "mgii": (0.08, 0.98), "ovi": (-0.22, 0.82)}


def displayed(cube, meta):
    """Where each pixel lands on the colorbar, 0..1 — what the viewer actually
    sees, so error measured here is error you could notice.

    Mirrors integral mode: accumulate density along the projection axis, then
    window it. The shader integrates over the unit box (dt = 1/steps) while the
    cube's proj_vmin/vmax were measured as a sum over N voxels, hence the
    log10(N) offset — the same one _applySet applies.
    """
    vmin, vmax = meta["vmin"], meta["vmax"]
    n = (cube.astype(np.float32) - 1.0) / 254.0
    dens = np.where(cube > 0, 10.0 ** (vmin + n * (vmax - vmin)), 0.0)
    lc = np.log10(dens.mean(axis=2) + 1e-30)

    off = np.log10(meta["dims"][0])
    pv0, pv1 = meta["proj_vmin"] - off, meta["proj_vmax"] - off
    cb_lo, cb_hi = COLORBAR.get(meta.get("field"), (0.0, 1.0))
    span = pv1 - pv0
    lo, hi = pv0 + cb_lo * span, pv0 + cb_hi * span
    return np.clip((lc - lo) / (hi - lo), 0.0, 1.0)


def check(orig, dec, meta):
    err = np.abs(dec.astype(np.int16) - orig.astype(np.int16))
    v0, v1 = displayed(orig, meta), displayed(dec, meta)
    # clipped pixels (pure black / pure top of the ramp) can't shift, so scoring
    # them would just dilute the number with zeros
    live = (v0 > 0.01) & (v0 < 0.99)
    dv = np.abs(v1 - v0)[live] * 100.0
    print(f"    voxel |err| mean {err.mean():4.2f} LSB, max {err.max():3d}  |  "
          f"colorbar shift over {live.mean():.0%} unclipped px: "
          f"mean {dv.mean():.2f}%, p99 {np.percentile(dv, 99):.2f}%")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", default=CUBES)
    ap.add_argument("--quality", type=int, default=QUALITY)
    ap.add_argument("--only", help="cube basename substring filter")
    ap.add_argument("--no-check", action="store_true", help="skip the decode/compare pass")
    ap.add_argument("-n", "--dry-run", action="store_true")
    args = ap.parse_args()

    names = sorted(f[:-4] for f in os.listdir(args.dir) if f.endswith(".bin"))
    if args.only:
        names = [n for n in names if args.only in n]
    if not names:
        raise SystemExit("no cubes found")

    total_in = total_out = 0
    for name in names:
        base = os.path.join(args.dir, name)
        meta = json.load(open(base + ".meta.json"))
        nx, ny, nz = meta["dims"]
        cube = np.fromfile(base + ".bin", np.uint8).reshape(nz, ny, nx)
        cols, per_part, rows = tiling(nx, nz)

        blobs = [encode(build_atlas(cube, p, cols, per_part, rows), args.quality)
                 for p in range(PARTS)]
        files = [f"{name}_a{p}.webp" for p in range(PARTS)]
        size = sum(len(b) for b in blobs)
        total_in += cube.nbytes
        total_out += size
        print(f"  {name:26s} {cube.nbytes / 1e6:6.2f} MB -> {size / 1e6:5.2f} MB "
              f"({cube.nbytes / size:4.1f}x)  {cols * nx}x{rows * ny} x{PARTS}")

        if not args.no_check:
            check(cube, unatlas(blobs, (nx, ny, nz), cols, per_part), meta)

        if args.dry_run:
            continue
        for fn, blob in zip(files, blobs):
            with open(os.path.join(args.dir, fn), "wb") as fh:
                fh.write(blob)
        meta["atlas"] = {
            "tile": [nx, ny],
            "cols": cols,
            "slices_per_part": per_part,
            "parts": files,
            "quality": args.quality,
            "note": "grayscale WebP z-slice atlas; R channel = the u8 cube value, "
                    "values < 2 clamp to 0 (the empty sentinel). Decode with color "
                    "management disabled.",
        }
        with open(base + ".meta.json", "w") as fh:
            json.dump(meta, fh, indent=2)
            fh.write("\n")

    print(f"\n  total {total_in / 1e6:.1f} MB -> {total_out / 1e6:.1f} MB "
          f"({total_in / total_out:.1f}x)" + ("   [dry run]" if args.dry_run else ""))


if __name__ == "__main__":
    main()
