export const FULLSCREEN_VERTEX_SHADER = /* glsl */ `
precision highp float;

varying vec2 vUv;

void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const SIMPLEX_NOISE_GLSL = /* glsl */ `
vec4 mod289(vec4 x) {
  return x - floor(x * (1.0 / 289.0)) * 289.0;
}

vec3 mod289(vec3 x) {
  return x - floor(x * (1.0 / 289.0)) * 289.0;
}

vec4 permute(vec4 x) {
  return mod289(((x * 34.0) + 1.0) * x);
}

vec4 taylorInvSqrt(vec4 r) {
  return 1.79284291400159 - 0.85373472095314 * r;
}

float snoise(vec3 v) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);

  vec3 i = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);

  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);

  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.xxx * 2.0;
  vec3 x3 = x0 - 1.0 + C.xxx * 3.0;

  i = mod289(i);
  vec4 p = permute(
    permute(
      permute(i.z + vec4(0.0, i1.z, i2.z, 1.0)) +
      i.y + vec4(0.0, i1.y, i2.y, 1.0)
    ) +
    i.x + vec4(0.0, i1.x, i2.x, 1.0)
  );

  float n_ = 1.0 / 7.0;
  vec3 ns = n_ * D.wyz - D.xzx;

  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);

  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);

  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);

  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);

  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));

  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;

  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);

  vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x;
  p1 *= norm.y;
  p2 *= norm.z;
  p3 *= norm.w;

  vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  m = m * m;

  return 42.0 * dot(m * m, vec4(
    dot(p0, x0),
    dot(p1, x1),
    dot(p2, x2),
    dot(p3, x3)
  ));
}

vec3 snoise3(vec3 p) {
  return vec3(
    snoise(p + vec3(11.7, -4.2, 1.3)),
    snoise(p + vec3(-6.1, 9.4, 2.7)),
    snoise(p + vec3(3.8, 7.2, -2.9))
  );
}
`;

const FLOW_UTILS_GLSL = /* glsl */ `
struct FlowSample {
  float drop;
  float atlasV;
  float phaseIn;
  float phaseOut;
  float river;
  vec3 position;
};

FlowSample sampleFlow(vec2 particleUv, float time, vec2 atlasWorldSize, float visibleAspect, float fallSpeed) {
  float visibleHeight = atlasWorldSize.x / max(visibleAspect, 0.0001);
  float stripCount = atlasWorldSize.y / max(visibleHeight, 0.0001);

  float stream = particleUv.y - time * fallSpeed;
  float drop = fract(stream);
  float stripIndex = floor(time * fallSpeed - particleUv.y) + 1.0;
  float atlasY = mod(particleUv.y + stripIndex + stripCount, stripCount);

  FlowSample flow;
  flow.drop = drop;
  flow.atlasV = atlasY / stripCount;
  flow.phaseIn = smoothstep(0.72, 0.98, drop);
  flow.phaseOut = smoothstep(0.26, 0.0, drop);
  flow.river = 1.0 - max(flow.phaseIn, flow.phaseOut);
  flow.position = vec3(
    (particleUv.x - 0.5) * atlasWorldSize.x,
    (drop - 0.5) * visibleHeight,
    0.0
  );
  return flow;
}
`;

export const VELOCITY_FRAGMENT_SHADER = /* glsl */ `
precision highp float;

varying vec2 vUv;

uniform sampler2D uVelocityTexture;
uniform sampler2D uOffsetTexture;
uniform sampler2D uMetaTexture;
uniform float uTime;
uniform float uDelta;
uniform vec3 uPointer;
uniform float uPointerRadius;
uniform float uPointerStrength;
uniform float uSpring;
uniform float uDamping;
uniform float uTurbulence;
uniform float uMaxSpeed;
uniform vec2 uAtlasWorldSize;
uniform float uVisibleAspect;
uniform float uFallSpeed;

${SIMPLEX_NOISE_GLSL}
${FLOW_UTILS_GLSL}

void main() {
  vec4 meta = texture2D(uMetaTexture, vUv);
  vec2 particleUv = meta.xy;
  float sideSeed = meta.z;
  float noiseSeed = meta.w;

  vec3 velocity = texture2D(uVelocityTexture, vUv).xyz;
  vec3 offset = texture2D(uOffsetTexture, vUv).xyz;

  FlowSample flow = sampleFlow(particleUv, uTime, uAtlasWorldSize, uVisibleAspect, uFallSpeed);
  vec3 particlePos = flow.position + offset;

  float side = mix(-1.0, 1.0, step(0.5, sideSeed));
  if (abs(particlePos.z) > 0.035) {
    side = sign(particlePos.z);
  }

  vec3 acceleration = -offset * uSpring;

  if (uPointer.z > 0.0001) {
    vec3 pointerPos = vec3(uPointer.xy, 0.0);
    vec3 away = particlePos - pointerPos;

    float planeDistance = length(away.xy);
    float falloff = exp(-pow(planeDistance / max(uPointerRadius, 0.0001), 2.0));

    away.z += side * uPointerRadius * 0.58 * falloff;

    float distanceToPointer = length(away) + 0.0001;
    vec3 repelDirection = away / distanceToPointer;
    float influence = falloff * uPointer.z * uPointerStrength;

    acceleration += repelDirection * influence;
    acceleration.z += side * influence * 0.32 * falloff;

    vec3 fieldA = snoise3(vec3(
      particlePos.xy * 0.34 + vec2(noiseSeed * 4.0, uTime * 0.12),
      4.0 + side * 2.0
    ));
    vec3 fieldB = snoise3(vec3(
      (particlePos.xy + vec2(side * 0.8, -side * 0.4)) * 0.62,
      10.0 + uTime * 0.07 + noiseSeed * 5.0
    ));

    acceleration += fieldA * influence * uTurbulence * vec3(0.60, 0.44, 0.74);
    acceleration += fieldB * influence * uTurbulence * vec3(0.26, 0.18, 0.42);
  }

  velocity += acceleration * uDelta;
  velocity *= exp(-uDamping * uDelta);

  float speed = length(velocity);
  if (speed > uMaxSpeed) {
    velocity *= uMaxSpeed / speed;
  }

  gl_FragColor = vec4(velocity, 1.0);
}
`;

export const OFFSET_FRAGMENT_SHADER = /* glsl */ `
precision highp float;

varying vec2 vUv;

uniform sampler2D uVelocityTexture;
uniform sampler2D uOffsetTexture;
uniform float uDelta;

void main() {
  vec3 velocity = texture2D(uVelocityTexture, vUv).xyz;
  vec3 offset = texture2D(uOffsetTexture, vUv).xyz;
  offset += velocity * uDelta;
  gl_FragColor = vec4(offset, 1.0);
}
`;

export const PARTICLE_VERTEX_SHADER = /* glsl */ `
precision highp float;

uniform float uTime;
uniform float uPointSize;
uniform float uPixelRatio;
uniform float uScroll;
uniform sampler2D uAtlasTexture;
uniform sampler2D uOffsetTexture;
uniform vec2 uAtlasWorldSize;
uniform float uVisibleAspect;
uniform float uFallSpeed;
uniform float uGlintStrength;
uniform float uExposure;

attribute vec2 aUV;
attribute vec2 aSimUV;
attribute float aScale;
attribute vec3 aRandomness;

varying vec3 vColor;
varying float vAlpha;
varying float vGlint;

${SIMPLEX_NOISE_GLSL}
${FLOW_UTILS_GLSL}

void main() {
  FlowSample flow = sampleFlow(aUV, uTime, uAtlasWorldSize, uVisibleAspect, uFallSpeed);
  vec3 pos = flow.position;

  vec3 sampledColor = texture2D(uAtlasTexture, vec2(aUV.x, flow.atlasV)).rgb;
  sampledColor = pow(sampledColor, vec3(1.18));
  sampledColor *= uExposure;
  sampledColor = sampledColor / (1.0 + sampledColor * 0.78);

  float luminance = dot(sampledColor, vec3(0.2126, 0.7152, 0.0722));
  sampledColor = mix(vec3(luminance), sampledColor, 0.88);

  float alpha = 0.56;
  float edgeMask = smoothstep(0.015, 0.08, aUV.x) * (1.0 - smoothstep(0.92, 0.985, aUV.x));
  alpha *= mix(0.72, 1.0, edgeMask);

  float entryNoiseA = snoise(vec3(aRandomness.xy * 10.5 + vec2(0.0, uTime * 0.16), 1.0 + aRandomness.z * 2.0));
  float entryNoiseB = snoise(vec3(aRandomness.yx * 6.4, 5.2 + uTime * 0.12));
  pos.z += pow(flow.phaseIn, 4.25) * 9.4;
  pos.x += entryNoiseA * flow.phaseIn * 1.16;
  pos.z += entryNoiseB * flow.phaseIn * 0.56;

  float driftA = snoise(vec3(aRandomness.xy * 8.6 + pos.xy * 0.02, uTime * 0.24));
  float driftB = snoise(vec3(aRandomness.xy * 4.1 + vec2(3.7, -2.4), 4.0 + uTime * 0.17));
  pos.x += driftA * flow.river * 0.04;
  pos.z += driftB * flow.river * 0.016;

  if (flow.phaseOut > 0.0001) {
    float breakup = pow(flow.phaseOut, 2.0);
    vec2 breakupField = vec2(
      snoise(vec3(pos.xy * 0.42 + vec2(uTime * 0.09, -uTime * 0.05), 8.0)),
      snoise(vec3(pos.xy * 0.42 + vec2(4.1, -2.2), 12.0 + uTime * 0.09))
    );
    vec2 breakupDir = normalize(breakupField + vec2(0.0001));
    float sparkSeed = fract(dot(aRandomness, vec3(17.1, 29.7, 47.3)));
    float spark = step(0.86, sparkSeed) * pow(flow.phaseOut, 1.7) * smoothstep(0.22, 1.0, flow.phaseOut);

    pos.y -= breakup * (1.9 + 3.1 * flow.phaseOut);
    pos.z -= pow(flow.phaseOut, 3.8) * 18.0;
    pos.x += breakupDir.x * breakup * aRandomness.z * 2.1;
    pos.z += breakupDir.y * breakup * aRandomness.z * 1.2;
    pos.x += breakupDir.x * spark * 6.4;
    pos.z += breakupDir.y * spark * 4.8;
    pos.y += spark * 1.4;

    alpha *= clamp(1.0 - breakup * (0.24 + 0.24 * abs(breakupField.x)) - spark * 0.26, 0.0, 1.0);
  }

  vec3 interactionOffset = texture2D(uOffsetTexture, aSimUV).xyz;
  pos += interactionOffset;

  float glintSeed = fract(dot(aRandomness, vec3(11.3, 29.7, 47.1)));
  float glintBias = smoothstep(0.36, 1.0, flow.drop);
  float glintMask = step(mix(0.9996, 0.996, glintBias), glintSeed);
  float glintPulse = pow(max(sin(uTime * (1.0 + aRandomness.x * 0.7) + aRandomness.y * 80.0 + aRandomness.z * 42.0), 0.0), 28.0);
  float glintField = smoothstep(0.24, 0.86, 0.5 + 0.5 * snoise(vec3(pos.xy * 0.35 + vec2(uTime * 0.12, -uTime * 0.09), 9.0)));
  float glint = glintMask * glintPulse * glintField * uGlintStrength * 0.9;

  sampledColor *= 1.0 + flow.phaseIn * 0.05;
  alpha *= 1.0 - smoothstep(0.48, 1.05, uScroll);

  vColor = sampledColor;
  vAlpha = alpha;
  vGlint = glint;

  vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
  gl_Position = projectionMatrix * mvPosition;

  float size = uPointSize * aScale * uPixelRatio;
  size *= 1.0 / max(0.0001, -mvPosition.z);
  size *= 1.0 + glint * 0.16;
  gl_PointSize = size;
}
`;

export const PARTICLE_FRAGMENT_SHADER = /* glsl */ `
precision highp float;

varying vec3 vColor;
varying float vAlpha;
varying float vGlint;

void main() {
  vec2 pointUv = gl_PointCoord - vec2(0.5);
  float radius = dot(pointUv, pointUv);
  if (radius > 0.25) {
    discard;
  }

  float soft = 1.0 - smoothstep(0.14, 0.25, radius);
  vec3 gold = vec3(1.08, 0.96, 0.74);
  vec3 color = vColor + gold * vGlint * 0.24;
  float alpha = min(vAlpha * soft * (0.52 + vGlint * 0.54), 1.0);

  gl_FragColor = vec4(color, alpha);
}
`;
