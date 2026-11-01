/**
 * rj-enhance.js v1.0.0 — 可访问性 + 动效层增强
 * 内容：主题切换 View Transitions / 卡片渐显 / 阅读进度条 / h2 锚点复制 / 阅读时长
 * 约定：所有动效在 prefers-reduced-motion 下降级；无 JS 时页面完全正常（class 由 JS 添加）。
 */
(function () {
  'use strict';
  var doc = document;
  var de = doc.documentElement;
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- 1) 主题切换：View Transitions 圆形扩散 ----------
     inject_head_js 在 head 里挂 window.activateDarkMode/LightMode；
     main.js 的点击处理直接调用它们 —— 包装这两个入口即可全覆盖
     （按钮点击、autoChangeMode、系统偏好变化都会经过这里）。 */
  function wrapActivate(name) {
    var orig = window[name];
    if (typeof orig !== 'function' || orig.__rjVt) return;
    var wrapped = function () {
      var self = this, args = arguments;
      if (!doc.startViewTransition || reduce) return orig.apply(self, args);
      doc.startViewTransition(function () { orig.apply(self, args); });
    };
    wrapped.__rjVt = true;
    window[name] = wrapped;
  }
  function patchThemeToggle() {
    wrapActivate('activateDarkMode');
    wrapActivate('activateLightMode');
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', patchThemeToggle);
  } else {
    patchThemeToggle();
  }
  /* 记录点击位置，圆形扩散从按钮处展开 */
  document.addEventListener('pointerdown', function (e) {
    var t = e.target;
    if (t && t.closest && t.closest('#darkmode')) {
      de.style.setProperty('--vt-x', e.clientX + 'px');
      de.style.setProperty('--vt-y', e.clientY + 'px');
    }
  }, true);

  /* ---------- 2) 卡片渐显（IntersectionObserver） ---------- */
  if (!reduce && 'IntersectionObserver' in window) {
    de.classList.add('rj-anim');
    var targets = doc.querySelectorAll('#recent-posts > .recent-post-item, #aside-content .card-widget');
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) {
          en.target.classList.add('rj-in');
          io.unobserve(en.target);
        }
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.05 });
    Array.prototype.forEach.call(targets, function (el, i) {
      el.classList.add('rj-reveal');
      el.style.transitionDelay = Math.min((i % 6) * 45, 225) + 'ms';
      /* 首屏已在视口内的卡片直接点亮，避免「闪一下再出现」 */
      var r = el.getBoundingClientRect();
      if (r.top < window.innerHeight * 0.98 && r.bottom > 0) {
        el.classList.add('rj-in');
      } else {
        io.observe(el);
      }
    });
  }

  /* ---------- 3) 文章页：阅读进度条 + 阅读时长 + h2 锚点复制 ---------- */
  var wrap = doc.getElementById('body-wrap');
  var art = doc.getElementById('article-container');
  var isPost = wrap && wrap.classList.contains('post');

  if (isPost) {
    /* 3a) 进度条 */
    var bar = doc.createElement('div');
    bar.className = 'rj-progress';
    bar.setAttribute('aria-hidden', 'true');
    doc.body.appendChild(bar);
    var upd = function () {
      if (!art) return;
      var r = art.getBoundingClientRect();
      var total = r.height - window.innerHeight;
      var p = total > 0 ? Math.min(Math.max(-r.top / total, 0), 1) : 0;
      bar.style.transform = 'scaleX(' + p + ')';
    };
    window.addEventListener('scroll', upd, { passive: true });
    window.addEventListener('resize', upd);
    upd();

    /* 3b) 阅读时长：中文按 400 字/分，英文按 220 词/分，取整至少 1 */
    var meta = doc.getElementById('post-meta') || doc.querySelector('.post-meta');
    if (meta && !meta.querySelector('.rj-mins')) {
      var text = art.textContent || '';
      var cjk = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
      var words = (text.replace(/[\u4e00-\u9fa5]/g, ' ').match(/[A-Za-z0-9]+/g) || []).length;
      var mins = Math.max(1, Math.round(cjk / 400 + words / 220));
      var minsEl = doc.createElement('span');
      minsEl.className = 'rj-mins';
      minsEl.innerHTML =
        '<svg class="rj-mins-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M12 8v4.2l2.8 1.6"/></svg>' +
        '约 ' + mins + ' 分钟';
      meta.appendChild(minsEl);
    }
  }

  /* 3c) h2/h3 锚点复制（有 id 的标题才加） */
  if (art) {
    var heads = art.querySelectorAll('h2[id], h3[id]');
    Array.prototype.forEach.call(heads, function (h) {
      if (h.querySelector('.rj-hcopy')) return;
      var btn = doc.createElement('button');
      btn.type = 'button';
      btn.className = 'rj-hcopy';
      btn.setAttribute('aria-label', '复制本节链接');
      btn.title = '复制本节链接';
      btn.innerHTML =
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
        '<path d="M10.5 13.5a4 4 0 0 0 5.7 0l3-3a4 4 0 1 0-5.7-5.7l-1.2 1.2"/>' +
        '<path d="M13.5 10.5a4 4 0 0 0-5.7 0l-3 3a4 4 0 1 0 5.7 5.7l1.2-1.2"/></svg>';
      var ok = function () {
        btn.classList.add('rj-hcopy-ok');
        btn.setAttribute('aria-label', '已复制');
        setTimeout(function () {
          btn.classList.remove('rj-hcopy-ok');
          btn.setAttribute('aria-label', '复制本节链接');
        }, 1600);
      };
      btn.addEventListener('click', function (ev) {
        ev.preventDefault();
        var url = location.origin + location.pathname + '#' + h.id;
        var fallback = function () {
          var ta = doc.createElement('textarea');
          ta.value = url;
          ta.style.cssText = 'position:fixed;opacity:0';
          doc.body.appendChild(ta);
          ta.select();
          try { doc.execCommand('copy'); ok(); } catch (err) { /* noop */ }
          ta.remove();
        };
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(url).then(ok, fallback);
        } else {
          fallback();
        }
      });
      h.appendChild(btn);
    });
  }
})();
