/* ==========================================================================
   背景外星人头像 · 随机眨眼（v1.7.9）
   --------------------------------------------------------------------------
   #web_bg 是 background: url(/img/oc.webp) center/cover 的静态壁纸，壁纸本身
   动不了，所以在同一坐标上叠一层「闭眼贴片」：

     · 容器 #rj-eyes 复刻 cover 之后的图片尺寸（resize / 转屏时重算），
       和壁纸用同一套缩放规则，所以左眼右眼永远咬住原图位置；
     · 贴片 oc-eye-l / oc-eye-r.webp 是 oc.webp 眼睛区域的原位强模糊 + 提亮，
       平时 clip-path 收在顶部完全不可见；
     · 眨眼时从上往下扫过再把帘子收回，单次约 200ms；
     · 两只眼各跑各的随机间隔（2~7 秒），偶尔同拍，接近真人。

   减少动态偏好（prefers-reduced-motion: reduce）下完全不挂载。
   ========================================================================== */
(function () {
  'use strict';

  var IMG_W = 1920;
  var IMG_H = 1080;

  /* ROI 取自原图眼睛区域的实测包围盒（像素坐标） */
  var EYES = [
    { x0: 10,   y0: 510, x1: 240,  y1: 772, src: '/img/oc-eye-l.webp', gap: [2400, 6600] },
    { x0: 1666, y0: 522, x1: 1908, y1: 756, src: '/img/oc-eye-r.webp', gap: [2800, 7400] }
  ];

  var mq = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  if (mq && mq.matches) return;

  var box = null;
  var nodes = [];

  function rnd(a, b) {
    return a + Math.random() * (b - a);
  }

  function build() {
    if (document.getElementById('rj-eyes')) return;

    box = document.createElement('div');
    box.id = 'rj-eyes';
    box.setAttribute('aria-hidden', 'true');

    for (var i = 0; i < EYES.length; i++) {
      var e = EYES[i];
      var s = document.createElement('span');
      s.className = 'rj-eye rj-eye--' + (i === 0 ? 'l' : 'r');
      s.style.left = (e.x0 / IMG_W * 100) + '%';
      s.style.top = (e.y0 / IMG_H * 100) + '%';
      s.style.width = ((e.x1 - e.x0) / IMG_W * 100) + '%';
      s.style.height = ((e.y1 - e.y0) / IMG_H * 100) + '%';
      s.style.backgroundImage = 'url("' + e.src + '")';
      box.appendChild(s);
      nodes.push(s);
    }

    document.body.appendChild(box);
    layout();
  }

  /* 复刻 #web_bg 的 center / cover：等比放大到刚好盖住视口，再居中 */
  function layout() {
    if (!box) return;
    var vw = document.documentElement.clientWidth || window.innerWidth;
    var vh = document.documentElement.clientHeight || window.innerHeight;
    var scale = Math.max(vw / IMG_W, vh / IMG_H);
    var w = IMG_W * scale;
    var h = IMG_H * scale;
    box.style.width = w + 'px';
    box.style.height = h + 'px';
    box.style.left = ((vw - w) / 2) + 'px';
    box.style.top = ((vh - h) / 2) + 'px';
  }

  function blink(node) {
    node.classList.remove('blink-up');
    node.classList.add('blink-down');
    setTimeout(function () {
      node.classList.remove('blink-down');
      node.classList.add('blink-up');
      setTimeout(function () {
        node.classList.remove('blink-up');
      }, 120);
    }, 95);
  }

  function schedule(i) {
    var e = EYES[i];
    setTimeout(function () {
      if (!document.hidden && (!mq || !mq.matches)) blink(nodes[i]);
      schedule(i);
    }, rnd(e.gap[0], e.gap[1]));
  }

  function start() {
    build();
    if (!nodes.length) return;
    for (var i = 0; i < nodes.length; i++) schedule(i);
  }

  function boot() {
    if (document.getElementById('rj-eyes')) {
      layout();
      return;
    }
    nodes = [];
    start();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  window.addEventListener('resize', layout);
  window.addEventListener('orientationchange', layout);

  /* pjax 只换内容不动 body，这里只兜底：元素万一被替换就重建，否则只校正尺寸 */
  document.addEventListener('pjax:complete', function () {
    setTimeout(boot, 60);
  });
})();
