import { createHeroConfig } from './hero/config.js';
import { ParticleHero } from './hero/ParticleHero.js';
import { GlobalClickFireworks } from './GlobalClickFireworks.js';

const root = document.documentElement;
const canvas = document.getElementById('scene-canvas');
const siteNav = document.querySelector('.site-nav');
const themeToggle = document.querySelector('[data-theme-toggle]');
const colorSchemeMedia = window.matchMedia('(prefers-color-scheme: dark)');
const reducedMotionMedia = window.matchMedia('(prefers-reduced-motion: reduce)');
const THEME_STORAGE_KEY = 'theme';

const heroConfig = createHeroConfig();
const mobileBreakpoint = heroConfig.viewport.mobileBreakpoint;

const state = {
  theme: root.getAttribute('data-theme'),
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

function getSystemTheme() {
  return colorSchemeMedia.matches ? 'dark' : 'light';
}

function updateThemeButton(theme) {
  const nextTheme = theme === 'dark' ? 'light' : 'dark';
  const label = `Switch to ${nextTheme} mode`;
  themeToggle.setAttribute('aria-label', label);
  themeToggle.setAttribute('title', label);
}

function applyTheme(theme, savePreference = false) {
  root.setAttribute('data-theme', theme);
  state.theme = theme;
  updateThemeButton(theme);
  hero.setTheme(theme);
  fireworks.setTheme(theme);

  if (savePreference) {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  }
}

function applyReducedMotion(reducedMotion) {
  state.reducedMotion = reducedMotion;
  hero.setReducedMotion(reducedMotion);
  fireworks.setReducedMotion(reducedMotion);
}

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
  state.dpr = Math.min(window.devicePixelRatio, state.isMobile ? 1.35 : 1.8);

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

  updateNavMetrics();
}

function updateNavMetrics() {
  const rect = siteNav.getBoundingClientRect();
  root.style.setProperty('--nav-height', `${Math.ceil(rect.height)}px`);
  root.style.setProperty('--nav-offset-top', `${Math.max(Math.round(rect.top), 0)}px`);
}

function getAnchorGap() {
  return Number.parseFloat(window.getComputedStyle(root).getPropertyValue('--anchor-gap'));
}

function getAnchorOffset() {
  const rect = siteNav.getBoundingClientRect();
  return Math.max(rect.bottom, 0) + getAnchorGap();
}

function getLayoutTop(element) {
  return element.getBoundingClientRect().top + window.scrollY;
}

function getMaxScrollY() {
  return Math.max(document.scrollingElement.scrollHeight - window.innerHeight, 0);
}

function getHashTarget(hash) {
  if (!hash || hash === '#') return null;
  return document.getElementById(decodeURIComponent(hash.slice(1)));
}

function scrollToAnchorTarget(target, behavior = 'smooth') {
  const top =
    target.id === 'top'
      ? 0
      : clamp(getLayoutTop(target) - getAnchorOffset(), 0, getMaxScrollY());

  window.scrollTo({
    top,
    behavior: state.reducedMotion ? 'auto' : behavior,
  });
}

function updateScrollTarget() {
  const rangeFactor = state.isMobile ? heroConfig.scroll.rangeMobile : heroConfig.scroll.rangeDesktop;
  state.scrollTarget = clamp(window.scrollY / (window.innerHeight * rangeFactor), 0, 1.16);
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
  window.addEventListener('click', (event) => fireworks.trigger(event), { passive: true });
}

function bindThemeToggle() {
  updateThemeButton(state.theme);

  themeToggle.addEventListener('click', () => {
    applyTheme(state.theme === 'dark' ? 'light' : 'dark', true);
  });

  colorSchemeMedia.addEventListener('change', () => {
    if (!localStorage.getItem(THEME_STORAGE_KEY)) {
      applyTheme(getSystemTheme());
    }
  });
}

function bindAnchorNavigation() {
  siteNav.addEventListener('click', (event) => {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }

    const link = event.target.closest('a[href^="#"]');
    if (!link) return;

    const target = getHashTarget(link.hash);
    if (!target) return;

    event.preventDefault();
    scrollToAnchorTarget(target);

    if (window.location.hash !== link.hash) {
      window.history.pushState(null, '', link.hash);
    }
  });

  window.addEventListener('popstate', () => {
    const target = getHashTarget(window.location.hash);
    if (target) {
      scrollToAnchorTarget(target, 'auto');
    }
  });
}

const ABSTRACT_PREVIEW_LINES = 4;
const ABSTRACT_COLLAPSED_SUFFIX = '...';
const ABSTRACT_TOGGLE_GAP = '    ';
const ABSTRACT_FILLER_SAFETY_PX = 1;

const abstractStates = new WeakMap();
let abstractResizeFrame = null;

function resolveLineHeight(reference) {
  return Number.parseFloat(window.getComputedStyle(reference).lineHeight);
}

function collectTextNodes(rootNode) {
  const textNodes = [];
  const walker = document.createTreeWalker(rootNode, NodeFilter.SHOW_TEXT);

  while (walker.nextNode()) {
    textNodes.push(walker.currentNode);
  }

  return textNodes;
}

function trimNodeStart(node) {
  if (node.nodeType === Node.TEXT_NODE) {
    node.nodeValue = node.nodeValue.replace(/^\s+/g, '');
    return node.nodeValue.length > 0;
  }

  while (node.firstChild) {
    if (trimNodeStart(node.firstChild)) {
      return true;
    }

    node.removeChild(node.firstChild);
  }

  return false;
}

function trimNodeEnd(node) {
  if (node.nodeType === Node.TEXT_NODE) {
    node.nodeValue = node.nodeValue.replace(/\s+$/g, '');
    return node.nodeValue.length > 0;
  }

  while (node.lastChild) {
    if (trimNodeEnd(node.lastChild)) {
      return true;
    }

    node.removeChild(node.lastChild);
  }

  return false;
}

function normalizeAbstractSource(html) {
  const template = document.createElement('template');
  template.innerHTML = html.trim();

  collectTextNodes(template.content).forEach((node) => {
    node.nodeValue = node.nodeValue.replace(/\s+/g, ' ');
  });

  trimNodeStart(template.content);
  trimNodeEnd(template.content);

  return Array.from(template.content.childNodes).map((node) => node.cloneNode(true));
}

function getNodesTextLength(nodes) {
  return nodes.reduce((length, node) => length + node.textContent.length, 0);
}

function getNodesText(nodes) {
  return nodes.map((node) => node.textContent).join('');
}

function cloneNodeTextRange(node, cursor, start, end) {
  if (cursor.offset >= end) {
    return null;
  }

  if (node.nodeType === Node.TEXT_NODE) {
    const value = node.nodeValue;
    const nodeStart = cursor.offset;
    const nodeEnd = nodeStart + value.length;
    cursor.offset = nodeEnd;

    const sliceStart = Math.max(start - nodeStart, 0);
    const sliceEnd = Math.min(end - nodeStart, value.length);
    if (sliceStart >= sliceEnd) {
      return null;
    }

    return document.createTextNode(value.slice(sliceStart, sliceEnd));
  }

  if (node.nodeType !== Node.ELEMENT_NODE) {
    return null;
  }

  const clone = node.cloneNode(false);
  Array.from(node.childNodes).forEach((child) => {
    const childClone = cloneNodeTextRange(child, cursor, start, end);
    if (childClone) {
      clone.appendChild(childClone);
    }
  });

  return clone.childNodes.length ? clone : null;
}

function cloneAbstractRange(state, start, end, { trimStart = false, trimEnd = false } = {}) {
  const fragment = document.createDocumentFragment();
  const cursor = { offset: 0 };

  state.sourceNodes.forEach((node) => {
    const clone = cloneNodeTextRange(node, cursor, start, end);
    if (clone) {
      fragment.appendChild(clone);
    }
  });

  if (trimStart) {
    trimNodeStart(fragment);
  }

  if (trimEnd) {
    trimNodeEnd(fragment);
  }

  return fragment;
}

function trimEndOffset(state, offset) {
  let nextOffset = Math.min(offset, state.textLength);

  while (nextOffset > 0 && /\s/.test(state.plainText[nextOffset - 1])) {
    nextOffset -= 1;
  }

  return nextOffset;
}

function getAbstractMeasureCopy(state) {
  if (!state.measureCopy) {
    state.measureCopy = document.createElement('p');
    state.measureCopy.className = state.copy.className;
    state.measureCopy.classList.add('paper-abstract-measure');
    state.measureCopy.style.position = 'absolute';
    state.measureCopy.style.visibility = 'hidden';
    state.measureCopy.style.pointerEvents = 'none';
    state.measureCopy.style.zIndex = '-1';
    state.measureCopy.style.left = '-10000px';
    state.measureCopy.style.top = '0';
    state.measureCopy.style.margin = '0';
    state.measureCopy.style.contain = 'layout style';
    document.body.appendChild(state.measureCopy);
  }

  state.measureCopy.style.width = `${state.contentWidth}px`;
  return state.measureCopy;
}

function createAbstractTail(
  state,
  { suffixText, fillerWidth, toggleLabel, isExpanded, gapText = ABSTRACT_TOGGLE_GAP, isMeasure = false },
) {
  const tail = document.createElement('span');
  const suffix = document.createElement('span');
  const filler = document.createElement('span');
  const gap = document.createElement('span');
  const button = isMeasure ? state.button.cloneNode(false) : state.button;

  tail.className = 'abstract-tail';
  suffix.className = 'abstract-suffix';
  filler.className = 'abstract-filler';
  gap.className = 'abstract-gap';

  suffix.textContent = suffixText;
  filler.style.width = `${Math.max(fillerWidth, 0)}px`;
  gap.textContent = gapText;
  button.type = 'button';
  button.hidden = false;
  button.textContent = toggleLabel;
  button.setAttribute('aria-expanded', isExpanded ? 'true' : 'false');

  tail.appendChild(suffix);
  tail.appendChild(filler);
  tail.appendChild(gap);
  tail.appendChild(button);

  return tail;
}

function setMeasureContent(state, fragment, tailOptions = null) {
  const measureCopy = getAbstractMeasureCopy(state);
  measureCopy.replaceChildren(fragment);

  if (tailOptions) {
    measureCopy.appendChild(createAbstractTail(state, { ...tailOptions, isMeasure: true }));
  }

  return measureCopy;
}

function getInlineLineMetrics(element, lineHeight) {
  const range = document.createRange();
  range.selectNodeContents(element);

  const rects = Array.from(range.getClientRects()).filter(
    (rect) => rect.width > 0.25 && rect.height > 0.25,
  );
  range.detach();

  const lines = [];
  const tolerance = lineHeight * 0.45;

  rects
    .sort((a, b) => a.top - b.top || a.left - b.left)
    .forEach((rect) => {
      const center = (rect.top + rect.bottom) / 2;
      const line = lines.find(
        (candidate) =>
          Math.abs(candidate.center - center) <= tolerance ||
          (rect.top < candidate.bottom - 1 && rect.bottom > candidate.top + 1),
      );

      if (!line) {
        lines.push({
          top: rect.top,
          right: rect.right,
          bottom: rect.bottom,
          left: rect.left,
          center,
        });
        return;
      }

      line.top = Math.min(line.top, rect.top);
      line.right = Math.max(line.right, rect.right);
      line.bottom = Math.max(line.bottom, rect.bottom);
      line.left = Math.min(line.left, rect.left);
      line.center = (line.top + line.bottom) / 2;
    });

  return lines.sort((a, b) => a.top - b.top);
}

function countMeasuredLines(state, start, end, tailOptions = null) {
  const fragment = cloneAbstractRange(state, start, end, {
    trimStart: start > 0,
    trimEnd: true,
  });
  const measureCopy = setMeasureContent(state, fragment, tailOptions);
  return getInlineLineMetrics(measureCopy, state.lineHeight).length;
}

function fitsCollapsedEnd(state, endOffset) {
  return (
    countMeasuredLines(state, 0, endOffset, {
      suffixText: ABSTRACT_COLLAPSED_SUFFIX,
      fillerWidth: 0,
      toggleLabel: 'Show more',
      isExpanded: false,
    }) <= ABSTRACT_PREVIEW_LINES
  );
}

function findCollapsedEndOffset(state) {
  let low = 0;
  let high = state.textLength;

  while (low < high) {
    const middle = Math.ceil((low + high) / 2);

    if (fitsCollapsedEnd(state, middle)) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }

  return trimEndOffset(state, low);
}

function measureLineEndWidth(state, start, end, suffixText) {
  const fragment = cloneAbstractRange(state, start, end, {
    trimStart: start > 0,
    trimEnd: true,
  });
  const measureCopy = setMeasureContent(state, fragment);

  if (suffixText) {
    const suffix = document.createElement('span');
    suffix.className = 'abstract-suffix';
    suffix.textContent = suffixText;
    measureCopy.appendChild(suffix);
  }

  const lines = getInlineLineMetrics(measureCopy, state.lineHeight);
  const lastLine = lines[lines.length - 1];
  return Math.max(lastLine.right - measureCopy.getBoundingClientRect().left, 0);
}

function measureTailControlWidth(state, toggleLabel, isExpanded) {
  const measureCopy = setMeasureContent(
    state,
    document.createDocumentFragment(),
    {
      suffixText: '',
      fillerWidth: 0,
      toggleLabel,
      isExpanded,
    },
  );

  return measureCopy.querySelector('.abstract-tail').getBoundingClientRect().width;
}

function calculateFillerWidth(state, start, end, suffixText, toggleLabel, isExpanded) {
  const lineEndWidth = measureLineEndWidth(state, start, end, suffixText);
  const tailControlWidth = measureTailControlWidth(state, toggleLabel, isExpanded);

  return Math.max(
    Math.floor(state.contentWidth - lineEndWidth - tailControlWidth - ABSTRACT_FILLER_SAFETY_PX),
    0,
  );
}

function getNaturalTailLayout(state, toggleLabel, isExpanded) {
  const lineEndWidth = measureLineEndWidth(state, 0, state.textLength, '');
  const tailControlWidth = measureTailControlWidth(state, toggleLabel, isExpanded);
  const remainingWidth = state.contentWidth - lineEndWidth - tailControlWidth;

  return {
    fillerWidth: Math.max(Math.floor(remainingWidth - ABSTRACT_FILLER_SAFETY_PX), 0),
    fitsInLine: remainingWidth >= 0,
  };
}

function renderFullAbstract(state) {
  state.copy.replaceChildren(cloneAbstractRange(state, 0, state.textLength));
}

function renderCollapsedAbstract(state) {
  const content = cloneAbstractRange(state, 0, state.collapsedEndOffset, { trimEnd: true });
  state.copy.replaceChildren(content);
  state.copy.appendChild(
    createAbstractTail(state, {
      suffixText: ABSTRACT_COLLAPSED_SUFFIX,
      fillerWidth: state.collapsedFillerWidth,
      toggleLabel: 'Show more',
      isExpanded: false,
    }),
  );
}

function renderExpandedAbstract(state) {
  renderFullAbstract(state);
  state.copy.appendChild(
    createAbstractTail(state, {
      suffixText: '',
      fillerWidth: state.expandedFillerWidth,
      gapText: state.expandedTailFitsInLine ? ABSTRACT_TOGGLE_GAP : ' ',
      toggleLabel: 'Show less',
      isExpanded: true,
    }),
  );
}

function renderAbstract(container) {
  const state = abstractStates.get(container);

  container.classList.toggle('is-collapsible', state.isTruncatable);
  container.classList.toggle('is-expanded', state.isTruncatable && state.expanded);

  if (!state.isTruncatable) {
    renderFullAbstract(state);
    state.button.textContent = 'Show more';
    state.button.hidden = true;
    state.button.setAttribute('aria-expanded', 'false');
    return;
  }

  (state.expanded ? renderExpandedAbstract : renderCollapsedAbstract)(state);
}

function updateAbstractLayout(container) {
  const state = abstractStates.get(container);
  if (!container.clientWidth) {
    return;
  }

  state.lineHeight = resolveLineHeight(state.copy);
  state.contentWidth = state.copy.getBoundingClientRect().width;
  state.isTruncatable =
    countMeasuredLines(state, 0, state.textLength) > ABSTRACT_PREVIEW_LINES;

  if (!state.isTruncatable) {
    state.expanded = false;
    state.collapsedEndOffset = state.textLength;
    state.collapsedFillerWidth = 0;
    state.expandedFillerWidth = 0;
    state.expandedTailFitsInLine = false;
  } else {
    state.collapsedEndOffset = findCollapsedEndOffset(state);
    state.collapsedFillerWidth = calculateFillerWidth(
      state,
      0,
      state.collapsedEndOffset,
      ABSTRACT_COLLAPSED_SUFFIX,
      'Show more',
      false,
    );
    const expandedTailLayout = getNaturalTailLayout(state, 'Show less', true);
    state.expandedFillerWidth = expandedTailLayout.fillerWidth;
    state.expandedTailFitsInLine = expandedTailLayout.fitsInLine;
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
    const copy = container.querySelector('.paper-abstract-copy');
    const button = container.querySelector('.abstract-toggle');

    const sourceNodes = normalizeAbstractSource(copy.innerHTML);
    const textLength = getNodesTextLength(sourceNodes);
    const plainText = getNodesText(sourceNodes);

    button.hidden = true;
    button.remove();
    abstractStates.set(container, {
      copy,
      button,
      sourceNodes,
      textLength,
      plainText,
      contentWidth: 0,
      collapsedEndOffset: textLength,
      collapsedFillerWidth: 0,
      expandedFillerWidth: 0,
      expandedTailFitsInLine: false,
      lineHeight: 0,
      measureCopy: null,
      expanded: false,
      isTruncatable: false,
    });

    button.addEventListener('click', () => {
      const state = abstractStates.get(container);
      if (!state.isTruncatable) return;
      state.expanded = !state.expanded;
      renderAbstract(container);
    });
  });

  scheduleAbstractLayout();
  window.addEventListener('resize', scheduleAbstractLayout);

  document.fonts.ready.then(scheduleAbstractLayout);
}

function bindGallery() {
  const gallery = document.getElementById('gallery');
  const galleryContainer = document.getElementById('gallery-container');
  const prevButton = document.getElementById('prev');
  const nextButton = document.getElementById('next');

  const galleryBaseUrl = 'https://homepage-ruihong.oss-cn-beijing.aliyuncs.com/photos/20251024';

  const photos = Array.from({ length: 12 }, (_, index) => ({
    src: `${galleryBaseUrl}/photo${index + 1}.jpg`,
    alt: `Gallery photo ${index + 1}`,
  }));

  const loopedPhotos = [photos[photos.length - 1], ...photos, photos[0], photos[1]];

  let currentIndex = 0;
  let isTransitioning = false;
  let autoAdvanceTimer = null;

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
      return;
    }

    isTransitioning = true;
    currentIndex += delta;
    syncPosition(true);
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
  });

  galleryContainer.addEventListener('mouseenter', pauseAutoAdvance);
  galleryContainer.addEventListener('mouseleave', resetAutoAdvance);
  document.addEventListener('visibilitychange', () => {
    (document.hidden ? pauseAutoAdvance : resetAutoAdvance)();
  });

  resetAutoAdvance();
}

function bindUI() {
  bindThemeToggle();
  bindAnchorNavigation();
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

  reducedMotionMedia.addEventListener('change', (event) => {
    applyReducedMotion(event.matches);
  });
}

async function init() {
  await hero.init();
  updateViewport();
  updateScrollTarget();
  applyTheme(state.theme);
  applyReducedMotion(state.reducedMotion);
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
