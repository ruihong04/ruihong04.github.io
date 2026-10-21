import { ParticleHero } from './hero/ParticleHero.js';
import { GlobalClickFireworks } from './GlobalClickFireworks.js';
import { addFrameTask, wakeFrameLoop } from './frameLoop.js';

// Particles are fully faded at uScroll = 1.05.
const HERO_FADE_END = 1.06;
const POINTER_ACTIVE_SCROLL = 1.04;

const coarsePointerMedia = window.matchMedia('(pointer: coarse)');

// compact: narrow layout. lightweight: smaller grid and pixel ratio, also on any touch device.
function readDeviceProfile(width, config) {
  const compact = width <= config.viewport.mobileBreakpoint;
  const lightweight = compact || coarsePointerMedia.matches;
  return {
    compact,
    lightweight,
    maxDpr: lightweight ? config.quality.maxDprLightweight : config.quality.maxDpr,
  };
}

class FrameBudget {
  constructor(quality) {
    this.quality = quality;
    this.reset();
  }

  reset() {
    this.samples = [];
    this.warmup = this.quality.warmupFrames;
  }

  // Returns true when the median frame time of a full window is over budget.
  record(delta) {
    if (this.warmup > 0) {
      this.warmup -= 1;
      return false;
    }

    this.samples.push(delta);
    if (this.samples.length < this.quality.sampleFrames) return false;

    const sorted = this.samples.sort((a, b) => a - b);
    const median = sorted[sorted.length >> 1];
    this.samples = [];
    return median * 1000 > this.quality.slowFrameMs;
  }
}

function bindHeroPointer({ hero, canvas, getScroll }) {
  function isOverVisibleHero(event) {
    const rect = canvas.getBoundingClientRect();
    const withinBounds =
      event.clientX >= rect.left &&
      event.clientX <= rect.right &&
      event.clientY >= rect.top &&
      event.clientY <= rect.bottom;

    return withinBounds && rect.bottom > 0 && rect.top < window.innerHeight && getScroll() < POINTER_ACTIVE_SCROLL;
  }

  function handleMove(event) {
    if (isOverVisibleHero(event)) {
      hero.handlePointerMove(event);
    } else {
      hero.handlePointerLeave();
    }
  }

  function handleDown(event) {
    if (event.pointerType === 'mouse' || !isOverVisibleHero(event)) return;
    hero.handlePointerDown(event);
    wakeFrameLoop();
  }

  function handleRelease(event) {
    if (event.pointerType === 'mouse') return;
    hero.handlePointerLeave();
  }

  const leave = () => hero.handlePointerLeave();

  window.addEventListener('pointermove', handleMove, { passive: true });
  window.addEventListener('pointerdown', handleDown, { passive: true });
  window.addEventListener('pointerup', handleRelease, { passive: true });
  window.addEventListener('pointercancel', handleRelease, { passive: true });
  document.documentElement.addEventListener('pointerleave', leave, { passive: true });
  window.addEventListener('blur', leave);
}

export async function startEffects({ canvas, config, getScroll }) {
  const hero = new ParticleHero({ canvas, config });
  const budget = new FrameBudget(config.quality);

  let dprCap = Infinity;
  let heroInView = true;
  let heroSize = '';

  function readHeroViewport() {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const profile = readDeviceProfile(width, config);
    return {
      width,
      height,
      dpr: Math.min(window.devicePixelRatio, profile.maxDpr, dprCap),
      compact: profile.compact,
      lightweight: profile.lightweight,
    };
  }

  const initialViewport = readHeroViewport();
  await hero.init(initialViewport);
  heroSize = JSON.stringify(initialViewport);

  function syncHeroSize() {
    const viewport = readHeroViewport();
    const size = JSON.stringify(viewport);
    if (size === heroSize) return;
    heroSize = size;
    hero.resize(viewport);
    budget.reset();
    wakeFrameLoop();
  }

  function lowerResolution() {
    const currentDpr = readHeroViewport().dpr;
    if (currentDpr <= config.quality.minDpr) return;
    dprCap = Math.max(config.quality.minDpr, currentDpr - config.quality.dprStep);
    syncHeroSize();
  }

  const fireworks = new GlobalClickFireworks();
  let fireworksSize = '';

  function syncFireworksSize() {
    const width = fireworks.canvas.clientWidth;
    const viewport = {
      width,
      height: fireworks.canvas.clientHeight,
      dpr: Math.min(window.devicePixelRatio, readDeviceProfile(width, config).maxDpr),
      lightweight: readDeviceProfile(width, config).lightweight,
    };
    const size = JSON.stringify(viewport);
    if (size === fireworksSize) return;
    fireworksSize = size;
    fireworks.resize(viewport);
  }

  syncFireworksSize();

  function isHeroActive() {
    return heroInView && getScroll() < HERO_FADE_END;
  }

  // A layer that isn't drawing applies resizes the next time it draws.
  let heroSizeDirty = false;
  let fireworksSizeDirty = false;

  function handleResize() {
    heroSizeDirty = true;
    fireworksSizeDirty = true;
    if (isHeroActive()) flushHeroSize();
    if (fireworks.isActive) flushFireworksSize();
  }

  function flushHeroSize() {
    if (!heroSizeDirty) return;
    heroSizeDirty = false;
    syncHeroSize();
  }

  function flushFireworksSize() {
    if (!fireworksSizeDirty) return;
    fireworksSizeDirty = false;
    syncFireworksSize();
  }

  const resizeObserver = new ResizeObserver(handleResize);
  resizeObserver.observe(canvas);
  resizeObserver.observe(fireworks.canvas);
  // Pixel-ratio changes don't resize elements.
  window.addEventListener('resize', handleResize);

  new IntersectionObserver(([entry]) => {
    heroInView = entry.isIntersecting;
    wakeFrameLoop();
  }).observe(canvas);

  bindHeroPointer({ hero, canvas, getScroll });

  window.addEventListener(
    'click',
    (event) => {
      flushFireworksSize();
      fireworks.trigger(event);
      wakeFrameLoop();
    },
    { passive: true }
  );

  addFrameTask((delta, now) => {
    if (!isHeroActive()) {
      budget.reset();
      return false;
    }

    flushHeroSize();
    hero.render({
      delta,
      elapsed: now / 1000,
      scroll: getScroll(),
    });

    if (budget.record(delta)) {
      lowerResolution();
    }

    return true;
  });

  addFrameTask((delta) => {
    if (!fireworks.isActive) return false;
    fireworks.render({ delta });
    return fireworks.isActive;
  });

  canvas.classList.add('is-ready');

  window.__RUIHONG_HERO__ = hero;
  window.__RUIHONG_HERO_CONFIG__ = config;

  return {
    setTheme(nextTheme) {
      hero.setTheme(nextTheme);
      fireworks.setTheme(nextTheme);
    },
    setReducedMotion(nextReducedMotion) {
      hero.setReducedMotion(nextReducedMotion);
      fireworks.setReducedMotion(nextReducedMotion);
    },
  };
}
