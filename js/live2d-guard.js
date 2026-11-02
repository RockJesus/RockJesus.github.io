/* ============================================================
   看板娘闸门（live2d-guard）· 常显版（2026-11-02）
   ------------------------------------------------------------
   历史版本曾做「滚过首屏淡出 + 左上角折叠按钮 + localStorage 记忆」，
   站主后来要求：看板娘一直显示、不要隐藏、也不要挡住右下角按钮。

   现在的行为：
     1. 常显 —— 不随滚动淡出，没有折叠按钮，也不读任何隐藏标记；
     2. 站位 —— 贴地（vOffset -28，脚底压着页面底边，与最初版本一致），
        左移 hOffset 60：画布右缘收进 1440px 处，右下角按钮列
        （3 枚 44px，left ≈ 1446）从她右侧空白经过，双马尾完全不碰按钮；
        z-index 仍压到 1（见 custom.css 批次 A1），卡片照旧盖在她身上，
        形成「从卡片后面探出来」的效果；
     3. ≤768px / 系统「减少动态效果」仍不加载 —— 手机上这块画布
        只会压住正文和浮标，还省 ~1MB 流量。
   ============================================================ */
(function () {
  'use strict';

  if (window.matchMedia('(max-width: 768px)').matches ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

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
      if (window.L2Dwidget) L2Dwidget.init(cfg);
    };
    document.body.appendChild(s);
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
