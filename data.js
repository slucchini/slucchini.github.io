(function () {
// data.jsx — research areas, publications, figures, movies.
// Real citations & summaries adapted from Scott Lucchini's research site.
// Image/video files are not available, so figures use captioned placeholders.

// ⊙ is a full-size glyph sitting on the baseline, so a plain "Z⊙" reads as two
// separate characters instead of solar-normalised metallicity. Fields that are
// rendered as React children (summaries, captions) can use these to get a real
// subscript: rich("~0.1 Z", sub("⊙"), ", with …"). A fragment, not an array,
// so the static parts don't need keys.
const sub = s => React.createElement("sub", null, s);
const rich = (...parts) => React.createElement(React.Fragment, null, ...parts);

const AREAS = [
// ───────────────────────────────────────────── HOME / ABOUT
{
  id: "home",
  kind: "home",
  tab: "Home",
  title: "Scott Lucchini",
  hue: 220,
  // calm cyan
  role: "Computational astrophysicist",
  tagline: "Simulating gas dynamics and galaxy evolution.",
  heroLines: ["Simulating", "gas & galaxies"],
  heroImage: "assets/galaxy_viz.png",
  // home shows a looping hero movie; the total-gas (200pc) volume is rendered
  // BEHIND it at the movie's camera inclination (from website_movie.py: camera at
  // (0,-100,64) looking at the disk in the x-y plane). Leaving home reveals the
  // model at the same orientation and it flies into the target framing (a morph).
  heroVideo: "raw_data/Au6_500pc_interp.mp4",
  viz: {
    layer: "volume",
    autoOrbit: false,
    interactive: false,
    mode: "integral",
    field: "total_gas",
    // reuse the CGM total-gas colormap limits for the model behind the movie
    fields: [{ key: "total_gas", cbLo: 0.02, cbHi: 0.76 }],
    controlsUI: [],
    // the hero movie sits opaque on top of the volume, so it's only ever seen in
    // motion during the morph out — skip the expensive refined still frame.
    refine: false,
    // direction = normalize(0,-100,64) (movie CAM); distance ~0.45 (≈130 kpc) zooms
    // the disk up prominently. roll tilts the disk to match the movie's tilt (the
    // movie camera is rolled/sheared; ~0.4 rad reproduces the lower-left→upper-right lean).
    camera: { pos: [0, -0.38, 0.24], target: [0, 0, 0] },
    roll: 0.4
  },
  photo: "assets/me.png",
  bio: ["I'm a computational astrophysicist studying how galaxies acquire, recycle, and lose their gas. Using large N-body and hydrodynamical simulations, I model the Magellanic Clouds and the formation of the Magellanic Stream, the multiphase circumgalactic medium that surrounds galaxies like our own, and the dynamics and morphology of galactic disks.", "My 2020 Nature paper introduced the Magellanic Corona — a warm gas halo around the Clouds that resolves the long-standing puzzle of the Stream's mass. More recently I released the ENGAWA simulations, a suite of cosmological zoom-in simulations that resolves the diffuse CGM down to 200 parsecs."],
  contacts: [{
    label: "Email",
    value: "scott.lucchini@cfa.harvard.edu",
    href: "mailto:scott.lucchini@cfa.harvard.edu"
  }, {
    label: "ORCID",
    value: "0000-0001-9982-0241",
    href: "https://orcid.org/0000-0001-9982-0241"
  }, {
    label: "GitHub",
    value: "@slucchini",
    href: "https://github.com/slucchini"
  }, {
    label: "ADS Library",
    value: "Publications",
    href: "https://ui.adsabs.harvard.edu/user/libraries/VAnooruRTeOhUxd-WxsuWA"
  }],
  // quick-jump cards into the three research areas
  jump: [{
    to: "cgm",
    label: "Circumgalactic Medium",
    hue: 220,
    note: "Galactic atmospheres & high-velocity clouds"
  }, {
    to: "ism",
    label: "Interstellar Medium",
    hue: 318,
    note: "Galactic dynamics & moving groups"
  }, {
    to: "magellanic",
    label: "Magellanic Clouds",
    hue: 72,
    note: "Galactic interactions & gas dynamics"
  }]
},
// ───────────────────────────────────────────── CGM
{
  id: "cgm",
  tab: "CGM",
  title: "The Circumgalactic Medium",
  kicker: "Galactic atmospheres · high-velocity clouds",
  hue: 220,
  // cyan
  vizKind: "halo",
  vizLabel: "Circumgalactic medium — multiphase gas halo",
  // same gas volume as home, now interactive (column-density / volume modes)
  viz: {
    layer: "volume",
    autoOrbit: false,
    interactive: true,
    mode: "integral",
    field: "total_gas",
    // cbLo / cbHi = colorbar bottom / top, as fractions of each ion's auto display
    // span (0 = auto min, 1 = auto max). Tune per ion to set the color scaling.
    fields: [
      { key: "total_gas", label: "Total gas", cbLo: 0.02, cbHi: 0.76 },
      { key: "hi", label: "H I", cbLo: -0.12, cbHi: 0.92 },
      { key: "mgii", label: "Mg II", cbLo: 0.08, cbHi: 0.98 },
      { key: "ovi", label: "O VI", cbLo: -0.22, cbHi: 0.82 }
    ],
    controlsUI: ["field", "zoom"],
    compare: true,
    compareLabels: ["Default", "200 pc"],
    // edge-on from -y (same azimuth as the home view) and pulled back, so arriving
    // from home is the smallest movement: tilt down to edge-on + un-roll, no spin.
    camera: { pos: [0, -1.1, 0], target: [0, 0, 0] },
    // opening zoom (camera.pos above is the 1x base distance). Stage.show() flies
    // straight to the zoomed distance, so there's no pop on arrival.
    zoom: 1.5,
    // phones (<=720px) start pulled back: the FOV is vertical, so a portrait
    // viewport crops the halo's sides off the 1.5x framing (see _zoomFor).
    zoomMobile: 1.15,
    // hold (seconds) at the previous area's framing before the fly starts, so the
    // home movie→model match cut is seen for a beat before the model flies edge-on.
    flyDelay: 0.1
  },
  release: {
    eyebrow: "Public data release",
    text: "The ENGAWA simulations are now public. This suite of cosmological zoom-in simulations resolves the circumgalactic medium of four Milky Way-like galaxies down to 200 pc using fixed-volume mesh refinement in Arepo with the IllustrisTNG feedback model. Full snapshots, group catalogs, and additional output files are freely available via Globus.",
    linkLabel: "Explore the ENGAWA data release",
    href: "/new_website/engawa/"
  },
  stats: [{
    v: "4",
    l: "papers"
  }, {
    v: "200 pc",
    l: "CGM resolution"
  }, {
    v: "TNG50",
    l: "+ Arepo zoom-ins"
  }],
  papers: [{
    tag: "ENGAWA · arXiv",
    year: "2026",
    title: "ENhanced Galactic Atmospheres With Arepo: Resolving the CGM at 200 pc with the ENGAWA Simulations",
    summary: "Standard cosmological simulations focus computation on dense, star-forming regions, leaving the low-density CGM poorly resolved. ENGAWA fixes spatial refinement down to 200 pc throughout the CGM, combining Lagrangian mass-refinement with a minimum gas-cell volume around galaxies — only possible with Arepo's hybrid Voronoi mesh. Higher resolution drives a dramatic increase in cool-gas column densities, and added stellar radiation brings HI columns into better alignment with COS-Halos data.",
    cite: "Lucchini, S., Abramson, C., Hummels, C., Conroy, C., Hernquist, L., & Smith, A. — submitted (2026)",
    links: [{
      label: "arXiv:2603.05584",
      href: "https://arxiv.org/abs/2603.05584"
    }],
    figures: [{
      kind: "image",
      src: "assets/web/engawa.jpg",
      caption: "Mg II and O VI columns around a MW-like halo, quadrant by quadrant: default resolution vs. 1 kpc, 500 pc and 200 pc refinement."
    }]
  }, {
    tag: "ENGAWA · arXiv",
    year: "2026",
    title: "A New Model for the Milky Way Halo Dispersion Measure with the ENGAWA Simulations: Low DMs and Large Anisotropy",
    summary: "Fast radio burst dispersion measures trace the low-density universe, but the Milky Way halo's own contribution has to be subtracted first. Across the four ENGAWA galaxies the median all-sky halo DM spans 19–39 pc cm⁻³, varying even at fixed feedback strength, halo mass and CGM gas fraction. With the CGM resolved to 200 pc, halo DMs come out lower and far more anisotropic than in previous models, dropping below 10 pc cm⁻³ toward the poles. Varying the solar position within each galaxy gives an estimate of the uncertainty from our own vantage point, and the resulting sky maps ship as a Python package returning halo DM as a function of Galactic longitude and latitude.",
    cite: "Lucchini, S., Connor, L., McCarty, S., & Konietzka, R. M. — submitted (2026)",
    links: [{
      label: "arXiv:2607.20601",
      href: "https://arxiv.org/abs/2607.20601"
    }, {
      label: "l26halodm on GitHub",
      href: "https://github.com/slucchini/l26halodm"
    }],
    figures: [{
      kind: "image",
      src: "assets/web/engawa_DMs.jpg",
      caption: "All-sky halo dispersion measure in Galactic coordinates, split down the meridian: default resolution on the left, 200 pc refinement on the right. The refined half is patchier and reaches lower DM off the plane."
    }]
  }, {
    tag: "ApJ",
    year: "2024",
    title: "On the Origin of High-velocity Clouds in the Galaxy",
    summary: rich("High-velocity clouds (HVCs) — neutral hydrogen moving inconsistently with Galactic rotation — have been debated for decades. In TNG50, we find that most HVCs form through thermal instability, with smaller contributions from disk outflows and infalling satellites. Intense mixing with the CGM brings most clouds to ~0.1 Z", sub("⊙"), ", with the lowest-metallicity clouds tracing satellite origins."),
    cite: "Lucchini, S., Han, J., Hernquist, L., & Conroy, C. — ApJ, 974, 105 (2024)",
    links: [{
      label: "10.3847/1538-4357/ad6dde",
      href: "https://iopscience.iop.org/article/10.3847/1538-4357/ad6dde"
    }, {
      label: "arXiv:2406.04434",
      href: "https://arxiv.org/abs/2406.04434"
    }],
    figures: [{
      kind: "image",
      src: "assets/HVC_origins.png",
      caption: "HVCs around a TNG50 galaxy outlined by origin — thermal instability in the warm and hot CGM accounts for over 60%."
    }]
  }, {
    tag: "ApJ",
    year: "2025",
    title: "Invisible Accretion: Ionized Envelopes of TNG50 HVCs can Sustain Star Formation",
    summary: "Observationally, HVCs consist of ionized material along with the neutral hydrogen we see in emission. In TNG50, we also see ionized material in the form of envelopes surrounding the neutral clouds. These ionized envelopes contain on average 6× more mass than their neutral counterparts. Across 47 MW-like galaxies, the contribution to the accretion rate from these envelopes dominates over the neutral HVC cores. The total rates scale with star-formation rate which suggests that ionized HVC envelopes could supply the fuel for galactic star formation.",
    cite: "Lucchini, S., Han, J., Hernquist, L., Conroy, C., & Fox, A. J. — ApJ, 990, 118 (2025)",
    links: [{
      label: "10.3847/1538-4357/adf3b3",
      href: "https://iopscience.iop.org/article/10.3847/1538-4357/adf3b3"
    }, {
      label: "arXiv:2507.18687",
      href: "https://arxiv.org/abs/2507.18687"
    }],
    figures: [{
      kind: "image",
      src: "assets/web/ionized_HVCs.jpg",
      caption: "Neutral HVC cores (blue) sit inside far larger ionized envelopes (red) — on average 6× more mass than the H I we see."
    }]
  }]
},
// ───────────────────────────────────────────── ISM
{
  id: "ism",
  tab: "ISM",
  title: "The Interstellar Medium",
  kicker: "Galactic dynamics · stellar moving groups",
  hue: 318,
  // nebula violet
  vizKind: "filament",
  vizLabel: "Interstellar medium — kinematic substructure",
  // the gas volume reorients to the x–y plane (disk face-on), then crossfades to
  // a high-cadence disk simulation movie which loops (see HeroMovie in app.js).
  viz: {
    layer: "volume",
    autoOrbit: false,
    interactive: false,
    mode: "integral",
    // Deliberately CGM's total-gas limits, NOT limits tuned for this page's
    // face-on view. Stage.show() applies the destination's colorbar in one shot
    // at the START of the fly, so any value that differs from CGM's would snap
    // visibly while the model is still in full view — you'd watch material drop
    // out the instant you clicked ISM. Matching CGM means the fly holds one
    // fixed colorbar end to end, mirroring the ISM->CGM direction.
    // (Tuned-for-face-on values would be ~0.20/0.85 — they look better at rest
    // but are only reachable without a pop by interpolating across the fly.)
    fields: [{ key: "total_gas", cbLo: 0.02, cbHi: 0.76 }],
    controlsUI: [],
    // face-on from BELOW (-z): mirrors the disk so the volume model's spiral
    // winding matches the I11 movie's (they're different simulations that wind
    // opposite ways when both seen from +z). Still at the SAME -y azimuth as
    // home/cgm so arriving from either is a pure tilt with no spin: only the
    // polar angle changes (cgm 90° edge-on -> ~178°). The small -y offset keeps
    // the camera off the exact pole, where lookAt with up=+z is degenerate.
    camera: { pos: [0, -0.02, -0.95], target: [0, 0, 0] },
    // opening zoom, to pull the disk in toward the movie's framing at the
    // crossfade. cgm sits at an effective 1.1/1.5 = 0.73, so at 1x the model
    // would *pull back* on the way here; 0.95/2.5 = 0.38 zooms in instead.
    zoom: 2.5
  },
  movie: "raw_data/I11_highcadence_gas_movie.mp4",
  // side-docked magnifier fed by a cursor reticle, with supernova markers
  // (SneLens in app.js): dia = panel diameter (css px, shrunk to fit small
  // heroes), mag = magnification — the cursor ring is dia/mag across, so
  // raising mag shrinks the sampled region (and softens the crop, the 1024px
  // movie being the only pixel source) — fade = SN dot lifetime in movie
  // frames, dot = SN marker radius in css px. Assets built by
  // scripts/build_sne_assets.py.
  movieLens: { base: "assets/viz/ism/", mag: 3, dia: 280, fade: 20, dot: 2.2 },
  lede: "Galactic disks are complicated places. In my work, I have used Gaia DR3 to trace the kinematic substructure of stars across the Milky Way's disk, identifying new moving groups and connecting them to the dynamics of the Galaxy's bar. I also build high-cadence hydrodynamical simulations of the interstellar medium to study how supernovae drive turbulence and shape the gas in galactic disks.",
  stats: [{
    v: "3",
    l: "papers"
  }, {
    v: "30M+",
    l: "Gaia DR3 stars"
  }, {
    v: "MGwave",
    l: "open-source tool"
  }],
  papers: [{
    tag: "ApJ",
    year: "2026",
    title: "Constraining Simulated Supernova Feedback Strengths with Galaxy Morphologies and JWST",
    summary: "Using the SMUGGLE resolved ISM model in Arepo, we have run a suite of high-cadence simulations of a NGC 628-like disk with varying supernova feedback strengths. The number and size of bubble structures in the disk is sensitive to the feedback strength, and can be compared to JWST observations of nearby galaxies to constrain the feedback model.",
    cite: "Lucchini, S., O'Neill, T., Goodman, A., & Zucker, C. — in prep",
    figures: [{
      kind: "image",
      src: "assets/perch_bubbles.png",
      caption: "Face on projection of simulated galaxy in mock F770W filter. Identified bubble structures shown as ellipses. The number and size of bubbles is sensitive to the strength of supernova feedback."
    }]
  }, {
    tag: "MNRAS",
    year: "2023",
    title: "Moving groups across Galactocentric radius with Gaia DR3",
    summary: "A new open-source wavelet-transform code, MGwave, identifies substructure in the velocity space of stars near the Sun using Gaia DR3. Over- and under-densities in azimuthal vs. radial velocity reveal three new moving groups and three groups previously unseen in Gaia data — a fresh look at the kinematic structure of the solar neighborhood.",
    cite: "Lucchini, S., Pellett, E., D'Onghia, E., & Aguerri, J. A. L. — MNRAS, 519, 1 (2023)",
    links: [{
      label: "10.1093/mnras/stac3519",
      href: "https://doi.org/10.1093/mnras/stac3519"
    }, {
      label: "arXiv:2206.10633",
      href: "https://arxiv.org/abs/2206.10633"
    }],
    figures: [{
      kind: "image",
      src: "assets/wavelet.png",
      caption: "Hyades, Sirius, Hercules and the Horn traced through velocity space, coloured by Galactocentric radius."
    }]
  }, {
    tag: "MNRAS",
    year: "2024",
    title: "The Milky Way Bar Pattern Speed using Hercules and Gaia DR3",
    summary: "Tracking the Hercules moving group in azimuth across the disk (±15° from the Sun) with Gaia DR3. Its velocity and strength change exactly as expected for stars trapped at the bar's corotation resonance — pointing to a slowly rotating bar (~40 km/s/kpc), independently confirming other measurements of the Milky Way's bar.",
    cite: "Lucchini, S., D'Onghia, E., & Aguerri, J. A. L. — MNRAS, 531, L14 (2024)",
    links: [{
      label: "10.1093/mnrasl/slae024",
      href: "https://doi.org/10.1093/mnrasl/slae024"
    }, {
      label: "arXiv:2305.04981",
      href: "https://arxiv.org/abs/2305.04981"
    }],
    figures: [{
      kind: "image",
      src: "assets/wavelet_hercules.png",
      caption: "Hercules' azimuthal velocity across ±15° of Galactic azimuth — the linear trend expected at the bar's corotation resonance."
    }]
  }]
},
// ───────────────────────────────────────────── MAGELLANIC CLOUDS
{
  id: "magellanic",
  tab: "Magellanic",
  title: "The Magellanic Clouds",
  kicker: "Galactic interactions · gas dynamics",
  hue: 72,
  // stellar amber
  vizKind: "stream",
  vizLabel: "Magellanic Stream — orbital interaction model",
  // MW + LMC CGM isosurfaces with a snapshot time scrubber
  viz: {
    layer: "iso",
    interactive: true,
    controlsUI: ["components", "time"],
    // +x axis view = y–z projection: y right, z up (stage up is +z, so
    // right = forward × up = +y). |pos| kept at the tuned base distance.
    camera: { pos: [2.27, 0, 0], target: [0, 0, 0] },
    zoom: 1.45
  },
  lede: "The Magellanic Clouds are the nearest interacting galaxies to our own, and the gas they shed — the Magellanic Stream — is the largest, closest example of the cosmic gas accretion that fuels galaxies like the Milky Way. I build hydrodynamic simulations of the Clouds and their interactions to trace how that gas is stripped, ionized, and ultimately delivered to our Galaxy.",
  stats: [{
    v: "6",
    l: "papers"
  }, {
    v: rich("2×10⁹ M", sub("⊙")),
    l: "stream mass budget"
  }, {
    v: "Nature",
    l: "2020 cover"
  }],
  papers: [{
    tag: "Nature",
    year: "2020",
    title: "The Magellanic Corona and the formation of the Magellanic Stream",
    summary: rich("N-body hydrodynamical simulations show that a warm circumgalactic medium around the LMC/SMC — the Magellanic Corona — is the key ingredient for reproducing the high ionization fraction and total mass of the Magellanic Stream. Previous models could not explain the ~2 billion M", sub("⊙"), " of ionized gas that dominates the Stream's mass budget. Near the LMC's virial temperature (3×10⁵ K), this gas is ionized, and is warped and stretched by the Milky Way as the Clouds fall in."),
    cite: "Lucchini, S., D'Onghia, E., Fox, A. J., et al. — Nature, 585, 203 (2020)",
    links: [{
      label: "10.1038/s41586-020-2663-4",
      href: "https://www.nature.com/articles/s41586-020-2663-4"
    }, {
      label: "arXiv:2009.04368",
      href: "https://arxiv.org/abs/2009.04368"
    }],
    figures: [{
      kind: "image",
      src: "assets/nature_cover.png",
      caption: "Nature cover — 10 September 2020."
    }]
  }, {
    tag: "ApJL",
    year: "2025",
    title: "Threading the Magellanic Needle: Hypervelocity Stars Trace the Past Location of the LMC",
    summary: "Hypervelocity stars ejected by the LMC's central black hole give a new handle on where the Cloud has been. Each star must have intersected the black hole's position at the moment it was ejected, so back-integrating three of them and asking which LMC orbits thread all three constrains the past motion far more tightly than conventional methods allow. Two previously published trajectories survive: a first-passage orbit from a self-consistent hydrodynamical simulation, and a second-passage orbit from a collisionless N-body run. The same fit independently locates the present-day ejection site, tracing the LMC's dynamical center and its supermassive black hole.",
    cite: "Lucchini, S., & Han, J. — ApJL, 993, L10 (2025)",
    links: [{
      label: "10.3847/2041-8213/ae109d",
      href: "https://iopscience.iop.org/article/10.3847/2041-8213/ae109d"
    }, {
      label: "arXiv:2510.03393",
      href: "https://arxiv.org/abs/2510.03393"
    }],
    figures: [{
      kind: "image",
      src: "assets/web/mc_hvs.jpg",
      caption: "Where the three stars were launched from, projected onto the face of the LMC: 1σ and 2σ contours per star and combined (white), against published estimates of the Cloud's dynamical centre."
    }]
  }, {
    tag: "ApJ",
    year: "2026",
    title: "The LMC Corona Favors a First Passage",
    summary: "Whether the LMC is approaching the Milky Way for the first time or has already had a pericenter passage sets how long the two have been interacting — and the Corona records it. Constrained idealized simulations, with live circumgalactic gas particles in analytic dark matter potentials following each published trajectory, show that the first-passage model reproduces the observed velocity and column-density profiles of the present-day Corona. The longer interaction time in a second passage strips it much further, leaving both profiles well below observations. The truncation radii come out at 16.6 ± 0.5 kpc for first passage versus 5.7 kpc for second, against the 17–20 kpc inferred from observations — strongly disfavoring a second-passage trajectory.",
    cite: "Lucchini, S., Han, J., Mishra, S., & Fox, A. J. — ApJ, 1002, 14 (2026)",
    links: [{
      label: "10.3847/1538-4357/ae5bc3",
      href: "https://iopscience.iop.org/article/10.3847/1538-4357/ae5bc3"
    }, {
      label: "arXiv:2510.03395",
      href: "https://arxiv.org/abs/2510.03395"
    }],
    figures: [{
      kind: "image",
      src: "assets/first_second_passage.png",
      caption: "LSR velocity against impact parameter around the LMC. The first-passage model (top) tracks the observed C IV sightlines; the second passage (bottom) sits well below them. The blue band marks the observed truncation radius."
    }]
  }, {
    tag: "ApJL",
    year: "2021",
    title: "The Magellanic Stream at 20 kpc: A New Orbital History for the Magellanic Clouds",
    summary: "Including the Magellanic Corona changes the Clouds' interaction history: hydrodynamical friction and ram pressure cause the SMC's orbit to decay more quickly. Improved models taking the Corona into consideration match the present-day positions and velocities within 3σ. In 7 of 10 simulated Streams, stripped gas ends up close to the Sun — as near as 20 kpc — a major shift from prior predictions of 100–200 kpc.",
    cite: "Lucchini, S., D'Onghia, E., & Fox, A. J. — ApJL, 921, L36 (2021)",
    links: [{
      label: "10.3847/2041-8213/ac3338",
      href: "https://iopscience.iop.org/article/10.3847/2041-8213/ac3338"
    }, {
      label: "arXiv:2110.11355",
      href: "https://arxiv.org/abs/2110.11355"
    }],
    figures: [{
      kind: "image",
      src: "assets/new_orbits.png",
      caption: "The Clouds' path through the halo and the gas stripped along it — the Stream ends up beside the Milky Way disk, not 100–200 kpc away."
    }]
  }, {
    tag: "ApJ",
    year: "2024",
    title: "Properties of the Magellanic Corona",
    summary: rich("A suite of simulations varying the Corona's initial mass and temperature shows the LMC can host a stable CGM for >4 Gyr with masses >2×10⁹ M", sub("⊙"), ". The full three-body interaction reproduces the observed neutral and ionized mass of the Trailing Stream, the LMC disk size, ionization fractions, neutral morphology, and the on-sky extent of the ionized gas."),
    cite: "Lucchini, S., D'Onghia, E., & Fox, A. J. — ApJ, 967, 16 (2024)",
    links: [{
      label: "10.3847/1538-4357/ad3c3b",
      href: "https://www.doi.org/10.3847/1538-4357/ad3c3b"
    }, {
      label: "arXiv:2311.16221",
      href: "https://arxiv.org/abs/2311.16221"
    }],
    figures: [{
      kind: "image",
      src: "assets/magellanic_corona.png",
      caption: "Trailing Stream mass — observations against earlier models and the low-, fiducial- and high-mass Corona runs."
    }]
  }, {
    tag: "Review · A&SS",
    year: "2024",
    title: "Following the tidal trail: a history of modeling the Magellanic Stream",
    summary: "A review of the history of modeling the Magellanic Stream, published as part of the 2024 Astronomy Prize Awardees Collection. It outlines the key observational advances behind our understanding of the Stream's formation, and the leading simulations and theoretical models with their successes and drawbacks.",
    cite: "Lucchini, S. — Astrophys. Space Sci., 369, 114 (2024)",
    links: [{
      label: "10.1007/s10509-024-04377-5",
      href: "https://link.springer.com/article/10.1007/s10509-024-04377-5"
    }, {
      label: "PDF",
      href: "https://rdcu.be/d03fK"
    }],
    figures: [{
      kind: "image",
      src: "assets/web/MC_review.jpg",
      caption: "The Magellanic System on the sky — the Leading Arm, Bridge and Trailing Stream in H I over the southern Milky Way."
    }]
  }]
}];
window.AREAS = AREAS;

})();
