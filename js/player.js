/* RockJesus site music player — fixed mini APlayer（自托管/QQ 歌单双源） */
(function () {
  if (window.__rjMusicInit) return; // pjax 防重复初始化
  window.__rjMusicInit = true;

  // —— 鼠标互动线条（canvas-nest）改为主题紫 #8b5cf6 ——
  var rjCanvasNest = document.getElementById('canvas_nest');
  if (rjCanvasNest) rjCanvasNest.setAttribute('color', '139,92,246');

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
    function curAudio() {
      var list = ap.list && ap.list.audios;
      return (list && list[ap.list.index]) || null;
    }
    // —— 封面同步 V15：预加载新封面成功后再切换（消除旧图残留/跨域加载竞态），
    //    加载失败兜底默认封面；listswitch/play/loadeddata 三事件双保险，封面始终跟随播放中的歌曲 ——
    function syncCover() {
      if (!body) return;
      var a = curAudio();
      var cover = (a && a.cover) || SEED.cover;
      var img = new Image();
      img.onload = function () {
        if (curAudio() !== a) return; // 已切走，忽略过期加载结果
        body.style.backgroundImage = 'url("' + cover + '")';
        body.style.backgroundSize = 'cover';
        body.style.backgroundPosition = 'center';
      };
      img.onerror = function () {
        if (curAudio() !== a) return;
        body.style.backgroundImage = 'url("' + SEED.cover + '")';
        body.style.backgroundSize = 'cover';
        body.style.backgroundPosition = 'center';
      };
      img.src = cover;
    }
    var syncTimer = null;
    function syncCoverDebounced() {
      if (syncTimer) clearTimeout(syncTimer);
      syncTimer = setTimeout(syncCover, 120); // 等待事件序列稳定，避免读到切换中间态
    }
    syncCover();

    ap.on('listswitch', syncCoverDebounced);
    ap.on('play', function () {
      if (row) row.classList.add('rj-playing');
      syncCoverDebounced();
    });
    ap.on('pause', function () { if (row) row.classList.remove('rj-playing'); });
    ap.on('ended', function () { if (row) row.classList.remove('rj-playing'); });
    ap.on('loadeddata', syncCoverDebounced);

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

    // —— 歌单展开后 10 秒无操作自动收起（点击播放器/歌单任意处重置计时） ——
    var listEl = container.querySelector('.aplayer-list');
    var foldTimer = null;
    function foldList() {
      try {
        if (ap.list && typeof ap.list.hide === 'function') { ap.list.hide(); }
        else if (listEl) { listEl.style.display = 'none'; }
      } catch (e) { if (listEl) { listEl.style.display = 'none'; } }
      foldTimer = null;
    }
    function armFold() {
      if (foldTimer) { clearTimeout(foldTimer); foldTimer = null; }
      if (!listEl) return;
      if (listEl.style.display !== 'none' && listEl.getBoundingClientRect().height > 0) {
        foldTimer = setTimeout(foldList, 10000);
      }
    }
    if (listEl && typeof MutationObserver !== 'undefined') {
      var mo = new MutationObserver(armFold);
      mo.observe(listEl, { attributes: true, attributeFilter: ['style', 'class'] });
    }
    container.addEventListener('pointerdown', function () { armFold(); }, true);
    armFold();

    // —— 单击封面播放/暂停，双击打开/关闭折叠歌单（V16）——
    //    原理：APlayer 内建在 .aplayer-pic 上绑定的 click(toggle) 已被 CSS pointer-events:none 屏蔽，
    //    事件落到 .aplayer-row 上由本层统一处理；单击延迟 280ms 以区分双击（双击取消待执行的单击），
    //    双击立即切换歌单展开状态；歌单按钮(.aplayer-menu)等交互控件保持 APlayer 内建行为
    var singleTimer = null;
    function isInteractive(el) {
      return !!(el && el.closest && el.closest(
        '.aplayer-bar-wrap, .aplayer-menu, .aplayer-volume-wrap, .aplayer-loop, ' +
        '.aplayer-icon, .aplayer-time, .aplayer-miniswitcher, button, a'
      ));
    }
    function togglePlay() {
      if (!ap.audio) return;
      try {
        if (ap.audio.paused) { ap.play(); } else { ap.pause(); }
      } catch (e) {}
    }
    function listHidden() {
      return !listEl || listEl.classList.contains('aplayer-list-hide') || listEl.style.display === 'none';
    }
    function toggleList() {
      if (!listEl) return;
      try {
        if (listHidden()) { ap.list.show(); } else { ap.list.hide(); }
      } catch (e) {
        listEl.style.display = listHidden() ? 'block' : 'none';
      }
      armFold();
    }
    if (row) {
      row.addEventListener('click', function (e) {
        if (singleTimer) { clearTimeout(singleTimer); singleTimer = null; }
        if (isInteractive(e.target)) return;
        singleTimer = setTimeout(function () { singleTimer = null; togglePlay(); }, 280);
      });
      row.addEventListener('dblclick', function (e) {
        if (singleTimer) { clearTimeout(singleTimer); singleTimer = null; }
        if (isInteractive(e.target)) return;
        toggleList();
      });
    }
  }

  function showTip(msg) {
    var t = document.getElementById('rj-tip');
    if (t) return;
    t = document.createElement('div');
    t.id = 'rj-tip';
    t.className = 'rj-tip';
    t.textContent = msg || '♪ 点击页面任意处开启音乐';
    document.body.appendChild(t);
    setTimeout(function () {
      t.classList.add('rj-tip-hide');
      setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 700);
    }, 5000);
  }

  // —— 静音自动播放的常驻提示：打开网页音乐已自动播放（被浏览器静音），
  //    提示条一直停留，直到首次点击/按键恢复声音才消失 ——
  function showMutedTip() {
    if (document.getElementById('rj-muted-tip')) return;
    var t = document.createElement('div');
    t.id = 'rj-muted-tip';
    t.className = 'rj-muted-tip';
    t.textContent = '🔇 音乐已自动播放 · 点击页面任意处开启声音';
    document.body.appendChild(t);
  }
  function hideMutedTip() {
    var t = document.getElementById('rj-muted-tip');
    if (t && t.parentNode) t.parentNode.removeChild(t);
  }

  // —— 自动播放：先正常带声播放；被浏览器拦截时转"静音自动播放"（muted 自动播放始终被允许），
  //    首次点击/按键任意处即恢复音量 —— 实现"打开网站后自动播放，无需先点击" ——
  //    注：APlayer 1.10.1 的 play() 不返回 Promise，须直接驱动 audio 元素（UI 由 audio 事件自动同步）
  function unmuteLater(ap) {
    var restore = function () {
      try {
        if (ap.audio) { ap.audio.muted = false; ap.audio.volume = 0.75; }
        document.body.setAttribute('data-rj-unmuted', JSON.stringify({ m: ap.audio ? ap.audio.muted : null, v: ap.audio ? ap.audio.volume : null }));
      } catch (e) {}
      hideMutedTip();
      document.removeEventListener('pointerdown', restore);
      document.removeEventListener('keydown', restore);
      document.removeEventListener('touchstart', restore);
    };
    document.addEventListener('pointerdown', restore);
    document.addEventListener('keydown', restore);
    document.addEventListener('touchstart', restore);
  }
  function autoPlay(ap, silent) {
    var a = ap.audio;
    if (!a) return;
    try {
      a.muted = false;
      a.volume = 0.75;
      var p = a.play();
      if (p && p.catch) {
        p.catch(function () {
          try {
            a.muted = true;
            a.volume = 0;
            document.body.setAttribute('data-rj-muted', '1');
            var p2 = a.play();
            if (p2 && p2.catch) p2.catch(function () {});
            if (!silent) showMutedTip();
            unmuteLater(ap);
          } catch (e2) {
            if (!silent) showTip('♪ 点击页面任意处开启音乐');
          }
        });
      }
    } catch (e) {
      if (!silent) showTip('♪ 点击页面任意处开启音乐');
    }
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

    // —— 打开：优先续播上次歌曲（同曲同进度、不切歌），否则随机挑一首；随后自动播放 ——
    try {
      if (saved && typeof saved.idx === 'number' && saved.idx >= 0 && saved.idx < ap.list.audios.length) {
        ap.list.switch(saved.idx);
        if (resumeTime > 3) {
          ap.on('loadeddata', function () { try { ap.seek(resumeTime); } catch (e) {} });
        }
      } else if (ap.list.audios.length > 1) {
        ap.list.switch(Math.floor(Math.random() * ap.list.audios.length));
      }
      autoPlay(ap, false);
    } catch (e) {
      showTip('♪ 点击页面任意处开启音乐');
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
      autoPlay(nap, true);
    });
  }

  // —— 右下角聊天按钮：改为豆包对话框（点击弹出豆包网页内嵌聊天） ——
  (function () {
    var btn = document.getElementById('chat_btn');
    if (!btn) return;
    var DOUBAO_CHAT_URL = 'https://www.doubao.com/chat/';
    var DOUBAO_AVATAR = 'https://lf-flow-web-cdn.doubao.com/obj/flow-doubao/doubao/web/doubao_avatar.png';

    // 换豆包女生头像外观
    btn.className = 'rj-doubao-btn';
    btn.innerHTML = '<img class="rj-doubao-avatar" src="' + DOUBAO_AVATAR + '" alt="豆包">';
    btn.title = '和豆包聊天';

    // 弹窗面板（懒创建）
    var panel = null;
    function buildPanel() {
      if (panel) return panel;
      panel = document.createElement('div');
      panel.id = 'rj-doubao-panel';
      panel.innerHTML =
        '<div class="rj-doubao-head">' +
          '<img class="rj-doubao-head-avatar" src="' + DOUBAO_AVATAR + '" alt="">' +
          '<span>和豆包聊天</span>' +
          '<button class="rj-doubao-close" title="关闭">×</button>' +
        '</div>' +
        '<iframe class="rj-doubao-frame" src="' + DOUBAO_CHAT_URL + '" frameborder="0" allow="clipboard-write; autoplay; microphone" allowtransparency="true"></iframe>';
      panel.querySelector('.rj-doubao-close').addEventListener('click', function () { hide(); });
      document.body.appendChild(panel);
      return panel;
    }
    function show() {
      buildPanel().classList.add('rj-doubao-open');
      btn.classList.add('rj-doubao-active');
    }
    function hide() {
      if (panel) panel.classList.remove('rj-doubao-open');
      btn.classList.remove('rj-doubao-active');
    }

    // 捕获阶段截停：屏蔽 gitter 等对 #chat_btn 的默认触发，改由豆包弹窗接管
    document.addEventListener('click', function (e) {
      if (btn.contains(e.target)) {
        e.preventDefault();
        e.stopPropagation();
        var open = panel && panel.classList.contains('rj-doubao-open');
        open ? hide() : show();
      }
    }, true);

    // 点击面板外部关闭
    document.addEventListener('click', function (e) {
      if (!panel || !panel.classList.contains('rj-doubao-open')) return;
      if (btn.contains(e.target) || panel.contains(e.target)) return;
      hide();
    });
  })();


  // ============ V12 全站增强：破图兜底 / 打赏二维码 / 人生信条 / 3D 旋转地球 ============
  // —— 破图兜底 V12.2 三层防红叉：事件捕获 + 逐图补挂 onerror + 全量扫描补救 ——
  //     ① 任意 img 加载失败 → 优雅紫渐变占位（消灭红叉/损坏图标）
  //     ② 不可靠外部源（vercel.app 的 GitHub stats / img.shields.io 徽章）→ 直接隐藏
  //        （国内网络超时且为装饰内容，隐藏比占位更干净；error 早于脚本注册时也能被扫描补救）
  function rjBrokenSvg() {
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="225">' +
      '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">' +
      '<stop offset="0" stop-color="#1e1b4b"/><stop offset="1" stop-color="#312e81"/></linearGradient></defs>' +
      '<rect width="400" height="225" fill="url(#g)"/>' +
      '<circle cx="200" cy="112" r="30" fill="none" stroke="rgba(139,92,246,.55)" stroke-width="2"/>' +
      '<path d="M186 112 l10 10 l18 -22" stroke="#a78bfa" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/>' +
      '</svg>');
  }
  function rjIsExtUnreliable(src) {
    return (src || '').indexOf('vercel.app') >= 0 || (src || '').indexOf('img.shields.io') >= 0;
  }
  function rjHideBroken(img) {
    try {
      img.style.display = 'none';
      img.dataset.rjFallback = '2';
    } catch (e) {}
  }
  function rjReplaceBroken(img) {
    try {
      img.onerror = null;
      img.removeAttribute('onerror');
      img.src = rjBrokenSvg();
      img.dataset.rjFallback = '2';
    } catch (e) {}
  }
  function rjPatchBrokenImgs() {
    document.querySelectorAll('img').forEach(function (img) {
      if (!img || img.dataset.rjFallback) return;
      var src = img.getAttribute('src') || img.getAttribute('data-lazy-src') || '';
      if (rjIsExtUnreliable(src)) { rjHideBroken(img); return; }
      img.dataset.rjFallback = '1';
      img.onerror = function () { rjReplaceBroken(this); };
      if (img.complete && img.naturalWidth === 0) { rjReplaceBroken(img); }
    });
  }
  // 事件捕获兜底：覆盖脚本注册后发生的加载失败；不可靠外部源直接隐藏
  document.addEventListener('error', function (e) {
    var t = e.target;
    if (t && t.tagName === 'IMG' && !t.dataset.rjFallback) {
      try {
        var src = t.getAttribute('src') || '';
        if (rjIsExtUnreliable(src)) { rjHideBroken(t); return; }
        rjReplaceBroken(t);
      } catch (err) {}
    }
  }, true);

  // 头像等 onerror 指向不存在的 4040.gif → 改为存在的 black.png；black.jpg 纯黑占位 → 隐藏
  function fixErrorImgRefs() {
    document.querySelectorAll('img[data-lazy-src*="4040.gif"], img[src*="4040.gif"]').forEach(function (img) {
      img.removeAttribute('onerror');
      var good = 'https://gcore.jsdelivr.net/gh/rockjesus/rockjesus/img/black.png';
      if (img.getAttribute('data-lazy-src')) img.setAttribute('data-lazy-src', good);
      else img.src = good;
    });
    document.querySelectorAll('img[data-lazy-src*="black.jpg"], img[src*="black.jpg"]').forEach(function (img) {
      img.style.display = 'none';
    });
  }

  // —— 打赏 / 加入我们菜单：悬停弹出可扫码二维码 ——
  function upgradeRewardMenus() {
    var menus = {
      '打赏': [['微信', 'wx.png'], ['支付宝', 'zfb.png'], ['赞赏', 'zsm.png']],
      '加入我们': [['QQ群', 'qq.png'], ['公众号', 'gzh.jpg']]
    };
    document.querySelectorAll('#nav .menus_item, #sidebar-menus .menus_item').forEach(function (item) {
      var a = item.querySelector('a.group');
      if (!a) return;
      var matched = null;
      Object.keys(menus).forEach(function (name) {
        if (a.textContent.indexOf(name) >= 0) matched = name;
      });
      if (!matched) return;
      var ul = item.querySelector('.menus_item_child');
      if (!ul || ul.classList.contains('rj-qr-menu')) return;
      var items = menus[matched];
      ul.classList.add('rj-qr-menu');
      ul.innerHTML = '';
      items.forEach(function (p) {
        var li = document.createElement('li');
        var link = document.createElement('a');
        var href = 'https://gcore.jsdelivr.net/gh/rockjesus/rockjesus/img/' + p[1];
        link.className = 'site-page child rj-qr-item';
        link.href = href;
        link.target = '_blank';
        link.rel = 'noopener';
        var img = document.createElement('img');
        img.src = href;
        img.alt = p[0];
        img.loading = 'lazy';
        var span = document.createElement('span');
        span.textContent = p[0];
        link.appendChild(img);
        link.appendChild(span);
        li.appendChild(link);
        ul.appendChild(li);
      });
    });
  }

  // —— 公告卡 → 人生信条 ——
  function upgradeAnnouncement() {
    document.querySelectorAll('.card-announcement').forEach(function (card) {
      if (card.dataset.rjCreed) return;
      card.dataset.rjCreed = '1';
      var head = card.querySelector('.item-headline');
      if (head) {
        var ic = head.querySelector('i');
        if (ic) ic.className = 'fas fa-quote-left';
        var sp = head.querySelector('span');
        if (sp) sp.textContent = '人生信条';
      }
      var content = card.querySelector('.announcement_content');
      if (content) {
        content.className = 'announcement_content rj-creed';
        content.innerHTML = 'Life is all about the journey — 人生是一场旅行，保持热爱，奔赴山海。<b>∞ Keep exploring</b>';
      }
    });
  }

  // —— 3D 旋转地球 + 访客国旗（Canvas 贴图球，IntersectionObserver 懒加载）——
  var rjGlobeDone = false;
  function initGlobe() {
    var host = document.querySelector('.card-webinfo');
    if (!host || rjGlobeDone) return;
    rjGlobeDone = true;
    var box = document.createElement('div');
    box.id = 'rj-globe';
    host.appendChild(box);
    var canvas = document.createElement('canvas');
    box.appendChild(canvas);
    var label = document.createElement('div');
    label.className = 'rj-globe-label';
    label.textContent = '🌐 定位中…';
    box.appendChild(label);
    var stats = document.createElement('div');
    stats.className = 'rj-globe-stats';
    stats.innerHTML = '<div class="rj-globe-stats-title">🌍 全世界访客分布</div><div class="rj-globe-stats-flags"></div>';
    box.appendChild(stats);
    var ctx = canvas.getContext('2d');
    var W = 340, H = 236, dpr = Math.min(window.devicePixelRatio || 1, 2);
    function resize() {
      W = canvas.clientWidth || 340;
      H = canvas.clientHeight || 236;
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    resize();
    var cx = W / 2, cy = H / 2, R = Math.min(W, H) / 2 - 8;
    var lon = 0, visitor = null, flagImg = null, started = false, running = false;
    // 赛博朋克数据光点（固定种子伪随机，青/洋红交替）
    var DOTS = [];
    (function () {
      var s = 42;
      function rnd() { s = (s * 16807) % 2147483647; return s / 2147483647; }
      for (var i = 0; i < 42; i++) {
        DOTS.push({ lat: -72 + rnd() * 144, lng: rnd() * 360, c: i % 2 ? 'rgba(34,211,238,' : 'rgba(232,121,249,' });
      }
    })();
    // 五大洲轮廓：world-atlas TopoJSON 合并大陆岸线，霓虹描边投影到球面
    var landGeo = null;
    function loadLand() {
      var s = document.createElement('script');
      s.src = 'https://unpkg.com/topojson-client@3.1.0/dist/topojson-client.min.js';
      s.onload = function () {
        if (!window.topojson) return;
        fetch('https://unpkg.com/world-atlas@2.0.2/countries-110m.json')
          .then(function (r) { return r.json(); })
          .then(function (topo) {
            try {
              var fc = topojson.feature(topo, topo.objects.countries);
              var merged = topojson.merge(topo, fc.features);
              landGeo = merged && merged.coordinates;
            } catch (e) { landGeo = null; }
          })
          .catch(function () { landGeo = null; });
      };
      document.head.appendChild(s);
    }
    function flagEmoji(cc) {
      if (!cc || !/^[A-Za-z]{2}$/.test(cc)) return '🌍';
      return String.fromCodePoint.apply(null, cc.toUpperCase().split('').map(function (c) { return 127397 + c.charCodeAt(0); }));
    }
    function recordVisit(v) {
      var key = 'rjGlobeHistory';
      var arr = [];
      try { arr = JSON.parse(localStorage.getItem(key)) || []; } catch (e) {}
      var hit = null;
      arr.forEach(function (x) { if (x.cc === v.cc) hit = x; });
      if (hit) { hit.n = (hit.n || 1) + 1; hit.t = Date.now(); }
      else { arr.push({ cc: v.cc, n: 1, t: Date.now() }); }
      arr.sort(function (a, b) { return (b.n || 0) - (a.n || 0); });
      arr = arr.slice(0, 24);
      try { localStorage.setItem(key, JSON.stringify(arr)); } catch (e) {}
      renderStats(arr);
    }
    function renderStats(arr) {
      var wrap = box.querySelector('.rj-globe-stats-flags');
      if (!wrap) return;
      if (!arr || !arr.length) { wrap.innerHTML = '<span class="rj-globe-stat-item">等待第一位访客…</span>'; return; }
      var h = '';
      arr.forEach(function (x) {
        var f = /^[A-Za-z]{2}$/.test(x.cc) ? 'https://flagcdn.com/w20/' + x.cc.toLowerCase() + '.png' : '';
        h += '<span class="rj-globe-stat-item">' + (f ? '<img class="rj-globe-flag" src="' + f + '" alt="' + x.cc + '">' : flagEmoji(x.cc)) + ' ×' + x.n + '</span>';
      });
      wrap.innerHTML = h;
    }
    function locate() {
      fetch('https://ipinfo.io/json', { cache: 'no-store' })
        .then(function (r) { return r.json(); })
        .then(function (d) {
          visitor = {
            cc: (d.country || '').toUpperCase(),
            city: d.city || '',
            lat: parseFloat(d.loc ? d.loc.split(',')[0] : NaN),
            lon: parseFloat(d.loc ? d.loc.split(',')[1] : NaN)
          };
          label.textContent = '🌐 当前访客 · ' + flagEmoji(visitor.cc) + ' ' + (visitor.city || visitor.cc || '世界各地');
          recordVisit(visitor);
          flagImg = null;
          if (/^[A-Za-z]{2}$/.test(visitor.cc)) {
            var fi = new Image();
            fi.crossOrigin = 'anonymous';
            fi.onload = function () { flagImg = fi; };
            fi.src = 'https://flagcdn.com/w40/' + visitor.cc.toLowerCase() + '.png';
          }
        })
        .catch(function () {
          label.textContent = '🌐 欢迎来自世界各地的访客';
          var arr = [];
          try { arr = JSON.parse(localStorage.getItem('rjGlobeHistory')) || []; } catch (e) {}
          renderStats(arr);
        });
    }
    // 球面投影（含旋转 lon），返回屏幕坐标与深度 z（正面 z>0）
    function proj(latDeg, lngDeg) {
      var latR = latDeg * Math.PI / 180;
      var lr = (((lngDeg - lon + 540) % 360) - 180) * Math.PI / 180;
      return {
        x: cx + R * Math.cos(latR) * Math.sin(lr),
        y: cy - R * Math.sin(latR),
        z: Math.cos(latR) * Math.cos(lr)
      };
    }
    function draw() {
      if (!running) return;
      ctx.clearRect(0, 0, W, H);
      lon += 0.26;
      if (lon >= 360) lon -= 360;
      var tt = Date.now() / 1000;
      var i, p, q;
      // 球体暗底（深空色）
      var g0 = ctx.createRadialGradient(cx - R * 0.2, cy - R * 0.25, R * 0.15, cx, cy, R);
      g0.addColorStop(0, 'rgba(16,32,66,.92)');
      g0.addColorStop(1, 'rgba(4,8,18,.97)');
      ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.fillStyle = g0; ctx.fill();
      // 霓虹经纬线框（经线青/紫交替，纬线青色）
      ctx.lineWidth = 1;
      for (var lng = -180; lng < 180; lng += 15) {
        ctx.strokeStyle = (Math.abs(lng) % 30 < 15) ? 'rgba(34,211,238,.5)' : 'rgba(168,85,247,.42)';
        ctx.beginPath();
        for (i = 0; i <= 24; i++) {
          p = proj(-90 + i * 7.5, lng);
          if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
        }
        ctx.stroke();
      }
      for (var lat = -75; lat <= 75; lat += 15) {
        ctx.strokeStyle = 'rgba(94,234,212,.34)';
        ctx.beginPath();
        for (i = 0; i <= 60; i++) {
          q = proj(lat, -180 + i * 6);
          if (i === 0) ctx.moveTo(q.x, q.y); else ctx.lineTo(q.x, q.y);
        }
        ctx.stroke();
      }
      // 五大洲霓虹轮廓（合并大陆岸线，青蓝描边 + 极淡填充）
      if (landGeo) {
        ctx.lineWidth = 1;
        ctx.strokeStyle = 'rgba(103,232,249,.62)';
        ctx.shadowColor = 'rgba(34,211,238,.85)';
        ctx.shadowBlur = 5;
        ctx.beginPath();
        for (var gi = 0; gi < landGeo.length; gi++) {
          var poly = landGeo[gi];
          for (var pi = 0; pi < poly.length; pi++) {
            var ring = poly[pi];
            for (var ri = 0; ri < ring.length; ri++) {
              var lp = proj(ring[ri][1], ring[ri][0]);
              if (ri === 0) ctx.moveTo(lp.x, lp.y); else ctx.lineTo(lp.x, lp.y);
            }
          }
        }
        ctx.stroke();
        ctx.shadowBlur = 0;
        ctx.fillStyle = 'rgba(34,211,238,.05)';
        ctx.fill();
      }
      // 数据光点（青/洋红闪烁）
      for (i = 0; i < DOTS.length; i++) {
        var d = DOTS[i];
        var dp = proj(d.lat, d.lng);
        var dz = Math.max(0, dp.z);
        var tw = 0.5 + 0.5 * Math.sin(tt * 2.2 + i * 1.7);
        ctx.fillStyle = d.c + (0.25 + 0.55 * dz * (0.55 + 0.45 * tw)).toFixed(2) + ')';
        ctx.beginPath();
        ctx.arc(dp.x, dp.y, 1.2 + 1.6 * dz, 0, Math.PI * 2);
        ctx.fill();
      }
      // 全息扫描带 + 高光（球内）
      ctx.save();
      ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.clip();
      var sy = cy - R + (2 * R * ((tt * 0.35) % 1));
      var sg = ctx.createLinearGradient(0, sy - 14, 0, sy + 14);
      sg.addColorStop(0, 'rgba(34,211,238,0)');
      sg.addColorStop(0.5, 'rgba(34,211,238,.22)');
      sg.addColorStop(1, 'rgba(34,211,238,0)');
      ctx.fillStyle = sg;
      ctx.fillRect(cx - R, sy - 14, R * 2, 28);
      var hg = ctx.createRadialGradient(cx + R * 0.32, cy - R * 0.45, R * 0.06, cx, cy, R * 1.02);
      hg.addColorStop(0, 'rgba(165,243,252,.28)');
      hg.addColorStop(0.4, 'rgba(165,243,252,.06)');
      hg.addColorStop(1, 'rgba(4,8,18,0)');
      ctx.fillStyle = hg;
      ctx.fillRect(cx - R, cy - R, R * 2, R * 2);
      ctx.restore();
      // 访客定位：脉冲圈 + 洋红点 + 国旗（正背面均显示）
      if (visitor && !isNaN(visitor.lat) && !isNaN(visitor.lon)) {
        var vp = proj(visitor.lat, visitor.lon);
        var vz = Math.max(0.05, vp.z);
        ctx.strokeStyle = 'rgba(232,121,249,' + (0.4 + 0.3 * vz) + ')';
        ctx.lineWidth = 1.4;
        ctx.beginPath(); ctx.arc(vp.x, vp.y, 4 + 2.5 * Math.sin(tt * 3.2), 0, Math.PI * 2); ctx.stroke();
        ctx.beginPath(); ctx.arc(vp.x, vp.y, 3, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(232,121,249,.95)'; ctx.fill();
        if (flagImg && flagImg.width) ctx.drawImage(flagImg, vp.x - 10, vp.y - 26, 20, 14);
        else { ctx.fillStyle = '#fff'; ctx.font = '11px monospace'; ctx.textAlign = 'center'; ctx.fillText(visitor.cc, vp.x, vp.y - 10); }
      }
      // 外光晕（青→紫）
      var halo = ctx.createRadialGradient(cx, cy, R * 0.92, cx, cy, R * 1.3);
      halo.addColorStop(0, 'rgba(34,211,238,.14)');
      halo.addColorStop(0.55, 'rgba(168,85,247,.10)');
      halo.addColorStop(1, 'rgba(168,85,247,0)');
      ctx.fillStyle = halo;
      ctx.fillRect(cx - R * 1.3, cy - R * 1.3, R * 2.6, R * 2.6);
      // 卫星轨道环（青色 + 洋红双环，带移动光点）
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(-0.45 + tt * 0.12);
      ctx.strokeStyle = 'rgba(34,211,238,.45)';
      ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.ellipse(0, 0, R + 15, (R + 15) * 0.36, 0, 0, Math.PI * 2); ctx.stroke();
      var sa = (tt * 0.9) % (Math.PI * 2);
      ctx.fillStyle = 'rgba(103,232,249,.95)';
      ctx.beginPath(); ctx.arc(Math.cos(sa) * (R + 15), Math.sin(sa) * (R + 15) * 0.36, 2.4, 0, Math.PI * 2); ctx.fill();
      ctx.rotate(1.35);
      ctx.strokeStyle = 'rgba(232,121,249,.38)';
      ctx.beginPath(); ctx.ellipse(0, 0, R + 22, (R + 22) * 0.3, 0, 0, Math.PI * 2); ctx.stroke();
      var sb = ((tt * 0.6) + 2) % (Math.PI * 2);
      ctx.fillStyle = 'rgba(249,168,212,.9)';
      ctx.beginPath(); ctx.arc(Math.cos(sb) * (R + 22), Math.sin(sb) * (R + 22) * 0.3, 1.8, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      requestAnimationFrame(draw);
    }
    function start() {
      if (started) return;
      started = true;
      running = true;
      locate();
      loadLand();
      var arr = [];
      try { arr = JSON.parse(localStorage.getItem('rjGlobeHistory')) || []; } catch (e) {}
      if (arr.length) renderStats(arr);
      requestAnimationFrame(draw);
    }
    if ('IntersectionObserver' in window) {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          if (en.isIntersecting) { io.disconnect(); start(); }
        });
      }, { rootMargin: '240px' });
      io.observe(box);
    } else {
      start();
    }
    window.addEventListener('resize', function () { resize(); cx = W / 2; cy = H / 2; R = Math.min(W, H) / 2 - 8; });
  }

  // —— 组装执行 ——
  function rjV12Run() {
    fixErrorImgRefs();
    upgradeRewardMenus();
    upgradeAnnouncement();
    initGlobe();
    rjPatchBrokenImgs();
    setTimeout(rjPatchBrokenImgs, 1500);
    setTimeout(rjPatchBrokenImgs, 4000);
    setTimeout(rjPatchBrokenImgs, 8000);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', rjV12Run);
  } else {
    rjV12Run();
  }
  document.addEventListener('pjax:complete', function () {
    fixErrorImgRefs();
    upgradeRewardMenus();
    upgradeAnnouncement();
    rjGlobeDone = false;
    initGlobe();
    rjPatchBrokenImgs();
    setTimeout(rjPatchBrokenImgs, 1500);
  });

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
