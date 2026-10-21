const GALLERY_BASE_URL = 'https://homepage-ruihong.oss-cn-beijing.aliyuncs.com/photos/20251024';
const PHOTO_COUNT = 12;
const AUTO_ADVANCE_MS = 5000;
const SWIPE_MIN_PX = 40;

export function bindGallery() {
  const gallery = document.getElementById('gallery');
  const galleryContainer = document.getElementById('gallery-container');
  const galleryViewport = document.getElementById('gallery-viewport');
  const prevButton = document.getElementById('prev');
  const nextButton = document.getElementById('next');

  const photos = Array.from({ length: PHOTO_COUNT }, (_, index) => ({
    src: `${GALLERY_BASE_URL}/photo${index + 1}.jpg`,
    alt: `Gallery photo ${index + 1}`,
  }));

  // Clones on both ends so the 1-up and 2-up views loop.
  const loopedPhotos = [photos[photos.length - 1], ...photos, photos[0], photos[1]];

  let currentIndex = 0;
  let isTransitioning = false;
  let autoAdvanceTimer = null;
  let isInView = false;
  let isHovered = false;
  let swipeStart = null;

  function buildGalleryItem(photo, index) {
    const itemDiv = document.createElement('div');
    itemDiv.className = 'gallery-item';

    const img = document.createElement('img');
    img.src = photo.src;
    img.alt = photo.alt;
    img.decoding = 'async';
    img.loading = index < 4 ? 'eager' : 'lazy';
    img.draggable = false;

    itemDiv.appendChild(img);
    return itemDiv;
  }

  function itemPercent() {
    return 100 / Number.parseFloat(window.getComputedStyle(gallery).getPropertyValue('--gallery-per-view'));
  }

  function syncPosition(animate = true) {
    gallery.style.transition = animate ? 'transform 500ms ease' : 'none';
    gallery.style.transform = `translateX(-${(currentIndex + 1) * itemPercent()}%)`;

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

  function updateAutoAdvance() {
    window.clearInterval(autoAdvanceTimer);
    if (!isInView || isHovered || document.hidden) return;
    autoAdvanceTimer = window.setInterval(() => move(1), AUTO_ADVANCE_MS);
  }

  gallery.textContent = '';
  loopedPhotos.forEach((photo, index) => gallery.appendChild(buildGalleryItem(photo, index)));
  syncPosition(false);

  prevButton.addEventListener('click', () => {
    move(-1);
    updateAutoAdvance();
  });

  nextButton.addEventListener('click', () => {
    move(1);
    updateAutoAdvance();
  });

  // Jump from a clone back to the real photo without animation.
  function settle() {
    if (currentIndex < 0) {
      currentIndex = photos.length - 1;
    } else if (currentIndex >= photos.length) {
      currentIndex = 0;
    }

    syncPosition(false);
    isTransitioning = false;
  }

  gallery.addEventListener('transitionend', (event) => {
    if (event.propertyName !== 'transform') {
      return;
    }

    settle();
  });

  galleryViewport.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'mouse') return;
    swipeStart = { x: event.clientX, y: event.clientY };
  });

  galleryViewport.addEventListener('pointerup', (event) => {
    if (!swipeStart) return;
    const dx = event.clientX - swipeStart.x;
    const dy = event.clientY - swipeStart.y;
    swipeStart = null;
    if (Math.abs(dx) < SWIPE_MIN_PX || Math.abs(dx) < Math.abs(dy)) return;
    move(dx < 0 ? 1 : -1);
    updateAutoAdvance();
  });

  galleryViewport.addEventListener('pointercancel', () => {
    swipeStart = null;
  });

  galleryContainer.addEventListener('mouseenter', () => {
    isHovered = true;
    updateAutoAdvance();
  });

  galleryContainer.addEventListener('mouseleave', () => {
    isHovered = false;
    updateAutoAdvance();
  });

  document.addEventListener('visibilitychange', updateAutoAdvance);

  new IntersectionObserver(([entry]) => {
    isInView = entry.isIntersecting;
    updateAutoAdvance();
  }).observe(galleryContainer);

  let observedWidth = -1;
  new ResizeObserver(([entry]) => {
    const width = entry.contentBoxSize[0].inlineSize;
    if (width === observedWidth) return;
    observedWidth = width;
    settle();
  }).observe(galleryViewport);
}
