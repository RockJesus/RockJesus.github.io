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

  // —— 统一装饰：全幅封面背景 + 悬浮播放键 + 播放状态 + 断点记忆 ——
  function decorate(ap, container, list) {
    var body = container.querySelector('.aplayer-body');
    var pic = container.querySelector('.aplayer-pic');
    var info = container.querySelector('.aplayer-info');
    var row = null;
    if (body && pic && info) {
      row = document.createElement('div');
      row.className = 'aplayer-row';
      body.insertBefore(row, body.firstChild);
      row.appendChild(pic);
      row.appendChild(info);
      pic.style.backgroundImage = 'none'; // 封面改由整卡背景展示
    }
    function curCover() {
      var a = ap.list.audios[ap.list.index];
      return (a && a.cover) || SEED.cover;
    }
    function setCover() {
      if (!body) return;
      body.style.backgroundImage = 'url("' + curCover() + '")';
      body.style.backgroundSize = 'cover';
      body.style.backgroundPosition = 'center';
    }
    setCover();

    ap.on('listswitch', function () { setCover(); });
    ap.on('play', function () { if (row) row.classList.add('rj-playing'); });
    ap.on('pause', function () { if (row) row.classList.remove('rj-playing'); });
    ap.on('ended', function () { if (row) row.classList.remove('rj-playing'); });

    // 断点续播记忆
    var STATE_KEY = 'rjPlayerState';
    function saveState() {
      try {
        localStorage.setItem(STATE_KEY, JSON.stringify({
          idx: ap.list.index,
          time: (ap.audio && ap.audio.currentTime) || 0
        }));
      } catch (e) {}
    }
    setInterval(saveState, 3000);
    ap.on('listswitch', function () { saveState(); });
    ap.on('pause', function () { saveState(); });
  }

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

  function readState() {
    try { return JSON.parse(localStorage.getItem('rjPlayerState')); } catch (e) { return null; }
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
    decorate(ap, container, list);

    var saved = readState();
    var resumeTime = saved && typeof saved.time === 'number' ? Math.min(Math.max(saved.time, 0), 3600) : 0;

    // —— 打开：优先续播上次歌曲，否则随机播放；被拦截时提示 ——
    try {
      if (saved && typeof saved.idx === 'number' && saved.idx >= 0 && saved.idx < ap.list.audios.length) {
        ap.list.switch(saved.idx);
        if (resumeTime > 3) {
          ap.on('loadeddata', function () { try { ap.seek(resumeTime); } catch (e) {} });
        }
      } else if (ap.list.audios.length > 1) {
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

    // —— pjax 切换页面后若播放器被重建，用记忆状态自动续播 ——
    document.addEventListener('pjax:complete', function () {
      var c = document.getElementById('site-player');
      if (!c || c.querySelector('.aplayer-body')) return;
      var st = readState();
      var idx = st && typeof st.idx === 'number' && st.idx >= 0 && st.idx < list.length ? st.idx : 0;
      if (!list[idx]) return;
      var nap = new APlayer({
        container: c,
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
      window.aplayers.push(nap);
      decorate(nap, c, list);
      nap.list.switch(idx);
      if (st && st.time > 3) {
        nap.on('loadeddata', function () { try { nap.seek(st.time); } catch (e) {} });
      }
      try {
        var np = nap.play();
        if (np && np.catch) { np.catch(function () {}); }
      } catch (e) {}
    });
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
