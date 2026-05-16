import * as THREE from 'three';

function clamp01(value) {
  return Math.min(1, Math.max(0, value));
}

function blendBands(fromBand, toBand) {
  const output = new ImageData(fromBand.width, fromBand.height);
  const lastRow = fromBand.height - 1;

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
  const lastRow = topBand.height - 1;

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

function normalizeImageSource(image) {
  return {
    source: image,
    width: image.naturalWidth,
    height: image.naturalHeight,
  };
}

export async function buildVerticalScrollAtlas(options) {
  const {
    imageUrls,
    targetWidth,
    overlapRatio,
    worldWidth,
  } = options;

  const images = await Promise.all(imageUrls.map((url) => loadImage(url)));
  const sources = images.map(normalizeImageSource);

  const slideHeights = sources.map(({ width, height }) => Math.max(2, Math.round((height / width) * targetWidth)));
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
