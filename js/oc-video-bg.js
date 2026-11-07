/**
 * oc-video-bg.js — 壁纸视频层（方案 C：会眨眼的循环短片）
 * --------------------------------------------------------------------------------
 * oc-blink.mp4：1920×1080 / 24fps / 10s，无缝循环（首末帧星云同为青绿、双眼全睁）。
 *   内容＝AI 图生视频 v4（Seedance 2.5）：原图两头贴边构图不变，
 *   右眼为青绿透镜并由下眼睑自下而上眨眼（左眼 1.4–2.4s、右眼 7.4–8.4s 各一次），
 *   星云在青绿与紫红之间各停留约 5 秒，色相变化不动物体、不改文字。
 * 静态兜底用 oc-blink-poster.webp（就是视频第 0 帧），
 *   所以视频没下载完 / 被浏览器挡住自动播放时，看到的和视频开头完全一致，不会跳画面。
 *
 * 行为：
 *   - 只插一次，位置在 body 最前，fixed 铺满、object-fit:cover（与原来的 center/cover 同一种裁切）
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

  function reduceMotion() {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  function mount() {
    if (reduceMotion()) return;
    if (document.getElementById(ID)) return;

    var v = document.createElement('video');
    v.id = ID;
    v.setAttribute('autoplay', '');
    v.setAttribute('muted', '');
    v.setAttribute('loop', '');
    v.setAttribute('playsinline', '');
    v.setAttribute('webkit-playsinline', '');
    v.setAttribute('preload', 'auto');
    v.setAttribute('poster', POSTER);
    v.setAttribute('aria-hidden', 'true');
    v.muted = true;
    v.loop = true;
    v.playsInline = true;
    v.src = SRC;

    /* 放 body 最前，保证绘制层级在内容之下、壁纸之上 */
    if (document.body.firstChild) {
      document.body.insertBefore(v, document.body.firstChild);
    } else {
      document.body.appendChild(v);
    }

    var play = function () {
      var p = v.play();
      if (p && typeof p.catch === 'function') p.catch(function () { /* 被自动播放策略拦住：留在 poster */ });
    };
    play();

    document.addEventListener('visibilitychange', function () {
      if (document.hidden) {
        try { v.pause(); } catch (e) {}
      } else {
        play();
      }
    });
  }

  if (document.body) mount();
  else document.addEventListener('DOMContentLoaded', mount, { once: true });
})();
