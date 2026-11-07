/**
 * rj-enhance.js v1.0.1 — 可访问性 + 动效层增强
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
      /* 回顶按钮外圈进度环：pjax 会换掉 #go-up，所以每次现取 */
      var up = doc.getElementById('go-up');
      if (up) up.style.setProperty('--rj-doc-progress', (p * 100).toFixed(1));
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

  /* ---------- 6) 首屏动态背景 ----------
     首页背景从静帧换成 13.6s 静音循环视频（详见 custom.css 批次 D）。
     视频首帧与静帧同画面，所以淡入时看不到切换。

     三条不做：
       · 不做首屏阻塞 —— 等 load + 空闲才挂载，视频不跟标题抢带宽；
       · 不做省流用户 —— Save-Data / 2G·3G 直接退回静帧，150KB 也是流量；
       · 不做减弱动效 —— prefers-reduced-motion 下完全不挂载。
     （原第四条「不做亮色主题」已取消：亮色首屏不再压白蒙层，
       两个主题共用同一张深色视频，文字已换成媒体安全色，见 custom.css 批次 E）
     进程内还会在离开首页时主动卸载，别让它在后台继续解码耗电。 */
  function heroEligible() {
    if (reduce) return false;
    var c = navigator.connection;
    if (!c) return true;
    if (c.saveData) return false;
    /* v1.8.6：门槛从「≥4g」放宽到「≥3g」。原来 3g 直接退回静帧，而实测机被判 3g，
       首屏就永远是死画面。只有真省流的 slow-2g / 2g 与 Save-Data 仍不挂载。 */
    return !/^(slow-2g|2g)$/.test(c.effectiveType || '');
  }

  var heroTimer = null;

  function heroSync() {
    var header = doc.getElementById('page-header');
    var onHome = !!(header && /(^|\s)full_page(\s|$)/.test(header.className));
    var video = header && header.querySelector('.rj-hero-video');

    /* 不在首页、或者是省流/减弱动效 ——
       两个方向都收干净，别留一个看不见的 video 在后台解码 */
    if (!onHome || !heroEligible()) {
      if (video) {
        video.pause();
        video.remove();
      }
      return;
    }
    if (video) {
      if (video.paused) {
        var again = video.play();
        if (again && again.catch) again.catch(function () {});
      }
      return;
    }

    var v = doc.createElement('video');
    v.className = 'rj-hero-video';
    v.muted = true;
    v.defaultMuted = true;
    v.loop = true;
    v.playsInline = true;
    v.autoplay = true;
    v.preload = 'auto';
    v.setAttribute('muted', '');
    v.setAttribute('playsinline', '');
    v.setAttribute('aria-hidden', 'true');
    v.setAttribute('tabindex', '-1');
    /* 手机竖屏按 cover 裁完只剩中间一条，672 宽够用；
       桌面全屏铺开才需要 1344 那一档。
       AV1 优先：同画质体积比 H.264 省 ~53%（桌面 372→173KB），
       canPlayType('av01') 能探测 —— Chrome/Edge(含 dav1d 软解)、iOS 17+、
       新安卓返回 'probably'；不支持的（旧 Safari/老安卓）返回 ''，自动落回 H.264。
       即使探测误判，下面 error 监听仍会撤层兜底，不会白屏。 */
    var av1 = !!v.canPlayType('video/mp4; codecs="av01.0.05M.08"');
    v.src = window.innerWidth < 820
      ? (av1 ? '/img/hero-bg-sm.av1.mp4' : '/img/hero-bg-sm.mp4')
      : (av1 ? '/img/hero-bg.av1.mp4' : '/img/hero-bg.mp4');

    v.addEventListener(
      'canplay',
      function () {
        v.classList.add('is-ready');
        var p = v.play();
        if (p && p.catch) p.catch(function () {});
      },
      { once: true }
    );
    /* 解码失败：AV1 探测误判（个别 Safari 会对 av01 乐观返回 'maybe'，
       真解码却失败）→ 原地换回 H.264 重试一次；H.264 也失败才撤层。
       静帧海报一直垫在下面，任何一步失败都不会白屏。 */
    v.addEventListener('error', function () {
      var cur = v.getAttribute('src') || '';
      if (/\.av1\.mp4$/.test(cur)) {
        v.setAttribute('src', cur.replace('.av1.mp4', '.mp4'));
        v.load();
        var p = v.play();
        if (p && p.catch) p.catch(function () {});
        return;
      }
      v.remove();
    });

    header.insertBefore(v, header.firstChild);
  }

  function heroStart() {
    if (heroTimer) return;
    var run = function () {
      heroTimer = null;
      heroSync();
    };
    if (window.requestIdleCallback) {
      heroTimer = requestIdleCallback(run, { timeout: 1200 });
    } else {
      heroTimer = setTimeout(run, 400);
    }
  }

  /* v1.8.6：挂载时机从「load 后」提前到「DOMContentLoaded 后」。
     load 要等全部图片/外部脚本，窄带下 40s 才到 —— 视频那之后才开始下，
     用户整个首屏停留期都是死的。CSS 在 head 已拿到（阻塞渲染、优先级高），
     这里 DOM 解析完再拉视频，不会抢首屏文字与样式的带宽。 */
  if (doc.readyState === 'loading') {
    doc.addEventListener('DOMContentLoaded', heroStart, { once: true });
  } else {
    heroStart();
  }

  doc.addEventListener('pjax:complete', function () {
    var header = doc.getElementById('page-header');
    if (header && /(^|\s)full_page(\s|$)/.test(header.className)) {
      heroStart();
    } else {
      heroSync();
    }
  });

  /* 主题切换时同步一次：两个主题现在都用同一张视频（亮色首屏已是深色底），
     这里只负责在省流/减弱动效条件变化时收放。只在页面 load 完之后响应，
     避免初始化阶段的 data-theme 写入把视频提前拉起来、跟首屏抢带宽。 */
  if (window.MutationObserver) {
    new MutationObserver(function () {
      if (doc.readyState === 'complete') heroSync();
    }).observe(de, { attributes: true, attributeFilter: ['data-theme'] });
  }
})();
