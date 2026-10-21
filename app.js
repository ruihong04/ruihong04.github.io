import { createHeroConfig } from './hero/config.js';
import { addFrameTask, wakeFrameLoop } from './frameLoop.js';
import { bindAbstracts } from './abstracts.js';
import { bindGallery } from './gallery.js';

const root = document.documentElement;
const canvas = document.getElementById('scene-canvas');
const heroShell = document.querySelector('.hero-shell');
const heroSticky = document.querySelector('.hero-sticky');
const siteNav = document.querySelector('.site-nav');
const themeToggle = document.querySelector('[data-theme-toggle]');
const colorSchemeMedia = window.matchMedia('(prefers-color-scheme: dark)');
const reducedMotionMedia = window.matchMedia('(prefers-reduced-motion: reduce)');
const THEME_STORAGE_KEY = 'theme';

// Easing rates (per second) of the hero scroll progress.
const SCROLL_EASE_RATE = 5.0;
const SCROLL_EASE_RATE_REDUCED = 9.05;
const SCROLL_SETTLE_EPSILON = 1e-4;

const heroConfig = createHeroConfig();

const state = {
  theme: root.getAttribute('data-theme'),
  reducedMotion: reducedMotionMedia.matches,
  heroCover: 0,
  scroll: 0,
  scrollTarget: 0,
  progressText: '',
};

let effects = null;

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
  effects?.setTheme(theme);

  if (savePreference) {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  }
}

function applyReducedMotion(reducedMotion) {
  state.reducedMotion = reducedMotion;
  effects?.setReducedMotion(reducedMotion);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function lerp(start, end, alpha) {
  return start + (end - start) * alpha;
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

// Progress 1 is the scroll position where the content curtain reaches the top and the hero unpins.
function measureHeroCover() {
  state.heroCover = heroShell.offsetHeight - heroSticky.offsetHeight;
}

function updateScrollTarget() {
  state.scrollTarget = clamp(window.scrollY / state.heroCover, 0, 1.16);
  wakeFrameLoop();
}

function updateScrollProgress(delta) {
  const rate = state.reducedMotion ? SCROLL_EASE_RATE_REDUCED : SCROLL_EASE_RATE;
  state.scroll = lerp(state.scroll, state.scrollTarget, 1 - Math.exp(-delta * rate));
  if (Math.abs(state.scrollTarget - state.scroll) < SCROLL_SETTLE_EPSILON) {
    state.scroll = state.scrollTarget;
  }

  const progressText = state.scroll.toFixed(4);
  if (progressText !== state.progressText) {
    state.progressText = progressText;
    root.style.setProperty('--hero-progress', progressText);
  }

  return state.scroll !== state.scrollTarget;
}

function bindReveals() {
  // A margin rather than a ratio threshold: tall sections may never reach a ratio on short phones.
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target);
      });
    },
    { rootMargin: '0px 0px -12% 0px' }
  );

  document.querySelectorAll('.reveal').forEach((element) => observer.observe(element));
}

function bindNavMetrics() {
  new ResizeObserver(() => {
    const rect = siteNav.getBoundingClientRect();
    root.style.setProperty('--nav-height', `${Math.ceil(rect.height)}px`);
    root.style.setProperty('--nav-offset-top', `${Math.max(Math.round(rect.top), 0)}px`);
  }).observe(siteNav);
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

function bindScrollProgress() {
  const coverObserver = new ResizeObserver(() => {
    measureHeroCover();
    updateScrollTarget();
  });
  coverObserver.observe(heroShell);
  coverObserver.observe(heroSticky);

  window.addEventListener('scroll', updateScrollTarget, { passive: true });

  addFrameTask(updateScrollProgress);
  measureHeroCover();
  updateScrollTarget();
}

async function loadEffects() {
  const { startEffects } = await import('./effects.js');
  effects = await startEffects({
    canvas,
    config: heroConfig,
    getScroll: () => state.scroll,
  });
  effects.setTheme(state.theme);
  effects.setReducedMotion(state.reducedMotion);
}

function init() {
  bindThemeToggle();
  bindNavMetrics();
  bindAnchorNavigation();
  bindReveals();
  bindScrollProgress();
  bindAbstracts();
  bindGallery();

  reducedMotionMedia.addEventListener('change', (event) => {
    applyReducedMotion(event.matches);
  });

  // Effects are decorative; the page works without them.
  loadEffects().catch((error) => {
    console.error('Hero effects failed to start:', error);
  });
}

init();
