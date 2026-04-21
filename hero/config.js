export function createHeroConfig() {
  return {
    viewport: {
      mobileBreakpoint: 820,
    },

    paper: {
      desktop: {
        position: { x: 4.0, y: -1.46, z: 0.0 },
        rotation: { x: 0.0, y: 0.0, z: 0.0 },
        scale: 0.6,
      },
      mobile: {
        position: { x: 3.0, y: -1.0, z: 0.0 },
        rotation: { x: 0.0, y: 0.0, z: 0.0 },
        scale: 0.48,
      },
      scrollShift: {
        position: { x: -0.35, y: 0.18, z: 0.0 },
        rotation: { x: 0.0, y: 0.0, z: 0.0 },
        scale: -0.03,
      },
      floatMotion: {
        positionX: 0.05,
        positionY: 0.03,
      },
      pointerTilt: {
        x: 0.018,
        y: 0.014,
      },
    },

    camera: {
      desktop: {
        fov: 50,
        position: { x: 4.0, y: -8.1, z: 3.22 },
        focusOffset: { y: 1.42, z: 0.5 },
        screenOffsetX: -8.5,
      },
      mobile: {
        fov: 52,
        position: { x: 3.0, y: -8.6, z: 3.55 },
        focusOffset: { y: 0.92, z: 0.5 },
        screenOffsetX: -1.85,
      },
      scrollShift: {
        position: { x: -0.35, y: 0.0, z: 0.0 },
        focusOffset: { y: 0.0, z: 0.0 },
        screenOffsetX: 0.0,
      },
    },

    atlas: {
      imageUrls: [
        './assets/hero-slides/1.jpg',
        './assets/hero-slides/2.jpg',
        './assets/hero-slides/3.jpg',
        './assets/hero-slides/4.jpg',
        './assets/hero-slides/5.jpg',
      ],
      targetWidth: 1024,
      overlapRatio: 0.16,
      worldWidth: 10,
      visibleAspect: 0.666,
    },

    particles: {
      desktop: {
        columns: 510,
        rows: 765,
      },
      mobile: {
        columns: 330,
        rows: 495,
      },
      basePointSize: 56,
      pointSizeMin: 18,
      pointSizeMax: 42,
      fallSpeed: 0.02,
      glintStrength: 0.16,
      exposure: 0.62,
    },

    interaction: {
      pointerRadius: 1.28,
      pointerStrength: 2.45,
      spring: 5.6,
      damping: 4.8,
      turbulence: 0.42,
      maxSpeed: 5.9,
      enterRate: 6.5,
      leaveRate: 0.27,
      followDesktop: 0.16,
      followMobile: 0.18,
      idleReturn: 0.05,
    },

    render: {
      exposure: 0.74,
    },

    scroll: {
      rangeDesktop: 1.14,
      rangeMobile: 1.02,
    },
  };
}
