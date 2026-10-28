/* RockJesus site music player — fixed mini APlayer（自托管/QQ 歌单双源） */
(function () {
  if (window.__rjMusicInit) return; // pjax 防重复初始化
  window.__rjMusicInit = true;

  // —— 鼠标互动线条（canvas-nest）改为主题紫 #8b5cf6 ——
  var rjCanvasNest = document.getElementById('canvas_nest');
  if (rjCanvasNest) rjCanvasNest.setAttribute('color', '139,92,246');

  // 只保留两个源。jsDelivr 已移除：它对 @main 有 12 小时缓存，素材仓更新后
  // 仍返回旧歌单，而它恰恰响应最快（~250ms）——只要前一个源慢一点，它就会
  // 抢先返回旧数据，表现成「列表又变回 30 首」。宁可少一个兜底，也不要错数据。
  var PLAYLIST_URLS = [
    '/data/playlist.json?v=1.2.1',                                            // 本站构建产物（主）
    'https://raw.githubusercontent.com/rockjesus/rockjesus/main/music/playlist.json'  // 素材仓直连（兜底）
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
      var timer = setTimeout(function () { ctrl.abort(); reject(new Error('timeout')); }, timeout || 12000);
      // 不要用 cache:'no-cache'：它会带 Cache-Control: no-cache 强制回源，
      // 583KB 的 JSON 每次都要等源头，首屏能卡到 30s+。
      // 版本更新靠 URL 上的 ?v= 控制（换版本 = 换缓存键），默认缓存策略即可。
      fetch(url, { signal: ctrl.signal })
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

  // APlayer 库自托管优先：从 jsDelivr 拉在境内能等 10s+，首屏全卡在这一步。
  // 同域 /lib 命中 CDN 缓存通常 <300ms；jsDelivr 留作兜底。
  function ensureAplayer(cb) {
    if (window.APlayer) return cb();
    var srcs = ['/lib/APlayer.min.js?v=1.10.1',
                'https://cdn.jsdelivr.net/npm/aplayer@1.10.1/dist/APlayer.min.js'];
    var i = 0;
    function next() {
      if (i >= srcs.length) { cb(); return; }
      var s = document.createElement('script');
      s.src = srcs[i++];
      s.onload = cb;
      s.onerror = next;
      document.head.appendChild(s);
    }
    next();
  }

  function normalize(list) {
    var out = [];
    (list || []).forEach(function (t) {
      if (!t || !t.name) return;
      // v1.6.8：拿不到直链的曲目也保留。
      // 歌单是「我喜欢」的完整收藏（3000+ 首），其中一部分受版权/会员限制无法解析出
      // 播放地址。旧版在这里直接丢弃，导致 3064 首只剩 30 首进列表。
      // 现在保留并标记，列表里置灰展示、不可切入播放。
      out.push({
        name: t.name,
        artist: t.artist || '',
        url: t.url || '',
        cover: t.cover || SEED.cover,
        duration: t.duration || 0
      });
    });
    return out;
  }

  // —— 可播性判定与查找 ——
  // 列表里同时存在可播/不可播两种曲目，所有切歌入口都必须绕过不可播的，
  // 否则会出现「切到一首空 src 的歌 → 播放器停在静默状态」。
  function rjIsPlayable(ap, i) {
    var a = ap && ap.list && ap.list.audios && ap.list.audios[i];
    return !!(a && a.url);
  }
  function rjFindPlayable(ap, from, dir) {
    var n = (ap && ap.list && ap.list.audios && ap.list.audios.length) || 0;
    for (var s = 1; s <= n; s++) {
      var i = ((from + dir * s) % n + n) % n;
      if (i === from) break;
      if (rjIsPlayable(ap, i)) return i;
    }
    return -1;
  }
  function rjRandomPlayable(ap) {
    var n = (ap && ap.list && ap.list.audios && ap.list.audios.length) || 0;
    var pool = [];
    for (var i = 0; i < n; i++) if (rjIsPlayable(ap, i)) pool.push(i);
    if (!pool.length) return -1;
    return pool[Math.floor(Math.random() * pool.length)];
  }

  // 列表高度按「整行」收口：写死 px 在不同字体/断点下会露出半行。
  // 实测首行与第 2 行高度（第 2 行起多 1px 描边）再定 maxHeight。
  function rjFitListRows(listEl, rows) {
    if (!listEl) return;
    var ol = listEl.querySelector('ol');
    if (!ol || !ol.children.length) return;
    var h1 = ol.children[0].getBoundingClientRect().height;
    var h2 = (ol.children[1] || ol.children[0]).getBoundingClientRect().height;
    if (!h1 || h1 < 8 || !h2) return;
    ol.style.maxHeight = Math.round(h1 + h2 * ((rows || 7) - 1)) + 'px';
  }

  // 断点变化后行高会变，重新收口一次（只绑一次，pjax 不重复挂）
  if (!window.__rjFitBound) {
    window.__rjFitBound = true;
    var __rjFitTimer = null;
    window.addEventListener('resize', function () {
      if (__rjFitTimer) clearTimeout(__rjFitTimer);
      __rjFitTimer = setTimeout(function () {
        rjFitListRows(document.querySelector('.aplayer .aplayer-list'), 7);
      }, 180);
    });
  }

  // —— 统一装饰：自绘外壳 + 封面毛玻璃底 + 播放状态 + 断点记忆 ——
  function decorate(ap, container, list) {
    var body = container.querySelector('.aplayer-body');
    var pic = container.querySelector('.aplayer-pic');
    var info = container.querySelector('.aplayer-info');
    // APlayer 自带的封面块 / 信息块 / 控制器 / 折叠箭头全部隐藏：
    // 只保留它的 audio、歌单数据和 .aplayer-list 面板，可见界面由 rj-pl 自绘
    if (pic) pic.style.display = 'none';
    if (info) info.style.display = 'none';
    var miniSw = container.querySelector('.aplayer-miniswitcher');
    if (miniSw) miniSw.style.display = 'none';
    var row = null; // 自绘外壳，沿用旧变量名承接后面对它的引用
    function curAudio() {
      var list = ap.list && ap.list.audios;
      return (list && list[ap.list.index]) || null;
    }
    // ============================================================
    //  切歌 V1.6.7
    //  APlayer 1.10.1 的 list 对象只有 switch()，没有 prev()/next()：
    //  旧代码调 ap.list.prev()/next() 会抛异常并被 try 吞掉 → 按钮「按了没反应」。
    //  正确入口是 player 级 skipBack()/skipForward()：按当前 order（含 random）
    //  取上一/下一序号，并自带首尾环绕。
    // ============================================================
    function rjSkip(dir, forcePlay) {
      var n = (ap.list && ap.list.audios && ap.list.audios.length) || 0;
      if (n < 2) return false;
      // 不能直接用 skipForward/skipBack：它们按列表顺序走，会落在不可播曲目上。
      // 这里沿同一方向线性找最近的可用曲目（环形，避开当前）。
      var target = rjFindPlayable(ap, ap.list.index, dir);
      if (target < 0) return false;
      var wasPlaying = forcePlay || !!(ap.audio && !ap.audio.paused);
      try { ap.list.switch(target); } catch (e) { return false; }
      resetTime();
      // 播放中换台继续播；暂停时换台停在新歌开头（保留用户的暂停意图）
      if (wasPlaying) { try { ap.play(); } catch (e) {} }
      return true;
    }
    // —— 换歌必须从头播：switch() 内部会 seek(0)，但「src 刚换」时对 currentTime
    //    的赋值可能被忽略，元数据就绪后再钉一次 0 作为保险 ——
    function resetTime() {
      if (!ap.audio) return;
      try { ap.audio.currentTime = 0; } catch (e) {}
      if (ap.audio.readyState < 1) {
        ap.audio.addEventListener('loadedmetadata', function () {
          try { ap.audio.currentTime = 0; } catch (e) {}
        }, { once: true });
      }
    }
    // —— 试听片段检测：vkey 过期时 QQ 只返回 30 秒试听，播放器误以为播完自动切歌 →
    //    表现为"每首歌都是片段"。若实际时长明显短于歌单标注 → 判定为试听，自动跳过该歌 ——
    function rjSkipPreview() {
      try {
        var a = curAudio();
        if (!ap.audio || !a || !a.duration || a.duration < 60) return;
        var real = ap.audio.duration;
        if (real && real < a.duration * 0.6) {
          rjSkip(1);
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
      function apply(u) {
        // 卡片底色 = 同一张封面的模糊版（CSS 侧读 --rj-pl-cover 做毛玻璃层），
        // 缩略封面也用这张图；不再把锐利大图铺到整卡，避免文字被照片压灰
        if (body) body.style.setProperty('--rj-pl-cover', 'url("' + u + '")');
        if (row) row.style.setProperty('--rj-pl-cover', 'url("' + u + '")');
      }
      var img = new Image();
      img.onload = function () {
        if (curAudio() !== a) return; // 已切走，忽略过期加载结果
        apply(cover);
      };
      img.onerror = function () {
        if (curAudio() !== a) return;
        apply(SEED.cover);
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
    ap.on('ended', function () {
      if (row) row.classList.remove('rj-playing');
      // APlayer 自己会切到列表下一首，但下一首可能不可播 → 停在空 src 上静默。
      // 等它切完再用索引判断，落在不可播就沿列表继续找下一首能播的。
      setTimeout(function () {
        if (!rjIsPlayable(ap, ap.list.index)) rjSkip(1, true);
      }, 280);
    });
    ap.on('loadeddata', syncCoverDebounced);

    // 断点续播记忆
    var STATE_KEY = 'rjPlayerState';
    function saveState(fixedTime, fixedIdx) {
      try {
        localStorage.setItem(STATE_KEY, JSON.stringify({
          idx: typeof fixedIdx === 'number' ? fixedIdx : ap.list.index,
          // 换歌瞬间 listswitch 先于 setAudio 触发，此刻 currentTime 还是上一首的，
          // 必须显式写 0，否则下次打开会把「新歌」续播到「旧进度」
          time: typeof fixedTime === 'number' ? fixedTime : ((ap.audio && ap.audio.currentTime) || 0)
        }));
      } catch (e) {}
    }
    setInterval(function () { saveState(); }, 3000);
    // listswitch 载荷带的是「即将切到的」index（此时 ap.list.index 还没更新），必须用它
    ap.on('listswitch', function (d) { saveState(0, d && d.index); });
    ap.on('pause', function () { saveState(); });

    // —— 播放列表：展开播放器即常显（旧版「10 秒无操作自动收起」已移除，
    //    与新交互的「展开默认带列表」冲突）；只有折叠播放器时才收起 ——
    var listEl = container.querySelector('.aplayer-list');

    // ============================================================
    //  曲目可播状态（V1.6.8）
    //  歌单已改为全量收录，列表里同时存在可播 / 不可播两类曲目。
    //  不可播的置灰（CSS）+ 角标，并在捕获阶段拦掉点击 ——
    //  否则会切到空 src 上，表现为「点了没反应」。
    // ============================================================
    // 顶部统计 + 搜索。3000+ 首纯靠滚动找歌不可用，搜索是这一版的必需品：
    // 过滤只切 li 的显隐，不重建 DOM，所以「行 → 曲目索引」的映射始终成立
    // （点击拦截用 children 序号取原索引，隐藏行仍在 children 里）。
    var searchTimer = null;
    function applyFilter(kw) {
      if (!listEl) return 0;
      var lis = listEl.querySelectorAll('ol li');
      var audios = (ap.list && ap.list.audios) || [];
      var q = (kw || '').trim().toLowerCase();
      var hit = 0;
      for (var i = 0; i < lis.length; i++) {
        var a = audios[i] || {};
        var m = !q ||
          String(a.name || '').toLowerCase().indexOf(q) >= 0 ||
          String(a.artist || '').toLowerCase().indexOf(q) >= 0;
        if (m) {
          hit++;
          lis[i].classList.remove('rj-hide');
        } else {
          lis[i].classList.add('rj-hide');
        }
      }
      var ol = listEl.querySelector('ol');
      if (ol) ol.scrollTop = 0;
      return hit;
    }
    function syncStat() {
      if (!listEl) return;
      var audios = (ap.list && ap.list.audios) || [];
      var ok = 0;
      for (var i = 0; i < audios.length; i++) if (audios[i] && audios[i].url) ok++;
      var box = listEl.querySelector('.rj-pl-stat');
      if (!box) {
        box = document.createElement('div');
        box.className = 'rj-pl-stat';
        box.innerHTML = '<span class="rj-pl-stat-num"></span>' +
          '<input class="rj-pl-search" type="search" placeholder="搜索歌名 / 歌手" />';
        listEl.insertBefore(box, listEl.firstChild);
        // APlayer 在播放器容器上挂了「点列表行 → 读 aplayer-list-index 换算出序号」的处理，
        // 点到统计条/搜索框时会走进它，而那里没有 index 元素 →
        // 抛「Cannot read properties of undefined (reading 'innerHTML')」。
        // 统计条是自绘交互区，直接截住事件不让它冒到 APlayer 的处理器上。
        ['click', 'mousedown', 'pointerdown', 'touchstart'].forEach(function (t) {
          box.addEventListener(t, function (e) { e.stopPropagation(); }, false);
        });
        var inp = box.querySelector('.rj-pl-search');
        inp.addEventListener('input', function () {
          if (searchTimer) clearTimeout(searchTimer);
          var v = this.value;
          searchTimer = setTimeout(function () { applyFilter(v); }, 200);
        });
        // 别让搜索框的按键冒到热键/翻页逻辑上
        inp.addEventListener('keydown', function (e) { e.stopPropagation(); });
      }
      var num = box.querySelector('.rj-pl-stat-num');
      if (num) num.innerHTML = '全部 <b>' + audios.length + '</b> 首 · 可播 <b class="ok">' + ok + '</b> 首';
    }
    // 列表高度按「整行」算：CSS 里写死 230px 是按桌面 32+33×6 推的，
    // 移动端行高更大（≈37），230 会露出半行。实测行高再定，永远整行收口。
    function fitListRows(rows) { rjFitListRows(listEl, rows); }
    function markRows() {
      if (!listEl) return;
      var lis = listEl.querySelectorAll('ol li');
      var audios = (ap.list && ap.list.audios) || [];
      for (var i = 0; i < lis.length; i++) {
        var playable = !!(audios[i] && audios[i].url);
        if (playable) {
          if (lis[i].classList.contains('rj-nop')) lis[i].classList.remove('rj-nop');
        } else if (!lis[i].classList.contains('rj-nop')) {
          lis[i].classList.add('rj-nop');
        }
      }
      syncStat();
      fitListRows(7);
    }
    if (listEl) {
      listEl.addEventListener('click', function (e) {
        var t = e.target;
        var li = t && t.closest ? t.closest('li') : null;
        if (!li || !li.parentNode || li.parentNode.tagName !== 'OL') return;
        var idx = Array.prototype.indexOf.call(li.parentNode.children, li);
        if (idx >= 0 && !rjIsPlayable(ap, idx)) {
          e.stopPropagation();
          e.preventDefault();
          var a = ap.list.audios[idx];
          showTip('「' + ((a && a.name) || '这首') + '」暂无可播地址，换一首吧');
        }
      }, true);
    }
    // 首屏优先出画面，标记放到下一个宏任务（3000+ 行 class 操作约 100ms）
    setTimeout(markRows, 40);

    // —— 交互模型 V1.6.2 ——
    //    折叠态圆盘：单击 = 播放/暂停，双击 = 展开
    //    展开态：双击圆盘 = 折叠；卡片空白处单击 = 播放/暂停、双击 = 开/关播放列表
    //    展开时播放列表默认打开；点页面其它任何位置自动折叠播放器
    var singleTimer = null;
    var vizSync = null;      // buildShell 内赋值，折叠/展开状态变化时同步律动启停
    function isInteractive(el) {
      return !!(el && el.closest && el.closest(
        '.rj-pl-bar, .rj-pl-btns, .rj-pl-disc, ' +
        '.aplayer-bar-wrap, .aplayer-menu, .aplayer-volume-wrap, .aplayer-loop, ' +
        '.aplayer-icon, .aplayer-time, .aplayer-miniswitcher, ' +
        '.aplayer-list, input, textarea, button, a'
      ));
    }
    function togglePlay() {
      if (!ap.audio) return;
      // 首屏第一次点击已由全局 pointerdown 开始播放，这里让掉这一次，避免瞬间暂停
      if (Date.now() - (container.__rjBootAt || 0) < 500) { container.__rjBootAt = 0; return; }
      try {
        if (ap.audio.paused) { ap.play(); } else { ap.pause(); }
      } catch (e) {}
    }
    function listHidden() {
      return !listEl || listEl.classList.contains('aplayer-list-hide') || listEl.style.display === 'none';
    }
    function showList() {
      if (!listEl) return;
      try { ap.list.show(); } catch (e) { listEl.style.display = 'block'; }
    }
    function hideList() {
      if (!listEl) return;
      try { ap.list.hide(); } catch (e) { listEl.style.display = 'none'; }
    }
    function toggleList() {
      if (!listEl) return;
      if (listHidden()) { showList(); } else { hideList(); }
    }
    function isCollapsed() {
      return container.classList.contains('rj-pl-collapsed');
    }
    function setCollapsed(v) {
      container.classList.toggle('rj-pl-collapsed', v);
      if (v) { if (!listHidden()) hideList(); }
      else if (listHidden()) { showList(); }
      if (vizSync) vizSync();   // 只有折叠态才跑律动，展开时停掉省电
    }
    // ============================================================
    //  自绘播放器外壳 rj-pl
    //  折叠态：64px 圆形唱片（透明底，封面常转；单击播放/暂停，双击展开）
    //  展开态：328px 玻璃卡片（封面 + 曲目 + 进度 + 控制钮 + 列表）
    //  APlayer 只保留 audio 与歌单，可见 UI 全部由本层接管
    // ============================================================
    (function buildShell() {
      if (!body) return;
      var P = {
        play: 'M9.2 6.4v11.2L17.6 12z',
        /* 暂停用两个圆角胶囊，纯矩形在封面上会像两块贴纸 */
        pause: '<rect x="7.2" y="5.2" width="3.4" height="13.6" rx="1.7"/>' +
               '<rect x="13.4" y="5.2" width="3.4" height="13.6" rx="1.7"/>',
        prev: 'M7 6a1 1 0 0 1 2 0v12a1 1 0 1 1-2 0V6zm10.6.7a1 1 0 0 1 1.5.8v10.8a1 1 0 0 1-1.5.8l-7.6-5.4a1 1 0 0 1 0-1.6l7.6-5.4z',
        next: 'M17 6a1 1 0 0 1 2 0v12a1 1 0 1 1-2 0V6zM5.9 6.7a1 1 0 0 1 1.5-.8l7.6 5.4a1 1 0 0 1 0 1.6l-7.6 5.4a1 1 0 0 1-1.5-.8V6.7z',
        list: 'M4 6h2v2H4V6zm4 0h12v2H8V6zm-4 5h2v2H4v-2zm4 0h12v2H8v-2zm-4 5h2v2H4v-2zm4 0h12v2H8v-2z'
      };
      // d 以 '<' 开头时按原始图形插入（圆角矩形等），否则当作单条 path
      var svg = function (d) {
        var inner = d.charAt(0) === '<' ? d : '<path d="' + d + '"/>';
        return '<svg viewBox="0 0 24 24" aria-hidden="true">' + inner + '</svg>';
      };
      var root = document.createElement('div');
      root.className = 'rj-pl';
      root.innerHTML =
        '<button type="button" class="rj-pl-disc" title="单击播放 / 暂停 · 双击展开">' +
          '<span class="rj-pl-art"></span>' +
          '<span class="rj-pl-shade"></span>' +
          '<span class="rj-pl-discbtn">' + svg(P.play) + '</span>' +
        '</button>' +
        '<canvas class="rj-pl-eq" aria-hidden="true"></canvas>' +
        '<div class="rj-pl-meta">' +
          '<div class="rj-pl-title">正在连接…</div>' +
          '<div class="rj-pl-line">' +
            '<span class="rj-pl-artist">RockJesus Station</span>' +
            '<span class="rj-pl-time">0:00 / 0:00</span>' +
          '</div>' +
          '<div class="rj-pl-bar"><span class="rj-pl-fill"><i class="rj-pl-thumb"></i></span></div>' +
        '</div>' +
        '<div class="rj-pl-btns">' +
          '<button type="button" data-a="prev" title="上一首">' + svg(P.prev) + '</button>' +
          '<button type="button" data-a="toggle" class="rj-pl-main" title="播放 / 暂停">' + svg(P.play) + '</button>' +
          '<button type="button" data-a="next" title="下一首">' + svg(P.next) + '</button>' +
          '<button type="button" data-a="list" title="播放列表">' + svg(P.list) + '</button>' +
        '</div>';
      body.insertBefore(root, body.firstChild);
      row = root;

      var disc = root.querySelector('.rj-pl-disc');
      var discBtn = root.querySelector('.rj-pl-discbtn');
      var elTitle = root.querySelector('.rj-pl-title');
      var elArtist = root.querySelector('.rj-pl-artist');
      var elTime = root.querySelector('.rj-pl-time');
      var elFill = root.querySelector('.rj-pl-fill');
      var elBar = root.querySelector('.rj-pl-bar');
      var mainBtn = root.querySelector('.rj-pl-main');

      // ============================================================
      //  折叠态律动 V1.6.6
      //  真实频谱优先：音乐源（QQ CDN / jsDelivr）都返回 Access-Control-Allow-Origin: *，
      //  audio 声明匿名跨域后即可接进 Web Audio 读 FFT；拿不到（AudioContext 没解锁 /
      //  个别源缺 CORS）就退回合成节拍，任何情况下都不影响播放与出声。
      // ============================================================
      var EQ_N = 36;                 // 环上柱子数
      var VIZ = 104;                 // 画布逻辑尺寸（CSS 侧同值，圆盘 66 → 环在圆盘外 1~15px）
      var DPR = Math.min(2, window.devicePixelRatio || 1);
      var eqEl = root.querySelector('.rj-pl-eq');
      var eq2d = eqEl && eqEl.getContext ? eqEl.getContext('2d') : null;
      if (eq2d) { eqEl.width = Math.round(VIZ * DPR); eqEl.height = Math.round(VIZ * DPR); }
      var viz = { tried: false, actx: null, an: null, data: null, raf: 0, fix: false, smooth: [] };
      for (var vi = 0; vi < EQ_N; vi++) viz.smooth.push(0);

      function initViz() {
        if (viz.tried) return;
        viz.tried = true;
        var AC = window.AudioContext || window.webkitAudioContext;
        var au = ap.audio;
        if (!AC || !au || !eq2d) return;
        try {
          // crossOrigin 已在 APlayer 创建后立刻设好（见上），这里只在极端情况下补一次
          if (!au.crossOrigin) au.crossOrigin = 'anonymous';
          var actx = new AC();
          var srcNode = actx.createMediaElementSource(au);
          var an = actx.createAnalyser();
          an.fftSize = 256;
          an.smoothingTimeConstant = 0.74;
          an.minDecibels = -88;
          srcNode.connect(an);
          an.connect(actx.destination);   // 必须接回 destination，否则只剩分析、没有声音
          viz.actx = actx;
          viz.an = an;
          viz.data = new Uint8Array(an.frequencyBinCount);
        } catch (e) {
          viz.an = null;
        }
      }

      // 极端兜底：万一某首源站没给 CORS 头，匿名跨域会直接加载失败；
      // 清掉 crossOrigin 重载一次 —— 宁可没有律动，也不能没有声音
      if (ap.audio) {
        ap.audio.addEventListener('error', function () {
          if (viz.fix) return;
          var au = ap.audio;
          if (!au || !au.crossOrigin) return;
          viz.fix = true;
          viz.an = null;
          try { au.crossOrigin = null; au.load(); } catch (e) {}
        });
      }

      // 频谱 → 36 根柱子（对数采样，前后镜像，视觉上左右对称）
      function sampleBars(d) {
        var maxBin = Math.min(d.length - 1, 56);   // 约到 10kHz
        var half = EQ_N / 2;
        var tmp = [];
        for (var i = 0; i < half; i++) {
          var t0 = Math.pow(i / (half - 1), 1.7);
          var t1 = Math.pow((i + 1) / (half - 1), 1.7);
          var lo = Math.min(maxBin, Math.floor(t0 * maxBin));
          var hi = Math.max(lo + 1, Math.min(maxBin, Math.floor(t1 * maxBin)));
          var sum = 0, n = 0;
          for (var j = lo; j <= hi; j++) { sum += d[j]; n++; }
          tmp.push(n ? (sum / n) / 255 : 0);
        }
        var out = [];
        for (var k = 0; k < EQ_N; k++) {
          out.push(k < half ? tmp[k] : tmp[EQ_N - 1 - k]);
        }
        return out;
      }

      function drawEq(bars, glow) {
        var R = VIZ / 2;
        eq2d.setTransform(DPR, 0, 0, DPR, 0, 0);
        eq2d.clearRect(0, 0, VIZ, VIZ);
        var r0 = R * 0.69;                  // 圆盘半径 + 约 3px，不要压边
        var maxLen = R - r0 - 3;
        eq2d.lineCap = 'round';
        eq2d.shadowBlur = 4 + glow * 8;
        eq2d.shadowColor = 'rgba(139, 92, 246, ' + (0.3 + glow * 0.45) + ')';
        for (var i = 0; i < EQ_N; i++) {
          var v = bars[i];
          var a = (i / EQ_N) * Math.PI * 2 - Math.PI / 2;
          var len = 1.4 + v * maxLen;
          var c = Math.cos(a), sn = Math.sin(a);
          var hue = 264 - 76 * (1 - Math.abs(i - EQ_N / 2) / (EQ_N / 2));   // 12 点紫、6 点青，左右对称
          eq2d.strokeStyle = 'hsla(' + hue.toFixed(0) + ', 92%, ' + (62 + v * 14).toFixed(0) + '%, ' + (0.3 + v * 0.62).toFixed(2) + ')';
          eq2d.lineWidth = 2.4;
          eq2d.beginPath();
          eq2d.moveTo(R + c * r0, R + sn * r0);
          eq2d.lineTo(R + c * (r0 + len), R + sn * (r0 + len));
          eq2d.stroke();
        }
        eq2d.shadowBlur = 0;
      }

      function frame(now) {
        viz.raf = requestAnimationFrame(frame);
        var au = ap.audio;
        if (!au || au.paused) return;
        var bars, low;
        if (viz.an && viz.actx && viz.actx.state === 'running') {
          viz.an.getByteFrequencyData(viz.data);
          bars = sampleBars(viz.data);
          low = (bars[0] + bars[1] + bars[2]) / 3;
        } else {
          // 合成节拍：约 92 BPM，kick 打点 + 慢速起伏，只在拿不到真实频谱时使用
          var t = now / 1000;
          var beat = 60 / 92;
          var kick = Math.exp(-((t % beat) / beat) * 6.5);
          var swell = 0.55 + 0.45 * Math.sin(t * 1.7);
          low = 0.2 + 0.5 * kick * swell;
          bars = [];
          for (var i = 0; i < EQ_N; i++) {
            bars.push(low * (0.4 + 0.6 * Math.abs(Math.sin(t * 2.1 + i * 0.72))));
          }
        }
        // 动态归一化：音乐各频段能量差异大，不归一化柱子几乎一样长，看不出律动
        var peak = 0;
        for (var pi = 0; pi < EQ_N; pi++) { if (bars[pi] > peak) peak = bars[pi]; }
        if (peak > 0.1) {
          for (var pj = 0; pj < EQ_N; pj++) {
            // 开方压缩动态范围：高频本来就弱，不抬一手环的两侧会空掉
            bars[pj] = Math.min(1, Math.pow(bars[pj] / peak, 0.72) * 0.94);
          }
        }
        // 平滑：上升快、回落慢，跳起来有弹性但不抖
        for (var s2 = 0; s2 < EQ_N; s2++) {
          var prev = viz.smooth[s2];
          var target = bars[s2];
          viz.smooth[s2] = target > prev ? prev + (target - prev) * 0.55 : prev + (target - prev) * 0.16;
        }
        drawEq(viz.smooth, Math.min(1, low * 1.25));
        // 圆盘随低频轻微脉动
        var beatScale = 1 + Math.min(0.045, low * 0.055);
        root.style.setProperty('--rj-beat', beatScale.toFixed(4));
      }

      function startViz() {
        if (viz.raf) return;
        initViz();
        if (viz.actx && viz.actx.state === 'suspended') {
          try { viz.actx.resume(); } catch (e) {}
        }
        viz.raf = requestAnimationFrame(frame);
      }
      function stopViz() {
        if (viz.raf) { cancelAnimationFrame(viz.raf); viz.raf = 0; }
        root.style.setProperty('--rj-beat', '1');
        // 等 0.45s 透明度淡出结束再清画布，否则环会"啪"地瞬间消失
        setTimeout(function () {
          if (viz.raf) return;   // 期间又播了就不清
          if (eq2d) {
            eq2d.setTransform(DPR, 0, 0, DPR, 0, 0);
            eq2d.clearRect(0, 0, VIZ, VIZ);
          }
          for (var i = 0; i < EQ_N; i++) viz.smooth[i] = 0;
        }, 460);
      }
      function syncViz() {
        var on = isCollapsed() && ap.audio && !ap.audio.paused;
        if (on) startViz(); else stopViz();
      }
      vizSync = syncViz;

      container.classList.add('rj-pl-collapsed'); // 默认折叠，和旧版首屏一致

      function fmt(t) {
        t = Math.max(0, Math.floor(t || 0));
        var m = Math.floor(t / 60), s = t % 60;
        return m + ':' + (s < 10 ? '0' + s : s);
      }
      // listswitch 在 ap.list.index 被赋值「之前」触发（APlayer 内部先 trigger 再改 index），
      // 所以必须优先用事件载荷里的 index，否则换歌后曲名/歌手会慢一首
      function syncMeta(idx) {
        var i = typeof idx === 'number' ? idx : ap.list.index;
        var a = (ap.list.audios && ap.list.audios[i]) || curAudio();
        elTitle.textContent = (a && a.name) || '未选择曲目';
        elArtist.textContent = (a && a.artist) || 'RockJesus Station';
        elTitle.title = elTitle.textContent;
      }
      function syncPlayIcon() {
        var paused = !ap.audio || ap.audio.paused;
        var d = paused ? P.play : P.pause;
        discBtn.innerHTML = svg(d);
        mainBtn.innerHTML = svg(d);
        root.classList.toggle('rj-pl-playing', !paused);
        syncViz();
      }
      function syncProgress() {
        var au = ap.audio;
        if (!au) return;
        var d = au.duration || 0;
        if (!d) { var a = curAudio(); d = (a && a.duration) || 0; }
        var p = d ? Math.min(1, au.currentTime / d) : 0;
        elFill.style.width = (p * 100).toFixed(2) + '%';
        elTime.textContent = fmt(au.currentTime) + ' / ' + fmt(d);
      }
      // 进度条：点击或拖拽都能定位
      var dragging = false;
      function seekTo(e) {
        var au = ap.audio; if (!au) return;
        var r = elBar.getBoundingClientRect();
        if (!r.width) return;
        var p = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
        var d = au.duration || 0;
        if (d) { try { au.currentTime = p * d; } catch (err) {} }
        elFill.style.width = (p * 100).toFixed(2) + '%';
      }
      elBar.addEventListener('pointerdown', function (e) {
        dragging = true; elBar.classList.add('rj-pl-drag'); seekTo(e);
        e.stopPropagation(); e.preventDefault();
      });
      window.addEventListener('pointermove', function (e) { if (dragging) seekTo(e); });
      window.addEventListener('pointerup', function () {
        if (dragging) { dragging = false; elBar.classList.remove('rj-pl-drag'); }
      });

      function on(ev, fn) { try { ap.on(ev, fn); } catch (e) {} }
      // 圆盘：单击播放/暂停，双击展开或折叠。
      // 单击延迟 230ms 执行，第二次点击到来时立刻撤销待执行的单击，避免双击误触发暂停
      disc.addEventListener('click', function (e) {
        e.stopPropagation();
        if (singleTimer) { clearTimeout(singleTimer); singleTimer = null; return; }
        singleTimer = setTimeout(function () {
          singleTimer = null;
          togglePlay();
        }, 230);
      });
      disc.addEventListener('dblclick', function (e) {
        e.stopPropagation(); e.preventDefault();
        if (singleTimer) { clearTimeout(singleTimer); singleTimer = null; }
        setCollapsed(!isCollapsed());
      });
      mainBtn.addEventListener('click', function (e) { e.stopPropagation(); togglePlay(); });
      root.querySelector('[data-a="prev"]').addEventListener('click', function (e) {
        e.stopPropagation();
        if (singleTimer) { clearTimeout(singleTimer); singleTimer = null; }
        rjSkip(-1);
      });
      root.querySelector('[data-a="next"]').addEventListener('click', function (e) {
        e.stopPropagation();
        if (singleTimer) { clearTimeout(singleTimer); singleTimer = null; }
        rjSkip(1);
      });
      var listBtn = root.querySelector('[data-a="list"]');
      listBtn.addEventListener('click', function (e) { e.stopPropagation(); toggleList(); });
      // 展开态卡片空白处：单击播放/暂停，双击开/关播放列表
      root.addEventListener('click', function (e) {
        if (isCollapsed() || isInteractive(e.target)) return;
        if (singleTimer) { clearTimeout(singleTimer); singleTimer = null; }
        singleTimer = setTimeout(function () { singleTimer = null; togglePlay(); }, 230);
      });
      root.addEventListener('dblclick', function (e) {
        if (isCollapsed() || isInteractive(e.target)) return;
        if (singleTimer) { clearTimeout(singleTimer); singleTimer = null; }
        toggleList();
      });
      // 点页面其它任何地方 → 自动折叠（用 pointerdown 捕获，菜单/皮肤点击也能立刻响应）
      document.addEventListener('pointerdown', function (e) {
        if (isCollapsed()) return;
        if (container.contains(e.target)) return;
        setCollapsed(true);
      }, true);

      on('listswitch', function (d) { syncMeta(d && d.index); });
      on('listswitch', function () { setTimeout(syncProgress, 60); });
      on('play', syncPlayIcon);
      on('pause', syncPlayIcon);
      on('ended', syncPlayIcon);
      on('loadedmetadata', syncProgress);
      if (ap.audio) ap.audio.addEventListener('timeupdate', syncProgress);
      // 歌单显隐 → 列表按钮保持高亮
      if (listEl && window.MutationObserver) {
        new MutationObserver(function () {
          root.classList.toggle('rj-pl-haslist', !listHidden());
        }).observe(listEl, { attributes: true, attributeFilter: ['style', 'class'] });
      }
      if (!root.style.getPropertyValue('--rj-pl-cover')) {
        root.style.setProperty('--rj-pl-cover', 'url("' + SEED.cover + '")');
      }
      // APlayer 会按容器宽度自动挂 .aplayer-narrow，原生窄态会隐藏歌单与信息；
      // 折叠改由 rj-pl-collapsed 控制，这里持续摘掉原生窄态类
      function stripNarrow() {
        if (container.classList.contains('aplayer-narrow')) {
          container.classList.remove('aplayer-narrow');
        }
        if (container.classList.contains('aplayer-mini')) {
          container.classList.remove('aplayer-mini');
        }
      }
      stripNarrow();
      if (window.MutationObserver) {
        new MutationObserver(stripNarrow).observe(container, { attributes: true, attributeFilter: ['class'] });
      }
      syncMeta(); syncPlayIcon(); syncProgress();
      setCollapsed(true);   // 首屏折叠：圆盘形态 + 收起播放列表
    })();
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
    // 提示条贴在播放器顶部上方，播放器展开歌单变高时跟着上移，避免压在歌单上
    var place = function () {
      var p = document.querySelector('.aplayer.aplayer-fixed');
      if (!p || !t.parentNode) return;
      var r = p.getBoundingClientRect();
      t.style.bottom = Math.round(window.innerHeight - r.top + 8) + 'px';
    };
    place();
    t.__rjPlace = place;
    if (window.ResizeObserver) {
      var ro = new ResizeObserver(place);
      var host = document.querySelector('.aplayer.aplayer-fixed');
      if (host) ro.observe(host);
      t.__rjRO = ro;
    }
    window.addEventListener('resize', place);
    setTimeout(place, 400);
    setTimeout(place, 1500);
  }
  function hideMutedTip() {
    var t = document.getElementById('rj-muted-tip');
    if (t) {
      if (t.__rjRO) { try { t.__rjRO.disconnect(); } catch (e) {} }
      if (t.__rjPlace) window.removeEventListener('resize', t.__rjPlace);
      if (t.parentNode) t.parentNode.removeChild(t);
    }
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

    // —— 律动前置：音频必须以匿名跨域方式加载 ——
    //    折叠态律动要接 Web Audio 读频谱，而不透明（无 CORS）资源接进 AudioContext
    //    会被浏览器强制静音。所以必须赶在 decorate（建壳）与首播之前设置；
    //    此时音频还没播，重新 load 一次不会打断任何播放。
    if (ap.audio) {
      try {
        if (!ap.audio.crossOrigin) ap.audio.crossOrigin = 'anonymous';
        if (ap.audio.src && ap.audio.paused) ap.audio.load();
      } catch (e) {}
    }

    decorate(ap, container, list);

    var saved = readState();
    var resumeTime = saved && typeof saved.time === 'number' ? Math.min(Math.max(saved.time, 0), 3600) : 0;

    // —— 打开：优先续播上次歌曲（同曲同进度、不切歌），否则随机挑一首；随后自动播放 ——
    //    续播 seek 必须「一次性 + 校验仍是同一首」：旧版把 seek 挂在 loadeddata 上，
    //    而 loadeddata 每次换歌都会再触发 → 听新歌会从旧歌的进度开始（"换歌不重头"）
    try {
      var bootIdx = -1;
      var savedIdx = (saved && typeof saved.idx === 'number') ? saved.idx : -1;
      if (savedIdx >= 0 && savedIdx < ap.list.audios.length && rjIsPlayable(ap, savedIdx)) {
        bootIdx = savedIdx;
      } else if (savedIdx >= 0 && savedIdx < ap.list.audios.length) {
        // 上次听的那首现在解析不出地址（版权/会员变动）→ 就近换一首能播的，不续进度
        bootIdx = rjFindPlayable(ap, savedIdx, 1);
        resumeTime = 0;
      }
      if (bootIdx < 0) bootIdx = rjRandomPlayable(ap);
      if (bootIdx >= 0) {
        var bootTrack = ap.list.audios[bootIdx];
        ap.list.switch(bootIdx);
        if (resumeTime > 3) {
          var resumeDone = false;
          ap.on('loadeddata', function () {
            if (resumeDone) return;
            if (!bootTrack || ap.list.audios[ap.list.index] !== bootTrack) return;
            resumeDone = true;
            try { ap.seek(resumeTime); } catch (e) {}
          });
        }
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
      // 记下这次"开声"点击：它已经让音乐开始播放，紧随其后的圆盘单击不能再 toggle
      // （否则首屏第一次点圆盘会「播一下立刻停」）
      container.__rjBootAt = Date.now();
      if (ap.audio && ap.audio.paused && ap.list.audios.length) {
        try { ap.play(); } catch (e) {}
      }
    }, true);

    // —— pjax 切换页面后若播放器被重建，用记忆状态自动续播 ——
    document.addEventListener('pjax:complete', function () {
      var c = document.getElementById('site-player');
      if (!c || c.querySelector('.aplayer-body')) return;
      var st = readState();
      var idx = st && typeof st.idx === 'number' && st.idx >= 0 && st.idx < list.length ? st.idx : -1;
      // 记忆里的曲目若已不可播，退到第一首能播的，别让 pjax 后重建出个空 src
      if (idx >= 0 && !list[idx].url) idx = -1;
      if (idx < 0) {
        for (var q = 0; q < list.length; q++) { if (list[q].url) { idx = q; break; } }
      }
      if (idx < 0 || !list[idx]) return;
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
      var pjTrack = list[idx];
      nap.list.switch(idx);
      if (st && st.time > 3) {
        // 同首播：续播只生效一次，换歌后一律从头播
        var pjDone = false;
        nap.on('loadeddata', function () {
          if (pjDone) return;
          if (!pjTrack || nap.list.audios[nap.list.index] !== pjTrack) return;
          pjDone = true;
          try { nap.seek(st.time); } catch (e) {}
        });
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
  // 面板定位：看板娘可见时，弹窗挂到她头顶上方（底边距头顶 10px），
  // 右边缘与看板娘右边缘对齐；高度按剩余空间收缩，保证顶部不出屏。
  // 看板娘不可见（移动端 / 加载失败）时清掉内联样式，回退 CSS 默认位置。
  function placePanel() {
    if (!rjPanel) return;
    var miku = document.getElementById('live2d-widget');
    var vw = window.innerWidth, vh = window.innerHeight;
    var r = miku && vw >= 768 ? miku.getBoundingClientRect() : null;
    if (!r || !r.width || !r.height) {
      rjPanel.style.bottom = rjPanel.style.right = rjPanel.style.height = rjPanel.style.maxHeight = '';
      return;
    }
    var bottom = Math.round(vh - r.top + 10);
    var h = Math.min(580, vh - bottom - 64);
    if (h < 420) {
      // 屏幕偏矮：头顶放不下一个可用的对话高度，改挂到看板娘左侧（底部让 80px），
      // 既不压住她，也保证面板本身有足够高度
      rjPanel.style.bottom = '80px';
      rjPanel.style.right = Math.round(vw - r.left + 12) + 'px';
      rjPanel.style.height = rjPanel.style.maxHeight = Math.min(580, vh - 96) + 'px';
      return;
    }
    rjPanel.style.bottom = bottom + 'px';
    rjPanel.style.right = Math.max(12, Math.round(vw - r.right)) + 'px';
    rjPanel.style.height = rjPanel.style.maxHeight = h + 'px';
  }
  window.addEventListener('resize', function () {
    if (rjPanel && rjPanel.classList.contains('rj-doubao-open')) placePanel();
  });
  function rjToggle(btn) {
    var open = rjPanel && rjPanel.classList.contains('rj-doubao-open');
    if (open) {
      closePanel();
    } else {
      buildPanel().classList.add('rj-doubao-open');
      placePanel();
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
    stats.innerHTML = '<div class="rj-globe-stats-title">🌍 访客分布</div><div class="rj-globe-stats-flags"></div>';
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

  // —— 导航徽标：外星人头像 × 额头苹果（实拍位图，透明背景）——
  //   源图黑底发光，抠图只留中间主体（黑银头骨 + 眼部高光 + 白苹果）；
  //   WebP 主用 23KB，PNG 仅在 WebP 解码失败时兜底，避免首屏开销
  var RJ_LOGO_WEBP = '/img/brand/alien-head.webp';
  var RJ_LOGO_PNG = '/img/brand/alien-head.png';
  function initLogo() {
    var host = document.getElementById('site-name');
    if (!host || host.querySelector('.rj-logo-wrap')) return;
    var wrap = document.createElement('span');
    wrap.className = 'rj-logo-wrap';
    var img = document.createElement('img');
    img.className = 'rj-logo-img';
    img.src = RJ_LOGO_WEBP;
    img.alt = '';
    img.setAttribute('aria-hidden', 'true');
    img.decoding = 'async';
    img.width = 376;
    img.height = 512;
    img.addEventListener('error', function () {
      if (img.getAttribute('data-fb')) return;
      img.setAttribute('data-fb', '1');
      img.src = RJ_LOGO_PNG;
    });
    wrap.appendChild(img);
    host.insertBefore(wrap, host.firstChild);
  }

  // —— 站点统计（Upstash 原子计数，替代失效的不蒜子 busuanzi）——
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
    ensurePagePv();
    var failed = function (id) { rjFill(id, '—'); };
    // 文章阅读量：按路径 +1（卡片内旧的本站访客数/总访问量已下线，仅保留地球分布）
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
          // 全量歌单里绝大多数曲目能播；万一整份都解析失败（vkey 全局过期）
          // 就退回种子曲，至少播放器不是死的
          var hasPlayable = list.some(function (t) { return t.url; });
          init(hasPlayable ? list : [SEED]);
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
