/* 首页卡片封面动图：先出首帧，进视口才拉视频数据
   —— 原来封面是 1~4MB 的 GIF 首帧静态图；改成 h264 循环视频后
   体积降到 10~130KB，再用 IntersectionObserver 做按需加载，
   首屏不加载任何视频数据，滚动到哪动到哪，离开视口立刻暂停。 */
(function () {
  var SEL = 'video[data-cover-video]';
  var io = null;

  function boot(v) {
    if (!v.dataset.src) return;
    if (!v.getAttribute('src')) v.setAttribute('src', v.dataset.src);
    var p = v.play();
    if (p && p.catch) p.catch(function () {});
  }

  function init() {
    var list = document.querySelectorAll(SEL);
    if (!list.length) return;

    // 老浏览器 / 用户开了「减少动态效果」：直接播，不做观察
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!('IntersectionObserver' in window) || reduce) {
      Array.prototype.forEach.call(list, boot);
      return;
    }

    if (!io) {
      io = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          var v = e.target;
          if (e.isIntersecting) {
            boot(v);
          } else if (!v.paused) {
            v.pause();
          }
        });
      }, { rootMargin: '300px 0px' });
    }
    Array.prototype.forEach.call(list, function (v) { io.observe(v); });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // 切走标签页时停掉全部封面视频，省电省流量
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) return;
    Array.prototype.forEach.call(document.querySelectorAll(SEL), function (v) {
      if (!v.paused) v.pause();
    });
  });

  // pjax 换页后重新绑定（首页/归档来回切也能动）
  document.addEventListener('pjax:complete', function () {
    setTimeout(init, 60);
  });
})();
