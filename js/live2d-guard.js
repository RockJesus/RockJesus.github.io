/* ============================================================
   看板娘闸门（live2d-guard）· 常显版（2026-11-02）＋ 滚动触发（v2.1.8）
   ------------------------------------------------------------
   历史版本曾做「滚过首屏淡出 + 左上角折叠按钮 + localStorage 记忆」，
   站主后来要求：看板娘一直显示、不要隐藏、也不要挡住右下角按钮。

   现在的行为：
     1. 常显 —— 不随滚动淡出，没有折叠按钮，也不读任何隐藏标记；
     2. 可拖动 —— 按住鼠标（或触摸）拖到任意位置，松手即记在
        localStorage（rj-live2d-pos），刷新/换页保持；双击出界会自动
        收回视口内。位置接管后 inline left/top 覆盖 L2Dwidget 的定位；
     3. 默认站位 —— 贴地（vOffset -28）+ 左移 hOffset 60，画布右缘
        收在右下角按钮列左侧，互不遮挡；
     4. z-index 压到 1（见 custom.css 批次 A1），卡片照旧盖在她身上；
     5. ≤768px / 系统「减少动态效果」仍不加载 —— 手机上这块画布
        只会压住正文和浮标，还省 ~1MB 流量。
     6. 首屏不加载（v2.1.8）—— 页面滚过首屏一截才拉 L2Dwidget 与模型；
        只看首屏就永远不加载，省掉约 1MB 请求与右侧占位。
   ============================================================ */
(function () {
  'use strict';

  if (window.matchMedia('(max-width: 768px)').matches ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  var POS_KEY = 'rj-live2d-pos';

  function readPos() {
    try {
      var p = JSON.parse(localStorage.getItem(POS_KEY));
      return p && typeof p.x === 'number' && typeof p.y === 'number' ? p : null;
    } catch (e) { return null; }
  }
  function writePos(p) {
    try { localStorage.setItem(POS_KEY, JSON.stringify(p)); } catch (e) {}
  }

  var cfg = {
    model: { jsonPath: '/live2dw/assets/miku.model.json' },
    // hOffset 60 = 整体左移 60px，给右下角按钮列（宽 44 + 右边距 10）让位；
    // 改动前先确认双马尾尖端不碰按钮列（实测马尾展宽约 ±70px）。
    display: { position: 'right', width: 200, height: 400, hOffset: 60, vOffset: -28 },
    mobile: { show: false, scale: 0.5 },
    log: false,
    pluginJsPath: 'lib/',
    pluginModelPath: 'assets/',
    pluginRootPath: 'live2dw/',
    tagMode: false
  };

  function load() {
    var s = document.createElement('script');
    s.src = '/live2dw/lib/L2Dwidget.min.js';
    s.onload = function () {
      if (!window.L2Dwidget) return;
      L2Dwidget.init(cfg);
      // init 是同步建 DOM 的，但保险起见轮询几帧等 #live2d-widget 出现
      var tries = 0;
      (function wait() {
        var el = document.getElementById('live2d-widget');
        if (el) return decorate(el);
        if (++tries < 40) requestAnimationFrame(wait);
      })();
    };
    document.body.appendChild(s);
  }

  /* 把定位接管过来：恢复上次拖到的位置，并 clamp 在视口内 */
  function takeOver(el, pos) {
    var r = el.getBoundingClientRect();
    var x = Math.min(Math.max(0, pos.x), window.innerWidth - r.width);
    var y = Math.min(Math.max(0, pos.y), window.innerHeight - r.height);
    el.style.right = 'auto';
    el.style.bottom = 'auto';
    el.style.left = Math.round(x) + 'px';
    el.style.top = Math.round(y) + 'px';
  }

  function decorate(el) {
    var pos = readPos();
    if (pos) {
      // 等 L2Dwidget 把自己的定位写完再覆盖
      requestAnimationFrame(function () { takeOver(el, pos); });
      window.addEventListener('resize', function () {
        takeOver(el, readPos() || { x: 0, y: 0 });
      });
    }

    /* 拖动：pointer 系列事件，鼠标 / 触屏一体。
       位移超过 6px 才算拖动 —— 否则保持「点击召唤豆包」的原交互；
       拖动结束置 justDragged，由 window 捕获阶段的 click 吞掉一次
       （window 捕获先于 player.js 绑在元素上的 click，冒泡也到不了
       document 的「点外部关闭」逻辑），避免松手误开面板。 */
    var justDragged = false;
    window.addEventListener('click', function (e) {
      if (justDragged && el.contains(e.target)) {
        e.stopPropagation();
        e.preventDefault();
        justDragged = false;
      }
    }, true);

    el.addEventListener('pointerdown', function (e) {
      if (e.button !== 0) return;
      var startX = e.clientX, startY = e.clientY;
      var rect = el.getBoundingClientRect();
      var offX = startX - rect.left, offY = startY - rect.top;
      var moved = false;

      el.classList.add('rj-l2d-dragging');

      function onMove(ev) {
        if (!moved) {
          if (Math.abs(ev.clientX - startX) + Math.abs(ev.clientY - startY) < 6) return;
          moved = true;
          el.style.right = 'auto';
          el.style.bottom = 'auto';
        }
        var r = el.getBoundingClientRect();
        var nx = Math.min(Math.max(0, ev.clientX - offX), window.innerWidth - r.width);
        var ny = Math.min(Math.max(0, ev.clientY - offY), window.innerHeight - r.height);
        el.style.left = Math.round(nx) + 'px';
        el.style.top = Math.round(ny) + 'px';
      }
      function onUp() {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
        el.classList.remove('rj-l2d-dragging');
        if (!moved) return;
        justDragged = true;
        var r = el.getBoundingClientRect();
        writePos({ x: Math.round(r.left), y: Math.round(r.top) });
      }
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
    });
  }

  /* 首屏不拉看板娘（v2.1.8）：
     模型 + 贴图约 1MB，原先在 load 后空闲就拉 —— 等于用户刚看到首页、
     首屏视频还在下的时候再插一条 1MB 请求，右侧也被立刻占住。
     现在改成「用户真的往下滚了才加载」：
       · 阈值 = min(260px, 视口高 × 0.34)，滚过首屏一截才动手；
       · 滚轮 / 触屏 / 键盘 / 拖滚动条都会冒 scroll，只听这一个就够；
       · 只触发一次，触发即摘监听，之后怎么滚都不重复加载；
       · 首帧自检一次：带锚点进来、或浏览器恢复了上次滚动位置时，
         用户本来就不在首屏，不该再等下一次滚动。
     代价是「只看首屏从不滚动」的访问永远见不到看板娘 —— 这正是这次的取舍。 */
  var l2dFired = false;

  function l2dThreshold() {
    return Math.min(260, Math.round(window.innerHeight * 0.34));
  }

  function l2dTryLoad() {
    if (l2dFired) return;
    if (window.scrollY <= l2dThreshold()) return;
    l2dFired = true;
    window.removeEventListener('scroll', l2dTryLoad);
    load();
  }

  window.addEventListener('scroll', l2dTryLoad, { passive: true });
  requestAnimationFrame(l2dTryLoad);

  /* pjax 换页后滚动位置可能被重置，也可能直接落在文章中部：再判一次 */
  document.addEventListener('pjax:complete', function () {
    if (!l2dFired) requestAnimationFrame(l2dTryLoad);
  });
})();
