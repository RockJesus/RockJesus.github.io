/**
 * oc-video-bg.js — 壁纸视频层（方案 C：会眨眼的循环短片）
 * --------------------------------------------------------------------------------
 * oc-blink.mp4：1920×1080 / 24fps / 10s / 2.44 MB，无缝循环（首末帧星云同为青绿、双眼全睁）。
 *   内容＝AI 图生视频 v4（Seedance 2.5）：原图两头贴边构图不变，
 *   右眼为青绿透镜并由下眼睑自下而上眨眼（左眼 1.4–2.4s、右眼 7.4–8.4s 各一次），
 *   星云在青绿与紫红之间各停留约 5 秒，色相变化不动物体、不改文字。
 * 静态兜底用 oc-blink-poster.webp（就是视频第 0 帧），
 *   所以视频没下载完 / 被浏览器挡住自动播放 / 被延迟加载时，看到的和视频开头完全一致，不会跳画面。
 *
 * 行为：
 *   - 只插一次，位置在 body 最前，fixed 铺满、object-fit:cover（与原来的 center/cover 同一种裁切）
 *   - 懒加载（v1.8.5）：2.44 MB 的视频不再和首屏头图视频抢同一条窄带。
 *     插入时只挂 poster、不设 src，等到下列任一条件才真正拉流：
 *       1) 首屏（#page-header）滚出视口 —— 用户已经看不到首屏，壁纸这时才需要；
 *       2) 页面 load 完成后再空闲 3 秒 —— 首屏的 CSS/JS/头图视频先拿到带宽；
 *       3) 兜底：load 完成 8 秒后。
 *   - 让路（v1.8.6）：即使触发条件满足，也要等头图视频（.rj-hero-video）readyState≥3
 *     或加载失败后才开拉。头图是首屏主角，AV1 只有 393 KB；壁纸 2.44 MB 且被首屏挡着
 *     看不见，抢带宽只会两败俱伤。头图 20 秒仍未就绪则不再等。
 *   - saveData 或 2G/slow-2G 网络下永不拉流，只保留静态 poster（省流量优先）。
 *   - muted + playsinline 才允许静音自动播放；被拦时保持 poster，不做任何重试动画
 *   - 页面不可见时暂停，回来再播（省电、省解码）
 *   - prefers-reduced-motion: reduce 时不插入，回落到静态壁纸
 * 装饰层，pointer-events:none，不影响任何交互。
 */
(function () {
  'use strict';

  var SRC = '/img/oc-blink.mp4?v=4';  /* v4 = AI 10s 版，带版本参数绕开老片缓存的 mp4 */
  var POSTER = '/img/oc-blink-poster.webp';
  var ID = 'rj-oc-video';
  var started = false;
  var waiting = false;

  function reduceMotion() {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  /* 省流：saveData 或 2G 级网络下不拉 2.44 MB 的壁纸视频 */
  function streamAllowed() {
    var c = navigator.connection;
    if (!c) return true;
    if (c.saveData) return false;
    return !/^(slow-2g|2g)$/.test(c.effectiveType || '');
  }

  function playVideo(v) {
    var p = v.play();
    if (p && typeof p.catch === 'function') p.catch(function () { /* 被自动播放策略拦住：留在 poster */ });
  }

  function doLoad() {
    if (started) return;
    var v = document.getElementById(ID);
    if (!v) return;
    started = true;
    v.src = SRC;
    playVideo(v);
  }

  /* 让路：等头图视频可播后再拉壁纸流。头图 video 是 DOMContentLoaded 之后才由
     rj-enhance.js 插入的，所以先给 2 秒时间让它出现；等不到（非首页 / 被省流禁用）
     就不阻塞。头图 20 秒仍未就绪也不再等。 */
  function whenHeroIdle(fn) {
    var deadline = Date.now() + 2000;
    var check = function () {
      var h = document.querySelector('.rj-hero-video');
      if (!h) {
        if (Date.now() < deadline) return setTimeout(check, 250);
        return fn();
      }
      if (h.readyState >= 3) return fn();
      var fired = false;
      var go = function () { if (fired) return; fired = true; fn(); };
      h.addEventListener('canplay', go, { once: true });
      h.addEventListener('error', go, { once: true });
      setTimeout(go, 20000);
    };
    check();
  }

  function tryStart() {
    if (started || waiting) return;
    if (!streamAllowed()) return;   /* 保持 poster，不再重试 */
    waiting = true;
    whenHeroIdle(function () {
      waiting = false;
      doLoad();
    });
  }

  /* 触发条件 1：首屏页头离开视口 */
  function watchHeader() {
    var header = document.getElementById('page-header');
    if (!header || !('IntersectionObserver' in window)) return;
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) {
          io.disconnect();
          tryStart();
        }
      });
    }, { threshold: 0.05 });
    io.observe(header);
  }

  /* 触发条件 2/3：load 完成后再空闲 3 秒，兜底 8 秒 */
  function whenPageLoaded(fn) {
    if (document.readyState === 'complete') return fn();
    window.addEventListener('load', fn, { once: true });
  }

  function mount() {
    if (reduceMotion()) return;
    if (document.getElementById(ID)) return;

    var v = document.createElement('video');
    v.id = ID;
    v.setAttribute('muted', '');
    v.setAttribute('loop', '');
    v.setAttribute('playsinline', '');
    v.setAttribute('webkit-playsinline', '');
    v.setAttribute('preload', 'none');   /* 关键：不预加载，等触发再拉流 */
    v.setAttribute('poster', POSTER);
    v.setAttribute('aria-hidden', 'true');
    v.muted = true;
    v.loop = true;
    v.playsInline = true;

    /* 放 body 最前，保证绘制层级在内容之下、壁纸之上 */
    if (document.body.firstChild) {
      document.body.insertBefore(v, document.body.firstChild);
    } else {
      document.body.appendChild(v);
    }

    watchHeader();

    whenPageLoaded(function () {
      var idle = function () { tryStart(); };
      setTimeout(function () {
        if (window.requestIdleCallback) window.requestIdleCallback(idle, { timeout: 5000 });
        else idle();
      }, 3000);
      setTimeout(idle, 8000);
    });

    document.addEventListener('visibilitychange', function () {
      if (document.hidden) {
        try { v.pause(); } catch (e) {}
      } else if (started) {
        playVideo(v);
      }
    });
  }

  if (document.body) mount();
  else document.addEventListener('DOMContentLoaded', mount, { once: true });
})();
