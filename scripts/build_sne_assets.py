#!/usr/bin/env python3
"""Build the compact ISM supernova-lens assets from the sne-viz export.

Source: the static sne-viz site built on the cluster by
interactive_sne_movie/export_static_assets.py (stride-2 snapshot slots with
per-slot ACTIVE SNe lists: x/y f32 tracked positions + age u8 in snapshots).
A local copy lives at SRC below — no cluster access needed to rebuild.

Output (assets/viz/ism/): a per-EVENT list instead of per-frame tracked
entries, cutting ~45 MB (or 1.1 GB with PNG frames) to ~5 MB:

  sne_xy.bin      u16 x, u16 y per event (interleaved), quantized over the
                  30 kpc extent, sorted by fire movie-frame
  sne_offsets.bin u32 * (movie_frames + 1); events firing at movie frame f are
                  rows [offsets[f], offsets[f+1])
  sne_meta.json   extent / fps / counts / file names
  rotation.json   copied from the export: dphi per STRIDE(=2) movie frames vs
                  radius — the viewer rotates each dot by dphi(R) * age/2 to
                  approximate the parent particle's drift

Movie-frame mapping (verified against gas_movie.py): the website's ISM movie
I11_highcadence_gas_movie.mp4 is snapshots 21..2500 at stride 1, 30 fps, same
projection/orientation/extent as the sne-viz frames, so movie frame f ==
snapshot 21 + f.

Events are the FIRST-SEEN entries (age 0 or 1): with the stride-2 export a SN
firing between kept slots first appears with age 1. fire_snap = slot_snap - age.
The per-frame tracked positions are then approximated at render time by
rotating the birth position with the rotation curve; the residual vs the true
tracked positions is measured below (report printed at the end).

Usage: python3 scripts/build_sne_assets.py
"""
import json
import os
import shutil

import numpy as np

SRC = "/Library/WebServer/Documents/personal-new/sne-viz"
OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                   "assets", "viz", "ism")

SNAP0 = 21          # movie frame 0 == snapshot 21 (gas_movie.py, stride 1)
MOVIE_FRAMES = 2480
HALF = 15.0         # extent [-15, 15] kpc
QMAX = 65535


def load_src():
    meta = json.load(open(os.path.join(SRC, "meta.json")))
    xs = np.fromfile(os.path.join(SRC, meta["files"]["x"]), dtype=np.float32)
    ys = np.fromfile(os.path.join(SRC, meta["files"]["y"]), dtype=np.float32)
    ages = np.fromfile(os.path.join(SRC, meta["files"]["age"]), dtype=np.uint8)
    offs = np.fromfile(os.path.join(SRC, meta["files"]["offsets"]), dtype=np.int32)
    snaps = np.asarray(meta["frame_numbers"], dtype=np.int64)  # slot -> snapshot
    assert len(offs) == len(snaps) + 1
    return meta, xs, ys, ages, offs, snaps


def extract_events(xs, ys, ages, offs, snaps):
    """First-seen entries -> (x, y, fire_movie_frame), FOV-clipped."""
    ex, ey, ef = [], [], []
    for k in range(len(snaps)):
        a0, a1 = offs[k], offs[k + 1]
        age = ages[a0:a1]
        first = age <= 1
        x = xs[a0:a1][first]
        y = ys[a0:a1][first]
        fire = (snaps[k] - age[first].astype(np.int64)) - SNAP0
        keep = (np.abs(x) <= HALF) & (np.abs(y) <= HALF) & (fire >= 0)
        ex.append(x[keep]); ey.append(y[keep]); ef.append(fire[keep])
    return np.concatenate(ex), np.concatenate(ey), np.concatenate(ef)


def rotation_fn():
    rot = json.load(open(os.path.join(SRC, "rotation.json")))
    rc = np.asarray(rot["r_centers_kpc"])
    dphi = np.asarray(rot["dphi_per_frame"])  # rad per STRIDE(=2) snapshots

    def advance(x, y, n_slots):
        """Rotate positions forward in time by n_slots stride-2 steps."""
        r = np.hypot(x, y)
        a = np.interp(r, rc, dphi) * n_slots
        c, s = np.cos(a), np.sin(a)
        return c * x - s * y, s * x + c * y
    return advance


def validate_drift(xs, ys, ages, offs, advance):
    """How well does birth-position + rotation-curve drift approximate the
    true tracked positions? NN-match cohorts (slot k, age a) -> (k+1, a+2);
    cohorts shed ~9%/slot (particles re-firing / leaving), hence NN not 1:1."""
    res_rot, res_fix = [], []
    for k in (300, 500, 700, 900):
        a0, a1 = offs[k], offs[k + 1]
        b0, b1 = offs[k + 1], offs[k + 2]
        for a in (0, 1):
            m1 = ages[a0:a1] == a
            m2 = ages[b0:b1] == a + 2
            if m1.sum() < 20 or m2.sum() < 20:
                continue
            x1, y1 = xs[a0:a1][m1], ys[a0:a1][m1]
            x2, y2 = xs[b0:b1][m2], ys[b0:b1][m2]
            for pred, acc in ((advance(x1, y1, 1), res_rot), ((x1, y1), res_fix)):
                d = np.hypot(x2[:, None] - pred[0][None, :],
                             y2[:, None] - pred[1][None, :]).min(axis=1)
                acc.append(d)
    res_rot = np.concatenate(res_rot) * 1000  # pc
    res_fix = np.concatenate(res_fix) * 1000
    print(f"drift residual per slot, WITH rotation model: "
          f"median {np.median(res_rot):.0f} pc, 95% {np.percentile(res_rot, 95):.0f} pc")
    print(f"drift residual per slot, WITHOUT (fixed dot):  "
          f"median {np.median(res_fix):.0f} pc, 95% {np.percentile(res_fix, 95):.0f} pc")


def main():
    meta, xs, ys, ages, offs, snaps = load_src()
    ex, ey, ef = extract_events(xs, ys, ages, offs, snaps)
    print(f"{len(ex):,} unique events from {len(ages):,} tracked entries")

    order = np.argsort(ef, kind="stable")
    ex, ey, ef = ex[order], ey[order], ef[order]
    qx = np.clip(np.round((ex + HALF) / (2 * HALF) * QMAX), 0, QMAX).astype(np.uint16)
    qy = np.clip(np.round((ey + HALF) / (2 * HALF) * QMAX), 0, QMAX).astype(np.uint16)
    xy = np.empty(2 * len(qx), dtype=np.uint16)
    xy[0::2] = qx; xy[1::2] = qy
    frame_offsets = np.searchsorted(ef, np.arange(MOVIE_FRAMES + 1)).astype(np.uint32)

    os.makedirs(OUT, exist_ok=True)
    xy.tofile(os.path.join(OUT, "sne_xy.bin"))
    frame_offsets.tofile(os.path.join(OUT, "sne_offsets.bin"))
    shutil.copy(os.path.join(SRC, "rotation.json"), os.path.join(OUT, "rotation.json"))
    out_meta = {
        "count": int(len(qx)),
        "extent_kpc": [-HALF, HALF, -HALF, HALF],
        "movie_frames": MOVIE_FRAMES,
        "fps": 30,
        "snap0": SNAP0,
        "fade_snapshots": int(meta.get("fade", 10)),  # physical fade in the export
        "rotation_stride": 2,   # rotation.json dphi is per this many movie frames
        "quant_max": QMAX,
        "files": {"xy": "sne_xy.bin", "offsets": "sne_offsets.bin"},
    }
    json.dump(out_meta, open(os.path.join(OUT, "sne_meta.json"), "w"), indent=1)

    total = sum(os.path.getsize(os.path.join(OUT, f))
                for f in ("sne_xy.bin", "sne_offsets.bin", "rotation.json", "sne_meta.json"))
    print(f"wrote {OUT}: {total / 1e6:.2f} MB total")

    # sanity: reconstructed active count at a slot vs the original per-slot list
    # (ours is slightly HIGHER: the export drops a dot early when its particle
    # re-fires — we keep both, which just overlaps two dots visually)
    for k in (400, 800):
        f = snaps[k] - SNAP0
        lo = np.searchsorted(ef, f - (out_meta["fade_snapshots"] - 1))
        hi = np.searchsorted(ef, f + 1)
        print(f"slot {k} (movie frame {f}): reconstructed active {hi - lo} "
              f"vs export {offs[k + 1] - offs[k]}")

    validate_drift(xs, ys, ages, offs, rotation_fn())


if __name__ == "__main__":
    main()
