/*
 * ODEN screencast player — plays a timeline JSON deterministically:
 *   shots    [{src, from, to}]                screenshot layers (crossfade)
 *   cursor   [{t, x, y, click?}]              eased keyframe path + click pulse
 *   captions [{t0, t1, x, y, text, n?}]       timed text boxes (n = step badge)
 *
 * Two modes:
 *   player.html?topic=<name>            interactive (autoplay + scrub)
 *   player.html?topic=<name>&capture=1  frame-stepping for capture.mjs via
 *                                       window.__seek(ms) / window.__duration
 */
(async function () {
  const params = new URLSearchParams(location.search);
  const topic = params.get("topic") || "installation";
  const capture = params.get("capture") === "1";
  if (capture) document.body.classList.add("capture");

  const tl = await (await fetch(`timelines/${topic}.json`)).json();
  const stage = document.getElementById("stage");
  const shotsEl = document.getElementById("shots");
  const capsEl = document.getElementById("captions");
  const cursorEl = document.getElementById("cursor");
  const pulseEl = document.getElementById("pulse");
  const playBtn = document.getElementById("playpause");
  const scrub = document.getElementById("scrub");
  const timeEl = document.getElementById("time");

  // Preload shots (decode before first render so capture never sees a blank).
  const shotImgs = tl.shots.map((s) => {
    const img = document.createElement("img");
    img.src = `assets/${topic}/${s.src}`;
    shotsEl.appendChild(img);
    return img;
  });
  await Promise.all(shotImgs.map((i) => i.decode().catch(() => {})));

  const capEls = tl.captions.map((c) => {
    const d = document.createElement("div");
    d.className = "caption";
    d.style.left = c.x + "px";
    d.style.top = c.y + "px";
    if (c.w) d.style.maxWidth = c.w + "px";
    d.innerHTML = (c.n ? `<span class="n">${c.n}</span>` : "") + c.text;
    capsEl.appendChild(d);
    return d;
  });

  const DUR = tl.duration;
  const ease = (u) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2);

  function cursorAt(t) {
    const k = tl.cursor;
    if (!k.length) return { x: -100, y: -100 };
    if (t <= k[0].t) return k[0];
    for (let i = 0; i < k.length - 1; i++) {
      if (t >= k[i].t && t <= k[i + 1].t) {
        const u = ease((t - k[i].t) / Math.max(1, k[i + 1].t - k[i].t));
        return { x: k[i].x + (k[i + 1].x - k[i].x) * u, y: k[i].y + (k[i + 1].y - k[i].y) * u };
      }
    }
    return k[k.length - 1];
  }

  let lastClickShown = -1;
  function render(t) {
    // shots
    tl.shots.forEach((s, i) => shotImgs[i].classList.toggle("active", t >= s.from && t < s.to));
    // captions
    tl.captions.forEach((c, i) => capEls[i].classList.toggle("on", t >= c.t0 && t < c.t1));
    // cursor
    const p = cursorAt(t);
    cursorEl.style.left = p.x + "px";
    cursorEl.style.top = p.y + "px";
    // click pulses: retrigger when we pass a click keyframe (forward only)
    for (const k of tl.cursor) {
      if (k.click && t >= k.t && t < k.t + 600 && lastClickShown !== k.t) {
        lastClickShown = k.t;
        pulseEl.style.left = k.x + 8 + "px";
        pulseEl.style.top = k.y + 4 + "px";
        pulseEl.classList.remove("on");
        void pulseEl.offsetWidth; // restart the animation
        pulseEl.classList.add("on");
      }
    }
    scrub.value = String(Math.round((t / DUR) * 1000));
    timeEl.textContent = `${(t / 1000).toFixed(1)}s / ${(DUR / 1000).toFixed(0)}s`;
  }

  // Capture API — deterministic frame stepping.
  window.__duration = DUR;
  window.__seek = (t) => {
    lastClickShown = -1;
    // In capture mode transitions must be instantaneous per frame.
    render(Math.min(t, DUR));
  };
  if (capture) {
    document.querySelectorAll("#shots img, .caption").forEach((el) => (el.style.transition = "none"));
    render(0);
    window.__ready = true;
    return;
  }

  // Interactive: autoplay with pause + scrub.
  let playing = true;
  let t0 = performance.now();
  let offset = 0;
  function loop(now) {
    if (playing) {
      let t = offset + (now - t0);
      if (t >= DUR) {
        t = DUR;
        playing = false;
        playBtn.textContent = "▶";
      }
      render(t);
    }
    requestAnimationFrame(loop);
  }
  playBtn.onclick = () => {
    if (playing) {
      offset = offset + (performance.now() - t0);
      playing = false;
      playBtn.textContent = "▶";
    } else {
      if (offset >= DUR) offset = 0;
      t0 = performance.now();
      playing = true;
      playBtn.textContent = "⏸";
    }
  };
  scrub.oninput = () => {
    offset = (Number(scrub.value) / 1000) * DUR;
    t0 = performance.now();
    lastClickShown = -1;
    render(offset);
  };
  requestAnimationFrame(loop);
})();
