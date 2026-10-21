import * as THREE from 'three';
import { buildVerticalScrollAtlas } from './atlasBuilder.js';
import {
  FULLSCREEN_VERTEX_SHADER,
  VELOCITY_FRAGMENT_SHADER,
  OFFSET_FRAGMENT_SHADER,
  PARTICLE_VERTEX_SHADER,
  PARTICLE_FRAGMENT_SHADER,
} from './shaders.js';

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function smoothstep(edge0, edge1, value) {
  const t = clamp((value - edge0) / Math.max(edge1 - edge0, 1e-6), 0, 1);
  return t * t * (3 - 2 * t);
}

// Offsets have settled this long after the pointer influence ends.
const SIMULATION_SETTLE_SECONDS = 5;

function currentGrid(config, lightweight) {
  return lightweight ? config.particles.mobile : config.particles.desktop;
}

function currentPaper(config, compact) {
  return compact ? config.paper.mobile : config.paper.desktop;
}

function currentCamera(config, compact) {
  return compact ? config.camera.mobile : config.camera.desktop;
}

function currentPointSize(config, lightweight, viewportHeight) {
  const grid = currentGrid(config, lightweight);
  const particleCount = grid.columns * grid.rows;
  const base = config.particles.basePointSize * Math.sqrt(100000 / particleCount);
  const scale = viewportHeight / 1080;
  return clamp(
    base * scale,
    config.particles.pointSizeMin,
    config.particles.pointSizeMax
  );
}

const PARTICLE_BLENDINGS = {
  additive: THREE.AdditiveBlending,
  normal: THREE.NormalBlending,
};

function currentTheme(config, theme) {
  return config.themes[theme];
}

export class ParticleHero {
  constructor({ canvas, config }) {
    this.canvas = canvas;
    this.config = config;

    this.state = {
      width: 1,
      height: 1,
      dpr: 1,
      compact: false,
      lightweight: false,
      reducedMotion: false,
      scroll: 0,
      theme: document.documentElement.getAttribute('data-theme'),
    };

    this.pointer = {
      inside: false,
      initialized: false,
      target: new THREE.Vector2(),
      current: new THREE.Vector2(),
      presence: 0,
    };
    this.simulationIdleTime = Infinity;

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      alpha: true,
      antialias: false,
      powerPreference: 'high-performance',
    });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.sortObjects = false;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 80);

    this.flowGroup = new THREE.Group();
    this.scene.add(this.flowGroup);

    this.lookAtTarget = new THREE.Vector3();

    this.raycaster = new THREE.Raycaster();
    this.pointerPlane = new THREE.Plane();
    this.pointerNdc = new THREE.Vector2();
    this.pointerHit = new THREE.Vector3();
    this.pointerLocal = new THREE.Vector3();
    this.flowWorldPosition = new THREE.Vector3();
    this.planeNormal = new THREE.Vector3(0, 0, 1);

    this.simScene = new THREE.Scene();
    this.simCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.simMesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicMaterial());
    this.simScene.add(this.simMesh);

    this.atlasTexture = null;
    this.atlasWorldSize = new THREE.Vector2(
      this.config.atlas.worldWidth,
      this.config.atlas.worldWidth / this.config.atlas.visibleAspect
    );

    this.points = null;
    this.pointMaterial = null;
    this.metaTexture = null;

    this.velocityRead = null;
    this.velocityWrite = null;
    this.offsetRead = null;
    this.offsetWrite = null;
    this.velocityMaterial = null;
    this.offsetMaterial = null;
  }

  async init(viewport) {
    await this.loadAtlas();
    this.applyViewport(viewport);
    this.buildParticleResources();
    this.applyViewportUniforms();
    this.refreshLayout(0, 0);
  }

  async loadAtlas() {
    const atlas = await buildVerticalScrollAtlas({
      imageUrls: this.config.atlas.imageUrls,
      targetWidth: this.config.atlas.targetWidth,
      overlapRatio: this.config.atlas.overlapRatio,
      worldWidth: this.config.atlas.worldWidth,
    });

    this.atlasTexture = atlas.texture;
    this.atlasWorldSize.copy(atlas.worldSize);
  }

  resize(viewport) {
    const gridChanged = this.state.lightweight !== viewport.lightweight;
    this.applyViewport(viewport);

    if (gridChanged) {
      this.buildParticleResources();
    }

    this.applyViewportUniforms();
  }

  applyViewport({ width, height, dpr, compact, lightweight }) {
    this.state.width = width;
    this.state.height = height;
    this.state.dpr = dpr;
    this.state.compact = compact;
    this.state.lightweight = lightweight;

    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(width, height, false);

    const cameraPose = currentCamera(this.config, compact);
    this.camera.aspect = width / height;
    this.camera.fov = cameraPose.fov;
    this.camera.updateProjectionMatrix();
  }

  applyViewportUniforms() {
    this.pointMaterial.uniforms.uPointSize.value = currentPointSize(this.config, this.state.lightweight, this.state.height);
    this.pointMaterial.uniforms.uPixelRatio.value = this.state.dpr;
  }

  setReducedMotion(reducedMotion) {
    this.state.reducedMotion = reducedMotion;
  }

  setTheme(theme) {
    this.state.theme = theme;
    this.applyThemeSettings();
  }

  applyThemeSettings() {
    const theme = currentTheme(this.config, this.state.theme);
    this.pointMaterial.uniforms.uThemeMode.value = theme.particleMode;
    this.pointMaterial.uniforms.uGlintStrength.value = theme.glintStrength;
    this.pointMaterial.uniforms.uExposure.value = theme.particleExposure;
    this.pointMaterial.blending = PARTICLE_BLENDINGS[theme.particleBlending];
    this.pointMaterial.needsUpdate = true;
  }

  reapplyConfig() {
    const cameraPose = currentCamera(this.config, this.state.compact);
    this.camera.fov = cameraPose.fov;
    this.camera.updateProjectionMatrix();

    this.velocityMaterial.uniforms.uPointerRadius.value = this.config.interaction.pointerRadius;
    this.velocityMaterial.uniforms.uPointerStrength.value = this.config.interaction.pointerStrength;
    this.velocityMaterial.uniforms.uSpring.value = this.config.interaction.spring;
    this.velocityMaterial.uniforms.uDamping.value = this.config.interaction.damping;
    this.velocityMaterial.uniforms.uTurbulence.value = this.config.interaction.turbulence;
    this.velocityMaterial.uniforms.uMaxSpeed.value = this.config.interaction.maxSpeed;
    this.velocityMaterial.uniforms.uVisibleAspect.value = this.config.atlas.visibleAspect;
    this.velocityMaterial.uniforms.uFallSpeed.value = this.config.particles.fallSpeed;

    this.applyViewportUniforms();
    this.pointMaterial.uniforms.uVisibleAspect.value = this.config.atlas.visibleAspect;
    this.pointMaterial.uniforms.uFallSpeed.value = this.config.particles.fallSpeed;

    this.applyThemeSettings();
    this.refreshLayout(performance.now() / 1000, this.state.scroll);
  }

  handlePointerMove(event) {
    this.pointer.inside = true;

    const rect = this.canvas.getBoundingClientRect();
    this.pointerNdc.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -(((event.clientY - rect.top) / rect.height) * 2 - 1)
    );

    this.updateInteractionPlane();
    this.raycaster.setFromCamera(this.pointerNdc, this.camera);

    if (!this.raycaster.ray.intersectPlane(this.pointerPlane, this.pointerHit)) {
      return;
    }

    this.pointerLocal.copy(this.pointerHit);
    this.flowGroup.worldToLocal(this.pointerLocal);

    this.pointer.target.set(this.pointerLocal.x, this.pointerLocal.y);

    if (!this.pointer.initialized) {
      this.pointer.current.copy(this.pointer.target);
      this.pointer.initialized = true;
    }
  }

  handlePointerDown(event) {
    this.handlePointerMove(event);
    this.pointer.current.copy(this.pointer.target);
  }

  handlePointerLeave() {
    this.pointer.inside = false;
  }

  render({ delta, elapsed, scroll }) {
    const cappedDelta = Math.min(delta, 1 / 30);
    const timeScale = this.state.reducedMotion ? 0.38 : 1.0;
    const time = elapsed * timeScale;

    this.state.scroll = scroll;

    this.updatePointer(cappedDelta);
    this.refreshLayout(time, scroll);

    const pointerInfluence = this.pointer.presence * (1 - smoothstep(0.38, 1.0, scroll));
    this.simulationIdleTime = pointerInfluence > 0 ? 0 : this.simulationIdleTime + cappedDelta;
    if (this.simulationIdleTime < SIMULATION_SETTLE_SECONDS) {
      this.updateSimulation(cappedDelta, time, pointerInfluence);
    }

    this.pointMaterial.uniforms.uTime.value = time;
    this.pointMaterial.uniforms.uScroll.value = scroll;

    this.renderer.setRenderTarget(null);
    this.renderer.render(this.scene, this.camera);
  }

  refreshLayout(time, scroll) {
    this.applyPaperLayout(this.getPaperLayout(time, scroll));
    this.applyCameraLayout(this.getCameraLayout(scroll));
  }

  getPaperLayout(time, scroll) {
    const paper = currentPaper(this.config, this.state.compact);
    const scrollShift = this.config.paper.scrollShift;
    const floatMotion = this.config.paper.floatMotion;

    return {
      position: {
        x: paper.position.x + scrollShift.position.x * scroll + Math.sin(time * 0.16) * floatMotion.positionX,
        y: paper.position.y + scrollShift.position.y * scroll + Math.sin(time * 0.19 + 0.4) * floatMotion.positionY,
        z: paper.position.z + scrollShift.position.z * scroll,
      },
      rotation: {
        x: paper.rotation.x + scrollShift.rotation.x * scroll,
        y: paper.rotation.y + scrollShift.rotation.y * scroll,
        z: paper.rotation.z + scrollShift.rotation.z * scroll,
      },
      scale: paper.scale + scrollShift.scale * scroll,
    };
  }

  applyPaperLayout(layout) {
    this.flowGroup.position.set(layout.position.x, layout.position.y, layout.position.z);
    this.flowGroup.rotation.set(layout.rotation.x, layout.rotation.y, layout.rotation.z);
    this.flowGroup.scale.setScalar(layout.scale);
  }

  getCameraLayout(scroll) {
    const cameraPose = currentCamera(this.config, this.state.compact);
    const cameraShift = this.config.camera.scrollShift;

    const position = {
      // Keep the optical axis centered on the paper so the projected shape stays isosceles.
      x: this.flowGroup.position.x,
      y: cameraPose.position.y + cameraShift.position.y * scroll,
      z: cameraPose.position.z + cameraShift.position.z * scroll,
    };

    return {
      position,
      target: {
        // Keep yaw and roll neutral so the projected top/bottom edges stay horizontal.
        x: position.x,
        y: this.flowGroup.position.y + cameraPose.focusOffset.y + cameraShift.focusOffset.y * scroll,
        z: this.flowGroup.position.z + cameraPose.focusOffset.z + cameraShift.focusOffset.z * scroll,
      },
      filmOffset: cameraPose.screenOffsetX + cameraShift.screenOffsetX * scroll,
    };
  }

  applyCameraLayout(layout) {
    this.camera.position.set(layout.position.x, layout.position.y, layout.position.z);
    this.camera.filmOffset = layout.filmOffset;
    this.camera.updateProjectionMatrix();
    this.lookAtTarget.set(layout.target.x, layout.target.y, layout.target.z);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(this.lookAtTarget);
  }

  updateInteractionPlane() {
    this.flowGroup.updateWorldMatrix(true, false);
    this.flowGroup.getWorldPosition(this.flowWorldPosition);
    this.pointerPlane.setFromNormalAndCoplanarPoint(this.planeNormal, this.flowWorldPosition);
  }

  updatePointer(delta) {
    if (!this.pointer.initialized) {
      return;
    }

    const followSpeed = this.state.compact
      ? this.config.interaction.followMobile
      : this.config.interaction.followDesktop;

    const moveAlpha = 1 - Math.exp(-delta * (this.pointer.inside ? 12 + followSpeed * 10 : 5));
    this.pointer.current.lerp(this.pointer.target, moveAlpha);

    const direction = this.pointer.inside ? 1 : -1;
    const rate = this.pointer.inside ? this.config.interaction.enterRate : this.config.interaction.leaveRate;
    this.pointer.presence = clamp(this.pointer.presence + direction * rate * delta, 0, 1);

    if (!this.pointer.inside) {
      this.pointer.current.multiplyScalar(1 - this.config.interaction.idleReturn * delta);
    }
  }

  updateSimulation(delta, time, pointerInfluence) {
    this.velocityMaterial.uniforms.uTime.value = time;
    this.velocityMaterial.uniforms.uDelta.value = delta;
    this.velocityMaterial.uniforms.uVelocityTexture.value = this.velocityRead.texture;
    this.velocityMaterial.uniforms.uOffsetTexture.value = this.offsetRead.texture;
    this.velocityMaterial.uniforms.uPointer.value.set(
      this.pointer.current.x,
      this.pointer.current.y,
      pointerInfluence
    );

    this.simMesh.material = this.velocityMaterial;
    this.renderer.setRenderTarget(this.velocityWrite);
    this.renderer.render(this.simScene, this.simCamera);

    this.offsetMaterial.uniforms.uDelta.value = delta;
    this.offsetMaterial.uniforms.uVelocityTexture.value = this.velocityWrite.texture;
    this.offsetMaterial.uniforms.uOffsetTexture.value = this.offsetRead.texture;

    this.simMesh.material = this.offsetMaterial;
    this.renderer.setRenderTarget(this.offsetWrite);
    this.renderer.render(this.simScene, this.simCamera);

    [this.velocityRead, this.velocityWrite] = [this.velocityWrite, this.velocityRead];
    [this.offsetRead, this.offsetWrite] = [this.offsetWrite, this.offsetRead];

    this.pointMaterial.uniforms.uOffsetTexture.value = this.offsetRead.texture;
  }

  buildParticleResources() {
    if (this.points) {
      this.disposeParticleResources();
    }

    const grid = currentGrid(this.config, this.state.lightweight);
    const { geometry, metaTexture, width, height } = this.createPointGeometry(grid.columns, grid.rows);
    this.metaTexture = metaTexture;

    this.createSimulationTargets(width, height);
    this.createSimulationMaterials();
    this.createPointMaterial();

    this.points = new THREE.Points(geometry, this.pointMaterial);
    this.points.frustumCulled = false;
    this.flowGroup.add(this.points);
  }

  createPointGeometry(columns, rows) {
    const particleCount = columns * rows;
    const positions = new Float32Array(particleCount * 3);
    const uv = new Float32Array(particleCount * 2);
    const simUv = new Float32Array(particleCount * 2);
    const scale = new Float32Array(particleCount);
    const randomness = new Float32Array(particleCount * 3);
    const meta = new Float32Array(particleCount * 4);

    let particleIndex = 0;
    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        const u = column / (columns - 1);
        const v = row / (rows - 1);
        const simX = (column + 0.5) / columns;
        const simY = (row + 0.5) / rows;
        const randomX = Math.random();
        const randomY = Math.random();
        const randomZ = Math.random();
        const randomW = Math.random();

        const base3 = particleIndex * 3;
        const base2 = particleIndex * 2;
        const base4 = particleIndex * 4;

        positions[base3 + 0] = 0;
        positions[base3 + 1] = 0;
        positions[base3 + 2] = 0;

        uv[base2 + 0] = u;
        uv[base2 + 1] = v;
        simUv[base2 + 0] = simX;
        simUv[base2 + 1] = simY;

        scale[particleIndex] = 0.68 + randomW * 0.62;
        randomness[base3 + 0] = randomX;
        randomness[base3 + 1] = randomY;
        randomness[base3 + 2] = randomZ;

        meta[base4 + 0] = u;
        meta[base4 + 1] = v;
        meta[base4 + 2] = randomZ;
        meta[base4 + 3] = randomW;

        particleIndex += 1;
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aUV', new THREE.BufferAttribute(uv, 2));
    geometry.setAttribute('aSimUV', new THREE.BufferAttribute(simUv, 2));
    geometry.setAttribute('aScale', new THREE.BufferAttribute(scale, 1));
    geometry.setAttribute('aRandomness', new THREE.BufferAttribute(randomness, 3));

    const metaTexture = new THREE.DataTexture(meta, columns, rows, THREE.RGBAFormat, THREE.FloatType);
    metaTexture.minFilter = THREE.NearestFilter;
    metaTexture.magFilter = THREE.NearestFilter;
    metaTexture.generateMipmaps = false;
    metaTexture.flipY = false;
    metaTexture.needsUpdate = true;

    return { geometry, metaTexture, width: columns, height: rows };
  }

  createRenderTarget(width, height) {
    return new THREE.WebGLRenderTarget(width, height, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      format: THREE.RGBAFormat,
      type: THREE.HalfFloatType,
      depthBuffer: false,
      stencilBuffer: false,
    });
  }

  clearRenderTarget(target) {
    this.renderer.setRenderTarget(target);
    this.renderer.clear();
  }

  createSimulationTargets(width, height) {
    this.velocityRead = this.createRenderTarget(width, height);
    this.velocityWrite = this.createRenderTarget(width, height);
    this.offsetRead = this.createRenderTarget(width, height);
    this.offsetWrite = this.createRenderTarget(width, height);

    this.clearRenderTarget(this.velocityRead);
    this.clearRenderTarget(this.velocityWrite);
    this.clearRenderTarget(this.offsetRead);
    this.clearRenderTarget(this.offsetWrite);
    this.renderer.setRenderTarget(null);
  }

  createSimulationMaterials() {
    const interaction = this.config.interaction;

    this.velocityMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uVelocityTexture: { value: this.velocityRead.texture },
        uOffsetTexture: { value: this.offsetRead.texture },
        uMetaTexture: { value: this.metaTexture },
        uTime: { value: 0 },
        uDelta: { value: 0 },
        uPointer: { value: new THREE.Vector3(0, 0, 0) },
        uPointerRadius: { value: interaction.pointerRadius },
        uPointerStrength: { value: interaction.pointerStrength },
        uSpring: { value: interaction.spring },
        uDamping: { value: interaction.damping },
        uTurbulence: { value: interaction.turbulence },
        uMaxSpeed: { value: interaction.maxSpeed },
        uAtlasWorldSize: { value: this.atlasWorldSize.clone() },
        uVisibleAspect: { value: this.config.atlas.visibleAspect },
        uFallSpeed: { value: this.config.particles.fallSpeed },
      },
      vertexShader: FULLSCREEN_VERTEX_SHADER,
      fragmentShader: VELOCITY_FRAGMENT_SHADER,
      depthWrite: false,
      depthTest: false,
    });

    this.offsetMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uVelocityTexture: { value: this.velocityRead.texture },
        uOffsetTexture: { value: this.offsetRead.texture },
        uDelta: { value: 0 },
      },
      vertexShader: FULLSCREEN_VERTEX_SHADER,
      fragmentShader: OFFSET_FRAGMENT_SHADER,
      depthWrite: false,
      depthTest: false,
    });
  }

  createPointMaterial() {
    const theme = currentTheme(this.config, this.state.theme);

    this.pointMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uPointSize: { value: currentPointSize(this.config, this.state.lightweight, this.state.height) },
        uPixelRatio: { value: this.state.dpr },
        uScroll: { value: 0 },
        uAtlasTexture: { value: this.atlasTexture },
        uOffsetTexture: { value: this.offsetRead.texture },
        uAtlasWorldSize: { value: this.atlasWorldSize.clone() },
        uVisibleAspect: { value: this.config.atlas.visibleAspect },
        uFallSpeed: { value: this.config.particles.fallSpeed },
        uGlintStrength: { value: theme.glintStrength },
        uExposure: { value: theme.particleExposure },
        uThemeMode: { value: theme.particleMode },
      },
      vertexShader: PARTICLE_VERTEX_SHADER,
      fragmentShader: PARTICLE_FRAGMENT_SHADER,
      transparent: true,
      depthWrite: false,
      blending: PARTICLE_BLENDINGS[theme.particleBlending],
    });
  }

  disposeParticleResources() {
    this.flowGroup.remove(this.points);
    this.points.geometry.dispose();
    this.points.material.dispose();
    this.points = null;

    [this.velocityRead, this.velocityWrite, this.offsetRead, this.offsetWrite].forEach((target) => {
      target.dispose();
    });
    this.velocityRead = null;
    this.velocityWrite = null;
    this.offsetRead = null;
    this.offsetWrite = null;

    this.velocityMaterial.dispose();
    this.offsetMaterial.dispose();
    this.velocityMaterial = null;
    this.offsetMaterial = null;

    this.metaTexture.dispose();
    this.metaTexture = null;
    this.pointMaterial = null;
  }
}
