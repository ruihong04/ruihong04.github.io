import * as THREE from '../three.module.js';

function clamp01(value) {
  return Math.min(1, Math.max(0, value));
}

function blendBands(fromBand, toBand) {
  const output = new ImageData(fromBand.width, fromBand.height);
  const lastRow = Math.max(fromBand.height - 1, 1);

  for (let y = 0; y < fromBand.height; y += 1) {
    const mixAmount = clamp01(y / lastRow);
    for (let x = 0; x < fromBand.width; x += 1) {
      const index = (y * fromBand.width + x) * 4;
      output.data[index + 0] = Math.round(fromBand.data[index + 0] * (1 - mixAmount) + toBand.data[index + 0] * mixAmount);
      output.data[index + 1] = Math.round(fromBand.data[index + 1] * (1 - mixAmount) + toBand.data[index + 1] * mixAmount);
      output.data[index + 2] = Math.round(fromBand.data[index + 2] * (1 - mixAmount) + toBand.data[index + 2] * mixAmount);
      output.data[index + 3] = 255;
    }
  }

  return output;
}

function blendLoopSeam(topBand, bottomBand) {
  const output = new ImageData(topBand.width, topBand.height);
  const lastRow = Math.max(topBand.height - 1, 1);

  for (let y = 0; y < topBand.height; y += 1) {
    const mixAmount = clamp01(y / lastRow);
    const reverseY = topBand.height - 1 - y;

    for (let x = 0; x < topBand.width; x += 1) {
      const writeIndex = (y * topBand.width + x) * 4;
      const bottomIndex = (reverseY * bottomBand.width + x) * 4;

      output.data[writeIndex + 0] = Math.round(bottomBand.data[bottomIndex + 0] * (1 - mixAmount) + topBand.data[writeIndex + 0] * mixAmount);
      output.data[writeIndex + 1] = Math.round(bottomBand.data[bottomIndex + 1] * (1 - mixAmount) + topBand.data[writeIndex + 1] * mixAmount);
      output.data[writeIndex + 2] = Math.round(bottomBand.data[bottomIndex + 2] * (1 - mixAmount) + topBand.data[writeIndex + 2] * mixAmount);
      output.data[writeIndex + 3] = 255;
    }
  }

  return output;
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = 'async';
    image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = url;
  });
}

function createPainterlyFallbackSlide(index) {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 1344;
  const ctx = canvas.getContext('2d');

  const palettes = [
    ['#132a2d', '#496d58', '#b7b86d', '#efe1a8'],
    ['#101926', '#24425a', '#6a8ba2', '#e7d7aa'],
    ['#1e1a1c', '#4f372f', '#b46b36', '#f0cb76'],
    ['#0c1734', '#27356d', '#8062a1', '#f5c779'],
    ['#15100d', '#3b241d', '#765034', '#f2c59b'],
  ];
  const palette = palettes[index % palettes.length];

  const background = ctx.createLinearGradient(0, 0, 0, canvas.height);
  background.addColorStop(0, palette[0]);
  background.addColorStop(0.45, palette[1]);
  background.addColorStop(1, palette[2]);
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const glow = ctx.createRadialGradient(canvas.width * 0.62, canvas.height * 0.34, 40, canvas.width * 0.62, canvas.height * 0.34, canvas.width * 0.48);
  glow.addColorStop(0, palette[3]);
  glow.addColorStop(0.45, `${palette[3]}66`);
  glow.addColorStop(1, `${palette[3]}00`);
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  for (let i = 0; i < 120; i += 1) {
    const x = Math.random() * canvas.width;
    const y = Math.random() * canvas.height;
    const w = canvas.width * (0.12 + Math.random() * 0.36);
    const h = 28 + Math.random() * 120;
    const rotation = (Math.random() - 0.5) * 0.9;
    const color = palette[Math.floor(Math.random() * palette.length)];

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rotation);
    ctx.globalAlpha = 0.11 + Math.random() * 0.14;
    ctx.fillStyle = color;
    ctx.fillRect(-w * 0.5, -h * 0.5, w, h);
    ctx.restore();
  }

  for (let i = 0; i < 45; i += 1) {
    const radius = 20 + Math.random() * 180;
    const x = Math.random() * canvas.width;
    const y = Math.random() * canvas.height;
    const fill = palette[Math.floor(Math.random() * palette.length)];

    ctx.save();
    ctx.globalAlpha = 0.08 + Math.random() * 0.1;
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.ellipse(x, y, radius, radius * (0.45 + Math.random() * 0.6), Math.random() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  return canvas;
}

function createFallbackSlides(count = 5) {
  return Array.from({ length: count }, (_, index) => createPainterlyFallbackSlide(index));
}

function normalizeImageSource(image) {
  const width = image.naturalWidth || image.width || 1;
  const height = image.naturalHeight || image.height || 1;
  return { source: image, width, height };
}

export async function buildVerticalScrollAtlas(options) {
  const {
    imageUrls,
    targetWidth = 1024,
    overlapRatio = 0.16,
    worldWidth = 10,
  } = options;

  let sources;
  try {
    const images = await Promise.all((imageUrls || []).map((url) => loadImage(url)));
    sources = images.map(normalizeImageSource);
  } catch (error) {
    sources = createFallbackSlides().map(normalizeImageSource);
  }

  if (!sources.length) {
    sources = createFallbackSlides().map(normalizeImageSource);
  }

  const slideHeights = sources.map(({ width, height }) => Math.max(2, Math.round((height / Math.max(width, 1)) * targetWidth)));
  const overlaps = slideHeights.map((height, index) => {
    if (index === 0) return 0;
    return Math.max(8, Math.round(Math.min(slideHeights[index - 1], height) * overlapRatio));
  });

  let atlasHeight = slideHeights[0];
  for (let index = 1; index < slideHeights.length; index += 1) {
    atlasHeight += slideHeights[index] - overlaps[index];
  }
  atlasHeight = Math.max(atlasHeight, 4);

  const atlasCanvas = document.createElement('canvas');
  atlasCanvas.width = targetWidth;
  atlasCanvas.height = atlasHeight;

  const ctx = atlasCanvas.getContext('2d');
  if (!ctx) {
    throw new Error('Could not create 2D context for atlas generation.');
  }

  ctx.clearRect(0, 0, atlasCanvas.width, atlasCanvas.height);
  ctx.drawImage(sources[0].source, 0, 0, atlasCanvas.width, slideHeights[0]);

  let cursor = slideHeights[0];
  for (let index = 1; index < sources.length; index += 1) {
    const overlap = overlaps[index];
    const nextHeight = slideHeights[index];
    const drawY = cursor - overlap;
    const previousBand = ctx.getImageData(0, drawY, atlasCanvas.width, overlap);

    ctx.drawImage(sources[index].source, 0, drawY, atlasCanvas.width, nextHeight);

    const currentBand = ctx.getImageData(0, drawY, atlasCanvas.width, overlap);
    ctx.putImageData(blendBands(previousBand, currentBand), 0, drawY);

    cursor = drawY + nextHeight;
  }

  const loopOverlap = Math.max(8, Math.round(Math.min(slideHeights[0], slideHeights[slideHeights.length - 1]) * overlapRatio));
  if (loopOverlap * 2 < atlasCanvas.height) {
    const topBand = ctx.getImageData(0, 0, atlasCanvas.width, loopOverlap);
    const bottomBand = ctx.getImageData(0, atlasCanvas.height - loopOverlap, atlasCanvas.width, loopOverlap);
    ctx.putImageData(blendLoopSeam(topBand, bottomBand), 0, 0);
  }

  const texture = new THREE.CanvasTexture(atlasCanvas);
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.generateMipmaps = false;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;

  return {
    canvas: atlasCanvas,
    texture,
    worldSize: new THREE.Vector2(worldWidth, worldWidth * (atlasCanvas.height / atlasCanvas.width)),
    slideHeights,
    overlaps,
  };
}
