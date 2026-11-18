/**
 * hero-smoke.js — 首页 hero 的鼠标流体烟雾层
 * --------------------------------------------------------------------------------
 * 机制参考 music-assistant.io 的 hero 特效（WebGL2 Navier-Stokes 流体），
 * 这里按本站在性能与视觉上做了轻量重写，不引用任何第三方脚本：
 *   速度场 advection → curl → vorticity → divergence → pressure(Jacobi×14) → gradient
 *   → dye advection → 输出
 * 鼠标在 hero 上移动时，把位移量作为速度注入染料，划过即拨起烟；没人动时由
 * 四角呼吸点 + 随机横穿的“风”维持画面生命，避免静止死板。
 *
 * 行为：
 *   - 只在存在 #page-header 的页面（首页/文章页 hero）挂载，其余页面直接退出
 *   - 画布 pointer-events:none，鼠标事件挂在 header 上，不拦截任何交互
 *   - prefers-reduced-motion: reduce 时不启动，页面保持原样
 *   - 离开视口暂停渲染（IntersectionObserver）；页面隐藏也暂停
 *   - DPR 上限 1.5，染料 512 / 速度 128，纹理预算小，弱机也不至于掉帧
 *   - WebGL2 或浮点渲染目标不可用时静默退出，不留任何痕迹
 */
(function () {
  'use strict';

  var header = document.querySelector('#page-header');
  if (!header) return;
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  if (!window.WebGL2RenderingContext) return;

  var canvas = document.createElement('canvas');
  canvas.className = 'rj-hero-smoke';
  canvas.setAttribute('aria-hidden', 'true');
  var gl = canvas.getContext('webgl2', {
    alpha: true, premultipliedAlpha: true, antialias: false, depth: false,
    stencil: false, powerPreference: 'low-power'
  });
  if (!gl) return;
  if (!(gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float'))) return;

  // ---- 参数 ----
  var SIM_RES = 128;
  var DYE_RES = 1024;
  var DENSITY_DISS = 1.6;
  var VELOCITY_DISS = 0.45;
  var PRESSURE = 0.8;
  var PRESSURE_ITER = 14;
  var CURL = 30;
  var SPLAT_RADIUS = 0.06;
  var SPLAT_FORCE = 9000;
  var EXPOSURE = 0.62;

  // 主题色：紫 → 青 → 品红 → 蓝，与站点渐变紫一致
  var PALETTE = [
    [0.545, 0.361, 0.965],
    [0.133, 0.827, 0.933],
    [0.910, 0.475, 0.976],
    [0.376, 0.647, 1.000]
  ];

  function compile(type, src) {
    var s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    return gl.getShaderParameter(s, gl.COMPILE_STATUS) ? s : null;
  }

  var vertSrc = [
    '#version 300 es',
    'precision highp float;',
    'in vec2 aPosition;',
    'out vec2 vUv, vL, vR, vT, vB;',
    'uniform vec2 texelSize;',
    'void main(){',
    '  vUv = aPosition * 0.5 + 0.5;',
    '  vL = vUv - vec2(texelSize.x, 0.0);',
    '  vR = vUv + vec2(texelSize.x, 0.0);',
    '  vT = vUv + vec2(0.0, texelSize.y);',
    '  vB = vUv - vec2(0.0, texelSize.y);',
    '  gl_Position = vec4(aPosition, 0.0, 1.0);',
    '}'
  ].join('\n');
  var vert = compile(gl.VERTEX_SHADER, vertSrc);
  if (!vert) return;

  function program(body) {
    var head = [
      '#version 300 es',
      'precision highp float;',
      'precision highp sampler2D;',
      'in vec2 vUv, vL, vR, vT, vB;',
      'out vec4 o;'
    ].join('\n');
    var p = gl.createProgram();
    var frag = compile(gl.FRAGMENT_SHADER, head + '\n' + body);
    if (!frag) return null;
    gl.attachShader(p, vert);
    gl.attachShader(p, frag);
    gl.bindAttribLocation(p, 0, 'aPosition');
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) return null;
    var u = {};
    var n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (var i = 0; i < n; i++) {
      var nm = gl.getActiveUniform(p, i).name;
      u[nm] = gl.getUniformLocation(p, nm);
    }
    return { program: p, uniforms: u };
  }

  var copyProg = program('uniform sampler2D uTexture; void main(){ o = texture(uTexture, vUv); }');
  var clearProg = program('uniform sampler2D uTexture; uniform float value; void main(){ o = value * texture(uTexture, vUv); }');
  var splatProg = program([
    'uniform sampler2D uTarget; uniform float aspectRatio; uniform vec3 color;',
    'uniform vec2 point; uniform float radius;',
    'void main(){',
    '  vec2 p = vUv - point; p.x *= aspectRatio;',
    '  vec3 s = exp(-dot(p,p)/radius) * color;',
    '  vec3 base = texture(uTarget, vUv).xyz;',
    '  o = vec4(base + s, 1.0);',
    '}'
  ].join('\n'));
  var advectionProg = program([
    'uniform sampler2D uVelocity, uSource; uniform vec2 texelSize; uniform vec2 dyeTexelSize;',
    'uniform float dt, dissipation;',
    'vec4 bilerp(sampler2D sam, vec2 uv, vec2 tsize){',
    '  vec2 st = uv/tsize - 0.5; vec2 iuv = floor(st); vec2 fuv = fract(st);',
    '  vec4 a = texture(sam, (iuv + vec2(0.5,0.5))*tsize);',
    '  vec4 b = texture(sam, (iuv + vec2(1.5,0.5))*tsize);',
    '  vec4 c = texture(sam, (iuv + vec2(0.5,1.5))*tsize);',
    '  vec4 d = texture(sam, (iuv + vec2(1.5,1.5))*tsize);',
    '  return mix(mix(a,b,fuv.x), mix(c,d,fuv.x), fuv.y);',
    '}',
    'void main(){',
    '  vec2 coord = vUv - dt * bilerp(uVelocity, vUv, texelSize).xy * texelSize;',
    '  vec4 result = bilerp(uSource, coord, dyeTexelSize);',
    '  float decay = 1.0 + dissipation * dt;',
    '  o = result / decay;',
    '}'
  ].join('\n'));
  var divergenceProg = program([
    'uniform sampler2D uVelocity;',
    'void main(){',
    '  float L = texture(uVelocity, vL).x;',
    '  float R = texture(uVelocity, vR).x;',
    '  float T = texture(uVelocity, vT).y;',
    '  float B = texture(uVelocity, vB).y;',
    '  vec2 C = texture(uVelocity, vUv).xy;',
    '  if (vL.x < 0.0) { L = -C.x; }',
    '  if (vR.x > 1.0) { R = -C.x; }',
    '  if (vT.y > 1.0) { T = -C.y; }',
    '  if (vB.y < 0.0) { B = -C.y; }',
    '  o = vec4(0.5*(R-L+T-B), 0.0, 0.0, 1.0);',
    '}'
  ].join('\n'));
  var curlProg = program([
    'uniform sampler2D uVelocity;',
    'void main(){',
    '  float L = texture(uVelocity, vL).y;',
    '  float R = texture(uVelocity, vR).y;',
    '  float T = texture(uVelocity, vT).x;',
    '  float B = texture(uVelocity, vB).x;',
    '  o = vec4(0.5*(R-L-T+B), 0.0, 0.0, 1.0);',
    '}'
  ].join('\n'));
  var vorticityProg = program([
    'uniform sampler2D uVelocity, uCurl; uniform float curl, dt;',
    'void main(){',
    '  float L = texture(uCurl, vL).x;',
    '  float R = texture(uCurl, vR).x;',
    '  float T = texture(uCurl, vT).x;',
    '  float B = texture(uCurl, vB).x;',
    '  float C = texture(uCurl, vUv).x;',
    '  vec2 force = 0.5*vec2(abs(T)-abs(B), abs(R)-abs(L));',
    '  force /= length(force)+1e-4;',
    '  force *= curl * C;',
    '  force.y *= -1.0;',
    '  vec2 velocity = texture(uVelocity, vUv).xy;',
    '  velocity += force * dt;',
    '  velocity = min(max(velocity, -1000.0), 1000.0);',
    '  o = vec4(velocity, 0.0, 1.0);',
    '}'
  ].join('\n'));
  var pressureProg = program([
    'uniform sampler2D uPressure, uDivergence;',
    'void main(){',
    '  float L = texture(uPressure, vL).x;',
    '  float R = texture(uPressure, vR).x;',
    '  float T = texture(uPressure, vT).x;',
    '  float B = texture(uPressure, vB).x;',
    '  float div = texture(uDivergence, vUv).x;',
    '  o = vec4((L+R+B+T-div)*0.25, 0.0, 0.0, 1.0);',
    '}'
  ].join('\n'));
  var gradientProg = program([
    'uniform sampler2D uPressure, uVelocity;',
    'void main(){',
    '  float L = texture(uPressure, vL).x;',
    '  float R = texture(uPressure, vR).x;',
    '  float T = texture(uPressure, vT).x;',
    '  float B = texture(uPressure, vB).x;',
    '  vec2 v = texture(uVelocity, vUv).xy;',
    '  v -= vec2(R-L, T-B);',
    '  o = vec4(v, 0.0, 1.0);',
    '}'
  ].join('\n'));
  var displayProg = program([
    'uniform sampler2D uDye; uniform float exposure;',
    'void main(){',
    '  vec3 c = texture(uDye, vUv).xyz;',
    '  vec3 col = 1.0 - exp(-c * exposure);',
    '  float edge = smoothstep(0.0, 0.18, vUv.y) * smoothstep(1.0, 0.82, vUv.y);',
    '  float a = clamp(max(col.r, max(col.g, col.b)), 0.0, 1.0) * edge;',
    '  o = vec4(col * edge * a, a);',
    '}'
  ].join('\n'));

  if (!copyProg || !clearProg || !splatProg || !advectionProg || !divergenceProg ||
      !curlProg || !vorticityProg || !pressureProg || !gradientProg || !displayProg) return;

  // ---- 几何 ----
  var vbo = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  function createFBO(w, h, internalFormat, format, type, param) {
    gl.activeTexture(gl.TEXTURE0);
    var texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, param);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, param);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, w, h, 0, format, type, null);
    var fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    return {
      texture: texture, fbo: fbo, width: w, height: h,
      texelSizeX: 1 / w, texelSizeY: 1 / h,
      attach: function (id) {
        gl.activeTexture(gl.TEXTURE0 + id);
        gl.bindTexture(gl.TEXTURE_2D, texture);
        return id;
      }
    };
  }
  function createDoubleFBO(w, h, internalFormat, format, type, param) {
    var a = createFBO(w, h, internalFormat, format, type, param);
    var b = createFBO(w, h, internalFormat, format, type, param);
    return {
      width: w, height: h, texelSizeX: a.texelSizeX, texelSizeY: a.texelSizeY,
      get read() { return a; }, set read(v) { a = v; },
      get write() { return b; }, set write(v) { b = v; },
      swap: function () { var t = a; a = b; b = t; }
    };
  }

  var halfFloat = gl.HALF_FLOAT;
  var rgba = gl.RGBA, rg = gl.RG, red = gl.RED;
  var dye = createDoubleFBO(DYE_RES, DYE_RES, gl.RGBA16F, rgba, halfFloat, gl.LINEAR);
  var velocity = createDoubleFBO(SIM_RES, SIM_RES, gl.RG16F, rg, halfFloat, gl.LINEAR);
  var divergence = createFBO(SIM_RES, SIM_RES, gl.R16F, red, halfFloat, gl.NEAREST);
  var curl = createFBO(SIM_RES, SIM_RES, gl.R16F, red, halfFloat, gl.NEAREST);
  var pressure = createDoubleFBO(SIM_RES, SIM_RES, gl.R16F, red, halfFloat, gl.NEAREST);

  function blit(target) {
    if (target == null) {
      gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    } else {
      gl.viewport(0, 0, target.width, target.height);
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
    }
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  // ---- 挂载 ----
  // 只靠 DOM 顺序叠层：video → canvas → nav / #site-info / #scroll-down
  // （后出现的绝对定位元素自然盖住前面的，因此不需要动任何主题元素样式）
  var navEl = header.querySelector('#nav');
  if (navEl) header.insertBefore(canvas, navEl);
  else header.appendChild(canvas);
  canvas.style.cssText = [
    'position:absolute', 'inset:0', 'width:100%', 'height:100%',
    'display:block', 'pointer-events:none', 'mix-blend-mode:screen'
  ].join(';');

  function resize() {
    var dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    var w = Math.max(1, Math.round(canvas.clientWidth * dpr));
    var h = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
  }
  resize();
  try { new ResizeObserver(resize).observe(canvas); } catch (e) { window.addEventListener('resize', resize); }

  function aspect() { return canvas.width / Math.max(1, canvas.height); }

  function splat(x, y, dx, dy, color) {
    gl.useProgram(splatProg.program);
    gl.uniform2f(splatProg.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
    gl.uniform1i(splatProg.uniforms.uTarget, velocity.read.attach(0));
    gl.uniform1f(splatProg.uniforms.aspectRatio, aspect());
    gl.uniform2f(splatProg.uniforms.point, x, y);
    gl.uniform3f(splatProg.uniforms.color, dx, dy, 0);
    var r = SPLAT_RADIUS / 100;
    if (aspect() > 1) r *= aspect();
    gl.uniform1f(splatProg.uniforms.radius, r);
    blit(velocity.write); velocity.swap();

    gl.uniform1i(splatProg.uniforms.uTarget, dye.read.attach(0));
    gl.uniform3f(splatProg.uniforms.color, color[0], color[1], color[2]);
    blit(dye.write); dye.swap();
  }

  function colorFor(i) {
    var c = PALETTE[i % PALETTE.length];
    var f = 0.55 + Math.random() * 0.45;
    return [c[0] * f, c[1] * f, c[2] * f];
  }

  function step(dt) {
    gl.disable(gl.BLEND);
    gl.useProgram(curlProg.program);
    gl.uniform2f(curlProg.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
    gl.uniform1i(curlProg.uniforms.uVelocity, velocity.read.attach(0));
    blit(curl);

    gl.useProgram(vorticityProg.program);
    gl.uniform2f(vorticityProg.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
    gl.uniform1i(vorticityProg.uniforms.uVelocity, velocity.read.attach(0));
    gl.uniform1i(vorticityProg.uniforms.uCurl, curl.attach(1));
    gl.uniform1f(vorticityProg.uniforms.curl, CURL);
    gl.uniform1f(vorticityProg.uniforms.dt, dt);
    blit(velocity.write); velocity.swap();

    gl.useProgram(divergenceProg.program);
    gl.uniform2f(divergenceProg.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
    gl.uniform1i(divergenceProg.uniforms.uVelocity, velocity.read.attach(0));
    blit(divergence);

    gl.useProgram(clearProg.program);
    gl.uniform1i(clearProg.uniforms.uTexture, pressure.read.attach(0));
    gl.uniform1f(clearProg.uniforms.value, PRESSURE);
    blit(pressure.write); pressure.swap();

    gl.useProgram(pressureProg.program);
    gl.uniform2f(pressureProg.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
    gl.uniform1i(pressureProg.uniforms.uDivergence, divergence.attach(0));
    for (var i = 0; i < PRESSURE_ITER; i++) {
      gl.uniform1i(pressureProg.uniforms.uPressure, pressure.read.attach(1));
      blit(pressure.write); pressure.swap();
    }

    gl.useProgram(gradientProg.program);
    gl.uniform2f(gradientProg.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
    gl.uniform1i(gradientProg.uniforms.uPressure, pressure.read.attach(0));
    gl.uniform1i(gradientProg.uniforms.uVelocity, velocity.read.attach(1));
    blit(velocity.write); velocity.swap();

    gl.useProgram(advectionProg.program);
    gl.uniform2f(advectionProg.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
    gl.uniform2f(advectionProg.uniforms.dyeTexelSize, velocity.texelSizeX, velocity.texelSizeY);
    gl.uniform1i(advectionProg.uniforms.uVelocity, velocity.read.attach(0));
    gl.uniform1i(advectionProg.uniforms.uSource, velocity.read.attach(0));
    gl.uniform1f(advectionProg.uniforms.dt, dt);
    gl.uniform1f(advectionProg.uniforms.dissipation, VELOCITY_DISS);
    blit(velocity.write); velocity.swap();

    gl.uniform2f(advectionProg.uniforms.dyeTexelSize, dye.texelSizeX, dye.texelSizeY);
    gl.uniform1i(advectionProg.uniforms.uVelocity, velocity.read.attach(0));
    gl.uniform1i(advectionProg.uniforms.uSource, dye.read.attach(1));
    gl.uniform1f(advectionProg.uniforms.dissipation, DENSITY_DISS);
    blit(dye.write); dye.swap();
  }

  function render() {
    gl.disable(gl.BLEND);
    gl.useProgram(displayProg.program);
    gl.uniform1i(displayProg.uniforms.uDye, dye.read.attach(0));
    gl.uniform1f(displayProg.uniforms.exposure, EXPOSURE);
    blit(null);
  }

  // ---- 指针 ----
  var pointer = { x: 0, y: 0, dx: 0, dy: 0, moved: false, has: false };
  // 调试开关：headless / 自动化环境没有 fine pointer，加 ?smoke-debug 可测真实交互链路；
  // 正常访问不会命中，线上行为完全不受影响。
  var DEBUG = /[?&]smoke-debug/.test(location.search);
  var fine = window.matchMedia('(hover: hover) and (pointer: fine)');
  function pointerEnabled() { return DEBUG || fine.matches; }

  header.addEventListener('pointermove', function (e) {
    if (!pointerEnabled() || e.pointerType === 'touch') return;
    var rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    var nx = (e.clientX - rect.left) / rect.width;
    var ny = 1 - (e.clientY - rect.top) / rect.height;
    if (nx < 0 || nx > 1 || ny < 0 || ny > 1) return;
    if (pointer.has) {
      pointer.dx = nx - pointer.x;
      pointer.dy = ny - pointer.y;
      pointer.moved = true;
    }
    pointer.x = nx;
    pointer.y = ny;
    pointer.has = true;
  }, { passive: true });
  header.addEventListener('pointerleave', function () { pointer.has = false; }, { passive: true });

  // ---- 静止时的生命：四角呼吸 + 偶尔横穿的风 ----
  var AMBIENT = [
    { x: 0.10, y: 0.68 }, { x: 0.90, y: 0.58 }
  ];
  var wind = null, windCooldown = 0;

  function windPath(w, k) {
    var ang = (w.dir > 0 ? 0 : Math.PI) + w.bend * k;
    return { x: w.x + Math.cos(ang) * 0.55 * k, y: w.y + Math.sin(ang) * 0.16 * k + w.bend * 0.1 * k * k };
  }

  function ambient(t) {
    for (var i = 0; i < AMBIENT.length; i++) {
      var a = AMBIENT[i];
      var ang = t * 0.45 + i * 1.6;
      splat(
        a.x + 0.09 * Math.sin(t * 0.23 + i * 1.7),
        a.y + 0.075 * Math.sin(t * 0.31 + i * 2.3),
        Math.cos(ang) * 0.045, Math.sin(ang) * 0.045,
        colorFor(i)
      );
    }
    if (!wind) {
      if (t < windCooldown) return;
      var left = Math.random() < 0.5;
      wind = {
        t0: t,
        x: left ? 0.04 + Math.random() * 0.12 : 0.84 + Math.random() * 0.12,
        y: 0.3 + Math.random() * 0.45,
        dir: left ? 1 : -1,
        bend: 0.35 * (Math.random() - 0.5),
        idx: Math.floor(Math.random() * 4)
      };
    }
    var k = Math.min(1, (t - wind.t0) / 1.6);
    var prev = windPath(wind, Math.max(0, k - 0.02));
    var cur = windPath(wind, k);
    splat(cur.x, cur.y, (cur.x - prev.x) * 3.0, (cur.y - prev.y) * 3.0, colorFor(wind.idx));
    if (k >= 1) { wind = null; windCooldown = t + 1.1 + Math.random() * 1.6; }
  }

  // ---- 主循环 ----
  var last = performance.now();
  var rafId = 0;
  var visible = true;
  var prevAmbient = 0;

  try {
    new IntersectionObserver(function (es) {
      visible = es[0].isIntersecting;
      if (visible && !rafId) { last = performance.now(); rafId = requestAnimationFrame(frame); }
    }, { threshold: 0.01 }).observe(canvas);
  } catch (e) { /* 无 IO 时保持常驻 */ }

  document.addEventListener('visibilitychange', function () {
    if (!document.hidden && visible && !rafId) {
      last = performance.now();
      rafId = requestAnimationFrame(frame);
    }
  });

  function frame(now) {
    rafId = 0;
    if (!visible || document.hidden) return;
    var dt = Math.min((now - last) / 1000, 1 / 30);
    last = now;
    if (dt <= 0) { rafId = requestAnimationFrame(frame); return; }
    var t = now / 1000;

    if (pointer.moved) {
      var ar = aspect();
      var mx = pointer.dx * (ar < 1 ? ar : 1);
      var my = pointer.dy * (ar > 1 ? 1 / ar : 1);
      var mc = colorFor(Math.floor(t * 0.12));
      mc = [mc[0] * 1.5, mc[1] * 1.5, mc[2] * 1.5];
      splat(pointer.x, pointer.y, mx * SPLAT_FORCE, my * SPLAT_FORCE, mc);
      pointer.moved = false;
    }
    if (t - prevAmbient > 0.085) { ambient(t); prevAmbient = t; }

    step(dt);
    render();
    rafId = requestAnimationFrame(frame);
  }

  // 首屏先给一道柔和的风，避免刚进来一片空（点位连续，不会留下孤立亮点）
  for (var i = 0; i < 26; i++) {
    var ok = i / 26;
    splat(0.12 + ok * 0.76, 0.56 + Math.sin(ok * Math.PI) * 0.09,
          0.02, Math.cos(ok * Math.PI) * 0.02, colorFor(i % 4));
  }
  rafId = requestAnimationFrame(frame);

  if (DEBUG) {
    window.__rjSmokeSplat = function (x, y, dx, dy) {
      splat(x, y, dx * SPLAT_FORCE, dy * SPLAT_FORCE, [1.0, 0.55, 1.0]);
    };
  }
  header.setAttribute('data-smoke', 'ready');
})();
