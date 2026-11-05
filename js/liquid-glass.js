/* ==========================================================================
   RockJesus.cn — Liquid Glass
   version: 1.0.0 · 2026-11-05
   --------------------------------------------------------------------------
   职责单一：给 .rj-lg--spot 写入 --mx/--my，驱动跟随光标的高光斑；
   可选地给 .rj-lg--adapt 采样壁纸亮度（默认关闭）。

   性能约定：
   · pointermove 只记坐标，样式写入放进 rAF，一帧最多一次
   · rect 缓存，指针离开时失效

   注意：本文件**不负责**给卡片挂 .rj-lg 类 —— 挂类由 liquid-glass-boot.js
   完成（独立脚本，便于在 inject 里单独管控）。
   ========================================================================== */
(function () {
  'use strict';

  var SPOT = '.rj-lg--spot';

  /* ---------- 2. 光标光斑 ---------- */

  var finePointer = window.matchMedia
    ? window.matchMedia('(hover: hover) and (pointer: fine)').matches
    : true;

  function initSpot(el) {
    if (el.__rjLgBound) return;
    el.__rjLgBound = true;

    var rect = null;
    var pending = false;
    var lastX = 0;
    var lastY = 0;

    function apply() {
      pending = false;
      if (!rect) return;
      var x = ((lastX - rect.left) / rect.width) * 100;
      var y = ((lastY - rect.top) / rect.height) * 100;
      x = x < 0 ? 0 : x > 100 ? 100 : x;
      y = y < 0 ? 0 : y > 100 ? 100 : y;
      el.style.setProperty('--mx', x.toFixed(2) + '%');
      el.style.setProperty('--my', y.toFixed(2) + '%');
    }

    el.addEventListener('pointerenter', function () {
      rect = el.getBoundingClientRect();
    }, { passive: true });

    el.addEventListener('pointermove', function (e) {
      lastX = e.clientX;
      lastY = e.clientY;
      if (!rect) rect = el.getBoundingClientRect();
      if (pending) return;
      pending = true;
      requestAnimationFrame(apply);
    }, { passive: true });

    el.addEventListener('pointerleave', function () {
      rect = null;
      el.style.removeProperty('--mx');
      el.style.removeProperty('--my');
    }, { passive: true });
  }

  /* ---------- 3. 自适应材质：采样卡片背后壁纸的亮度 ---------- */

  /*
   * 做法：把当前页面背景图（壁纸）加载到一个离屏 canvas，
   * 按每张卡片在视口中的位置，取对应区域的平均亮度，写到 --rj-lg-lum。
   *
   * 只做一次（首屏 + 视口变化时重算），不监听滚动 —— 因为壁纸是 fixed 的，
   * 卡片相对视口的位置在滚动时不变（侧栏 sticky 也只是小幅位移）。
   */

  var ADAPT = '.rj-lg--adapt';

  function getWallpaperURL() {
    var bg = getComputedStyle(document.body).backgroundImage || '';
    var m = bg.match(/url\((['"]?)(.*?)\1\)/);
    return m ? m[2] : null;
  }

  function luminance(r, g, b) {
    function ch(c) {
      c /= 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    }
    return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
  }

  function sampleCards(img) {
    var cards = document.querySelectorAll(ADAPT);
    if (!cards.length) return;

    /* 缩小到 96px 宽做采样，足够算平均亮度且不占内存 */
    var SW = 96;
    var SH = Math.max(1, Math.round(SW * img.naturalHeight / img.naturalWidth));
    var cv = document.createElement('canvas');
    cv.width = SW;
    cv.height = SH;
    var ctx = cv.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;
    ctx.drawImage(img, 0, 0, SW, SH);

    var vw = window.innerWidth;
    var vh = window.innerHeight;
    var iw = img.naturalWidth;
    var ih = img.naturalHeight;

    /* 复现 background-size: cover 的映射 */
    var scale = Math.max(vw / iw, vh / ih);
    var dw = iw * scale;
    var dh = ih * scale;
    var dx = (vw - dw) / 2;
    var dy = (vh - dh) / 2;

    for (var i = 0; i < cards.length; i++) {
      var r = cards[i].getBoundingClientRect();
      if (!r.width || !r.height) continue;

      /* 卡片区域映射回壁纸原图坐标，再映射到缩略图 */
      var x0 = ((r.left - dx) / dw) * SW;
      var y0 = ((r.top - dy) / dh) * SH;
      var x1 = ((r.right - dx) / dw) * SW;
      var y1 = ((r.bottom - dy) / dh) * SH;
      x0 = Math.max(0, Math.min(SW - 1, x0));
      y0 = Math.max(0, Math.min(SH - 1, y0));
      x1 = Math.max(x0 + 1, Math.min(SW, x1));
      y1 = Math.max(y0 + 1, Math.min(SH, y1));

      var data;
      try {
        data = ctx.getImageData(x0 | 0, y0 | 0, Math.max(1, (x1 - x0) | 0), Math.max(1, (y1 - y0) | 0)).data;
      } catch (e) {
        return; /* 壁纸跨域时 canvas 被污染，静默放弃 */
      }

      var sum = 0;
      var n = 0;
      for (var k = 0; k < data.length; k += 4) {
        sum += luminance(data[k], data[k + 1], data[k + 2]);
        n++;
      }
      if (!n) continue;
      cards[i].style.setProperty('--rj-lg-lum', (sum / n).toFixed(4));
    }
  }

  function adapt() {
    var cards = document.querySelectorAll(ADAPT);
    if (!cards.length) return;

    var url = getWallpaperURL();
    if (!url) return;

    var img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = function () { sampleCards(img); };
    img.onerror = function () { /* 加载失败就保持默认，不影响玻璃表现 */ };
    img.src = url;
  }

  /* ---------- 入口 ---------- */

  function scan() {
    if (finePointer) {
      var spots = document.querySelectorAll(SPOT);
      for (var j = 0; j < spots.length; j++) initSpot(spots[j]);
    }
    adapt();
  }

  /* 视口变化时重算（卡片位置会变） */
  var rsTimer = null;
  window.addEventListener('resize', function () {
    if (rsTimer) clearTimeout(rsTimer);
    rsTimer = setTimeout(adapt, 180);
  }, { passive: true });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', scan);
  } else {
    scan();
  }

  /* 兼容 Butterfly 的 pjax：局部刷新后重新扫描 */
  if (typeof btf !== 'undefined' && btf && typeof btf.addGlobalFn === 'function') {
    btf.addGlobalFn('rjLiquidGlass', scan);
  }

  /* 兜底：只在侧栏容器内观察，断开不重连，开销可忽略 */
  if (window.MutationObserver) {
    var aside = document.getElementById('aside-content');
    if (aside) {
      new MutationObserver(scan).observe(aside, { childList: true, subtree: true });
    }
  }
})();
