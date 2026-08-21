(function () {
// app.jsx — gallery nav, slide transitions, per-area content.
const {
  useState,
  useEffect,
  useCallback,
  useRef
} = React;

// Locked-in design settings (explored via the design Tweaks panel, then fixed).
const TWEAKS = {
  theme: "cosmic",
  accent: "per-area",
  hero: "animated",
  motion: "moderate"
};
const ACCENT_HUE = {
  "Cyan": 220,
  "Amber": 72,
  "Violet": 318
};
function resolveHue(accent, areaHue) {
  if (accent === "per-area") return areaHue;
  return ACCENT_HUE[accent] ?? areaHue;
}

// ── Publication row — text chunk + space for an image or two ──
function PaperCard({
  p,
  hue,
  i
}) {
  const figs = p.figures || [];
  // A paper in prep has no arXiv/DOI to point at yet, so `links` may be absent.
  // The row is dropped entirely rather than rendered empty — .paper-links carries
  // a margin-top that would otherwise leave a gap under the summary.
  const links = p.links || [];
  return /*#__PURE__*/React.createElement("article", {
    className: "pub" + (figs.length ? "" : " no-fig")
  }, /*#__PURE__*/React.createElement("div", {
    className: "pub-text"
  }, /*#__PURE__*/React.createElement("h3", {
    className: "paper-title"
  }, p.title), /*#__PURE__*/React.createElement("div", {
    className: "paper-cite"
  }, p.cite), /*#__PURE__*/React.createElement("p", {
    className: "paper-sum"
  }, p.summary), links.length > 0 && /*#__PURE__*/React.createElement("div", {
    className: "paper-links"
  }, links.map(l => /*#__PURE__*/React.createElement("a", {
    key: l.href,
    href: l.href,
    target: "_blank",
    rel: "noopener noreferrer",
    className: "paper-link"
  }, l.label, /*#__PURE__*/React.createElement("svg", {
    viewBox: "0 0 24 24",
    width: "11",
    height: "11",
    "aria-hidden": "true"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M7 17L17 7M9 7h8v8",
    stroke: "currentColor",
    strokeWidth: "2",
    fill: "none",
    strokeLinecap: "round",
    strokeLinejoin: "round"
  })))))), figs.length > 0 && /*#__PURE__*/React.createElement("div", {
    className: "pub-figs" + (figs.length > 1 ? " multi" : "")
  }, figs.map((f, j) => /*#__PURE__*/React.createElement(Placeholder, {
    key: j,
    kind: f.kind,
    caption: f.caption,
    src: f.src,
    hue: hue,
    mono: f.kind === "image" ? "FIGURE" : f.kind.toUpperCase()
  }))));
}

// ── Home / About panel ──
function HomePanel({
  area,
  hue,
  goById,
  volumeReady,
  morphIn,
  leaving
}) {
  // The total-gas volume is rendered BEHIND the hero movie at the movie's
  // inclination. When arriving here from another area (morphIn), keep the movie
  // hidden while the stage's camera flies back to home framing, so the 3D model
  // is seen reorienting to its home alignment first — the reverse of the home→CGM
  // morph — then fade the movie in over it. On a direct/first load there's no fly
  // to watch, so reveal it immediately.
  //
  // Timing knob: the fade starts HERO_REVEAL_DELAY ms after the fly BEGINS (the
  // "shown" event). The fly itself takes ~900ms (see viz3d.js `dur`), so a value
  // a bit under that starts the fade just before the model settles, leaving a
  // short overlap where the model is still visible through the fading-in movie.
  // The fade's own duration lives in styles.css (.home-hero-bg transition).
  const HERO_REVEAL_DELAY = 650;
  const [heroShown, setHeroShown] = useState(!morphIn);
  useEffect(() => {
    if (heroShown) return;
    let off = null, iv = null, revealTimer = null;
    const startFade = () => { if (revealTimer == null) revealTimer = setTimeout(() => setHeroShown(true), HERO_REVEAL_DELAY); };
    const attach = () => {
      if (!window.SLViz) return false;
      // "shown" fires when the camera fly starts (after any layer load), so the
      // delay is measured from the fly's real beginning, not from mount.
      off = window.SLViz.on("shown", id => { if (id === area.id) startFade(); });
      return true;
    };
    if (!attach()) iv = setInterval(() => { if (attach()) clearInterval(iv); }, 60);
    // safety net: never leave the hero hidden if the event is missed
    const fallback = setTimeout(() => setHeroShown(true), 3000);
    return () => { if (off) off(); if (iv) clearInterval(iv); if (revealTimer) clearTimeout(revealTimer); clearTimeout(fallback); };
  }, []);
  // hidden while arriving (until the fly-back settles) AND while leaving (the
  // pre-navigation fade-out in App.go)
  const heroBgClass = "home-hero-bg" + (heroShown && !leaving ? "" : " viz-faded");
  return /*#__PURE__*/React.createElement("section", {
    className: "home-page"
  }, /*#__PURE__*/React.createElement("div", {
    className: "home-hero"
  },/*#__PURE__*/React.createElement("div", {
    className: "viz-hit",
    "aria-hidden": "true"
  }), area.heroVideo ? /*#__PURE__*/React.createElement("video", {
    className: heroBgClass + " home-hero-video",
    src: area.heroVideo, poster: area.heroImage,
    autoPlay: true, loop: true, playsInline: true, preload: "auto",
    ref: el => { if (el) el.muted = true; },
    "aria-hidden": "true"
  }) : /*#__PURE__*/React.createElement("div", {
    className: heroBgClass,
    style: {
      backgroundImage: `url(${area.heroImage})`
    },
    "aria-hidden": "true"
  }), /*#__PURE__*/React.createElement("div", {
    className: "home-hero-scrim",
    "aria-hidden": "true"
  }), /*#__PURE__*/React.createElement("div", {
    className: "home-hero-inner"
  }, /*#__PURE__*/React.createElement("h1", {
    className: "home-hero-title"
  }, area.heroLines.map((line, i) => /*#__PURE__*/React.createElement("span", {
    key: i,
    className: "home-hero-line"
  }, line)))), /*#__PURE__*/React.createElement("button", {
    className: "home-hero-scroll",
    onClick: () => {
      const el = document.querySelector(".home-jump");
      const topbar = document.querySelector(".topbar");
      if (!el) return;
      const offset = topbar ? topbar.offsetHeight : 0;
      const start = window.pageYOffset;
      const target = el.getBoundingClientRect().top + start - offset;
      const dist = target - start;
      const dur = 650;
      const ease = p => p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
      let t0 = null;
      const step = now => {
        if (t0 === null) t0 = now;
        const p = Math.min((now - t0) / dur, 1);
        window.scrollTo({
          top: start + dist * ease(p),
          behavior: "instant"
        });
        if (p < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    },
    "aria-label": "Scroll to bio"
  }, /*#__PURE__*/React.createElement("svg", {
    viewBox: "0 0 24 24",
    width: "16",
    height: "16"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M12 5v14M6 13l6 6 6-6",
    stroke: "currentColor",
    strokeWidth: "1.8",
    fill: "none",
    strokeLinecap: "round",
    strokeLinejoin: "round"
  })))), /*#__PURE__*/React.createElement("div", {
    className: "home-jump"
  }, /*#__PURE__*/React.createElement("div", {
    className: "jump-grid"
  }, area.jump.map(j => /*#__PURE__*/React.createElement("button", {
    key: j.to,
    className: "jump-card",
    style: {
      "--jhue": j.hue
    },
    onClick: () => goById(j.to)
  }, /*#__PURE__*/React.createElement("span", {
    className: "jump-label",
    style: {
      color: "rgb(255, 255, 255)"
    }
  }, j.label), /*#__PURE__*/React.createElement("span", {
    className: "jump-note",
    style: {
      fontFamily: "\"IBM Plex Sans\""
    }
  }, j.note), /*#__PURE__*/React.createElement("span", {
    className: "jump-arrow",
    "aria-hidden": "true"
  }, /*#__PURE__*/React.createElement("svg", {
    viewBox: "0 0 24 24",
    width: "16",
    height: "16"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M5 12h14M13 6l6 6-6 6",
    stroke: "currentColor",
    strokeWidth: "1.8",
    fill: "none",
    strokeLinecap: "round",
    strokeLinejoin: "round"
  }))))))), /*#__PURE__*/React.createElement("section", {
    className: "home"
  }, /*#__PURE__*/React.createElement("div", {
    className: "home-about"
  }, /*#__PURE__*/React.createElement("div", {
    className: "home-about-id"
  }, /*#__PURE__*/React.createElement("h1", {
    className: "home-name",
    style: {
      fontWeight: "600",
      letterSpacing: "0px"
    }
  }, "Scott", /*#__PURE__*/React.createElement("br", null), " ", "Lucchini"), /*#__PURE__*/React.createElement("p", {
    className: "home-tagline",
    style: {
      fontFamily: "\"Space Grotesk\""
    }
  }, area.tagline)), /*#__PURE__*/React.createElement("div", {
    className: "home-bio"
  }, area.bio.map((para, i) => /*#__PURE__*/React.createElement("p", {
    key: i
  }, para)))), /*#__PURE__*/React.createElement("div", {
    className: "home-contact"
  }, /*#__PURE__*/React.createElement("div", {
    className: "contact-grid"
  }, /*#__PURE__*/React.createElement("div", {
    className: "contact-photo"
  }, /*#__PURE__*/React.createElement("img", {
    src: "assets/headshot_circle.png",
    alt: "Scott Lucchini",
    style: {
      width: "100px",
      height: "100px",
      objectFit: "fill"
    }
  })), area.contacts.map(c => /*#__PURE__*/React.createElement("a", {
    key: c.label,
    className: "contact" + (c.placeholder ? " is-ph" : ""),
    href: c.href,
    target: c.href.startsWith("http") ? "_blank" : undefined,
    rel: "noopener noreferrer"
  }, /*#__PURE__*/React.createElement("span", {
    className: "contact-label"
  }, c.label), /*#__PURE__*/React.createElement("span", {
    className: "contact-value"
  }, c.value)))))));
}

// ── Per-area content stage ──
function AreaContent({
  area,
  hue
}) {
  return /*#__PURE__*/React.createElement("section", {
    className: "content"
  }, /*#__PURE__*/React.createElement("div", {
    className: "content-inner"
  }, area.release && /*#__PURE__*/React.createElement("div", {
    className: "data-release"
  }, /*#__PURE__*/React.createElement("div", {
    className: "release-eyebrow"
  }, area.release.eyebrow || "Public data release"), /*#__PURE__*/React.createElement("p", {
    className: "release-text"
  }, area.release.text), /*#__PURE__*/React.createElement("a", {
    className: "release-link",
    href: area.release.href
  }, area.release.linkLabel, /*#__PURE__*/React.createElement("svg", {
    viewBox: "0 0 24 24",
    width: "13",
    height: "13",
    "aria-hidden": "true"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M5 12h14M13 6l6 6-6 6",
    stroke: "currentColor",
    strokeWidth: "2",
    fill: "none",
    strokeLinecap: "round",
    strokeLinejoin: "round"
  })))), /*#__PURE__*/React.createElement("div", {
    className: "sec-label"
  }, "Publications", /*#__PURE__*/React.createElement("span", {
    className: "sec-count"
  }, area.papers.length)), area.placeholderNote && /*#__PURE__*/React.createElement("div", {
    className: "ph-note"
  }, area.placeholderNote), /*#__PURE__*/React.createElement("div", {
    className: "pubs"
  }, area.papers.map((p, i) => /*#__PURE__*/React.createElement(PaperCard, {
    key: p.title,
    p: p,
    hue: hue,
    i: i
  })))));
}

// ── Viz control overlays (drive window.SLViz imperatively) ──
const callViz = (fn, ...args) => {
  // returns whatever the stage returns — setVolumeField hands back a promise
  // that settles when the new cubes are actually on screen
  if (window.SLViz && typeof window.SLViz[fn] === "function") return window.SLViz[fn](...args);
};
// touch device? (no hover, so hover-driven affordances need a tap equivalent)
function coarsePointer() {
  return typeof window !== "undefined" && !!window.matchMedia &&
    window.matchMedia("(pointer: coarse)").matches;
}

// CGM gas volume: species dropdown + color-scale (min/max) + zoom
function VolumeControls({ area }) {
  const ui = (area.viz && area.viz.controlsUI) || [];
  const fields = (area.viz && area.viz.fields) || [];
  const defaultField = (area.viz && area.viz.field) || (fields[0] && fields[0].key);
  const fieldCb = key => {
    const f = fields.find(x => x.key === key) || {};
    return { lo: f.cbLo !== undefined ? f.cbLo : 0, hi: f.cbHi !== undefined ? f.cbHi : 1 };
  };
  const defCb = fieldCb(defaultField);
  const defaultZoom = area.viz && area.viz.zoom !== undefined ? area.viz.zoom : 1;
  const [mode, setMode] = useState(area.viz && area.viz.mode === "integral" ? "integral" : "volume");
  const [opacity, setOpacity] = useState(1);
  const [zoom, setZoom] = useState(defaultZoom);
  const [field, setField] = useState(defaultField);
  const [cbLo, setCbLo] = useState(defCb.lo);
  const [cbHi, setCbHi] = useState(defCb.hi);
  // ion whose cubes are in flight (null when nothing is loading)
  const [busyField, setBusyField] = useState(null);
  const showMode = ui.includes("mode");
  // On touch devices the zoom slider is replaced by two-finger pinch zoom (see
  // _applyInteract in viz3d.js); keep the slider for desktop (mouse) only.
  const showZoom = ui.includes("zoom") && !coarsePointer();
  const showField = ui.includes("field") && fields.length > 0;
  const showColorbar = ui.includes("colorbar");
  // Switching ion also resets the color scale (min/max) to that ion's defaults —
  // but the new cubes take a moment to arrive, so the window is handed to
  // setVolumeField and applied WITH the swap rather than now. Applying it now
  // re-windowed the outgoing ion's data first, which read as the image changing
  // twice. The button goes busy meanwhile so the click still feels immediate.
  const changeField = key => {
    if (key === field) return;
    setField(key);
    const c = fieldCb(key);
    setCbLo(c.lo); setCbHi(c.hi);
    setBusyField(key);
    Promise.resolve(callViz("setVolumeField", key, c))
      .catch(() => {})
      .then(() => setBusyField(b => (b === key ? null : b)));
  };
  const changeCb = (lo, hi) => { setCbLo(lo); setCbHi(hi); callViz("setVolumeColorbar", lo, hi); };
  // each area re-frames at 1x zoom, default field, and that field's color scale
  useEffect(() => {
    setZoom(defaultZoom); setField(defaultField);
    const c = fieldCb(defaultField); setCbLo(c.lo); setCbHi(c.hi); callViz("setVolumeColorbar", c.lo, c.hi);
  }, [area.id]);
  if (!showMode && !showZoom && !showField && !showColorbar) return null;
  return /*#__PURE__*/React.createElement("div", {
    className: "viz-controls"
  }, showField && /*#__PURE__*/React.createElement("div", {
    className: "vc-fields",
    // single-select (the shader binds one ion pair at a time), so the group is
    // named for screen readers and each button reports its own pressed state
    role: "group",
    "aria-label": "Species"
  }, fields.map(f => /*#__PURE__*/React.createElement("button", {
    key: f.key,
    className: (field === f.key ? "active" : "") + (busyField === f.key ? " is-loading" : ""),
    "aria-pressed": field === f.key,
    "aria-busy": busyField === f.key ? "true" : undefined,
    onClick: () => changeField(f.key)
  }, f.label))), showMode && /*#__PURE__*/React.createElement("div", {
    className: "vc-row"
  }, /*#__PURE__*/React.createElement("span", {
    className: "vc-seg"
  }, /*#__PURE__*/React.createElement("button", {
    className: mode === "integral" ? "active" : "",
    onClick: () => { setMode("integral"); callViz("setVolumeMode", "integral"); }
  }, "Column"), /*#__PURE__*/React.createElement("button", {
    className: mode === "volume" ? "active" : "",
    onClick: () => { setMode("volume"); callViz("setVolumeMode", "volume"); }
  }, "Volume"))), showColorbar && /*#__PURE__*/React.createElement("label", null, "Scale min", /*#__PURE__*/React.createElement("input", {
    type: "range", min: "-0.5", max: "0.9", step: "0.02", value: cbLo,
    onChange: e => changeCb(parseFloat(e.target.value), cbHi)
  })), showColorbar && /*#__PURE__*/React.createElement("label", null, "Scale max", /*#__PURE__*/React.createElement("input", {
    type: "range", min: "0.1", max: "1.5", step: "0.02", value: cbHi,
    onChange: e => changeCb(cbLo, parseFloat(e.target.value))
  })), showZoom && /*#__PURE__*/React.createElement("label", null, "Zoom", /*#__PURE__*/React.createElement("input", {
    type: "range", min: "0.6", max: "2.5", step: "0.05", value: zoom,
    onChange: e => { const v = parseFloat(e.target.value); setZoom(v); callViz("setZoom", v); }
  })), showColorbar && mode === "volume" && /*#__PURE__*/React.createElement("label", null, "Opacity", /*#__PURE__*/React.createElement("input", {
    type: "range", min: "0.1", max: "3", step: "0.05", value: opacity,
    onChange: e => { const v = parseFloat(e.target.value); setOpacity(v); callViz("setVolumeOpacity", v); }
  })));
}

// ENGAWA/CGM: draggable vertical wipe comparing the two resolution runs. The
// divider strip catches pointer events (and updates the shader's screen-x split);
// everywhere else stays pointer-transparent so drag-to-rotate still reaches the
// OrbitControls surface (.viz-hit) underneath.
function CompareSlider({ area }) {
  const ref = useRef(null);
  const [split, setSplit] = useState(0.5);
  const dragging = useRef(false);
  const labels = (area.viz && area.viz.compareLabels) || ["Default", "200 pc"];

  const apply = useCallback(f => {
    const v = Math.min(1, Math.max(0, f));
    setSplit(v);
    callViz("setSplit", v);
  }, []);

  useEffect(() => { callViz("setSplit", 0.5); setSplit(0.5); }, [area.id]);

  const fracFromX = clientX => {
    const host = ref.current && ref.current.closest(".hero-viz-full");
    if (!host) return split;
    const r = host.getBoundingClientRect();
    return (clientX - r.left) / r.width;
  };
  const onDown = e => {
    dragging.current = true;
    e.currentTarget.setPointerCapture && e.currentTarget.setPointerCapture(e.pointerId);
    apply(fracFromX(e.clientX));
    e.stopPropagation(); e.preventDefault();
  };
  const onMove = e => { if (!dragging.current) return; apply(fracFromX(e.clientX)); e.stopPropagation(); };
  const onUp = e => { dragging.current = false; e.stopPropagation(); };

  return /*#__PURE__*/React.createElement("div", {
    className: "viz-compare", ref, style: { "--split": (split * 100) + "%" }
  }, /*#__PURE__*/React.createElement("div", {
    className: "viz-compare-label left"
  }, labels[0]), /*#__PURE__*/React.createElement("div", {
    className: "viz-compare-label right"
  }, labels[1]), /*#__PURE__*/React.createElement("div", {
    className: "viz-divider", role: "slider", tabIndex: 0,
    "aria-label": "Resolution comparison split",
    "aria-valuemin": 0, "aria-valuemax": 100, "aria-valuenow": Math.round(split * 100),
    onPointerDown: onDown, onPointerMove: onMove, onPointerUp: onUp, onPointerCancel: onUp,
    onKeyDown: e => {
      if (e.key === "ArrowLeft") { apply(split - 0.02); e.preventDefault(); }
      if (e.key === "ArrowRight") { apply(split + 0.02); e.preventDefault(); }
    }
  }, /*#__PURE__*/React.createElement("div", { className: "viz-divider-handle" })));
}

// Gesture guard (touch only), the pattern Google Maps uses: one finger scrolls
// the page past the viz (see _attachControls in viz3d.js), which reads as a dead
// model unless you're told why. So the first one-finger drag ACROSS the viz dims
// it and names the second finger; the message fades once the finger lifts, and a
// real two-finger gesture dismisses it immediately. Replaces the old timed pill,
// which said the same thing on arrival whether or not anyone had tried to touch.
function TouchGestureHint({ area }) {
  const ref = useRef(null);
  const [show, setShow] = useState(false);
  const zoom = !!(area.viz && area.viz.controlsUI && area.viz.controlsUI.includes("zoom"));
  useEffect(() => {
    const host = ref.current && ref.current.closest(".hero-viz-full");
    if (!host || !window.matchMedia || !window.matchMedia("(pointer: coarse)").matches) return;
    // touchmove, not touchstart: a tap is not a thwarted gesture, and the wipe
    // handle is a one-finger control in its own right
    const onMove = e => {
      if (e.target.closest && e.target.closest(".viz-divider")) return;
      setShow(e.touches.length < 2);
    };
    // the message lives exactly as long as the gesture — lifting the last finger
    // clears it at once (the CSS fade is all that outlives the touch)
    const onEnd = e => { if (!e.touches.length) setShow(false); };
    host.addEventListener("touchmove", onMove, { passive: true });
    host.addEventListener("touchend", onEnd, { passive: true });
    host.addEventListener("touchcancel", onEnd, { passive: true });
    return () => {
      host.removeEventListener("touchmove", onMove);
      host.removeEventListener("touchend", onEnd);
      host.removeEventListener("touchcancel", onEnd);
    };
  }, [area.id]);
  return /*#__PURE__*/React.createElement("div", {
    className: "touch-gesture" + (show ? " show" : ""),
    ref,
    "aria-hidden": "true"
  }, /*#__PURE__*/React.createElement("span", {
    className: "touch-gesture-msg"
  }, zoom ? "Use two fingers to rotate and zoom" : "Use two fingers to rotate"));
}

// ISM: after the 3D gas volume reorients (the stage emits "settled" when its
// camera fly finishes), crossfade to a looping disk-simulation movie and play it.
// Remounts per area (the .stage is keyed by area.id), so state resets each visit.
function HeroMovie({ area }) {
  const ref = useRef(null);
  const [active, setActive] = useState(false);
  useEffect(() => {
    let off = null, iv = null;
    const attach = () => {
      if (!window.SLViz) return false;
      off = window.SLViz.on("settled", id => { if (id === area.id) setActive(true); });
      return true;
    };
    if (!attach()) iv = setInterval(() => { if (attach()) clearInterval(iv); }, 60);
    return () => { if (off) off(); if (iv) clearInterval(iv); };
  }, [area.id]);
  useEffect(() => {
    const v = ref.current;
    if (!v || !active) return;
    try { v.currentTime = 0; } catch (e) {}
    const p = v.play();
    if (p && p.catch) p.catch(() => {});
  }, [active]);
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("video", {
    className: "hero-movie" + (active ? " show" : ""),
    ref, src: area.movie, muted: true, loop: true, playsInline: true,
    preload: "auto", "aria-hidden": "true"
  }), area.movieLens && /*#__PURE__*/React.createElement(SneLens, {
    area, videoRef: ref
  }), /*#__PURE__*/React.createElement(MovieScrub, {
    videoRef: ref, active
  }), area.movieLens && /*#__PURE__*/React.createElement("div", {
    className: "lens-hint" + (active ? " show" : ""),
    "aria-hidden": "true"
  }, coarsePointer()
    ? "tap to magnify \xB7 tap again to release"
    : "hover to magnify \xB7 click to pin \xB7 supernovae in yellow"));
}

// ISM: bottom scrubber + playback-speed control for the hero movie. The video
// element is the source of truth: an rAF loop mirrors currentTime into the
// (uncontrolled) range input and frame counter, so external changes (looping,
// speed) stay reflected and the SNe lens — which also reads currentTime —
// needs no coupling. Dragging pauses the video and resumes on release if it
// was playing. Speed uses video.playbackRate (30 fps source, so ½× ≈ 15 fps);
// no re-encode needed.
function MovieScrub({ videoRef, active }) {
  const sliderRef = useRef(null);
  const labelRef = useRef(null);
  const drag = useRef({ on: false, wasPlaying: false });
  const [rate, setRate] = useState(0.5);   // ½× default (15 fps effective)
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    const v = videoRef.current;
    if (v) v.playbackRate = rate;
  }, [rate, active]);
  // mirror the video's actual play state (autoplay on "settled", drag
  // pause/resume, the button itself) into the button icon
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const on = () => setPlaying(true), off = () => setPlaying(false);
    v.addEventListener("play", on);
    v.addEventListener("pause", off);
    setPlaying(!v.paused);
    return () => { v.removeEventListener("play", on); v.removeEventListener("pause", off); };
  }, []);
  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) { const p = v.play(); if (p && p.catch) p.catch(() => {}); }
    else v.pause();
  };
  useEffect(() => {
    let raf;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const v = videoRef.current, s = sliderRef.current, l = labelRef.current;
      if (!v || !s || !v.duration) return;
      if (s.max !== String(v.duration)) s.max = String(v.duration);
      if (!drag.current.on) s.value = String(v.currentTime);
      if (l) l.textContent = "frame " + String(Math.round(v.currentTime * 30)).padStart(4, "0");
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  const seek = e => {
    const v = videoRef.current;
    if (!v || !v.duration) return;
    try { v.currentTime = parseFloat(e.target.value); } catch (err) {}
  };
  const onDown = () => {
    const v = videoRef.current;
    if (!v) return;
    drag.current = { on: true, wasPlaying: !v.paused };
    v.pause();
  };
  const onUp = () => {
    const v = videoRef.current;
    if (drag.current.wasPlaying && v) { const p = v.play(); if (p && p.catch) p.catch(() => {}); }
    drag.current.on = false;
  };
  return /*#__PURE__*/React.createElement("div", {
    className: "movie-scrub" + (active ? " show" : "")
  }, /*#__PURE__*/React.createElement("input", {
    type: "range", className: "time-slider", ref: sliderRef,
    min: "0", max: "0", step: "any", defaultValue: "0",
    "aria-label": "Movie scrub",
    onInput: seek, onPointerDown: onDown, onPointerUp: onUp, onPointerCancel: onUp
  }), /*#__PURE__*/React.createElement("div", {
    className: "scrub-row"
  }, /*#__PURE__*/React.createElement("span", {
    className: "scrub-left"
  }, /*#__PURE__*/React.createElement("button", {
    className: "scrub-play",
    onClick: togglePlay,
    "aria-label": playing ? "Pause" : "Play"
  }, playing ? "❚❚" : "▶"), /*#__PURE__*/React.createElement("span", {
    className: "vc-seg scrub-speed", role: "group", "aria-label": "Playback speed"
  }, [0.5, 1].map(r => /*#__PURE__*/React.createElement("button", {
    key: r,
    className: rate === r ? "active" : "",
    "aria-pressed": rate === r,
    onClick: () => setRate(r)
  }, (r === 1 ? "1" : "\xBD") + "\xD7")))), /*#__PURE__*/React.createElement("span", {
    className: "scrub-frame", ref: labelRef
  }, "frame 0000")));
}

// ISM: circular magnifier docked to the side of the hero movie, fed by a small
// reticle ring that follows the cursor — the ring is drawn at exactly the size
// of the sampled region (dia / mag css px), so "this circle → that panel" reads
// without the magnifier ever covering the thing it magnifies.
// The movie itself is the pixel source — movie frame f == snapshot 21+f with
// the same 30 kpc FOV and orientation as the SNe export — so the lens costs no
// extra image data: it crops the playing <video> onto a canvas at `mag`× and
// overlays supernovae from the compact event list in assets/viz/ism/ (u16 x,y
// per event, sorted by fire movie-frame, sliced via a per-frame offset table).
// Dots drift with the disk via the rotation curve (dphi per `rotation_stride`
// movie frames vs radius; residual vs the true tracked positions is ~4 pc per
// slot — measured by scripts/build_sne_assets.py) and fade over cfg.fade movie
// frames. Hover-only: skipped entirely on coarse-pointer (touch) devices.
let SNE_DATA = null; // module cache — fetched once, survives area remounts
function loadSneData(base) {
  if (!SNE_DATA) {
    SNE_DATA = Promise.all([
      fetch(base + "sne_meta.json").then(r => r.json()),
      fetch(base + "rotation.json").then(r => r.json()),
      fetch(base + "sne_xy.bin").then(r => r.arrayBuffer()),
      fetch(base + "sne_offsets.bin").then(r => r.arrayBuffer())
    ]).then(([meta, rot, xy, off]) => ({
      meta, rot, xy: new Uint16Array(xy), offsets: new Uint32Array(off)
    }));
  }
  return SNE_DATA;
}
function SneLens({ area, videoRef }) {
  const cvRef = useRef(null);
  const panelRef = useRef(null);
  const retRef = useRef(null);
  const capRef = useRef(null);
  const st = useRef({ cx: 0, cy: 0, over: false, raf: 0, data: null, dia: 0 });
  useEffect(() => {
    // Fine pointers get the hover-follow lens; touch has no hover, so there the
    // lens is pin-only — a tap drops the region at that spot and it co-rotates
    // with the disk from then on (same pin path as a desktop click).
    const fine = window.matchMedia("(pointer: fine)").matches;
    const cfg = area.movieLens;
    const cv = cvRef.current;
    const panel = panelRef.current, ret = retRef.current, cap = capRef.current;
    const host = cv && cv.closest(".hero-viz-full");
    if (!host) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const maxDia = cfg.dia || 280, mag = cfg.mag || 3, fade = cfg.fade || 20;
    const ctx = cv.getContext("2d");
    const s = st.current;
    loadSneData(cfg.base).then(d => { s.data = d; });

    // Size and park the panel. It's docked rather than cursor-following, so it
    // has to fit beside the movie: shrink it on small heroes. The sampled region
    // is dia/mag, so the reticle shrinks with it and the two stay in honest
    // proportion. (Phones are narrow and the panel is the whole point there, so
    // it may take a bigger share of the width than on a wide hero.)
    //
    // Wide viewports dock it against the movie's right gutter, vertically
    // centered. Below CORNER_W there is no gutter worth using, so it goes to the
    // top-right corner, hard against the edge — where it must clear two things:
    // .arrow-r (46px, vertically centered, so a tall panel hanging from the top
    // reaches down into it) and the hero title, which is nowrap, sits in the
    // same band, and paints above the panel.
    const CORNER_W = 1150;
    const INSET = 14, TOP = 16, CAP_H = 26, ARROW_H = 33, MIN = 96;
    const setStyle = (el, k, v) => { if (el.style[k] !== v) el.style[k] = v; };
    // How far the title's *text* reaches, relative to the hero box. The <h1> is
    // a full-width flex item, so its own rect says nothing about where the words
    // end — a Range over its contents does. Cached per hero size (a re-layout is
    // the only thing that moves it).
    const titleEl = host.querySelector(".hero-title");
    const titleReach = hr => {
      if (!titleEl) return null;
      const key = Math.round(hr.width) + ":" + Math.round(hr.height);
      if (s.tKey !== key) {
        const rng = document.createRange();
        rng.selectNodeContents(titleEl);
        const r = rng.getBoundingClientRect();
        s.tKey = key;
        s.tReach = { right: r.right - hr.left, bottom: r.bottom - hr.top };
      }
      return s.tReach;
    };
    const layout = hr => {
      const base = fine
        ? Math.min(maxDia, hr.width * 0.26, hr.height * 0.55)
        : Math.min(maxDia, hr.width * 0.42, hr.height * 0.34);
      const floor = fine ? 150 : 120;
      if (window.innerWidth >= CORNER_W) {
        setStyle(panel, "top", ""); setStyle(panel, "right", ""); setStyle(panel, "transform", "");
        return Math.round(Math.max(floor, base));
      }
      // room between the top inset and the arrow, panel + caption
      let top = TOP;
      let d = Math.max(floor, Math.min(base, hr.height / 2 - ARROW_H - TOP - CAP_H));
      const t = titleReach(hr);
      if (t && hr.width - INSET - d < t.right + 12) {
        // it would run into the title: either drop below the title band or stay
        // put and narrow past the title's right edge — whichever leaves a bigger
        // panel. Both may go under `floor` (a cramped window is exactly when the
        // panel has to give); MIN is where it stops being worth showing.
        const dropTop = Math.max(TOP, t.bottom + 14);
        const dropped = Math.min(base, hr.height / 2 - ARROW_H - dropTop - CAP_H);
        const narrowed = Math.min(d, hr.width - INSET - t.right - 12);
        if (dropped >= narrowed) { top = dropTop; d = dropped; } else { d = narrowed; }
        d = Math.max(MIN, d);
      }
      setStyle(panel, "top", top + "px");
      setStyle(panel, "right", INSET + "px");
      setStyle(panel, "transform", "none");
      return Math.round(d);
    };
    const resize = d => {
      if (s.dia === d) return;
      s.dia = d;
      cv.width = cv.height = Math.round(d * dpr);
      cv.style.width = cv.style.height = d + "px";
      ret.style.width = ret.style.height = (d / mag) + "px";
    };

    // linear interpolation in the rotation table (rad per rotation_stride frames)
    const dphiAt = (r, rot) => {
      const rc = rot.r_centers_kpc, dp = rot.dphi_per_frame;
      if (r <= rc[0]) return dp[0];
      if (r >= rc[rc.length - 1]) return dp[dp.length - 1];
      let lo = 0, hi = rc.length - 1;
      while (hi - lo > 1) { const m = (lo + hi) >> 1; if (rc[m] <= r) lo = m; else hi = m; }
      const t = (r - rc[lo]) / (rc[hi] - rc[lo]);
      return dp[lo] + t * (dp[hi] - dp[lo]);
    };
    const hide = () => {
      panel.classList.remove("on", "pinned");
      ret.classList.remove("on", "pinned");
      host.classList.remove("lens-active");
    };

    const draw = () => {
      s.raf = requestAnimationFrame(draw);
      const video = videoRef.current;
      const wanted = s.pin || s.over;
      if (!wanted || !video || !video.classList.contains("show") || !video.videoWidth) { hide(); return; }
      const hr = host.getBoundingClientRect();
      const dia = layout(hr);
      resize(dia);
      // displayed movie square: object-fit contain in a scaled element — the
      // bounding rect includes the CSS transform, so the square is just the
      // centered min(w,h) region of it
      const r = video.getBoundingClientRect();
      const side = Math.min(r.width, r.height);
      const sqL = r.left + (r.width - side) / 2;
      const sqT = r.top + (r.height - side) / 2;
      let fx, fy, lx, ly;
      if (s.pin) {
        // pinned: the anchor co-rotates with the disk from its pin-time frame
        // to the current frame (rotation about the center preserves R, so the
        // stepwise integration collapses to one rotation by dphi(R)·Δslots;
        // Δ is negative when scrubbing backwards, which just rotates back)
        const d0 = s.data;
        const half = d0 ? d0.meta.extent_kpc[1] : 15;
        let xr = s.pin.x, yr = s.pin.y;
        if (d0) {
          const n = (video.currentTime - s.pin.t0) * d0.meta.fps / d0.meta.rotation_stride;
          const a = dphiAt(Math.hypot(xr, yr), d0.rot) * n;
          const ca = Math.cos(a), sa = Math.sin(a);
          const x2 = ca * xr - sa * yr, y2 = sa * xr + ca * yr;
          xr = x2; yr = y2;
        }
        fx = (xr + half) / (2 * half);
        fy = (half - yr) / (2 * half);
        lx = sqL + fx * side; ly = sqT + fy * side;
        s.pinScreen = { x: lx, y: ly };   // for the unpin hit test
      } else {
        fx = (s.cx - sqL) / side;
        fy = (s.cy - sqT) / side;
        if (fx < 0 || fx > 1 || fy < 0 || fy > 1) { hide(); return; }
        lx = s.cx; ly = s.cy;
      }
      panel.classList.add("on");
      ret.classList.add("on");
      panel.classList.toggle("pinned", !!s.pin);
      ret.classList.toggle("pinned", !!s.pin);
      // crosshair cursor only in follow mode — when pinned the mouse is free
      host.classList.toggle("lens-active", !s.pin);
      // only the reticle tracks; the panel is parked by CSS
      const rd = dia / mag;
      ret.style.transform = `translate(${lx - hr.left - rd / 2}px, ${ly - hr.top - rd / 2}px)`;

      const vw = video.videoWidth;                 // 1024
      const scx = fx * vw, scy = fy * vw;          // crop center (video px)
      const hs = (rd / 2) * (vw / side);           // crop half-side (video px)
      const scale = (dia * dpr) / (2 * hs);        // video px -> canvas px
      // caption states what the ring covers, in physical units
      const across = (rd / side) * 2 * (s.data ? s.data.meta.extent_kpc[1] : 15);
      const capTxt = mag + "\xD7 \xB7 " + across.toFixed(1) + " kpc across";
      if (cap.textContent !== capTxt) cap.textContent = capTxt;
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, cv.width, cv.height);
      // clamp the source rect to the video frame and map the intersection, so
      // a lens near the edge letterboxes in black instead of stretching
      const sx0 = Math.max(0, scx - hs), sx1 = Math.min(vw, scx + hs);
      const sy0 = Math.max(0, scy - hs), sy1 = Math.min(vw, scy + hs);
      if (sx1 > sx0 && sy1 > sy0) {
        ctx.drawImage(video, sx0, sy0, sx1 - sx0, sy1 - sy0,
          (sx0 - (scx - hs)) * scale, (sy0 - (scy - hs)) * scale,
          (sx1 - sx0) * scale, (sy1 - sy0) * scale);
      }

      const d = s.data;
      if (!d) return;
      const meta = d.meta, half = meta.extent_kpc[1];
      const f = video.currentTime * meta.fps;      // current movie frame (float)
      const g1 = Math.min(meta.movie_frames - 1, Math.floor(f));
      const g0 = Math.max(0, g1 - fade + 1);
      const R = (cfg.dot || 2.2) * dpr;            // dot radius (canvas px)
      for (let g = g0; g <= g1; g++) {
        const age = f - g;                         // movie frames since firing
        const alpha = Math.max(0, 1 - age / fade);
        if (alpha <= 0) continue;
        ctx.fillStyle = `rgba(255,221,51,${alpha.toFixed(3)})`;
        for (let i = d.offsets[g]; i < d.offsets[g + 1]; i++) {
          const x = (d.xy[2 * i] / meta.quant_max) * 2 * half - half;
          const y = (d.xy[2 * i + 1] / meta.quant_max) * 2 * half - half;
          // advance the birth position with the disk rotation
          const a = dphiAt(Math.hypot(x, y), d.rot) * (age / meta.rotation_stride);
          const ca = Math.cos(a), sa = Math.sin(a);
          const xr = ca * x - sa * y, yr = sa * x + ca * y;
          const vx = ((xr + half) / (2 * half)) * vw;  // kpc -> video px
          const vy = ((half - yr) / (2 * half)) * vw;  // (y axis flipped)
          const px = (vx - scx) * scale + cv.width / 2;
          const py = (vy - scy) * scale + cv.height / 2;
          if (px < -R || px > cv.width + R || py < -R || py > cv.height + R) continue;
          ctx.beginPath();
          ctx.arc(px, py, R, 0, 2 * Math.PI);
          ctx.fill();
        }
      }
    };

    // the panel is pointer-transparent, so the cursor can end up "inside" it;
    // freeze the sample there instead of magnifying the region behind the panel
    const overPanel = (cx, cy) => {
      if (!panel.classList.contains("on")) return false;
      const p = panel.getBoundingClientRect();
      return cx >= p.left && cx <= p.right && cy >= p.top && cy <= p.bottom;
    };
    // touch: a finger dragging the page emits pointermove, which must not be
    // read as hovering — there the lens shows only what was tapped
    const onMove = e => {
      if (!fine || e.pointerType === "touch") return;
      // over the scrub bar the lens must yield (and give the cursor back)
      if (e.target.closest && e.target.closest(".movie-scrub")) { s.over = false; return; }
      if (overPanel(e.clientX, e.clientY)) return;
      s.cx = e.clientX; s.cy = e.clientY; s.over = true;
    };
    const onLeave = () => { s.over = false; };
    // click/tap pins the sample point in the co-rotating frame — the reticle
    // then drifts with the disk while the panel keeps showing it (so it can be
    // watched while scrubbing); hitting the pinned reticle (or Esc) releases it
    const pinAt = (cx, cy, target) => {
      if (target && target.closest &&
          (target.closest(".movie-scrub") || target.closest(".arrow"))) return;
      const video = videoRef.current;
      if (!video || !video.videoWidth || !video.classList.contains("show")) return;
      if (overPanel(cx, cy)) return;
      // the ring is a small target, so touch gets a generous release radius
      const grab = Math.max(fine ? 24 : 40, s.dia / mag / 2);
      if (s.pin && s.pinScreen && Math.hypot(cx - s.pinScreen.x, cy - s.pinScreen.y) < grab) {
        s.pin = null;
        return;
      }
      const r = video.getBoundingClientRect();
      const side = Math.min(r.width, r.height);
      const fx = (cx - (r.left + (r.width - side) / 2)) / side;
      const fy = (cy - (r.top + (r.height - side) / 2)) / side;
      if (fx < 0 || fx > 1 || fy < 0 || fy > 1) return;
      const half = s.data ? s.data.meta.extent_kpc[1] : 15;
      s.pin = {
        x: fx * 2 * half - half,      // kpc at pin time
        y: half - fy * 2 * half,
        t0: video.currentTime,
      };
    };
    const onClick = e => { if (!s.touch) pinAt(e.clientX, e.clientY, e.target); };
    // Touch runs off pointerdown/up rather than click: iOS is unreliable about
    // synthesizing click on a plain <div>, and the down/up pair also lets a tap
    // be told apart from a scroll drag (moved far) or a long press.
    const onDown = e => {
      s.touch = e.pointerType === "touch";
      s.tap = s.touch ? { x: e.clientX, y: e.clientY, t: performance.now(), tgt: e.target } : null;
    };
    const onUp = e => {
      const d = s.tap;
      s.tap = null;
      if (e.pointerType !== "touch" || !d) return;
      if (performance.now() - d.t > 600) return;
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 12) return;
      pinAt(e.clientX, e.clientY, d.tgt);
    };
    const onCancel = () => { s.tap = null; };
    const onKey = e => { if (e.key === "Escape") s.pin = null; };
    host.addEventListener("pointermove", onMove);
    host.addEventListener("pointerleave", onLeave);
    host.addEventListener("click", onClick);
    host.addEventListener("pointerdown", onDown);
    host.addEventListener("pointerup", onUp);
    host.addEventListener("pointercancel", onCancel);
    window.addEventListener("keydown", onKey);
    s.raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(s.raf);
      host.removeEventListener("pointermove", onMove);
      host.removeEventListener("pointerleave", onLeave);
      host.removeEventListener("click", onClick);
      host.removeEventListener("pointerdown", onDown);
      host.removeEventListener("pointerup", onUp);
      host.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("keydown", onKey);
      host.classList.remove("lens-active");
    };
  }, [area.id]);
  // The reticle is drawn first on purpose: a pinned ring co-rotates and can
  // sweep under the panel, and with both on the same z-index the DOM order
  // decides — this way the panel stays on top of the ring, not the other way.
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    className: "sne-reticle", ref: retRef, "aria-hidden": "true"
  }), /*#__PURE__*/React.createElement("div", {
    className: "sne-lens-panel", ref: panelRef, "aria-hidden": "true"
  }, /*#__PURE__*/React.createElement("div", {
    className: "sne-lens-cap", ref: capRef
  }), /*#__PURE__*/React.createElement("canvas", {
    className: "sne-lens", ref: cvRef
  })));
}

// Magellanic: MW / LMC component visibility toggles
const MAG_COMPONENTS = [
  { key: "mw", name: "MW CGM", color: "#4da6ff" },
  { key: "lmc", name: "LMC CGM", color: "#ff8c3a" }
];
function ComponentToggles() {
  const [vis, setVis] = useState({ mw: true, lmc: true });
  const [orbits, setOrbits] = useState(true);
  const toggle = k => { const nv = { ...vis, [k]: !vis[k] }; setVis(nv); callViz("setIsoVisible", k, nv[k]); };
  const toggleOrbits = () => { const nv = !orbits; setOrbits(nv); callViz("setOrbitsVisible", nv); };
  return /*#__PURE__*/React.createElement("div", {
    className: "viz-controls viz-legend"
  }, MAG_COMPONENTS.map(c => /*#__PURE__*/React.createElement("button", {
    key: c.key,
    type: "button",
    className: "legend-item" + (vis[c.key] ? "" : " off"),
    "aria-pressed": vis[c.key],
    onClick: () => toggle(c.key)
  }, /*#__PURE__*/React.createElement("span", {
    className: "legend-dot", style: { background: c.color }
  }), /*#__PURE__*/React.createElement("span", {
    className: "legend-name"
  }, c.name))), /*#__PURE__*/React.createElement("button", {
    key: "orbits",
    type: "button",
    className: "legend-item" + (orbits ? "" : " off"),
    "aria-pressed": orbits,
    onClick: toggleOrbits
  }, /*#__PURE__*/React.createElement("span", {
    className: "legend-dot legend-line"
  }), /*#__PURE__*/React.createElement("span", {
    className: "legend-name"
  }, "Orbits")));
}

// Magellanic: snapshot time scrubber (value 0 = most recent snapshot)
function TimeBar({ timeline, preload }) {
  const snaps = timeline && timeline.snapshots;
  const [v, setV] = useState(0);
  if (!snaps || !snaps.length) return null;
  const n = snaps.length;
  const t0 = snaps[n - 1].time_gyr;
  const snapIdx = (n - 1) - v;
  const dt = snaps[snapIdx].time_gyr - t0;
  const onChange = e => { const nv = parseInt(e.target.value, 10); setV(nv); callViz("setSnapshot", (n - 1) - nv); };
  const frac = n > 1 ? v / (n - 1) : 0;
  // keep the label centered under the 14px thumb across the track
  const labelLeft = `calc(${frac} * (100% - 14px) + 7px)`;
  return /*#__PURE__*/React.createElement("div", {
    className: "viz-timebar"
  }, /*#__PURE__*/React.createElement("input", {
    type: "range", className: "time-slider", min: "0", max: String(n - 1), step: "1", value: v, onChange: onChange
  }), /*#__PURE__*/React.createElement("div", {
    className: "time-label-track"
  }, /*#__PURE__*/React.createElement("div", {
    className: "time-label", style: { left: labelLeft }
  }, dt === 0 ? "t = 0 Gyr" : `t = ${dt.toFixed(2)} Gyr`)), preload && preload.l < preload.t && /*#__PURE__*/React.createElement("div", {
    className: "time-preload"
  }, `preloading ${preload.l}/${preload.t}…`));
}

// Picks the right overlay set for the current area + a loading pill
function VizControls({ area, loading, timeline, preload }) {
  const ui = (area.viz && area.viz.controlsUI) || [];
  return /*#__PURE__*/React.createElement(React.Fragment, null,
    loading && /*#__PURE__*/React.createElement("div", { className: "viz-loading" }, "Loading visualization…"),
    ["mode", "colorbar", "field", "zoom"].some(k => ui.includes(k)) && /*#__PURE__*/React.createElement(VolumeControls, { area }),
    ui.includes("components") && /*#__PURE__*/React.createElement(ComponentToggles, null),
    ui.includes("time") && /*#__PURE__*/React.createElement(TimeBar, { timeline, preload }));
}

function App() {
  const t = TWEAKS;
  const [idx, setIdx] = useState(() => {
    const n = parseInt(localStorage.getItem("sl_area") || "0", 10);
    return Number.isFinite(n) && n >= 0 && n < AREAS.length ? n : 0;
  });
  const [dir, setDir] = useState(1);
  // false on the initial render; flips true the first time the user navigates,
  // so Home can tell a fresh load (show the movie at once) from an arrival via
  // transition (hold the movie back to reveal the model's fly to home framing).
  const navigatedRef = useRef(false);
  const [loading, setLoading] = useState(false);
  const [volumeReady, setVolumeReady] = useState(false);
  const [timeline, setTimeline] = useState(null);
  const [preload, setPreload] = useState(null);
  const area = AREAS[idx];
  const hue = resolveHue(t.accent, area.hue);
  const heroStatic = t.hero === "striped";
  // Leaving home: the hero movie fades out in place while the 3D model behind
  // it starts its fly to the target area IMMEDIATELY (pre-shown on the stage,
  // which is driven imperatively and doesn't care what page React shows) — so
  // fade and fly run together. The React page swap is deferred HOME_LEAVE_MS
  // so the movie survives long enough to dissolve; the swap's own show() is
  // then skipped as a duplicate (preShownRef), only rebinding OrbitControls to
  // the new page's .viz-hit. Navigation from any other page stays immediate;
  // extra clicks mid-fade retarget both the pending swap and the fly.
  const HOME_LEAVE_MS = 250;
  const [homeLeaving, setHomeLeaving] = useState(false);
  const idxRef = useRef(idx);
  idxRef.current = idx;
  const leaveRef = useRef(null);   // { timer, n, d } while the fade-out runs
  const preShownRef = useRef(null); // area id whose show() already ran early
  const go = useCallback((n, d) => {
    const doGo = (nn, dd) => {
      navigatedRef.current = true;
      setDir(dd);
      setIdx(cur => {
        const next = (nn + AREAS.length) % AREAS.length;
        localStorage.setItem("sl_area", String(next));
        return next;
      });
    };
    const preShow = next => {
      const t = AREAS[next];
      preShownRef.current = t.id;
      window.__slPendingArea = { id: t.id, cfg: t.viz };
      if (window.SLViz) window.SLViz.show(t.id, t.viz);
    };
    const next = (n + AREAS.length) % AREAS.length;
    if (leaveRef.current) {
      leaveRef.current.n = n;
      leaveRef.current.d = d;
      if (AREAS[next].id !== preShownRef.current) preShow(next);
      return;
    }
    if (AREAS[idxRef.current].kind === "home" && next !== idxRef.current) {
      setHomeLeaving(true);
      preShow(next);
      leaveRef.current = {
        n, d,
        timer: setTimeout(() => {
          const p = leaveRef.current;
          leaveRef.current = null;
          setHomeLeaving(false);
          doGo(p.n, p.d);
        }, HOME_LEAVE_MS)
      };
      return;
    }
    doGo(n, d);
  }, []);
  const goById = useCallback(id => {
    const n = AREAS.findIndex(a => a.id === id);
    if (n >= 0) go(n, n > idx ? 1 : -1);
    window.scrollTo({
      top: 0,
      behavior: "smooth"
    });
  }, [go, idx]);
  useEffect(() => {
    const onKey = e => {
      if (e.target.closest && e.target.closest("input,textarea,select")) return;
      if (e.key === "ArrowRight") go(idx + 1, 1);else if (e.key === "ArrowLeft") go(idx - 1, -1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [idx, go]);

  // Drive the persistent 3D stage when the area changes. __slPendingArea covers
  // the case where this fires before viz3d.js (a deferred module) has loaded.
  // If go() already pre-showed this area (leaving home: the fly starts with the
  // movie fade), don't show() again — that would restart the fly mid-flight —
  // but DO re-attach OrbitControls, which were bound to the now-unmounted
  // page's .viz-hit overlay.
  useEffect(() => {
    if (preShownRef.current === area.id) {
      preShownRef.current = null;
      callViz("rebindControls");
      return;
    }
    window.__slPendingArea = { id: area.id, cfg: area.viz };
    if (window.SLViz) window.SLViz.show(area.id, area.viz);
  }, [idx]);

  // Subscribe to viz stage events (retry until window.SLViz exists).
  useEffect(() => {
    const offs = [];
    const attach = () => {
      if (!window.SLViz) return false;
      offs.push(window.SLViz.on("loading", (id, on) => setLoading(on)));
      offs.push(window.SLViz.on("volume-ready", () => setVolumeReady(true)));
      offs.push(window.SLViz.on("iso-ready", tl => setTimeline(tl)));
      offs.push(window.SLViz.on("preload", (l, tt) => setPreload({ l, t: tt })));
      return true;
    };
    if (attach()) return () => offs.forEach(f => f && f());
    const iv = setInterval(() => { if (attach()) clearInterval(iv); }, 60);
    return () => { clearInterval(iv); offs.forEach(f => f && f()); };
  }, []);

  // The persistent canvas tracks this anchor's rect. It lives OUTSIDE the sliding
  // .stage so the 3D viz stays static while the page content slides past it.
  // Home renders an anchor too: the total-gas volume sits behind the hero movie
  // at the movie's inclination, so leaving home morphs the movie into the model.
  // ONE shared anchor height for home + areas (styles.css .viz-anchor) — a
  // per-area height made the model jump at navigation once the movie was gone.
  const vizAnchor = /*#__PURE__*/React.createElement("div", {
    className: "viz-anchor",
    "aria-hidden": "true"
  });

  // Viz controls live OUTSIDE the sliding .stage so they stay put while the page
  // content slides between research areas. The spacer drops the panels to just
  // below the (sliding) hero title.
  const vizUI = (area.viz && area.viz.controlsUI) || [];
  const vizOverlay = area.kind === "home" ? null : /*#__PURE__*/React.createElement("div", {
    className: "viz-overlay"
  }, /*#__PURE__*/React.createElement("div", {
    className: "viz-overlay-inner"
  }, /*#__PURE__*/React.createElement("div", {
    className: "viz-overlay-spacer",
    "aria-hidden": "true"
  }), ["mode", "colorbar", "field", "zoom"].some(k => vizUI.includes(k)) && /*#__PURE__*/React.createElement(VolumeControls, {
    area: area
  }), vizUI.includes("components") && /*#__PURE__*/React.createElement(ComponentToggles, null)), vizUI.includes("time") && /*#__PURE__*/React.createElement(TimeBar, {
    timeline: timeline,
    preload: preload
  }), loading && /*#__PURE__*/React.createElement("div", {
    className: "viz-loading"
  }, "Loading visualization…"));

  return /*#__PURE__*/React.createElement("div", {
    className: "site",
    "data-theme": t.theme,
    style: {
      "--hue": hue
    }
  }, /*#__PURE__*/React.createElement("header", {
    className: "topbar"
  }, /*#__PURE__*/React.createElement("a", {
    className: "brand" + (idx === 0 ? " is-home" : ""),
    href: "#top",
    onClick: e => {
      e.preventDefault();
      go(0, -1);
      window.scrollTo({
        top: 0,
        behavior: "smooth"
      });
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "brand-name"
  }, "Scott Lucchini"), /*#__PURE__*/React.createElement("span", {
    className: "brand-role"
  }, "Computational Astrophysicist")), /*#__PURE__*/React.createElement("nav", {
    className: "tabs",
    role: "tablist"
  }, AREAS.reduce((acc, a, i) => {
    if (a.kind !== "home") acc.push({
      a,
      i
    });
    return acc;
  }, []).map(({
    a,
    i
  }, num) => /*#__PURE__*/React.createElement("button", {
    key: a.id,
    role: "tab",
    "aria-selected": i === idx,
    className: "tab" + (i === idx ? " active" : ""),
    style: {
      "--thue": t.accent === "per-area" ? a.hue : hue
    },
    onClick: () => go(i, i > idx ? 1 : -1)
  }, /*#__PURE__*/React.createElement("span", {
    className: "tab-i"
  }, String(num + 1).padStart(2, "0")), /*#__PURE__*/React.createElement("span", {
    className: "tab-l"
  }, a.tab))))), /*#__PURE__*/React.createElement("main", {
    id: "top"
  }, vizAnchor, vizOverlay, /*#__PURE__*/React.createElement("div", {
    className: "stage",
    key: area.id,
    "data-dir": dir,
    "data-screen-label": area.tab
  }, area.kind === "home" ? /*#__PURE__*/React.createElement(HomePanel, {
    area: area,
    hue: hue,
    goById: goById,
    volumeReady: volumeReady,
    morphIn: navigatedRef.current,
    leaving: homeLeaving
  }) : /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("section", {
    className: "hero"
  }, /*#__PURE__*/React.createElement("div", {
    className: "hero-viz-full"
  }, /*#__PURE__*/React.createElement("div", {
    className: "viz-hit" + (area.viz && area.viz.interactive ? " on" : ""),
    "aria-hidden": "true"
  }), area.viz && area.viz.compare && /*#__PURE__*/React.createElement(CompareSlider, {
    area: area
  }), /*#__PURE__*/React.createElement("div", {
    className: "hero-grid",
    "aria-hidden": "true"
  }), area.movie && /*#__PURE__*/React.createElement(HeroMovie, {
    area: area
  }), /*#__PURE__*/React.createElement("div", {
    className: "hero-viz-scrim",
    "aria-hidden": "true"
  }), /*#__PURE__*/React.createElement("button", {
    className: "arrow arrow-l",
    onClick: () => go(idx - 1, -1),
    "aria-label": "Previous area"
  }, /*#__PURE__*/React.createElement("svg", {
    viewBox: "0 0 24 24",
    width: "22",
    height: "22"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M15 5l-7 7 7 7",
    stroke: "currentColor",
    strokeWidth: "1.8",
    fill: "none",
    strokeLinecap: "round",
    strokeLinejoin: "round"
  }))), /*#__PURE__*/React.createElement("button", {
    className: "arrow arrow-r",
    onClick: () => go(idx + 1, 1),
    "aria-label": "Next area"
  }, /*#__PURE__*/React.createElement("svg", {
    viewBox: "0 0 24 24",
    width: "22",
    height: "22"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M9 5l7 7-7 7",
    stroke: "currentColor",
    strokeWidth: "1.8",
    fill: "none",
    strokeLinecap: "round",
    strokeLinejoin: "round"
  }))), /*#__PURE__*/React.createElement("div", {
    className: "hero-overlay"
  }, /*#__PURE__*/React.createElement("div", {
    className: "hero-overlay-inner"
  }, /*#__PURE__*/React.createElement("h1", {
    className: "hero-title"
  }, area.title))), area.viz && area.viz.interactive && /*#__PURE__*/React.createElement(TouchGestureHint, {
    area: area
  })), area.lede && /*#__PURE__*/React.createElement("div", {
    className: "hero-foot"
  }, /*#__PURE__*/React.createElement("p", {
    className: "hero-lede"
  }, area.lede))), /*#__PURE__*/React.createElement(AreaContent, {
    area: area,
    hue: hue
  })))), /*#__PURE__*/React.createElement("footer", {
    className: "foot"
  }, /*#__PURE__*/React.createElement("span", null, "\xA9 ", new Date().getFullYear(), " Scott Lucchini"), /*#__PURE__*/React.createElement("span", {
    className: "foot-dots"
  }, AREAS.map((a, i) => /*#__PURE__*/React.createElement("button", {
    key: a.id,
    className: "fdot" + (i === idx ? " on" : ""),
    onClick: () => go(i, i > idx ? 1 : -1),
    "aria-label": a.tab
  }))), /*#__PURE__*/React.createElement("span", {
    className: "foot-hint"
  }, "\u2190 / \u2192 to navigate")));
}
ReactDOM.createRoot(document.getElementById("root")).render(/*#__PURE__*/React.createElement(App, null));

})();
