/* Zero-dependency WebGL2 product stage.

   Renders the product photo as a closed soft volume: a displaced grid mesh
   whose front and back shells meet at the silhouette (depth -> 0 at the mask
   edge). Per-fragment normals come from the depth texture, lit by a warm
   key/fill/rim studio setup over the panel's cream paper. Two modes:

   - "scan":  locked three-quarter pose, a light band sweeps the item while
              the analysis runs.
   - "orbit": slow turntable rotation with drag-to-spin inertia.

   The same instance survives the loading -> loaded transition so the object
   is physically continuous when the verdict lands. */

import type { DepthMap } from "./depth";

export type StageMode = "scan" | "orbit";

type StageOptions = {
  reducedMotion?: boolean;
};

const FOV = (26 * Math.PI) / 180;
const CAMERA_TILT = (-10 * Math.PI) / 180;
const SCAN_POSE = -0.38;
const ORBIT_SPEED = 0.55; // rad/s
const SCAN_PERIOD = 2.6; // s per sweep

const VERTEX_SHADER = `#version 300 es
precision highp float;

in vec2 aGrid;

uniform sampler2D uDepth;
uniform mat4 uProjection;
uniform mat4 uView;
uniform mat4 uModel;
uniform vec2 uHalfExtent;
uniform float uThickness;
uniform float uSide;
uniform float uIntro;
uniform float uFlatten;

out vec2 vUv;
out vec3 vWorldPos;

void main() {
  vUv = aGrid;
  float depth = texture(uDepth, aGrid).r * (1.0 - uFlatten);
  vec3 local = vec3(
    (aGrid.x - 0.5) * 2.0 * uHalfExtent.x,
    (0.5 - aGrid.y) * 2.0 * uHalfExtent.y,
    uSide * depth * uThickness
  );
  local *= mix(0.92, 1.0, uIntro);
  vec4 world = uModel * vec4(local, 1.0);
  vWorldPos = world.xyz;
  gl_Position = uProjection * uView * world;
}`;

const FRAGMENT_SHADER = `#version 300 es
precision highp float;

in vec2 vUv;
in vec3 vWorldPos;

uniform sampler2D uColor;
uniform sampler2D uDepth;
uniform mat3 uNormalMatrix;
uniform vec2 uTexelSize;
uniform vec2 uHalfExtent;
uniform float uThickness;
uniform float uSide;
uniform float uOrbitMix;
uniform float uScanActive;
uniform float uScanY;
uniform float uIntro;
uniform float uRimBoost;
uniform vec3 uRimColor;
uniform vec3 uCameraPos;
uniform float uDebugAlpha;

out vec4 outColor;

void main() {
  vec4 albedo = texture(uColor, vUv);
  float alpha = albedo.a;
  if (uDebugAlpha > 0.5) {
    outColor = vec4(alpha, 1.0 - alpha, texture(uDepth, vUv).r * 0.5, 1.0);
    return;
  }
  // Sharpen the silhouette edge to roughly one pixel.
  alpha = clamp((alpha - 0.5) / max(fwidth(alpha), 1e-4) + 0.5, 0.0, 1.0);
  if (alpha < 0.004) discard;

  // Normal from depth gradient. Wide taps (1.6 texels) smooth the stair-steps
  // the low-res depth grid would otherwise print along the silhouette rim.
  vec2 tap = uTexelSize * 1.6;
  float dR = texture(uDepth, vUv + vec2(tap.x, 0.0)).r;
  float dL = texture(uDepth, vUv - vec2(tap.x, 0.0)).r;
  float dD = texture(uDepth, vUv + vec2(0.0, tap.y)).r;
  float dU = texture(uDepth, vUv - vec2(0.0, tap.y)).r;
  vec2 worldTap = tap * uHalfExtent * 2.0;
  vec3 normal = normalize(vec3(
    -(dR - dL) * uThickness / max(worldTap.x * 2.0, 1e-5),
    (dD - dU) * uThickness / max(worldTap.y * 2.0, 1e-5),
    1.0
  ));
  normal.z *= uSide;
  normal = normalize(uNormalMatrix * normal);

  vec3 viewDir = normalize(uCameraPos - vWorldPos);

  vec3 keyDir = normalize(vec3(-0.38, 0.55, 0.74));
  vec3 fillDir = normalize(vec3(0.62, 0.08, 0.45));

  float key = dot(normal, keyDir) * 0.5 + 0.5;
  key = pow(key, 1.7);
  float fill = max(dot(normal, fillDir), 0.0);

  vec3 keyColor = vec3(1.0, 0.985, 0.955);
  vec3 fillColor = vec3(0.955, 0.97, 1.0);
  vec3 ambient = vec3(0.38, 0.375, 0.365);

  // Keep the lit maximum just under 1.0 so the photo's own shading survives.
  vec3 light = ambient + keyColor * key * 0.56 + fillColor * fill * 0.12;

  vec3 halfVec = normalize(keyDir + viewDir);
  float spec = pow(max(dot(normal, halfVec), 0.0), 26.0) * mix(0.08, 0.16, uOrbitMix);

  // Soft fresnel edge shading defines a light object on light paper, and a
  // hint of tone (verdict colour) lives in the same band.
  float facing = 1.0 - abs(dot(normal, viewDir));
  float edge = pow(facing, 3.0);
  light *= 1.0 - edge * 0.26;
  float rim = pow(facing, 3.4) * mix(0.14, 0.3, uOrbitMix) * (1.0 + uRimBoost * 1.7);

  vec3 color = albedo.rgb * light + vec3(spec) + uRimColor * rim;

  // Back shell reads as the shaded reverse of the item.
  if (uSide < 0.0) color *= 0.92;

  // Scan: a cool analytic band sweeps top to bottom. Material below the
  // leading line is slightly dimmed ("not yet read") so the motion stays
  // legible even on white fabric.
  float rel = vUv.y - uScanY;
  float band = exp(-pow(rel * 22.0, 2.0));
  float line = exp(-pow(rel * 170.0, 2.0));
  float ahead = smoothstep(0.0, 0.08, rel);
  color *= 1.0 - ahead * 0.055 * uScanActive;
  vec3 scanGlow = vec3(0.4, 0.58, 0.74) * band * 0.34 + vec3(0.88, 0.96, 1.0) * line * 0.62;
  color += scanGlow * uScanActive;

  color *= mix(0.97, 1.0, uIntro);
  outColor = vec4(color * alpha, alpha * uIntro);
}`;

/* The contact shadow is a camera-facing soft ellipse: a true ground-plane quad
   would be seen nearly edge-on at this camera tilt and vanish to a sliver. */
const SHADOW_VERTEX = `#version 300 es
precision highp float;
in vec2 aGrid;
uniform mat4 uProjection;
uniform mat4 uView;
uniform vec3 uShadowCenter;
uniform vec2 uShadowRadius;
out vec2 vLocal;
void main() {
  vLocal = aGrid * 2.0 - 1.0;
  vec3 world = uShadowCenter + vec3(vLocal.x * uShadowRadius.x, vLocal.y * uShadowRadius.y, 0.0);
  gl_Position = uProjection * uView * vec4(world, 1.0);
}`;

const SHADOW_FRAGMENT = `#version 300 es
precision highp float;
in vec2 vLocal;
uniform float uShadowStrength;
out vec4 outColor;
void main() {
  float distance2 = dot(vLocal, vLocal);
  float core = exp(-distance2 * 4.4);
  float halo = exp(-distance2 * 1.7) * 0.5;
  float a = (core + halo) * uShadowStrength;
  outColor = vec4(vec3(0.11, 0.12, 0.13) * a * 0.6, a * 0.6);
}`;

export class ProductStage {
  private gl: WebGL2RenderingContext;
  private canvas: HTMLCanvasElement;
  private meshProgram: WebGLProgram;
  private shadowProgram: WebGLProgram;
  private meshVao: WebGLVertexArrayObject;
  private shadowVao: WebGLVertexArrayObject;
  private meshIndexCount: number;
  private colorTexture: WebGLTexture;
  private depthTexture: WebGLTexture;
  private halfExtent: { x: number; y: number };
  /** Mask bounding box in world units: centre + half extents. */
  private box: { cx: number; cy: number; hw: number; hh: number };
  private thickness: number;
  private texel: { x: number; y: number };

  private mode: StageMode = "scan";
  private reducedMotion: boolean;
  private rimColor: [number, number, number] = [0.86, 0.84, 0.8];
  private rimTarget: [number, number, number] = [0.86, 0.84, 0.8];
  private rimPulse = 0;

  private angle = SCAN_POSE;
  private velocity = 0;
  private orbitMix = 0;
  private scanActive = 1;
  private intro = 0;
  private scanClock = 0;
  private bobClock = 0;
  private lastTime = 0;
  private rafId = 0;
  private running = false;
  private disposed = false;
  private dragging = false;
  private lastDragX = 0;
  private lastDragTime = 0;
  private debugAlpha = /stageDebug=alpha/.test(window.location.search);

  constructor(canvas: HTMLCanvasElement, map: DepthMap, options: StageOptions = {}) {
    this.canvas = canvas;
    this.reducedMotion = options.reducedMotion ?? false;

    const gl = canvas.getContext("webgl2", {
      alpha: true,
      antialias: true,
      premultipliedAlpha: true,
      powerPreference: "low-power"
    });
    if (!gl) throw new Error("WebGL2 unavailable");
    this.gl = gl;

    this.meshProgram = createProgram(gl, VERTEX_SHADER, FRAGMENT_SHADER);
    this.shadowProgram = createProgram(gl, SHADOW_VERTEX, SHADOW_FRAGMENT);

    const aspect = map.color.width / map.color.height;
    this.halfExtent = aspect >= 1 ? { x: 0.5, y: 0.5 / aspect } : { x: 0.5 * aspect, y: 0.5 };
    this.box = {
      cx: (map.bounds.cx - 0.5) * 2 * this.halfExtent.x,
      cy: (0.5 - map.bounds.cy) * 2 * this.halfExtent.y,
      hw: map.bounds.hw * 2 * this.halfExtent.x,
      hh: map.bounds.hh * 2 * this.halfExtent.y
    };
    this.thickness = Math.min(this.box.hw, this.box.hh) * 0.22;
    this.texel = { x: 1 / map.depthWidth, y: 1 / map.depthHeight };

    const segX = 110;
    const segY = Math.max(48, Math.min(150, Math.round(segX / aspect)));
    const mesh = buildGrid(gl, segX, segY);
    this.meshVao = mesh.vao;
    this.meshIndexCount = mesh.indexCount;
    this.shadowVao = buildGrid(gl, 1, 1).vao;

    this.colorTexture = createTexture(gl);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, map.color);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);

    this.depthTexture = createTexture(gl);
    const depthBytes = new Uint8Array(map.depth.length);
    for (let i = 0; i < map.depth.length; i++) depthBytes[i] = Math.round(map.depth[i] * 255);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(
      gl.TEXTURE_2D, 0, gl.R8, map.depthWidth, map.depthHeight, 0,
      gl.RED, gl.UNSIGNED_BYTE, depthBytes
    );

    this.lastTime = performance.now();
    this.start();
  }

  setMode(mode: StageMode) {
    if (this.mode === mode) return;
    this.mode = mode;
    if (mode === "orbit" && !this.reducedMotion) {
      // Lift-off: a touch of extra spin as the verdict lands, easing to
      // cruise, with a brief rim-light pulse in the verdict tone.
      this.velocity = ORBIT_SPEED * 2.6;
      this.rimPulse = 1;
    }
    this.requestStaticFrame();
  }

  setRimColor(hex: string) {
    const parsed = /^#?([0-9a-f]{6})$/i.exec(hex);
    if (!parsed) return;
    const value = parseInt(parsed[1], 16);
    this.rimTarget = [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
    if (this.reducedMotion || !this.running) {
      this.rimColor = [...this.rimTarget];
    }
    this.requestStaticFrame();
  }

  pointerDown(clientX: number) {
    if (this.reducedMotion) return;
    this.dragging = true;
    this.lastDragX = clientX;
    this.lastDragTime = performance.now();
  }

  pointerMove(clientX: number) {
    if (!this.dragging) return;
    const now = performance.now();
    const dx = clientX - this.lastDragX;
    const dt = Math.max(8, now - this.lastDragTime) / 1000;
    const deltaAngle = (dx / Math.max(120, this.canvas.clientWidth)) * Math.PI * 1.5;
    this.angle += deltaAngle;
    this.velocity = clampAbs(deltaAngle / dt, 11);
    this.lastDragX = clientX;
    this.lastDragTime = now;
  }

  pointerUp() {
    this.dragging = false;
  }

  setRunning(running: boolean) {
    if (running && !this.running && !this.disposed) {
      this.running = true;
      this.lastTime = performance.now();
      this.rafId = requestAnimationFrame(this.frame);
    } else if (!running && this.running) {
      this.running = false;
      cancelAnimationFrame(this.rafId);
    }
  }

  dispose() {
    this.disposed = true;
    this.setRunning(false);
    const gl = this.gl;
    gl.deleteProgram(this.meshProgram);
    gl.deleteProgram(this.shadowProgram);
    gl.deleteTexture(this.colorTexture);
    gl.deleteTexture(this.depthTexture);
  }

  private start() {
    if (this.reducedMotion) {
      this.intro = 1;
      this.orbitMix = this.mode === "orbit" ? 1 : 0;
      this.scanActive = 0;
      this.angle = SCAN_POSE;
      this.requestStaticFrame();
      return;
    }
    this.setRunning(true);
  }

  /** One-shot render for reduced motion / property changes while paused. */
  private requestStaticFrame() {
    if (this.running || this.disposed) return;
    requestAnimationFrame(() => {
      if (!this.running && !this.disposed) this.render();
    });
  }

  private frame = (now: number) => {
    if (!this.running) return;
    const dt = Math.min(0.05, (now - this.lastTime) / 1000);
    this.lastTime = now;
    this.step(dt);
    this.render();
    this.rafId = requestAnimationFrame(this.frame);
  };

  private step(dt: number) {
    this.intro = approach(this.intro, 1, dt * 2.6);
    this.bobClock += dt;
    this.rimPulse = approach(this.rimPulse, 0, dt * 1.6);
    for (let channel = 0; channel < 3; channel++) {
      this.rimColor[channel] = approach(this.rimColor[channel], this.rimTarget[channel], dt * 3);
    }

    const targetOrbit = this.mode === "orbit" ? 1 : 0;
    this.orbitMix = approach(this.orbitMix, targetOrbit, dt * 2.2);
    this.scanActive = approach(this.scanActive, this.mode === "scan" ? 1 : 0, dt * 3.2);

    if (this.mode === "scan") {
      this.scanClock += dt;
      if (!this.dragging) {
        // Spring the pose back to the scan angle.
        const springPull = (SCAN_POSE - this.angle) * 6;
        this.velocity += (springPull - this.velocity * 5.4) * dt * 4;
        this.angle += this.velocity * dt;
      }
    } else if (!this.dragging) {
      // Ease angular velocity toward cruise speed.
      this.velocity += (ORBIT_SPEED - this.velocity) * Math.min(1, dt * 1.4);
      this.angle += this.velocity * dt;
    }
  }

  private render() {
    const gl = this.gl;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const width = Math.max(1, Math.round(this.canvas.clientWidth * dpr));
    const height = Math.max(1, Math.round(this.canvas.clientHeight * dpr));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    gl.viewport(0, 0, width, height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    const canvasAspect = width / height;
    const { hw: bhw, hh: bhh } = this.box;

    // Fit the garment (not the whole texture) with margin, leaving room for
    // the contact shadow below.
    const tanHalf = Math.tan(FOV / 2);
    const fitDistance = Math.max(
      (bhh * 1.52) / tanHalf,
      (Math.max(bhw, this.thickness) * 1.24) / (tanHalf * canvasAspect)
    );
    const cameraY = Math.sin(-CAMERA_TILT) * fitDistance;
    const cameraZ = Math.cos(CAMERA_TILT) * fitDistance;

    const projection = perspective(FOV, canvasAspect, 0.1, 10);
    const view = lookAtOrigin(cameraY, cameraZ, CAMERA_TILT);

    if (this.debugAlpha) this.angle = 0;
    const bob = this.reducedMotion ? 0 : Math.sin(this.bobClock * 1.05) * 0.012 * this.orbitMix;
    const lift = (this.orbitMix * 0.018 + bob) * bhh;
    const model = modelMatrix(this.angle, lift + bhh * 0.06, this.box.cx, this.box.cy);
    const normalMatrix = rotationYMat3(this.angle);

    // Contact shadow first (blended), then the solid shells.
    gl.useProgram(this.shadowProgram);
    gl.bindVertexArray(this.shadowVao);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.disable(gl.DEPTH_TEST);
    setMat4(gl, this.shadowProgram, "uProjection", projection);
    setMat4(gl, this.shadowProgram, "uView", view);
    const spread = 0.62 + 0.38 * Math.abs(Math.cos(this.angle));
    const shadowHalfWidth = bhw * spread * 1.08;
    setVec3(gl, this.shadowProgram, "uShadowCenter", [0, -bhh * 1.12, 0]);
    setVec2(gl, this.shadowProgram, "uShadowRadius", [shadowHalfWidth, shadowHalfWidth * 0.26]);
    setFloat(gl, this.shadowProgram, "uShadowStrength", (0.62 - (lift / Math.max(bhh, 1e-4)) * 4) * this.intro);
    gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_INT, 0);

    gl.useProgram(this.meshProgram);
    gl.bindVertexArray(this.meshVao);
    gl.disable(gl.BLEND);
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.SAMPLE_ALPHA_TO_COVERAGE);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.colorTexture);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.depthTexture);
    setInt(gl, this.meshProgram, "uColor", 0);
    setInt(gl, this.meshProgram, "uDepth", 1);

    setMat4(gl, this.meshProgram, "uProjection", projection);
    setMat4(gl, this.meshProgram, "uView", view);
    setMat4(gl, this.meshProgram, "uModel", model);
    setMat3(gl, this.meshProgram, "uNormalMatrix", normalMatrix);
    setVec2(gl, this.meshProgram, "uHalfExtent", [this.halfExtent.x, this.halfExtent.y]);
    setVec2(gl, this.meshProgram, "uTexelSize", [this.texel.x, this.texel.y]);
    setFloat(gl, this.meshProgram, "uThickness", this.thickness);
    setFloat(gl, this.meshProgram, "uOrbitMix", this.orbitMix);
    setFloat(gl, this.meshProgram, "uIntro", easeOutCubic(this.intro));
    setVec3(gl, this.meshProgram, "uRimColor", this.rimColor);
    setFloat(gl, this.meshProgram, "uRimBoost", this.rimPulse);
    setVec3(gl, this.meshProgram, "uCameraPos", [0, cameraY, cameraZ]);

    const scanPhase = (this.scanClock % SCAN_PERIOD) / SCAN_PERIOD;
    setFloat(gl, this.meshProgram, "uScanY", easeInOutSine(scanPhase) * 1.3 - 0.15);
    setFloat(gl, this.meshProgram, "uScanActive", this.scanActive);
    setFloat(gl, this.meshProgram, "uDebugAlpha", this.debugAlpha ? 1 : 0);
    setFloat(gl, this.meshProgram, "uFlatten", /stageFlat=1/.test(window.location.search) ? 1 : 0);

    for (const side of [-1, 1]) {
      setFloat(gl, this.meshProgram, "uSide", side);
      gl.drawElements(gl.TRIANGLES, this.meshIndexCount, gl.UNSIGNED_INT, 0);
    }

    gl.disable(gl.SAMPLE_ALPHA_TO_COVERAGE);
    gl.bindVertexArray(null);
  }
}

/* ---- GL helpers ---- */

function createProgram(gl: WebGL2RenderingContext, vertexSrc: string, fragmentSrc: string): WebGLProgram {
  const program = gl.createProgram()!;
  for (const [type, source] of [
    [gl.VERTEX_SHADER, vertexSrc],
    [gl.FRAGMENT_SHADER, fragmentSrc]
  ] as const) {
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      throw new Error(`Shader compile failed: ${gl.getShaderInfoLog(shader)}`);
    }
    gl.attachShader(program, shader);
  }
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(`Program link failed: ${gl.getProgramInfoLog(program)}`);
  }
  return program;
}

function buildGrid(gl: WebGL2RenderingContext, segX: number, segY: number) {
  const cols = segX + 1;
  const rows = segY + 1;
  const positions = new Float32Array(cols * rows * 2);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const i = (y * cols + x) * 2;
      positions[i] = x / segX;
      positions[i + 1] = y / segY;
    }
  }
  const indices = new Uint32Array(segX * segY * 6);
  let offset = 0;
  for (let y = 0; y < segY; y++) {
    for (let x = 0; x < segX; x++) {
      const a = y * cols + x;
      const b = a + 1;
      const c = a + cols;
      const d = c + 1;
      indices.set([a, c, b, b, c, d], offset);
      offset += 6;
    }
  }

  const vao = gl.createVertexArray()!;
  gl.bindVertexArray(vao);
  const positionBuffer = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  const indexBuffer = gl.createBuffer()!;
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
  gl.bindVertexArray(null);
  return { vao, indexCount: indices.length };
}

function createTexture(gl: WebGL2RenderingContext): WebGLTexture {
  const texture = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  return texture;
}

/* ---- Matrix helpers (column-major) ---- */

function perspective(fov: number, aspect: number, near: number, far: number): Float32Array {
  const f = 1 / Math.tan(fov / 2);
  const out = new Float32Array(16);
  out[0] = f / aspect;
  out[5] = f;
  out[10] = (far + near) / (near - far);
  out[11] = -1;
  out[14] = (2 * far * near) / (near - far);
  return out;
}

function lookAtOrigin(cameraY: number, cameraZ: number, tilt: number): Float32Array {
  // Camera on the y/z arc looking at the origin: rotate by -tilt then translate.
  const c = Math.cos(tilt);
  const s = Math.sin(tilt);
  const distance = Math.hypot(cameraY, cameraZ);
  const out = new Float32Array(16);
  out[0] = 1;
  out[5] = c;
  out[6] = s;
  out[9] = -s;
  out[10] = c;
  out[14] = -distance;
  out[15] = 1;
  return out;
}

/** T(0, lift, 0) · RotY(angle) · T(-centerX, -centerY, 0): the garment spins
    about its own bounding-box centre, then floats by `lift`. */
function modelMatrix(angleY: number, lift: number, centerX: number, centerY: number): Float32Array {
  const c = Math.cos(angleY);
  const s = Math.sin(angleY);
  const out = new Float32Array(16);
  out[0] = c;
  out[2] = -s;
  out[5] = 1;
  out[8] = s;
  out[10] = c;
  out[12] = -c * centerX;
  out[13] = lift - centerY;
  out[14] = s * centerX;
  out[15] = 1;
  return out;
}

function rotationYMat3(angle: number): Float32Array {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return new Float32Array([c, 0, -s, 0, 1, 0, s, 0, c]);
}

/* ---- Uniform setters ---- */

function setFloat(gl: WebGL2RenderingContext, program: WebGLProgram, name: string, value: number) {
  gl.uniform1f(gl.getUniformLocation(program, name), value);
}

function setInt(gl: WebGL2RenderingContext, program: WebGLProgram, name: string, value: number) {
  gl.uniform1i(gl.getUniformLocation(program, name), value);
}

function setVec2(gl: WebGL2RenderingContext, program: WebGLProgram, name: string, value: [number, number]) {
  gl.uniform2fv(gl.getUniformLocation(program, name), value);
}

function setVec3(gl: WebGL2RenderingContext, program: WebGLProgram, name: string, value: [number, number, number]) {
  gl.uniform3fv(gl.getUniformLocation(program, name), value);
}

function setMat3(gl: WebGL2RenderingContext, program: WebGLProgram, name: string, value: Float32Array) {
  gl.uniformMatrix3fv(gl.getUniformLocation(program, name), false, value);
}

function setMat4(gl: WebGL2RenderingContext, program: WebGLProgram, name: string, value: Float32Array) {
  gl.uniformMatrix4fv(gl.getUniformLocation(program, name), false, value);
}

/* ---- Maths ---- */

function approach(current: number, target: number, rate: number): number {
  return current + (target - current) * Math.min(1, rate);
}

function clampAbs(value: number, max: number): number {
  return Math.max(-max, Math.min(max, value));
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

function easeInOutSine(t: number): number {
  return 0.5 - 0.5 * Math.cos(Math.PI * t);
}
