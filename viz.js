(function () {
// viz.jsx — animated hero placeholder canvas + figure/movie/interactive placeholders.
const {
  useRef,
  useEffect
} = React;

// ── Hero canvas: three distinct drifting-particle "modes", tinted by area hue ──
function HeroViz({
  hue,
  kind,
  motion = "moderate",
  paused = false
}) {
  const ref = useRef(null);
  const raf = useRef(0);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    let W = 0,
      H = 0,
      dpr = Math.min(window.devicePixelRatio || 1, 2);
    function resize() {
      const r = canvas.getBoundingClientRect();
      W = r.width;
      H = r.height;
      canvas.width = W * dpr;
      canvas.height = H * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    const N = motion === "minimal" ? 70 : 150;
    const rand = (a, b) => a + Math.random() * (b - a);
    const accent = (l, c, a) => `oklch(${l} ${c} ${hue} / ${a})`;

    // particle pool
    let P = [];
    function seed() {
      P = [];
      for (let i = 0; i < N; i++) {
        if (kind === "stream") {
          // particles flow along a sweeping arc (the "stream")
          P.push({
            t: Math.random(),
            off: rand(-0.16, 0.16),
            s: rand(0.2, 1),
            v: rand(0.02, 0.06)
          });
        } else if (kind === "halo") {
          // diffuse cloud orbiting a center
          const ang = rand(0, Math.PI * 2),
            rr = Math.pow(Math.random(), 0.6);
          P.push({
            ang,
            rr,
            s: rand(0.2, 1),
            v: rand(0.0006, 0.0028) * (Math.random() < 0.5 ? 1 : -1)
          });
        } else {
          // filament network: points drifting slowly, connected by nearby links
          P.push({
            x: Math.random(),
            y: Math.random(),
            s: rand(0.2, 1),
            vx: rand(-0.0006, 0.0006),
            vy: rand(-0.0006, 0.0006)
          });
        }
      }
    }
    seed();
    let tg = 0;
    const speed = motion === "minimal" ? 0.4 : motion === "lots" ? 1.25 : 0.8;
    function streamPath(t) {
      // parametric arc across the canvas
      const x = (0.08 + 0.84 * t) * W;
      const y = (0.62 - 0.34 * Math.sin(t * Math.PI * 0.92) - 0.12 * t) * H;
      return {
        x,
        y
      };
    }
    function frame() {
      tg += 0.016 * speed;
      ctx.clearRect(0, 0, W, H);
      if (kind === "stream") {
        // faint guide arc
        ctx.lineWidth = 1;
        for (let g = -1; g <= 1; g++) {
          ctx.beginPath();
          for (let t = 0; t <= 1.001; t += 0.02) {
            const p = streamPath(t);
            const yo = p.y + g * 0.1 * H * (0.3 + t);
            t === 0 ? ctx.moveTo(p.x, yo) : ctx.lineTo(p.x, yo);
          }
          ctx.strokeStyle = accent(0.8, 0.12, 0.05);
          ctx.stroke();
        }
        for (const p of P) {
          if (!paused) p.t += p.v * 0.06 * speed;
          if (p.t > 1) p.t -= 1;
          const base = streamPath(p.t);
          const spread = 0.1 * H * (0.3 + p.t);
          const x = base.x;
          const y = base.y + p.off / 0.16 * spread + Math.sin(tg + p.t * 9) * 4;
          const r = p.s * 1.9 + 0.4;
          const a = 0.15 + 0.6 * p.s * (1 - Math.abs(p.off) / 0.18);
          ctx.beginPath();
          ctx.arc(x, y, r, 0, Math.PI * 2);
          ctx.fillStyle = accent(0.86, 0.13, a);
          ctx.fill();
        }
      } else if (kind === "halo") {
        const cx = W * 0.5,
          cy = H * 0.52,
          R = Math.min(W, H) * 0.42;
        // soft glow rings
        for (let k = 3; k >= 1; k--) {
          ctx.beginPath();
          ctx.arc(cx, cy, R * (k / 3), 0, Math.PI * 2);
          ctx.strokeStyle = accent(0.8, 0.1, 0.04 * k);
          ctx.lineWidth = 1;
          ctx.stroke();
        }
        for (const p of P) {
          if (!paused) p.ang += p.v * speed;
          const rr = p.rr * R;
          const wob = Math.sin(tg * 0.6 + p.ang * 3) * 6;
          const x = cx + Math.cos(p.ang) * (rr + wob);
          const y = cy + Math.sin(p.ang) * (rr + wob) * 0.78;
          const r = p.s * 1.8 + 0.4;
          const a = 0.12 + 0.5 * (1 - p.rr) * p.s;
          ctx.beginPath();
          ctx.arc(x, y, r, 0, Math.PI * 2);
          ctx.fillStyle = accent(0.85, 0.13, a);
          ctx.fill();
        }
      } else {
        // filament network
        const pts = P.map(p => {
          if (!paused) {
            p.x += p.vx * speed;
            p.y += p.vy * speed;
          }
          if (p.x < 0 || p.x > 1) p.vx *= -1;
          if (p.y < 0 || p.y > 1) p.vy *= -1;
          return {
            x: p.x * W,
            y: p.y * H,
            s: p.s
          };
        });
        const maxD = Math.min(W, H) * 0.18;
        ctx.lineWidth = 1;
        for (let i = 0; i < pts.length; i++) {
          for (let j = i + 1; j < pts.length; j++) {
            const dx = pts[i].x - pts[j].x,
              dy = pts[i].y - pts[j].y;
            const d = Math.hypot(dx, dy);
            if (d < maxD) {
              ctx.beginPath();
              ctx.moveTo(pts[i].x, pts[i].y);
              ctx.lineTo(pts[j].x, pts[j].y);
              ctx.strokeStyle = accent(0.8, 0.12, 0.18 * (1 - d / maxD));
              ctx.stroke();
            }
          }
        }
        for (const p of pts) {
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.s * 1.7 + 0.5, 0, Math.PI * 2);
          ctx.fillStyle = accent(0.86, 0.13, 0.35 + 0.4 * p.s);
          ctx.fill();
        }
      }
      raf.current = requestAnimationFrame(frame);
    }
    raf.current = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf.current);
      ro.disconnect();
    };
  }, [hue, kind, motion, paused]);
  return /*#__PURE__*/React.createElement("canvas", {
    ref: ref,
    className: "hero-canvas"
  });
}

// ── Figure slot: a real image when `src` is given, otherwise a striped
// placeholder standing in for a figure / movie / interactive not yet added ──
function Placeholder({
  kind = "image",
  caption,
  hue,
  mono = "FIGURE",
  tall = false,
  src
}) {
  const isMovie = kind === "movie";
  const isInteractive = kind === "interactive";
  const label = isMovie ? "MOVIE" : isInteractive ? "INTERACTIVE" : mono;
  return /*#__PURE__*/React.createElement("div", {
    className: "ph " + (tall ? "ph-tall " : "") + kind,
    style: {
      "--phue": hue
    }
  }, src ? /*#__PURE__*/React.createElement("img", {
    className: "ph-img", src: src, alt: caption || "", loading: "lazy", decoding: "async"
  }) : /*#__PURE__*/React.createElement("div", {
    className: "ph-stripe"
  }, (isMovie || isInteractive) && /*#__PURE__*/React.createElement("div", {
    className: "ph-play",
    "aria-hidden": "true"
  }, /*#__PURE__*/React.createElement("svg", {
    viewBox: "0 0 24 24",
    width: "20",
    height: "20"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M8 5v14l11-7z",
    fill: "currentColor"
  }))), /*#__PURE__*/React.createElement("span", {
    className: "ph-tag"
  }, label)), caption && /*#__PURE__*/React.createElement("div", {
    className: "ph-cap"
  }, caption));
}
Object.assign(window, {
  HeroViz,
  Placeholder
});

})();
