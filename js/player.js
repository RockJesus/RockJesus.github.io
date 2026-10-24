/* RockJesus site music player — fixed mini APlayer（自托管/QQ 歌单双源） */
(function () {
  if (window.__rjMusicInit) return; // pjax 防重复初始化
  window.__rjMusicInit = true;

  var PLAYLIST_URLS = [
    'https://cdn.jsdelivr.net/gh/rockjesus/rockjesus/music/playlist.json',
    'https://gcore.jsdelivr.net/gh/rockjesus/rockjesus/music/playlist.json',
    'https://raw.githubusercontent.com/rockjesus/rockjesus/main/music/playlist.json'
  ];
  var SEED = {
    name: 'RockJesus Station',
    artist: 'CC0 · Pixabay',
    url: 'https://cdn.jsdelivr.net/gh/rockjesus/rockjesus@main/music/seed1.mp3',
    cover: 'https://gcore.jsdelivr.net/gh/rockjesus/rockjesus/img/header_oc.webp'
  };

  // 带超时的 fetch：任何源 10s 内无响应即放弃，保证播放器一定初始化
  function fetchJson(url, timeout) {
    return new Promise(function (resolve, reject) {
      var ctrl = new AbortController();
      var timer = setTimeout(function () { ctrl.abort(); reject(new Error('timeout')); }, timeout || 10000);
      fetch(url, { cache: 'no-cache', signal: ctrl.signal })
        .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
        .then(function (d) { clearTimeout(timer); resolve(d); })
        .catch(function (e) { clearTimeout(timer); reject(e); });
    });
  }

  function fetchPlaylist(i) {
    i = i || 0;
    if (i >= PLAYLIST_URLS.length) return Promise.reject(new Error('all sources failed'));
    return fetchJson(PLAYLIST_URLS[i]).catch(function () { return fetchPlaylist(i + 1); });
  }

  function ensureAplayer(cb) {
    if (window.APlayer) return cb();
    var s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/aplayer@1.10.1/dist/APlayer.min.js';
    s.onload = cb;
    document.head.appendChild(s);
  }

  function normalize(list) {
    var out = [];
    (list || []).forEach(function (t) {
      if (!t || !t.url || !t.name) return;
      out.push({
        name: t.name,
        artist: t.artist || '',
        url: t.url,
        cover: t.cover || SEED.cover
      });
    });
    return out;
  }

  function init(list) {
    var container = document.getElementById('site-player');
    if (!container || !window.APlayer || !list.length) return;
    var ap = new APlayer({
      container: container,
      fixed: true,
      mini: true,
      autoplay: false,
      theme: '#a78bfa',
      loop: 'all',
      order: 'random',
      preload: 'none',
      volume: 0.75,
      mutex: true,
      listFolded: true,
      listMaxHeight: 260,
      audio: list
    });
    window.aplayers = window.aplayers || [];
    window.aplayers.push(ap); // pjax 只销毁非 fixed 实例

    // —— 重组迷你条：渐变播放键 + 黑胶封面 + 歌名/进度 ——
    var body = container.querySelector('.aplayer-body');
    var pic = container.querySelector('.aplayer-pic');
    var info = container.querySelector('.aplayer-info');
    var row = null;
    var cover = null;
    if (body && pic && info) {
      row = document.createElement('div');
      row.className = 'aplayer-row';
      cover = document.createElement('img');
      cover.className = 'rj-cover';
      cover.alt = '';
      cover.src = (list[0] && list[0].cover) || SEED.cover;
      cover.onerror = function () { cover.src = SEED.cover; };
      body.insertBefore(row, body.firstChild);
      row.appendChild(pic);
      row.appendChild(cover);
      row.appendChild(info);
    }

    function refreshCover(idx) {
      if (!cover) return;
      var a = ap.list.audios[idx];
      cover.src = (a && a.cover) || SEED.cover;
    }
    ap.on('listswitch', function (e) { refreshCover(e.index); });
    ap.on('play', function () { if (row) row.classList.add('rj-playing'); });
    ap.on('pause', function () { if (row) row.classList.remove('rj-playing'); });
    ap.on('ended', function () { if (row) row.classList.remove('rj-playing'); });

    // —— 打开即随机播放（浏览器拦截时给出提示，点任意处即播）——
    function showTip() {
      var t = document.getElementById('rj-tip');
      if (t) return;
      t = document.createElement('div');
      t.id = 'rj-tip';
      t.className = 'rj-tip';
      t.textContent = '♪ 点击页面任意处开启音乐';
      document.body.appendChild(t);
      setTimeout(function () {
        t.classList.add('rj-tip-hide');
        setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 700);
      }, 5000);
    }
    try {
      if (ap.list.audios.length > 1) {
        ap.list.switch(Math.floor(Math.random() * ap.list.audios.length));
      }
      var p = ap.play();
      if (p && p.catch) { p.catch(function () { showTip(); }); }
    } catch (e) {
      showTip();
    }

    // 首次点击页面任意处 -> 开始播放（尊重浏览器自动播放策略兜底）
    var started = false;
    document.addEventListener('pointerdown', function () {
      if (started) return;
      started = true;
      if (ap.audio && ap.audio.paused && ap.list.audios.length) {
        try { ap.play(); } catch (e) {}
      }
    }, true);
  }

  function load() {
    ensureAplayer(function () {
      fetchPlaylist()
        .then(function (data) {
          var list = normalize(data && data.tracks);
          init(list.length ? list : [SEED]);
        })
        .catch(function () { init([SEED]); });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', load);
  } else {
    load();
  }
})();
