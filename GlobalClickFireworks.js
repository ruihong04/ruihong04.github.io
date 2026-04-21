import * as THREE from './three.module.js';

const FIREWORK_VERTEX_SHADER = /* glsl */ `
precision highp float;

uniform float uPixelRatio;

attribute float aSize;
attribute float aAlpha;
attribute vec3 aColor;

varying float vAlpha;
varying vec3 vColor;

void main() {
  vAlpha = aAlpha;
  vColor = aColor;

  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  gl_PointSize = max(aSize * uPixelRatio, 0.0);
}
`;

const FIREWORK_FRAGMENT_SHADER = /* glsl */ `
precision highp float;

uniform sampler2D uSprite;

varying float vAlpha;
varying vec3 vColor;

void main() {
  vec4 sprite = texture2D(uSprite, gl_PointCoord);
  float alpha = pow(sprite.a, 1.35) * vAlpha;

  if (alpha < 0.02) {
    discard;
  }

  vec3 color = vColor * mix(0.92, 1.02, sprite.r);
  gl_FragColor = vec4(color, alpha);
}
`;

const FIREWORK_PALETTE = ['#fff4d6', '#ffd48b', '#f0b086', '#e28a67', '#ffe7c2'];
const MAX_ACTIVE_BURSTS = 12;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function randBetween(min, max) {
  return min + Math.random() * (max - min);
}

function createSparkTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;

  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Could not create canvas context for fireworks texture.');
  }

  const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0.0, 'rgba(255, 255, 255, 1)');
  gradient.addColorStop(0.12, 'rgba(255, 246, 222, 0.96)');
  gradient.addColorStop(0.28, 'rgba(255, 214, 139, 0.72)');
  gradient.addColorStop(0.48, 'rgba(255, 194, 120, 0.18)');
  gradient.addColorStop(0.68, 'rgba(255, 194, 120, 0.04)');
  gradient.addColorStop(1.0, 'rgba(255, 194, 120, 0)');

  context.fillStyle = gradient;
  context.fillRect(0, 0, canvas.width, canvas.height);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;

  return texture;
}

function createFireworkMaterial(spriteTexture) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uPixelRatio: { value: 1 },
      uSprite: { value: spriteTexture },
    },
    vertexShader: FIREWORK_VERTEX_SHADER,
    fragmentShader: FIREWORK_FRAGMENT_SHADER,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexColors: false,
  });
}

export class GlobalClickFireworks {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'global-fireworks-canvas';
    this.canvas.setAttribute('aria-hidden', 'true');
    document.body.appendChild(this.canvas);

    this.state = {
      width: window.innerWidth,
      height: window.innerHeight,
      dpr: 1,
      reducedMotion: false,
    };

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      alpha: true,
      antialias: false,
      powerPreference: 'high-performance',
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.sortObjects = false;

    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 20);
    this.camera.position.z = 10;

    this.sparkTexture = createSparkTexture();
    this.material = createFireworkMaterial(this.sparkTexture);
    this.bursts = [];
  }

  resize({ width, height, dpr }) {
    this.state.width = width;
    this.state.height = height;
    this.state.dpr = clamp(dpr, 1, 1.5);

    this.renderer.setPixelRatio(this.state.dpr);
    this.renderer.setSize(width, height, false);

    this.camera.left = -width / 2;
    this.camera.right = width / 2;
    this.camera.top = height / 2;
    this.camera.bottom = -height / 2;
    this.camera.updateProjectionMatrix();

    this.material.uniforms.uPixelRatio.value = this.state.dpr;
  }

  setReducedMotion(reducedMotion) {
    this.state.reducedMotion = reducedMotion;
  }

  trigger(event) {
    if (event.button !== undefined && event.button !== 0) {
      return;
    }

    const point = this.toScenePoint(event.clientX, event.clientY);
    this.spawnBurst(point.x, point.y);
  }

  toScenePoint(clientX, clientY) {
    return {
      x: clientX - this.state.width / 2,
      y: this.state.height / 2 - clientY,
    };
  }

  spawnBurst(x, y) {
    if (this.bursts.length >= MAX_ACTIVE_BURSTS) {
      this.disposeBurst(this.bursts.shift());
    }

    const baseCount = this.state.width <= 820 ? 42 : 64;
    const particleCount = this.state.reducedMotion ? Math.round(baseCount * 0.55) : baseCount;
    const positions = new Float32Array(particleCount * 3);
    const colors = new Float32Array(particleCount * 3);
    const sizes = new Float32Array(particleCount);
    const alphas = new Float32Array(particleCount);
    const velocities = new Float32Array(particleCount * 3);
    const baseSizes = new Float32Array(particleCount);
    const baseAlphas = new Float32Array(particleCount);
    const twinkle = new Float32Array(particleCount);

    const glowCount = Math.max(4, Math.round(particleCount * 0.14));
    const color = new THREE.Color();

    for (let index = 0; index < particleCount; index += 1) {
      const baseIndex = index * 3;
      const isGlowParticle = index >= particleCount - glowCount;
      const angle = Math.random() * Math.PI * 2;
      const directionX = Math.cos(angle);
      const directionY = Math.sin(angle);
      const speed = isGlowParticle
        ? randBetween(34, 72)
        : randBetween(108, 236) * (0.78 + Math.random() * 0.28);
      const directionalBias = isGlowParticle ? randBetween(-14, 14) : randBetween(-22, 22);
      const spawnRadius = isGlowParticle ? randBetween(3, 8) : randBetween(8, 16);
      const spawnJitter = isGlowParticle ? 2.4 : 1.6;

      positions[baseIndex + 0] = x + directionX * spawnRadius + randBetween(-spawnJitter, spawnJitter);
      positions[baseIndex + 1] = y + directionY * spawnRadius + randBetween(-spawnJitter, spawnJitter);
      positions[baseIndex + 2] = 0;

      velocities[baseIndex + 0] = directionX * speed;
      velocities[baseIndex + 1] = directionY * speed + directionalBias;
      velocities[baseIndex + 2] = 0;

      color.set(FIREWORK_PALETTE[Math.floor(Math.random() * FIREWORK_PALETTE.length)]);
      if (isGlowParticle) {
        color.lerp(new THREE.Color('#fff9ef'), 0.1);
      }

      colors[baseIndex + 0] = color.r;
      colors[baseIndex + 1] = color.g;
      colors[baseIndex + 2] = color.b;

      const size = isGlowParticle ? randBetween(11, 18) : randBetween(5.5, 11);
      const alpha = isGlowParticle ? randBetween(0.14, 0.26) : randBetween(0.36, 0.6);

      sizes[index] = size;
      alphas[index] = alpha;
      baseSizes[index] = size;
      baseAlphas[index] = alpha;
      twinkle[index] = Math.random() * Math.PI * 2;
    }

    const geometry = new THREE.BufferGeometry();
    const positionAttribute = new THREE.BufferAttribute(positions, 3);
    const colorAttribute = new THREE.BufferAttribute(colors, 3);
    const sizeAttribute = new THREE.BufferAttribute(sizes, 1);
    const alphaAttribute = new THREE.BufferAttribute(alphas, 1);

    positionAttribute.setUsage(THREE.DynamicDrawUsage);
    sizeAttribute.setUsage(THREE.DynamicDrawUsage);
    alphaAttribute.setUsage(THREE.DynamicDrawUsage);

    geometry.setAttribute('position', positionAttribute);
    geometry.setAttribute('aColor', colorAttribute);
    geometry.setAttribute('aSize', sizeAttribute);
    geometry.setAttribute('aAlpha', alphaAttribute);

    const points = new THREE.Points(geometry, this.material);
    points.frustumCulled = false;
    this.scene.add(points);

    this.bursts.push({
      points,
      geometry,
      positions,
      velocities,
      baseSizes,
      baseAlphas,
      sizes,
      alphas,
      twinkle,
      positionAttribute,
      sizeAttribute,
      alphaAttribute,
      age: 0,
      lifetime: this.state.reducedMotion ? randBetween(0.55, 0.75) : randBetween(0.9, 1.25),
      drag: this.state.reducedMotion ? 0.9 : 0.93,
      gravity: this.state.reducedMotion ? 360 : 540,
    });
  }

  render({ delta }) {
    const clampedDelta = Math.min(delta, 1 / 24);

    for (let index = this.bursts.length - 1; index >= 0; index -= 1) {
      const burst = this.bursts[index];
      burst.age += clampedDelta;

      const progress = clamp(burst.age / burst.lifetime, 0, 1);
      const fade = 1 - progress;
      const settle = 0.72 + 0.28 * clamp(progress / 0.14, 0, 1);
      const drag = Math.pow(burst.drag, clampedDelta * 60);

      for (let particleIndex = 0; particleIndex < burst.baseSizes.length; particleIndex += 1) {
        const baseIndex = particleIndex * 3;

        burst.velocities[baseIndex + 0] *= drag;
        burst.velocities[baseIndex + 1] *= drag;
        burst.velocities[baseIndex + 1] -= burst.gravity * clampedDelta;

        burst.positions[baseIndex + 0] += burst.velocities[baseIndex + 0] * clampedDelta;
        burst.positions[baseIndex + 1] += burst.velocities[baseIndex + 1] * clampedDelta;

        const twinkle = 0.9 + 0.1 * Math.sin(burst.age * 18 + burst.twinkle[particleIndex]);
        burst.alphas[particleIndex] = burst.baseAlphas[particleIndex] * fade * fade * settle * twinkle;
        burst.sizes[particleIndex] = burst.baseSizes[particleIndex] * (0.62 + fade * 0.38);
      }

      burst.positionAttribute.needsUpdate = true;
      burst.sizeAttribute.needsUpdate = true;
      burst.alphaAttribute.needsUpdate = true;

      if (progress >= 1) {
        this.disposeBurst(burst);
        this.bursts.splice(index, 1);
      }
    }

    this.renderer.render(this.scene, this.camera);
  }

  disposeBurst(burst) {
    if (!burst) return;
    this.scene.remove(burst.points);
    burst.geometry.dispose();
  }

  dispose() {
    while (this.bursts.length) {
      this.disposeBurst(this.bursts.pop());
    }

    this.material.dispose();
    this.sparkTexture.dispose();
    this.renderer.dispose();
    this.canvas.remove();
  }
}
