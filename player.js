function padTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.floor(seconds % 60);
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function initPlayer(root) {
  const audio = root.querySelector("[data-audio]");
  const playButton = root.querySelector("[data-play]");
  const playText = root.querySelector("[data-play-text]");
  const seek = root.querySelector("[data-seek]");
  const current = root.querySelector("[data-current]");
  const duration = root.querySelector("[data-duration]");
  const volume = root.querySelector("[data-volume]");
  const snowCanvas = document.querySelector("[data-snow]");

  if (!audio || !playButton || !seek || !current || !duration || !volume) return;

  // Configure chorus windows (seconds) for petal bloom.
  // Set these to your track's chorus start/end times.
  const chorusStarts = [90, 136, 180];
  const chorusDurationSeconds = 22;
  const chorusWindows = chorusStarts.map((start) => [start, start + chorusDurationSeconds]);

  // Canvas snow system (fast + smooth; starts/stops without stutter)
  const snow = {
    rafId: null,
    running: false,
    lastTs: 0,
    target: 0,
    intensity: 0,
    spawnAcc: 0,
    flakes: [],
  };

  function isInChorus(timeSeconds) {
    for (const [start, end] of chorusWindows) {
      if (timeSeconds >= start && timeSeconds <= end) return true;
    }
    return false;
  }

  function resizeSnowCanvas() {
    if (!snowCanvas) return;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.floor(snowCanvas.clientWidth));
    const h = Math.max(1, Math.floor(snowCanvas.clientHeight));

    const targetW = Math.floor(w * dpr);
    const targetH = Math.floor(h * dpr);
    if (snowCanvas.width !== targetW || snowCanvas.height !== targetH) {
      snowCanvas.width = targetW;
      snowCanvas.height = targetH;
    }
  }

  function rand(min, max) {
    return min + Math.random() * (max - min);
  }

  function spawnFlake(ctxW, ctxH) {
    // small count + simple circles = smooth
    const radius = rand(0.8, 2.2);
    return {
      x: rand(0, ctxW),
      y: rand(-20, -2),
      r: radius,
      vy: rand(26, 62) * (1.2 - radius / 2.4),
      vx: rand(-10, 10),
      wobble: rand(0.8, 2.2),
      phase: rand(0, Math.PI * 2),
      alpha: rand(0.35, 0.95),
      twinkle: rand(0.6, 1.4),
    };
  }

  function stopSnowIfIdle() {
    if (!snowCanvas) return;
    if (snow.intensity > 0.02) return;
    if (snow.flakes.length > 0) return;
    if (!snow.running) return;
    if (snow.rafId != null) {
      cancelAnimationFrame(snow.rafId);
      snow.rafId = null;
    }
    snow.running = false;
    snowCanvas.dataset.active = "false";
  }

  function snowFrame(ts) {
    if (!snowCanvas) return;
    const ctx = snowCanvas.getContext("2d");
    if (!ctx) return;

    resizeSnowCanvas();

    const dpr = window.devicePixelRatio || 1;
    const w = snowCanvas.width;
    const h = snowCanvas.height;

    const dt = Math.min(0.05, Math.max(0.001, (ts - (snow.lastTs || ts)) / 1000));
    snow.lastTs = ts;

    // Smooth easing of intensity (no jumps)
    const ease = 1 - Math.exp(-dt * 4.2);
    snow.intensity += (snow.target - snow.intensity) * ease;

    // Spawn rate scales with intensity
    const spawnPerSecond = 34; // tuned for smoothness/perf
    snow.spawnAcc += snow.intensity * spawnPerSecond * dt;

    const maxFlakes = 160;
    while (snow.spawnAcc >= 1 && snow.flakes.length < maxFlakes) {
      snow.flakes.push(spawnFlake(w, h));
      snow.spawnAcc -= 1;
    }

    ctx.clearRect(0, 0, w, h);
    ctx.save();
    ctx.scale(1, 1);

    // Draw
    for (let i = snow.flakes.length - 1; i >= 0; i--) {
      const f = snow.flakes[i];
      const wob = Math.sin((ts / 1000) * f.wobble + f.phase) * 0.8;
      f.x += (f.vx + wob) * dt * dpr;
      f.y += f.vy * dt * dpr;

      // wrap horizontally a bit
      if (f.x < -30) f.x = w + 30;
      if (f.x > w + 30) f.x = -30;

      // remove when below screen
      if (f.y > h + 30) {
        snow.flakes.splice(i, 1);
        continue;
      }

      // Fade flakes with intensity so stop is smooth
      const fade = 0.15 + 0.85 * snow.intensity;
      const tw = 0.75 + 0.25 * Math.sin((ts / 1000) * f.twinkle + f.phase);
      const a = f.alpha * fade * tw;
      ctx.beginPath();
      ctx.fillStyle = `rgba(255, 255, 255, ${a.toFixed(4)})`;
      ctx.arc(f.x, f.y, f.r * dpr, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();

    // Keep running while active or flakes exist
    if (snow.intensity > 0.02 || snow.flakes.length > 0) {
      snow.rafId = requestAnimationFrame(snowFrame);
    } else {
      snow.running = false;
      snow.rafId = null;
      snowCanvas.dataset.active = "false";
    }
  }

  function setSnowActive(shouldBeActive) {
    if (!snowCanvas) return;
    snow.target = shouldBeActive ? 1 : 0;
    snowCanvas.dataset.active = shouldBeActive ? "true" : "false";

    if (!snow.running) {
      snow.running = true;
      snow.lastTs = 0;
      snow.rafId = requestAnimationFrame(snowFrame);
    }

    if (!shouldBeActive) {
      // If already idle, stop quickly; otherwise easing will handle it.
      stopSnowIfIdle();
    }
  }

  function setPlayingUI(isPlaying) {
    playButton.dataset.state = isPlaying ? "playing" : "paused";
    playButton.setAttribute(
      "aria-label",
      isPlaying ? "Pause / 一時停止" : "Play / 再生"
    );
    if (playText) playText.textContent = isPlaying ? "Pause / 一時停止" : "Play / 再生";
  }

  function syncTimeUI() {
    current.textContent = padTime(audio.currentTime);

    const dur = audio.duration;
    duration.textContent = padTime(dur);

    if (Number.isFinite(dur) && dur > 0) {
      const pct = (audio.currentTime / dur) * 100;
      seek.value = String(clamp(pct, 0, 100));
    } else {
      seek.value = "0";
    }
  }

  audio.addEventListener("loadedmetadata", syncTimeUI);
  audio.addEventListener("timeupdate", syncTimeUI);
  audio.addEventListener("timeupdate", () => {
    if (!chorusWindows.length) {
      setSnowActive(false);
      return;
    }
    setSnowActive(isInChorus(audio.currentTime));
  });
  audio.addEventListener("ended", () => {
    setPlayingUI(false);
    setSnowActive(false);
    syncTimeUI();
  });

  audio.addEventListener("play", () => setPlayingUI(true));
  audio.addEventListener("pause", () => setPlayingUI(false));
  audio.addEventListener("pause", () => setSnowActive(false));

  playButton.addEventListener("click", async () => {
    if (audio.paused) {
      try {
        await audio.play();
      } catch {
        // Autoplay or user gesture restrictions; ignore.
      }
    } else {
      audio.pause();
    }
  });

  seek.addEventListener("input", () => {
    const dur = audio.duration;
    if (!Number.isFinite(dur) || dur <= 0) return;
    const pct = Number(seek.value) / 100;
    audio.currentTime = clamp(pct * dur, 0, dur);
    syncTimeUI();
  });

  volume.addEventListener("input", () => {
    audio.volume = clamp(Number(volume.value), 0, 1);
  });

  audio.volume = clamp(Number(volume.value), 0, 1);
  setPlayingUI(false);
  syncTimeUI();
}

document.addEventListener("DOMContentLoaded", () => {
  const root = document.querySelector("[data-player]");
  if (root) initPlayer(root);
});
