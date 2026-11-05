/* ==========================================================================
   RockJesus.cn — Liquid Glass 挂类器
   version: 1.0.0 · 2026-11-05
   --------------------------------------------------------------------------
   只做一件事：给侧栏卡片挂上材质类。材质本身在 liquid-glass.css，
   光斑/采样在 liquid-glass.js —— 三个文件职责分开，便于单独回滚。

   挂的类：
     .rj-lg          材质本体（均衡档，暗玻璃，通过 WCAG AA）
     .rj-lg--spot    光标高光斑
     .rj-lg--ultra   复刻档（iOS 26 参考图：无暗膜、亮玻璃、重虚化）

   为什么「复刻档」默认开启：
     站长 2026-11-05 明确要求「复刻参考图的效果」，参考图就是复刻档。
     想换回均衡档：把下面 GRADE_ON 改成 'balanced'，或只删掉这一处。

   兼容：
     · pjax 局部刷新后重新挂（Butterfly 的 btf.addGlobalFn）
     · 只碰 #aside-content 内的 .card-widget，不碰主列文章卡片
     · 幂等：重复执行只是 classList.add，无副作用
   ========================================================================== */
(function () {
  'use strict';

  /* ---------- 配置 ---------- */
  var GRADE_ON = 'replica';   // 'replica' = 复刻档（默认） | 'balanced' = 均衡档

  var BASE = ['rj-lg', 'rj-lg--spot'];
  var GRADE = GRADE_ON === 'replica' ? 'rj-lg--ultra' : null;

  var SELECTOR = '#aside-content .card-widget';

  function apply() {
    var cards = document.querySelectorAll(SELECTOR);
    var i, j, el;

    for (i = 0; i < cards.length; i++) {
      el = cards[i];

      /* 允许单张卡片退出：data-rj-lg="off" */
      if (el.getAttribute('data-rj-lg') === 'off') {
        for (j = 0; j < BASE.length; j++) el.classList.remove(BASE[j]);
        if (GRADE) el.classList.remove(GRADE);
        continue;
      }

      for (j = 0; j < BASE.length; j++) el.classList.add(BASE[j]);
      if (GRADE) el.classList.add(GRADE);
    }
  }

  /* ---------- 入口 ---------- */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', apply);
  } else {
    apply();
  }

  /* pjax：局部刷新后侧栏会重建，需要重新挂 */
  if (window.btf && typeof window.btf.addGlobalFn === 'function') {
    window.btf.addGlobalFn('rjLiquidGlassBoot', apply);
  }

  /* 兜底：侧栏内容异步渲染（卡片是以后端接口填的）时补挂一次 */
  if (window.MutationObserver) {
    var aside = document.getElementById('aside-content');
    if (aside) {
      var t = null;
      new MutationObserver(function () {
        if (t) return;
        t = setTimeout(function () { t = null; apply(); }, 80);
      }).observe(aside, { childList: true, subtree: true });
    }
  }
})();
