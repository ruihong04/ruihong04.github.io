import { createHeroConfig } from './hero/config.js';
import { ParticleHero } from './hero/ParticleHero.js';
import { GlobalClickFireworks } from './GlobalClickFireworks.js';

const root = document.documentElement;
const canvas = document.getElementById('scene-canvas');
const reducedMotionMedia = window.matchMedia('(prefers-reduced-motion: reduce)');

const heroConfig = createHeroConfig();
const mobileBreakpoint = heroConfig.viewport.mobileBreakpoint;

const state = {
  width: window.innerWidth,
  height: window.innerHeight,
  isMobile: window.innerWidth <= mobileBreakpoint,
  dpr: 1,
  reducedMotion: reducedMotionMedia.matches,
  scroll: 0,
  scrollTarget: 0,
};

const hero = new ParticleHero({
  canvas,
  config: heroConfig,
});
const fireworks = new GlobalClickFireworks();

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function lerp(start, end, alpha) {
  return start + (end - start) * alpha;
}

function updateViewport() {
  state.width = window.innerWidth;
  state.height = window.innerHeight;
  state.isMobile = window.innerWidth <= mobileBreakpoint;
  state.dpr = Math.min(window.devicePixelRatio || 1, state.isMobile ? 1.35 : 1.8);

  hero.resize({
    width: state.width,
    height: state.height,
    dpr: state.dpr,
    isMobile: state.isMobile,
  });

  fireworks.resize({
    width: state.width,
    height: state.height,
    dpr: state.dpr,
  });
}

function updateScrollTarget() {
  const rangeFactor = state.isMobile ? heroConfig.scroll.rangeMobile : heroConfig.scroll.rangeDesktop;
  const scrollRange = Math.max(window.innerHeight * rangeFactor, 1);
  state.scrollTarget = clamp(window.scrollY / scrollRange, 0, 1.16);
}

function bindScrollButtons() {
  document.querySelectorAll('[data-scroll-target]').forEach((button) => {
    button.addEventListener('click', () => {
      const targetSelector = button.getAttribute('data-scroll-target');
      const target = targetSelector ? document.querySelector(targetSelector) : null;
      if (!target) return;
      target.scrollIntoView({ behavior: state.reducedMotion ? 'auto' : 'smooth', block: 'start' });
    });
  });
}

function bindReveals() {
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target);
      });
    },
    { threshold: 0.14 }
  );

  document.querySelectorAll('.reveal').forEach((element) => observer.observe(element));
}

function bindHeroPointer() {
  function updatePointerState(event) {
    const rect = canvas.getBoundingClientRect();
    const withinBounds =
      event.clientX >= rect.left &&
      event.clientX <= rect.right &&
      event.clientY >= rect.top &&
      event.clientY <= rect.bottom;

    const heroVisible = rect.bottom > 0 && rect.top < window.innerHeight && state.scrollTarget < 1.04;

    if (withinBounds && heroVisible) {
      hero.handlePointerMove(event);
    } else {
      hero.handlePointerLeave();
    }
  }

  window.addEventListener('pointermove', updatePointerState, { passive: true });
  window.addEventListener('pointerleave', () => hero.handlePointerLeave(), { passive: true });
  window.addEventListener('blur', () => hero.handlePointerLeave());
}

function bindGlobalClickFireworks() {
  window.addEventListener(
    'click',
    (event) => {
      fireworks.trigger(event);
    },
    { passive: true }
  );
}

const ABSTRACT_PREVIEW_LINES = 4;
const ABSTRACT_COLLAPSED_SUFFIX = '...';
const ABSTRACT_EXPANDED_SUFFIX = '';
const ABSTRACT_TOGGLE_GAP = '    ';

const abstractStates = new WeakMap();
let abstractMeasureNode = null;
let abstractResizeFrame = null;

function normalizeAbstractText(text) {
  return text.replace(/\s+/g, ' ').trim();
}

function resolveLineHeight(reference) {
  const styles = window.getComputedStyle(reference);
  const lineHeight = Number.parseFloat(styles.lineHeight);
  if (Number.isFinite(lineHeight)) {
    return lineHeight;
  }

  return Number.parseFloat(styles.fontSize) * 1.2;
}

function getAbstractMeasureNode(reference) {
  if (!abstractMeasureNode) {
    abstractMeasureNode = document.createElement('div');
    abstractMeasureNode.style.position = 'absolute';
    abstractMeasureNode.style.visibility = 'hidden';
    abstractMeasureNode.style.pointerEvents = 'none';
    abstractMeasureNode.style.zIndex = '-1';
    abstractMeasureNode.style.left = '-9999px';
    abstractMeasureNode.style.top = '0';
    document.body.appendChild(abstractMeasureNode);
  }

  const styles = window.getComputedStyle(reference);
  abstractMeasureNode.style.font = styles.font;
  abstractMeasureNode.style.fontFamily = styles.fontFamily;
  abstractMeasureNode.style.fontSize = styles.fontSize;
  abstractMeasureNode.style.fontWeight = styles.fontWeight;
  abstractMeasureNode.style.fontStyle = styles.fontStyle;
  abstractMeasureNode.style.letterSpacing = styles.letterSpacing;
  abstractMeasureNode.style.lineHeight = styles.lineHeight;
  abstractMeasureNode.style.textTransform = styles.textTransform;

  return abstractMeasureNode;
}

function measureInlineTextWidth(reference, text) {
  const measureNode = getAbstractMeasureNode(reference);
  measureNode.style.width = 'auto';
  measureNode.style.whiteSpace = 'pre';
  measureNode.textContent = text;
  return measureNode.getBoundingClientRect().width;
}

function getTailWidth(state, suffixText, toggleLabel) {
  return (
    measureInlineTextWidth(state.copy, suffixText) +
    measureInlineTextWidth(state.copy, ABSTRACT_TOGGLE_GAP) +
    measureInlineTextWidth(state.button, toggleLabel)
  );
}

function normalizeLineSlice(text) {
  return text.replace(/^\s+/g, '').replace(/\s+$/g, '');
}

function getRemainingText(state, startIndex) {
  return state.characters.slice(startIndex).join('').replace(/^\s+/g, '');
}

function skipWrapSpaces(state, index) {
  let nextIndex = index;

  while (nextIndex < state.characters.length && state.characters[nextIndex] === ' ') {
    nextIndex += 1;
  }

  return nextIndex;
}

function findLineEnd(state, startIndex, maxWidth) {
  const start = skipWrapSpaces(state, startIndex);
  if (start >= state.characters.length) {
    return start;
  }

  let low = start;
  let high = state.characters.length;

  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    const candidate = normalizeLineSlice(state.characters.slice(start, mid).join(''));

    if (measureInlineTextWidth(state.copy, candidate) <= maxWidth) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }

  if (low === start) {
    return Math.min(start + 1, state.characters.length);
  }

  return low;
}

function buildLine(state, text, suffixText, toggleLabel, isExpanded) {
  const suffixWidth = measureInlineTextWidth(state.copy, suffixText);
  const gapWidth = measureInlineTextWidth(state.copy, ABSTRACT_TOGGLE_GAP);
  const toggleWidth = measureInlineTextWidth(state.button, toggleLabel);
  const textWidth = measureInlineTextWidth(state.copy, text);

  return {
    text,
    suffixText,
    fillerWidth: Math.max(state.contentWidth - (textWidth + suffixWidth + gapWidth + toggleWidth), 0),
    toggleLabel,
    isExpanded,
  };
}

function buildCollapsedLines(state) {
  const lines = [];
  let index = 0;
  let lineNumber = 0;

  while (lineNumber < ABSTRACT_PREVIEW_LINES - 1) {
    const end = findLineEnd(state, index, state.contentWidth);
    lines.push({
      text: normalizeLineSlice(state.characters.slice(skipWrapSpaces(state, index), end).join('')),
    });
    index = end;
    lineNumber += 1;
  }

  const lastStart = skipWrapSpaces(state, index);
  const lastEnd = findLineEnd(state, lastStart, state.contentWidth - state.collapsedTailWidth);
  const lastText = normalizeLineSlice(state.characters.slice(lastStart, lastEnd).join(''));
  lines.push(buildLine(state, lastText, ABSTRACT_COLLAPSED_SUFFIX, 'Show more', false));

  return lines;
}

function buildExpandedLines(state) {
  const lines = [];
  let index = 0;
  const lastLineWidth = state.contentWidth - state.expandedTailWidth;

  while (measureInlineTextWidth(state.copy, getRemainingText(state, index)) > lastLineWidth) {
    const end = findLineEnd(state, index, state.contentWidth);
    lines.push({
      text: normalizeLineSlice(state.characters.slice(skipWrapSpaces(state, index), end).join('')),
    });
    index = end;
  }

  lines.push(buildLine(state, getRemainingText(state, index), ABSTRACT_EXPANDED_SUFFIX, 'Show less', true));
  return lines;
}

function countWrappedLines(state) {
  let count = 0;
  let index = 0;

  while (index < state.characters.length) {
    const end = findLineEnd(state, index, state.contentWidth);
    if (end <= index) {
      break;
    }

    index = end;
    count += 1;
  }

  return count;
}

function appendAbstractLine(state, line) {
  const lineNode = document.createElement('span');
  lineNode.className = 'abstract-line';

  if (!line.toggleLabel) {
    lineNode.textContent = line.text;
    state.copy.appendChild(lineNode);
    return;
  }

  const lineText = document.createElement('span');
  const filler = document.createElement('span');
  const gap = document.createElement('span');

  lineNode.classList.add('abstract-line--tail');
  lineText.className = 'abstract-line-text';
  filler.className = 'abstract-filler';
  gap.className = 'abstract-gap';

  lineText.textContent = line.text;
  state.suffix.textContent = line.suffixText;
  filler.style.width = `${line.fillerWidth}px`;
  gap.textContent = ABSTRACT_TOGGLE_GAP;
  state.button.textContent = line.toggleLabel;
  state.button.hidden = false;
  state.button.setAttribute('aria-expanded', line.isExpanded ? 'true' : 'false');

  lineNode.appendChild(lineText);
  lineNode.appendChild(state.suffix);
  lineNode.appendChild(filler);
  lineNode.appendChild(gap);
  lineNode.appendChild(state.button);
  state.copy.appendChild(lineNode);
}

function renderLines(state, lines) {
  state.copy.textContent = '';
  lines.forEach((line) => appendAbstractLine(state, line));
}

function renderAbstract(container) {
  const state = abstractStates.get(container);
  if (!state) {
    return;
  }

  container.classList.toggle('is-collapsible', state.isTruncatable);
  container.classList.toggle('is-expanded', state.isTruncatable && state.expanded);
  container.style.setProperty('--abstract-line-height', `${state.lineHeight}px`);

  if (!state.isTruncatable) {
    state.copy.textContent = state.fullText;
    state.button.textContent = 'Show more';
    state.button.hidden = true;
    state.button.setAttribute('aria-expanded', 'false');
    state.tail.appendChild(state.suffix);
    state.tail.appendChild(state.button);
    return;
  }

  renderLines(state, state.expanded ? state.expandedLines : state.collapsedLines);
}

function updateAbstractLayout(container) {
  const state = abstractStates.get(container);
  if (!state || !container.clientWidth) {
    return;
  }

  state.lineHeight = resolveLineHeight(state.copy);
  state.contentWidth = state.copy.getBoundingClientRect().width;
  state.collapsedTailWidth = getTailWidth(state, ABSTRACT_COLLAPSED_SUFFIX, 'Show more');
  state.expandedTailWidth = getTailWidth(state, ABSTRACT_EXPANDED_SUFFIX, 'Show less');
  state.isTruncatable = countWrappedLines(state) > ABSTRACT_PREVIEW_LINES;

  if (!state.isTruncatable) {
    state.expanded = false;
    state.collapsedLines = [];
    state.expandedLines = [];
  } else {
    state.collapsedLines = buildCollapsedLines(state);
    state.expandedLines = buildExpandedLines(state);
  }

  renderAbstract(container);
}

function scheduleAbstractLayout() {
  if (abstractResizeFrame !== null) {
    cancelAnimationFrame(abstractResizeFrame);
  }

  abstractResizeFrame = window.requestAnimationFrame(() => {
    abstractResizeFrame = null;
    document.querySelectorAll('[data-abstract]').forEach((container) => updateAbstractLayout(container));
  });
}

function bindAbstracts() {
  const abstracts = Array.from(document.querySelectorAll('[data-abstract]'));

  abstracts.forEach((container) => {
    if (abstractStates.get(container)) return;

    const copy = container.querySelector('.paper-abstract-copy');
    const button = container.querySelector('.abstract-toggle');
    if (!copy || !button) return;

    const tail = document.createElement('span');
    const suffix = document.createElement('span');
    const fullText = normalizeAbstractText(copy.textContent);

    tail.className = 'abstract-tail';
    suffix.className = 'abstract-suffix';
    tail.appendChild(suffix);
    tail.appendChild(button);
    container.appendChild(tail);

    copy.textContent = fullText;
    abstractStates.set(container, {
      copy,
      button,
      tail,
      suffix,
      fullText,
      characters: Array.from(fullText),
      contentWidth: 0,
      collapsedTailWidth: 0,
      expandedTailWidth: 0,
      collapsedLines: [],
      expandedLines: [],
      lineHeight: 0,
      expanded: false,
      isTruncatable: false,
    });

    button.addEventListener('click', () => {
      const state = abstractStates.get(container);
      if (!state || !state.isTruncatable) return;
      state.expanded = !state.expanded;
      renderAbstract(container);
    });
  });

  scheduleAbstractLayout();
  window.addEventListener('resize', scheduleAbstractLayout);

  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => {
      scheduleAbstractLayout();
    });
  }
}

function bindGallery() {
  const gallery = document.getElementById('gallery');
  const galleryContainer = document.getElementById('gallery-container');
  const prevButton = document.getElementById('prev');
  const nextButton = document.getElementById('next');

  if (!gallery || !galleryContainer || !prevButton || !nextButton) {
    return;
  }

  const galleryBaseUrl = 'https://homepage-ruihong.oss-cn-beijing.aliyuncs.com/photos/20251024';

  const photos = Array.from({ length: 12 }, (_, index) => ({
    src: `${galleryBaseUrl}/photo${index + 1}.jpg`,
    alt: `Gallery photo ${index + 1}`,
  }));

  if (photos.length < 2) {
    return;
  }

  const loopedPhotos = [photos[photos.length - 1], ...photos, photos[0], photos[1]];

  let currentIndex = 0;
  let isTransitioning = false;
  let autoAdvanceTimer = null;
  const queuedMoves = [];

  function buildGalleryItem(photo, index) {
    const itemDiv = document.createElement('div');
    itemDiv.className = 'gallery-item';

    const img = document.createElement('img');
    img.src = photo.src;
    img.alt = photo.alt;
    img.decoding = 'async';
    img.loading = index < 4 ? 'eager' : 'lazy';

    itemDiv.appendChild(img);
    return itemDiv;
  }

  function syncPosition(animate = true) {
    gallery.style.transition = animate ? 'transform 500ms ease' : 'none';
    gallery.style.transform = `translateX(-${(currentIndex + 1) * 50}%)`;

    if (!animate) {
      void gallery.offsetWidth;
      gallery.style.transition = 'transform 500ms ease';
    }
  }

  function move(delta) {
    if (isTransitioning) {
      queuedMoves.push(delta);
      return;
    }

    isTransitioning = true;
    currentIndex += delta;
    syncPosition(true);
  }

  function flushQueuedMove() {
    if (!queuedMoves.length) {
      return;
    }

    const nextDelta = queuedMoves.shift();
    window.requestAnimationFrame(() => {
      move(nextDelta);
    });
  }

  function resetAutoAdvance() {
    window.clearInterval(autoAdvanceTimer);
    autoAdvanceTimer = window.setInterval(() => {
      move(1);
    }, 5000);
  }

  function pauseAutoAdvance() {
    window.clearInterval(autoAdvanceTimer);
  }

  gallery.textContent = '';
  loopedPhotos.forEach((photo, index) => gallery.appendChild(buildGalleryItem(photo, index)));
  syncPosition(false);

  prevButton.addEventListener('click', () => {
    move(-1);
    resetAutoAdvance();
  });

  nextButton.addEventListener('click', () => {
    move(1);
    resetAutoAdvance();
  });

  gallery.addEventListener('transitionend', (event) => {
    if (event.propertyName !== 'transform') {
      return;
    }

    if (currentIndex < 0) {
      currentIndex = photos.length - 1;
      syncPosition(false);
    } else if (currentIndex >= photos.length) {
      currentIndex = 0;
      syncPosition(false);
    }

    isTransitioning = false;
    flushQueuedMove();
  });

  galleryContainer.addEventListener('mouseenter', pauseAutoAdvance);
  galleryContainer.addEventListener('mouseleave', resetAutoAdvance);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      pauseAutoAdvance();
    } else {
      resetAutoAdvance();
    }
  });

  resetAutoAdvance();
}

function bindUI() {
  bindScrollButtons();
  bindReveals();
  bindHeroPointer();
  bindGlobalClickFireworks();
  bindAbstracts();
  bindGallery();

  window.addEventListener('scroll', updateScrollTarget, { passive: true });
  window.addEventListener('resize', () => {
    updateViewport();
    updateScrollTarget();
  });

  if (typeof reducedMotionMedia.addEventListener === 'function') {
    reducedMotionMedia.addEventListener('change', (event) => {
      state.reducedMotion = event.matches;
      hero.setReducedMotion(event.matches);
      fireworks.setReducedMotion(event.matches);
    });
  } else if (typeof reducedMotionMedia.addListener === 'function') {
    reducedMotionMedia.addListener((event) => {
      state.reducedMotion = event.matches;
      hero.setReducedMotion(event.matches);
      fireworks.setReducedMotion(event.matches);
    });
  }
}

async function init() {
  updateViewport();
  updateScrollTarget();
  hero.setReducedMotion(state.reducedMotion);
  fireworks.setReducedMotion(state.reducedMotion);
  await hero.init();
  bindUI();

  window.__RUIHONG_HERO__ = hero;
  window.__RUIHONG_HERO_CONFIG__ = heroConfig;

  let lastTime = performance.now();

  function frame(now) {
    const delta = (now - lastTime) / 1000;
    lastTime = now;

    state.scroll = lerp(state.scroll, state.scrollTarget, state.reducedMotion ? 0.14 : 0.08);
    root.style.setProperty('--hero-progress', state.scroll.toFixed(4));

    hero.render({
      delta,
      elapsed: now / 1000,
      scroll: state.scroll,
      reducedMotion: state.reducedMotion,
    });

    fireworks.render({ delta });

    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
}

init();
