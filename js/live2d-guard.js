/* ============================================================
   看板娘闸门（live2d-guard）
   ------------------------------------------------------------
   问题：L2Dwidget 是 fixed + z-index 99999 的 200×400 画布，
   直接压在侧栏上 —— 文章页盖住作者卡头像，首页盖住全球访客地图，
   ≤768px 还会压住首屏标题和社交图标。

   处理：
     1. ≤768px / 系统「减少动态效果」→ 根本不加载（省 ~1MB，且手机上只会添乱）
     2. 滚过首屏即淡出 + 停止接收指针事件（正文区域永远干净）
     3. 模型左上角一枚折叠按钮，选择记在 localStorage
   ============================================================ */
(function () {
  'use strict';

  var KEY = 'rj-live2d-hidden';
  var narrow = window.matchMedia('(max-width: 768px)');
  var calm = window.matchMedia('(prefers-reduced-motion: reduce)');
  if (narrow.matches || calm.matches) return;      // 手机上不加载

  function hidden() {
    try { return localStorage.getItem(KEY) === '1'; } catch (e) { return false; }
  }
  function setHidden(v) {
    try { v ? localStorage.setItem(KEY, '1') : localStorage.removeItem(KEY); } catch (e) {}
  }

  var cfg = {
    model: { jsonPath: '/live2dw/assets/miku.model.json' },
    // hOffset 0 = 贴右边缘：侧栏右边界在 1292 左右，模型 1240 起，只压住
    // 卡片右沿 50px；配合下方 CSS 的 z-index 让卡片盖在它上面，等于「从卡片后面探出来」。
    display: { position: 'right', width: 200, height: 400, hOffset: 0, vOffset: -68 },
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

  function decorate(el) {
    el.classList.add('rj-l2d');

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'rj-l2d-toggle';
    btn.setAttribute('aria-label', '收起看板娘');
    btn.title = '收起看板娘';
    btn.innerHTML = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" ' +
      'stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      setHidden(true);
      el.style.display = 'none';
    });
    el.appendChild(btn);

    if (hidden()) { el.style.display = 'none'; return; }

    // 滚过首屏 60% 就淡出：正文/侧栏区域永远不被这块 200×400 的画布压住。
    // 注意 L2Dwidget 自己往 el 上写了内联 opacity / pointer-events，
    // 用 class 控制会被内联样式压掉 —— 只能同样走内联。
    var away = null;
    function apply(next) {
      if (next === away) return;
      away = next;
      el.style.opacity = next ? '0' : '1';
      el.style.transform = next ? 'translateY(16px)' : 'none';
      // 淡出后必须彻底让出命中区：200×400 的透明块压在侧栏上会吞掉点击
      el.style.pointerEvents = 'none';
      el.classList.toggle('rj-l2d-away', next);   // 仅用于调试/截图定位
    }
    var ticking = false;
    function sync() {
      ticking = false;
      // 首屏 84vh，卡片在一屏底部就会露头；只要开始滚动就让位，
      // 别让这块 200×400 的画布压住第一张卡。
      apply(window.scrollY > 24);
    }
    window.addEventListener('scroll', function () {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(sync);
    }, { passive: true });
    sync();
  }

  // 等 load + 空闲再拉脚本，别和首屏抢带宽
  function go() {
    window.requestIdleCallback
      ? requestIdleCallback(load, { timeout: 4000 })
      : setTimeout(load, 2000);
  }
  if (document.readyState === 'complete') go();
  else window.addEventListener('load', go, { once: true });
})();
