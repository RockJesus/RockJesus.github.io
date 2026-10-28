/* RockJesus site music player — fixed mini APlayer（自托管/QQ 歌单双源） */
(function () {
  if (window.__rjMusicInit) return; // pjax 防重复初始化
  window.__rjMusicInit = true;

  // —— 鼠标互动线条（canvas-nest）改为主题紫 #8b5cf6 ——
  var rjCanvasNest = document.getElementById('canvas_nest');
  if (rjCanvasNest) rjCanvasNest.setAttribute('color', '139,92,246');

  var PLAYLIST_URLS = [
    '/data/playlist.json?v=1.1.22',
    'https://cdn.jsdelivr.net/gh/rockjesus/rockjesus/music/playlist.json',
    'https://raw.githubusercontent.com/rockjesus/rockjesus/main/music/playlist.json'
  ];
  var SEED = {
    name: 'RockJesus Station',
    artist: 'CC0 · Pixabay',
    url: 'https://cdn.jsdelivr.net/gh/rockjesus/rockjesus@main/music/seed1.mp3',
    cover: '/img/header_oc.webp'
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
        cover: t.cover || SEED.cover,
        duration: t.duration || 0
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
    // —— 试听片段检测：vkey 过期时 QQ 只返回 30 秒试听，播放器误以为播完自动切歌 →
    //    表现为"每首歌都是片段"。若实际时长明显短于歌单标注 → 判定为试听，自动跳过该歌 ——
    function rjSkipPreview() {
      try {
        var a = curAudio();
        if (!ap.audio || !a || !a.duration || a.duration < 60) return;
        var real = ap.audio.duration;
        if (real && real < a.duration * 0.6) {
          ap.list.next();
        }
      } catch (e) {}
    }
    if (ap.audio) ap.audio.addEventListener('loadedmetadata', rjSkipPreview);
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
    // —— 封面中央播放/暂停按钮（最小折叠态常显；点击直接播放/暂停）——
    if (row) {
      var picBtn = document.createElement('div');
      picBtn.className = 'rj-pic-btn';
      picBtn.setAttribute('aria-label', '播放/暂停');
      picBtn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>';
      row.appendChild(picBtn);
      function syncPicBtn() {
        if (!ap.audio) return;
        var paused = ap.audio.paused;
        picBtn.innerHTML = paused
          ? '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>'
          : '<svg viewBox="0 0 24 24"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>';
        picBtn.classList.toggle('rj-pic-btn-playing', !paused);
      }
      picBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        e.preventDefault();
        togglePlay();
      });
      ap.on('play', syncPicBtn);
      ap.on('pause', syncPicBtn);
      ap.on('ended', syncPicBtn);
      syncPicBtn();
    }
    // —— 自定义控制条（展开态）：上一首/播放暂停/下一首/循环/随机/列表/静音，主题紫圆钮 ——
    if (row) {
      var svgI = function (d) { return '<svg viewBox="0 0 24 24"><path d="' + d + '"/></svg>'; };
      var I = {
        prev: 'M7 6a1 1 0 0 1 2 0v12a1 1 0 1 1-2 0V6zm10.6.7a1 1 0 0 1 1.5.8v10.8a1 1 0 0 1-1.5.8l-7.6-5.4a1 1 0 0 1 0-1.6l7.6-5.4z',
        next: 'M17 6a1 1 0 0 1 2 0v12a1 1 0 1 1-2 0V6zM5.9 6.7a1 1 0 0 1 1.5-.8l7.6 5.4a1 1 0 0 1 0 1.6l-7.6 5.4a1 1 0 0 1-1.5-.8V6.7z',
        loop: 'M17 7H7v3L3 6l4-4v3h12v5h-2V7zm-10 10h10v-3l4 4-4 4v-3H5v-5h2v4z',
        random: 'M5 8h8l-2-2 1.5-1.5L17 8l-4.5 3.5L11 10l2-2H5V8zm14 8h-8l2 2-1.5 1.5L7 16l4.5-3.5L13 14l-2 2h8v-2z',
        list: 'M4 6h2v2H4V6zm4 0h12v2H8V6zm-4 5h2v2H4v-2zm4 0h12v2H8v-2zm-4 5h2v2H4v-2zm4 0h12v2H8v-2z',
        vol: 'M3 9v6h4l5 5V4L7 9H3zm13.5 3a4.5 4.5 0 0 0-2.5-4.1v8.2a4.5 4.5 0 0 0 2.5-4.1zm0-7.9V6a7 7 0 0 1 0 12v1.9a9 9 0 0 0 0-16.8z'
      };
      var ctrl = document.createElement('div');
      ctrl.className = 'rj-controls';
      function mkCtl(cls, d, title, fn) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'rj-ctl ' + cls;
        b.title = title;
        b.innerHTML = svgI(d);
        b.addEventListener('click', function (e) { e.stopPropagation(); e.preventDefault(); fn(); });
        return b;
      }
      var ctrlPlay = mkCtl('rj-ctl-play', 'M8 5v14l11-7z', '播放/暂停', togglePlay);
      ctrl.appendChild(mkCtl('rj-ctl-prev', I.prev, '上一首', function () { try { ap.list.prev(); } catch (e) {} }));
      ctrl.appendChild(ctrlPlay);
      ctrl.appendChild(mkCtl('rj-ctl-next', I.next, '下一首', function () { try { ap.list.next(); } catch (e) {} }));
      ctrl.appendChild(mkCtl('rj-ctl-loop', I.loop, '循环模式', function () {
        try { ap.loop = ap.loop === 'all' ? 'one' : ap.loop === 'one' ? 'none' : 'all'; } catch (e) {}
      }));
      ctrl.appendChild(mkCtl('rj-ctl-random', I.random, '随机/顺序', function () {
        try { ap.order = ap.order === 'random' ? 'list' : 'random'; } catch (e) {}
      }));
      ctrl.appendChild(mkCtl('rj-ctl-list', I.list, '播放列表', toggleList));
      ctrl.appendChild(mkCtl('rj-ctl-mute', I.vol, '静音', function () {
        try { if (ap.audio) ap.audio.muted = !ap.audio.muted; } catch (e) {}
      }));
      if (info) info.appendChild(ctrl);
      var syncCtlPlay = function () {
        if (!ap.audio) return;
        ctrlPlay.innerHTML = ap.audio.paused ? svgI('M8 5v14l11-7z') : svgI('M6 5h4v14H6zM14 5h4v14h-4z');
        ctrlPlay.classList.toggle('rj-ctl-playing', !ap.audio.paused);
      };
      ap.on('play', syncCtlPlay);
      ap.on('pause', syncCtlPlay);
      ap.on('ended', syncCtlPlay);
      syncCtlPlay();
    }
    // —— 折叠/展开 ↔ 播放列表联动：播放器折叠时列表收起，展开时列表展开 ——
    if (window.MutationObserver) {
      var moFold = new MutationObserver(function () {
        try {
          if (container.classList.contains('aplayer-mini')) {
            if (listEl && !listHidden()) ap.list.hide();
          } else {
            if (listEl && listHidden()) ap.list.show();
          }
        } catch (e) {}
      });
      moFold.observe(container, { attributes: true, attributeFilter: ['class'] });
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

  // —— 右下角聊天按钮：改为豆包对话框（点击弹出豆包网页内嵌聊天）——
  //    pjax 切换文章页时 #rightside-config-show 内的 #chat_btn 会被替换成新页面原始按钮，
  //    因此豆包样式与交互改为函数 + 事件委托，并在 pjax:complete 后重新应用 ——
  function setupDoubao() {
    var btn = document.getElementById('chat_btn');
    if (!btn) return;
    if (btn.getAttribute('data-rj-doubao') === '1') return;
    btn.setAttribute('data-rj-doubao', '1');
    var DOUBAO_AVATAR = 'https://lf-flow-web-cdn.doubao.com/obj/flow-doubao/doubao/web/doubao_avatar.png';
    btn.className = 'rj-doubao-btn';
    btn.innerHTML = '<img class="rj-doubao-avatar" src="' + DOUBAO_AVATAR + '" alt="豆包">';
    btn.title = '和豆包聊天';
  }
  var rjPanel = null;
  function buildPanel() {
    if (rjPanel) return rjPanel;
    var DOUBAO_CHAT_URL = 'https://www.doubao.com/chat/';
    var DOUBAO_AVATAR = 'https://lf-flow-web-cdn.doubao.com/obj/flow-doubao/doubao/web/doubao_avatar.png';
    rjPanel = document.createElement('div');
    rjPanel.id = 'rj-doubao-panel';
    rjPanel.innerHTML =
      '<div class="rj-doubao-head">' +
        '<img class="rj-doubao-head-avatar" src="' + DOUBAO_AVATAR + '" alt="">' +
        '<span>和豆包聊天</span>' +
        '<a class="rj-doubao-pop" href="' + DOUBAO_CHAT_URL + '" target="_blank" rel="noopener" title="在新窗口打开">↗</a>' +
        '<button class="rj-doubao-close" title="关闭">×</button>' +
      '</div>' +
      '<div class="rj-doubao-body">' +
        '<div class="rj-doubao-loading"><span class="rj-doubao-spin"></span><em>豆包加载中…</em></div>' +
        '<iframe class="rj-doubao-frame" data-src="' + DOUBAO_CHAT_URL + '" title="豆包 AI 对话" frameborder="0" allow="clipboard-write; microphone; autoplay; fullscreen"></iframe>' +
      '</div>';
    rjPanel.querySelector('.rj-doubao-close').addEventListener('click', closePanel);
    document.body.appendChild(rjPanel);
    return rjPanel;
  }
  // 内嵌 iframe 懒加载：首次展开时才请求豆包，避免拖慢首屏；加载完再撤掉骨架
  function mountFrame() {
    if (!rjPanel) return;
    var f = rjPanel.querySelector('.rj-doubao-frame');
    if (!f) return;
    if (!f.getAttribute('src')) {
      f.setAttribute('src', f.getAttribute('data-src'));
      var mark = function () { rjPanel.classList.add('rj-doubao-ready'); };
      f.addEventListener('load', mark);
      // 兜底：网络异常时也撤骨架，避免一直转圈
      setTimeout(mark, 15000);
    }
  }
  function closePanel() {
    if (rjPanel) rjPanel.classList.remove('rj-doubao-open');
    var b = document.getElementById('chat_btn');
    if (b) b.classList.remove('rj-doubao-active');
  }
  function rjToggle(btn) {
    var open = rjPanel && rjPanel.classList.contains('rj-doubao-open');
    if (open) {
      closePanel();
    } else {
      buildPanel().classList.add('rj-doubao-open');
      mountFrame();
      if (btn) btn.classList.add('rj-doubao-active');
    }
  }
  // ESC 关闭
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closePanel();
  });
  // 捕获阶段截停：屏蔽 gitter 等对 #chat_btn 的默认触发，改由豆包弹窗接管（委托，实时找当前按钮）
  document.addEventListener('click', function (e) {
    var btn = document.getElementById('chat_btn');
    if (!btn) return;
    if (btn.contains(e.target)) {
      e.preventDefault();
      e.stopPropagation();
      rjToggle(btn);
    }
  }, true);
  // 点击面板外部关闭（看板娘的点击除外，否则打开动作冒泡后会被立即关闭）
  document.addEventListener('click', function (e) {
    if (!rjPanel || !rjPanel.classList.contains('rj-doubao-open')) return;
    var btn = document.getElementById('chat_btn');
    if (btn && btn.contains(e.target)) return;
    if (rjPanel.contains(e.target)) return;
    var miku = document.getElementById('live2d-widget');
    if (miku && (miku === e.target || miku.contains(e.target))) return;
    rjPanel.classList.remove('rj-doubao-open');
    if (btn) btn.classList.remove('rj-doubao-active');
  });
  setupDoubao();
  document.addEventListener('pjax:complete', function () { setupDoubao(); });

  // —— 看板娘（live2d 模型）点击 → 弹出豆包对话框 ——
  //    canvas 是 pointer-events:none，点击落在容器 #live2d-widget 上；
  //    容器由 L2Dwidget 脚本异步创建，轮询绑定一次即可（body 级元素，pjax 不销毁）。
  (function bindMikuDoubao() {
    var tries = 0;
    var timer = setInterval(function () {
      tries++;
      var miku = document.getElementById('live2d-widget');
      if (miku) {
        clearInterval(timer);
        miku.setAttribute('data-rj-miku-chat', '1');
        miku.addEventListener('click', function () { rjToggle(null); });
        return;
      }
      if (tries > 60) clearInterval(timer); // 30s 后放弃（组件被禁用等场景）
    }, 500);
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
      img.onerror = function () {
        var s = this.getAttribute('src') || this.getAttribute('data-lazy-src') || '';
        if (rjIsExtUnreliable(s)) { rjHideBroken(this); return; }
        rjReplaceBroken(this);
      };
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
      var good = '/img/black.png';
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
        var href = '/img/' + p[1];
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
  var rjCounted = false;   // 每次打开网站只统计一次（pjax 站内跳转不重复计）
  var rjGlobeStop = null;  // 旧地球实例的停止回调（pjax 重建时防止残留渲染循环）
  // 云端计数通道：Upstash Redis REST（GitHub 账号注册，CORS 放行本域）
  var UPSTASH_URL = 'https://tight-wren-137459.upstash.io';
  var UPSTASH_TOKEN = 'gQAAAAAAAhjzAAIgcDFlMWQ3MGViMGI3MTQ0ODg4OTQ1ZDAwMzc5NzQzYjRmNg';
  function initGlobe() {
    var host = document.querySelector('.card-webinfo');
    if (!host || rjGlobeDone) return;
    rjGlobeDone = true;
    if (rjGlobeStop) { rjGlobeStop(); rjGlobeStop = null; }
    var oldBox = host.querySelector('#rj-globe');
    if (oldBox) oldBox.remove();
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
      H = W - 4; // 正方形画布：完整显示左右顶格的球体
      canvas.style.height = H + 'px';
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    resize();
    var cx = W / 2, cy = H / 2, R = W / 2 - 26;
    var lon = 0, visitor = null, flagImg = null, started = false, running = false;
    var historyVisits = [];
    var flagCache = {};
    var CC_POS = {
      CN: [35, 105], HK: [22.3, 114.2], MO: [22.2, 113.5], TW: [23.5, 121],
      US: [38, -97], CA: [56, -106], MX: [23.6, -102], BR: [-14, -51], AR: [-34, -64],
      GB: [53, -1], FR: [46.6, 2.4], DE: [51, 10], IT: [42.8, 12.8], ES: [40, -3.7],
      NL: [52.3, 4.9], BE: [50.5, 4.5], CH: [46.8, 8.2], SE: [62, 15], NO: [61, 8],
      DK: [56, 10], FI: [64, 26], PL: [52, 19], RU: [55, 37.6], UA: [49, 31],
      CZ: [49.8, 15.5], AT: [47.5, 14.5], PT: [39.6, -8], IE: [53.3, -7.5],
      GR: [39, 22], RO: [46, 25], HU: [47, 19], TR: [39, 35],
      JP: [36, 138], KR: [36.5, 127.5], KP: [40, 127], SG: [1.35, 103.8],
      MY: [3.9, 102], TH: [13.8, 100.5], VN: [14, 108], ID: [-2, 118],
      PH: [12.9, 121.8], IN: [22, 79], PK: [30, 69], BD: [24, 90], LK: [7.2, 80.6],
      MM: [21, 96], KH: [12.5, 105], LA: [18, 104], NP: [28, 84], IR: [32, 53],
      IQ: [33, 44], IL: [31.5, 34.8], SA: [24, 45], AE: [24, 54], QA: [25.5, 51.2],
      KW: [29.3, 47.5], OM: [21, 57], YE: [15, 48], JO: [31, 36], SY: [35, 38],
      LB: [33.8, 35.8], AU: [-25, 134], NZ: [-41, 174], PG: [-6, 147],
      EG: [26, 30], ZA: [-29, 24], NG: [9, 8], KE: [-1, 37.8], ET: [9, 40],
      GH: [7.8, -1], MA: [31.8, -7], DZ: [28, 2], TN: [34, 9], LY: [27, 17],
      SD: [15, 30], TZ: [-6, 35], UG: [1, 32.5], ZW: [-19, 29.7], CI: [7.5, -5.5],
      SN: [14, -14.5], CM: [5.5, 12.3]
    };
    function preloadFlag(cc) {
      if (!cc || !/^[A-Za-z]{2}$/.test(cc) || flagCache[cc]) return;
      var im = new Image();
      im.onload = function () { flagCache[cc] = im; };
      im.src = 'https://flagcdn.com/w20/' + cc.toLowerCase() + '.png';
    }
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
      s.src = '/js/topojson-client.min.js?v=110';
      s.onload = function () {
        if (!window.topojson) return;
        fetch('/data/countries-110m.json', { cache: 'no-cache' })
          .then(function (r) { return r.json(); })
          .then(function (topo) {
            try {
              var merged = topojson.merge(topo, [topo.objects.countries]);
              landGeo = merged && merged.coordinates;
              if (landGeo && landGeo.length) { drawLand(); }
            } catch (e) { landGeo = null; }
          })
          .catch(function () { landGeo = null; });
      };
      s.onerror = function () { landGeo = null; };
      document.head.appendChild(s);
    }
    function drawLand() {
      if (!landGeo) return;
      var gi, pi, ri, lp, ring, poly, needMove;
      ctx.save();
      ctx.lineWidth = 1.6;
      ctx.strokeStyle = 'rgba(125,240,255,.92)';
      ctx.shadowColor = 'rgba(34,211,238,.95)';
      ctx.shadowBlur = 9;
      ctx.beginPath();
      for (gi = 0; gi < landGeo.length; gi++) {
        poly = landGeo[gi];
        for (pi = 0; pi < poly.length; pi++) {
          ring = poly[pi];
          if (ring.length < 3) continue;
          needMove = true;
          for (ri = 0; ri < ring.length; ri++) {
            lp = proj(ring[ri][1], ring[ri][0]);
            if (lp.z < 0) { needMove = true; continue; }
            if (needMove) { ctx.moveTo(lp.x, lp.y); needMove = false; }
            else { ctx.lineTo(lp.x, lp.y); }
          }
        }
      }
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.fillStyle = 'rgba(34,211,238,.07)';
      ctx.fill();
      ctx.restore();
    }
    function flagEmoji(cc) {
      if (!cc || !/^[A-Za-z]{2}$/.test(cc)) return '🌍';
      return String.fromCodePoint.apply(null, cc.toUpperCase().split('').map(function (c) { return 127397 + c.charCodeAt(0); }));
    }
    function recordVisit(v) {
      if (!v || !/^[A-Za-z]{2}$/.test(v.cc) || rjCounted) return;
      rjCounted = true; // 每次打开网站统计一次
      sessionVisits[v.cc] = (sessionVisits[v.cc] || 0) + 1;
      refreshVisits();
      incrCloud(v.cc);
    }
    // —— 云端持久化：/data/visitors.json（GitHub Pages 公开累计基准）∪ 本地增量 ——
    var cloudVisits = null;
    var sessionVisits = {};
    // 每次访问原子 +1：Upstash INCR 按国家独立计数（并发访客互不覆盖、打开即生效）
    function incrCloud(cc) {
      fetch(UPSTASH_URL + '/incr/visits_' + cc, { headers: { 'Authorization': 'Bearer ' + UPSTASH_TOKEN }, cache: 'no-store' })
        .then(function (r) { if (!r.ok) throw new Error('incr'); return r.json(); })
        .then(function (j) {
          var n = parseInt(j && j.result, 10);
          if (n > 0) {
            if (!cloudVisits) cloudVisits = {};
            cloudVisits[cc] = Math.max(cloudVisits[cc] || 0, n);
            refreshVisits();
          }
        })
        .catch(function () {
          // Upstash 不可用 → 回落旧通道：新国家并入 /data/visitors.json 基准
          if (cloudVisits && !(cc in cloudVisits)) pushCloud();
        });
    }
    function mergeVisits() {
      var m = {};
      if (cloudVisits) {
        for (var k in cloudVisits) {
          if (Object.prototype.hasOwnProperty.call(cloudVisits, k) && /^[A-Za-z]{2}$/.test(k)) m[k] = cloudVisits[k];
        }
      }
      // 会话内新增国家：即时并入显示（云端基准更新后由发布同步覆盖）
      for (var s in sessionVisits) {
        if (Object.prototype.hasOwnProperty.call(sessionVisits, s) && /^[A-Za-z]{2}$/.test(s)) {
          if (!(s in m)) m[s] = sessionVisits[s];
        }
      }
      return Object.keys(m).map(function (k) { return { cc: k, n: m[k] }; })
        .sort(function (a, b) { return (b.n || 0) - (a.n || 0); }).slice(0, 24);
    }
    function refreshVisits() {
      historyVisits = mergeVisits();
      historyVisits.forEach(function (x) { preloadFlag(x.cc); });
      renderStats(historyVisits);
    }
    function loadCloudVisits() {
      var H = { 'Authorization': 'Bearer ' + UPSTASH_TOKEN };
      Promise.all([
        fetch(UPSTASH_URL + '/keys/visits_*', { headers: H, cache: 'no-store' }).then(function (r) { return r.json(); }).catch(function () { return { result: [] }; }),
        fetch(UPSTASH_URL + '/get/visits', { headers: H, cache: 'no-store' }).then(function (r) { return r.json(); }).catch(function () { return { result: null }; })
      ]).then(function (rs) {
        var ks = (rs[0].result || []).filter(function (k) { return /^visits_[A-Za-z]{2}$/.test(k); });
        var legacy = null;
        try { legacy = JSON.parse(rs[1].result); } catch (e) {}
        if (!ks.length) {
          // 尚无按国家键 → 沿用旧格式基准
          cloudVisits = (legacy && typeof legacy === 'object') ? legacy : null;
          refreshVisits();
          if (cloudVisits) return;
          throw new Error('empty');
        }
        return fetch(UPSTASH_URL + '/mget/' + ks.map(encodeURIComponent).join('/'), { headers: H, cache: 'no-store' })
          .then(function (r) { return r.json(); })
          .then(function (mj) {
            var d = {};
            var vals = mj.result || [];
            ks.forEach(function (k, i) {
              var n = parseInt(vals[i], 10);
              if (n > 0) d[k.slice(7)] = n;
            });
            // 兼容旧格式键（老版本客户端仍可能写入）
            if (legacy) for (var c in legacy) if (/^[A-Za-z]{2}$/.test(c) && legacy[c] > (d[c] || 0)) d[c] = legacy[c];
            // 合并本会话已 INCR 的瞬时结果，避免竞态覆盖
            if (cloudVisits) for (var c2 in cloudVisits) if (cloudVisits[c2] > (d[c2] || 0)) d[c2] = cloudVisits[c2];
            cloudVisits = d;
            refreshVisits();
          });
      }).catch(function () {
        fetch('/data/visitors.json?v=' + Math.floor(Date.now() / 86400000), { cache: 'no-store' })
          .then(function (r) { if (!r.ok) throw new Error('bad'); return r.json(); })
          .then(function (d) { cloudVisits = (d && typeof d === 'object') ? d : null; refreshVisits(); })
          .catch(function () {});
      });
    }
    // —— 新国家自动并入云端：合并当前云端基准与会话新增，写回 kvdb（跨设备立即生效）——
    function pushCloud() {
      if (!cloudVisits) return;
      var m = {};
      for (var k in cloudVisits) if (Object.prototype.hasOwnProperty.call(cloudVisits, k)) m[k] = cloudVisits[k];
      for (var s in sessionVisits) if (Object.prototype.hasOwnProperty.call(sessionVisits, s)) m[s] = (m[s] || 0) + sessionVisits[s];
      var body = JSON.stringify(m);
      fetch(UPSTASH_URL + '/set/visits/' + encodeURIComponent(body), {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + UPSTASH_TOKEN },
        cache: 'no-store'
      }).then(function (r) {
        if (r.ok) { cloudVisits = m; refreshVisits(); }
      }).catch(function () {});
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
    function applyVisitor(d) {
      visitor = {
        cc: ((d && (d.country || d.country_code)) || '').toUpperCase(),
        city: (d && d.city) || '',
        lat: parseFloat(d && d.loc ? d.loc.split(',')[0] : (d && d.latitude != null ? d.latitude : NaN)),
        lon: parseFloat(d && d.loc ? d.loc.split(',')[1] : (d && d.longitude != null ? d.longitude : NaN))
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
    }
    function locate() {
      fetch('https://ipinfo.io/json', { cache: 'no-store' })
        .then(function (r) { if (!r.ok) throw new Error('ipinfo'); return r.json(); })
        .then(applyVisitor)
        .catch(function () {
          // 备用定位源：ipinfo 失败（限流/被墙）时保证访客仍被统计
          fetch('https://ipapi.co/json/', { cache: 'no-store' })
            .then(function (r) { if (!r.ok) throw new Error('ipapi'); return r.json(); })
            .then(applyVisitor)
            .catch(function () {
              label.textContent = '🌐 欢迎来自世界各地的访客';
              refreshVisits();
            });
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
      if (landGeo) { drawLand(); }
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
      // 历史访客国旗落位（按国家中心点投影，仅正面显示）
      for (var hq = 0; hq < historyVisits.length; hq++) {
        var hv = historyVisits[hq];
        if (!hv || !/^[A-Za-z]{2}$/.test(hv.cc)) continue;
        if (visitor && hv.cc === visitor.cc) continue;
        var hpos = CC_POS[hv.cc];
        if (!hpos) continue;
        var hp = proj(hpos[0], hpos[1]);
        if (hp.z < 0.05) continue;
        ctx.fillStyle = 'rgba(34,211,238,.6)';
        ctx.beginPath(); ctx.arc(hp.x, hp.y, 2, 0, Math.PI * 2); ctx.fill();
        var fim = flagCache[hv.cc];
        if (fim && fim.width) { ctx.drawImage(fim, hp.x - 7, hp.y - 13, 14, 10); }
        else { ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.font = '9px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(flagEmoji(hv.cc), hp.x, hp.y - 2); }
      }
      // 访客定位：脉冲圈 + 洋红点 + 国旗（仅正面显示，转背面时为淡光点）
      if (visitor && !isNaN(visitor.lat) && !isNaN(visitor.lon)) {
        var vp = proj(visitor.lat, visitor.lon);
        if (vp.z > 0.05) {
          var vz = Math.max(0.05, vp.z);
          ctx.strokeStyle = 'rgba(232,121,249,' + (0.4 + 0.3 * vz) + ')';
          ctx.lineWidth = 1.4;
          ctx.beginPath(); ctx.arc(vp.x, vp.y, 4 + 2.5 * Math.sin(tt * 3.2), 0, Math.PI * 2); ctx.stroke();
          ctx.beginPath(); ctx.arc(vp.x, vp.y, 3, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(232,121,249,.95)'; ctx.fill();
          if (flagImg && flagImg.width) ctx.drawImage(flagImg, vp.x - 10, vp.y - 26, 20, 14);
          else { ctx.fillStyle = '#fff'; ctx.font = '11px monospace'; ctx.textAlign = 'center'; ctx.fillText(visitor.cc, vp.x, vp.y - 10); }
        } else {
          ctx.beginPath(); ctx.arc(vp.x, vp.y, 2.4, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(232,121,249,.45)'; ctx.fill();
        }
      }
      // 外光晕（青→紫）
      var halo = ctx.createRadialGradient(cx, cy, R * 0.92, cx, cy, R * 1.3);
      halo.addColorStop(0, 'rgba(34,211,238,.14)');
      halo.addColorStop(0.55, 'rgba(168,85,247,.10)');
      halo.addColorStop(1, 'rgba(168,85,247,0)');
      ctx.fillStyle = halo;
      ctx.fillRect(cx - R * 1.3, cy - R * 1.3, R * 2.6, R * 2.6);
      // 卫星轨道环（球外环绕，青色 + 洋红双环带光点）
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(-0.45 + tt * 0.12);
      ctx.strokeStyle = 'rgba(34,211,238,.5)';
      ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.ellipse(0, 0, R + 15, (R + 15) * 0.36, 0, 0, Math.PI * 2); ctx.stroke();
      var sa = (tt * 0.9) % (Math.PI * 2);
      ctx.fillStyle = 'rgba(103,232,249,.95)';
      ctx.beginPath(); ctx.arc(Math.cos(sa) * (R + 15), Math.sin(sa) * (R + 15) * 0.36, 2.4, 0, Math.PI * 2); ctx.fill();
      ctx.rotate(1.35);
      ctx.strokeStyle = 'rgba(232,121,249,.42)';
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
      rjGlobeStop = function () { running = false; };
      locate();
      loadLand();
      refreshVisits();
      loadCloudVisits();
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
    window.addEventListener('resize', function () { resize(); cx = W / 2; cy = H / 2; R = W / 2 - 26; });
  }

  // —— 导航徽标：Alien×Apple 融合标记「额饰异形」——
  // 外星人头像（切角颅骨 / 发光斜眼）+ 额头苹果能量印记（咬口 + 叶片），霓虹双色
  var RJ_LOGO_SVG =
    '<svg class="rj-logo" viewBox="0 0 64 64" aria-hidden="true" focusable="false">' +
      '<defs>' +
        '<linearGradient id="rjLogoRim" x1="0" y1="0" x2="1" y2="1">' +
          '<stop offset="0" class="rj-logo-r1"/>' +
          '<stop offset=".45" class="rj-logo-r2"/>' +
          '<stop offset="1" class="rj-logo-r3"/>' +
        '</linearGradient>' +
        '<linearGradient id="rjLogoCore" x1="0" y1="0" x2=".6" y2="1">' +
          '<stop offset="0" class="rj-logo-k1"/>' +
          '<stop offset=".55" class="rj-logo-k2"/>' +
          '<stop offset="1" class="rj-logo-k3"/>' +
        '</linearGradient>' +
        '<mask id="rjLogoBite"><rect x="0" y="0" width="64" height="64" fill="#fff"/><circle cx="37.73" cy="14.78" r="2.73" fill="#000"/></mask>' +
      '</defs>' +
      '<path class="rj-logo-head" d="M32 4.4 L36.8 4.8 L42 6.6 L46.6 9.6 L50.4 13.9 L52.6 20.6 L50 28.2 L46.2 35 L40.6 41.2 L32 45.8 L23.4 41.2 L17.8 35 L14 28.2 L11.4 20.6 L13.6 13.9 L17.4 9.6 L22 6.6 L27.2 4.8 Z"/>' +
      '<path class="rj-logo-eye" d="M30.6 28.4 C27.2 24.8 23.4 22.8 19.6 23.2 C17.1 23.4 15.8 24.5 15.6 25.6 C17.6 27.9 21.2 29.4 24.9 29.5 C27.4 29.6 29.4 29.4 30.6 28.4 Z M33.4 28.4 C36.8 24.8 40.6 22.8 44.4 23.2 C46.9 23.4 48.2 24.5 48.4 25.6 C46.4 27.9 42.8 29.4 39.1 29.5 C36.6 29.6 34.6 29.4 33.4 28.4 Z"/>' +
      '<g class="rj-logo-coreg" mask="url(#rjLogoBite)"><path class="rj-logo-core" d="M32.00 12.15 C29.74 10.37 26.92 11.49 26.64 14.31 C26.36 16.95 27.49 19.77 29.56 21.08 C30.50 21.65 31.25 21.83 32.00 21.83 C32.75 21.83 33.50 21.65 34.44 21.08 C36.51 19.77 37.64 16.95 37.36 14.31 C37.08 11.49 34.26 10.37 32.00 12.15 Z M32.19 10.84 C32.28 8.86 33.22 7.55 35.38 6.98 C35.29 9.05 34.35 10.37 32.19 10.84 Z"/></g>' +
    '</svg>';
  function initLogo() {
    var host = document.getElementById('site-name');
    if (!host || host.querySelector('.rj-logo-wrap')) return;
    var wrap = document.createElement('span');
    wrap.className = 'rj-logo-wrap';
    wrap.innerHTML = RJ_LOGO_SVG;
    host.insertBefore(wrap, host.firstChild);
  }

  // —— 站点统计（Upstash 原子计数，替代失效的不蒜子 busuanzi）——
  var rjPvMarked = false;   // 总访问量：每次完整页面加载 +1
  var rjPvPath = null;      // 文章阅读量：每次进入该文章（含 pjax 跳转）计一次
  function rjUpstash(key, isIncr) {
    return fetch(UPSTASH_URL + (isIncr ? '/incr/' : '/get/') + key, {
      headers: { 'Authorization': 'Bearer ' + UPSTASH_TOKEN },
      cache: 'no-store'
    }).then(function (r) {
      if (!r.ok) throw new Error('upstash');
      return r.json();
    }).then(function (j) {
      var n = parseInt(j && j.result, 10);
      if (!(n > 0)) throw new Error('value');
      return n;
    });
  }
  function rjFmt(n) { return n >= 100000 ? (n / 1000).toFixed(1) + 'k' : String(n); }
  function rjFill(id, val) {
    var el = document.getElementById(id);
    if (el) el.innerHTML = val;
  }
  function ensureWebinfoItems() {
    var host = document.querySelector('.card-webinfo .webinfo');
    if (!host || host.querySelector('#rj-site-pv')) return;
    function mk(id, name) {
      var it = document.createElement('div');
      it.className = 'webinfo-item';
      var nm = document.createElement('div');
      nm.className = 'item-name';
      nm.textContent = name + ' :';
      var cnt = document.createElement('div');
      cnt.className = 'item-count';
      cnt.id = id;
      cnt.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
      it.appendChild(nm);
      it.appendChild(cnt);
      return it;
    }
    host.appendChild(mk('rj-site-uv', '本站访客数'));
    host.appendChild(mk('rj-site-pv', '本站总访问量'));
  }
  function ensurePagePv() {
    if (document.getElementById('rj-page-pv')) return;
    var line = document.querySelector('#post-info .meta-secondline');
    if (!line) return;
    var sep = document.createElement('span');
    sep.className = 'post-meta-separator';
    sep.textContent = '|';
    var box = document.createElement('span');
    box.className = 'post-meta-pv-cv';
    box.innerHTML = '<i class="far fa-eye fa-fw post-meta-icon"></i><span class="post-meta-label">阅读量:</span><span id="rj-page-pv"><i class="fa-solid fa-spinner fa-spin"></i></span>';
    line.appendChild(sep);
    line.appendChild(box);
  }
  function rjStats() {
    ensureWebinfoItems();
    ensurePagePv();
    var failed = function (id) { rjFill(id, '—'); };
    // 本站总访问量：每次完整页面加载 +1（pjax 站内跳转不重复计）
    if (!rjPvMarked) {
      rjPvMarked = true;
      rjUpstash('pv_total', true)
        .then(function (n) { rjFill('rj-site-pv', rjFmt(n)); })
        .catch(function () { failed('rj-site-pv'); });
    }
    // 本站访客数：每个浏览器只计一次（localStorage 标记去重）
    var uvDone = false;
    try { uvDone = !!localStorage.getItem('rjUvDone'); } catch (e) {}
    var uvReq = uvDone
      ? rjUpstash('uv_total', false)
      : rjUpstash('uv_total', true).then(function (n) {
          try { localStorage.setItem('rjUvDone', '1'); } catch (e) {}
          return n;
        });
    uvReq.then(function (n) { rjFill('rj-site-uv', rjFmt(n)); }).catch(function () { failed('rj-site-uv'); });
    // 文章阅读量：按路径 +1
    if (document.getElementById('rj-page-pv')) {
      var path = location.pathname;
      var pkey = 'pv_' + encodeURIComponent(path);
      if (rjPvPath !== path) {
        rjPvPath = path;
        rjUpstash(pkey, true)
          .then(function (n) { rjFill('rj-page-pv', rjFmt(n)); })
          .catch(function () { failed('rj-page-pv'); });
      } else {
        rjUpstash(pkey, false)
          .then(function (n) { rjFill('rj-page-pv', rjFmt(n)); })
          .catch(function () { failed('rj-page-pv'); });
      }
    }
  }

  // —— 组装执行 ——
  function rjV12Run() {
    fixErrorImgRefs();
    upgradeRewardMenus();
    upgradeAnnouncement();
    initLogo();
    initGlobe();
    rjStats();
    rjPatchBrokenImgs();
    setTimeout(rjPatchBrokenImgs, 1500);
    setTimeout(rjPatchBrokenImgs, 4000);
    setTimeout(rjPatchBrokenImgs, 8000);
    setTimeout(rjPatchBrokenImgs, 15000);
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
    initLogo();
    initGlobe();
    rjStats();
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
