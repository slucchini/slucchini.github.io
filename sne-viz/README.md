# I11 SNe + gas density static viewer

Open `index.html` directly in a browser, or serve with `python -m http.server` from this directory and visit http://localhost:8000.

To deploy: copy this folder to any static host (GitHub Pages, S3, plain Apache/nginx). All assets are relative.

Contents:
- `index.html` — the viewer (vanilla JS + canvas).
- `frames/frame_NNN.png` — 500 colormapped gas density frames.
- `sne_positions.json` — supernova positions (kpc) and the frame each fired at.
