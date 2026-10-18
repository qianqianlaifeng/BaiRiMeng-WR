/* =========================================================
   BaiRiMeng-WR · 前端交互
   ========================================================= */
(function () {
  'use strict';

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  var LS = { credits: 'brm.credits', sign: 'brm.signin', assets: 'brm.assets', mine: 'brm.mine' };

  var state = {
    items: [], mine: [], assets: [],
    view: 'home',
    filters: { home: 'all', gallery: 'all' },
    mode: 'generate', ratio: '3:4', size: '2K', count: 1,
    ref: null, current: null, busy: false,
    credits: 630,
    signin: { last: '', streak: 0 },
    colsHome: null, heightsHome: null,
    colsGal: null, heightsGal: null
  };

  /* ---------------- 工具 ---------------- */
  function today() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function load(key, def) {
    try { var v = localStorage.getItem(key); return v ? JSON.parse(v) : def; } catch (e) { return def; }
  }
  function save(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) {}
  }

  function toast(msg, isErr) {
    var el = document.createElement('div');
    el.className = 'toast' + (isErr ? ' err' : '');
    el.textContent = msg;
    $('#toasts').appendChild(el);
    setTimeout(function () {
      el.style.transition = '.3s';
      el.style.opacity = '0';
      el.style.transform = 'translateY(6px)';
      setTimeout(function () { el.remove(); }, 320);
    }, 2600);
  }

  /* ---------------- 数据 ---------------- */
  function loadData() {
    if (window.GALLERY_DATA && window.GALLERY_DATA.length) return window.GALLERY_DATA;
    return [];
  }

  /* ---------------- 签到 ---------------- */
  function signinStatus() {
    var t = today();
    var signed = state.signin.last === t;
    var yesterday = (function () {
      var d = new Date(); d.setDate(d.getDate() - 1);
      return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    })();
    var streak = signed ? state.signin.streak : (state.signin.last === yesterday ? state.signin.streak + 1 : 1);
    var reward = 30 + Math.min(streak - 1, 6) * 10;
    return { signed: signed, streak: streak, reward: reward };
  }

  function doSignin() {
    var st = signinStatus();
    if (st.signed) { toast('今天已经签到过啦，明天再来'); return; }
    state.signin.last = today();
    state.signin.streak = st.streak;
    state.credits += st.reward;
    save(LS.sign, state.signin);
    save(LS.credits, state.credits);
    paintCredits();
    paintSignin();
    toast('签到成功 · 灵感值 +' + st.reward + '（连续 ' + st.streak + ' 天）');
  }

  function paintSignin() {
    var st = signinStatus();
    var btn = $('#signBtn');
    if (!btn) return;
    btn.disabled = st.signed;
    btn.innerHTML = st.signed
      ? '今日已签到 · 明日再来'
      : '立即签到 · +' + st.reward + ' 灵感值';
    $('#signState').textContent = st.signed
      ? '已连续签到 ' + st.streak + ' 天 · 明天继续'
      : '已连续 ' + Math.max(0, st.streak - 1) + ' 天 · 今天还没签';
    $('#streakInfo').textContent = st.signed ? '连续 ' + st.streak + ' 天' : '待签到';
    var dot = $('#navDot');
    if (dot) dot.style.display = st.signed ? 'none' : '';
  }

  function paintCredits() {
    $$('.credit').forEach(function (el) { el.innerHTML = '<i>◇</i>' + state.credits; });
    var big = $('#creditBig');
    if (big) big.textContent = state.credits;
    var me = $('#meCount');
    if (me) me.textContent = state.mine.length;
  }

  /* ---------------- 卡片 ---------------- */
  function cardEl(item, idx, opts) {
    opts = opts || {};
    var el = document.createElement('article');
    el.className = 'card';
    el.style.animationDelay = Math.min((idx || 0) * 26, 380) + 'ms';
    el.dataset.id = item.id || '';
    var safe = String(item.prompt || '').replace(/"/g, '&quot;');
    var badge = opts.badge ? '<span class="card-badge">' + opts.badge + '</span>' : '';
    var tools = opts.tools === false ? '' :
      '<div class="card-tools">' +
      '<button class="card-tool" data-act="edit" title="以此为参考图编辑"><svg viewBox="0 0 24 24"><path d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17v3Z"/><path d="M13.5 6.5 17 10"/></svg></button>' +
      '<button class="card-tool" data-act="open" title="查看提示词"><svg viewBox="0 0 24 24"><path d="M4 5.5h16v13H4z"/><path d="M8 10h8M8 14h5"/></svg></button>' +
      '</div>';
    el.innerHTML =
      '<img src="' + item.src + '" alt="' + (item.title || '作品') + '" loading="lazy" />' +
      badge + tools +
      '<div class="card-veil"><p class="card-prompt">' + safe + '</p>' +
      '<span class="card-cta">查看提示词</span></div>';

    el.addEventListener('click', function (e) {
      var act = e.target.closest ? e.target.closest('[data-act]') : null;
      if (act && act.getAttribute('data-act') === 'edit') {
        e.stopPropagation();
        startEdit(item, true);
        return;
      }
      openModal(item);
    });
    return el;
  }

  function colCount() {
    var w = window.innerWidth;
    return w > 1180 ? 3 : (w > 760 ? 2 : 1);
  }
  function estimateH(item, w) {
    var p = String(item.ratio || '3:4').split(':').map(Number);
    var rw = p[0] || 3, rh = p[1] || 4;
    return (w / rw) * rh + 18;
  }
  function buildMasonry(box, list, key, filterTag) {
    var shown = filterTag && filterTag !== 'all'
      ? list.filter(function (i) { return (i.tags || []).indexOf(filterTag) >= 0; })
      : list;
    box.innerHTML = '';
    var n = colCount();
    var cols = [], heights = [];
    for (var i = 0; i < n; i++) {
      var c = document.createElement('div');
      c.className = 'mcol';
      box.appendChild(c);
      cols.push(c);
      heights.push(0);
    }
    var colW = (box.clientWidth - (n - 1) * 18) / n;
    shown.forEach(function (it, i) {
      var k = heights.indexOf(Math.min.apply(null, heights));
      cols[k].appendChild(cardEl(it, i));
      heights[k] += estimateH(it, colW || 300);
    });
    state['cols' + key] = cols;
    state['heights' + key] = heights;
    return shown.length;
  }

  /* ---------------- 渲染 ---------------- */
  function render() {
    var n1 = buildMasonry($('#masonry'), state.items, 'Home', state.filters.home);
    var n2 = buildMasonry($('#masonry2'), state.items, 'Gal', state.filters.gallery);
    $('#galCount').textContent = n1 + ' 个作品 · 每张都附带提示词';
    $('#galCount2').textContent = n2 + ' 个作品 · 每张都附带提示词';

    // 我的创作
    var mine = $('#mine'), mine2 = $('#mine2');
    [mine, mine2].forEach(function (box) {
      if (!box) return;
      box.innerHTML = '';
      state.mine.forEach(function (it, i) {
        box.appendChild(cardEl(it, i, { badge: it.tags && it.tags[0] === '编辑' ? '编辑' : '新作', tools: true }));
      });
    });
    $('#mineCount').textContent = state.mine.length ? state.mine.length + ' 张作品' : '还没有作品';
    $('#createEmpty').style.display = state.mine.length ? 'none' : '';

    // 素材库
    var ab = $('#assets');
    if (ab) {
      ab.innerHTML = '';
      state.assets.forEach(function (it, i) {
        ab.appendChild(cardEl({ src: it.src, title: it.title || '参考图', prompt: it.prompt || '（上传的参考图）', tags: ['素材'], ratio: it.ratio || '3:4' }, i, { badge: '素材' }));
      });
      var empty = $('#assetsEmpty');
      if (empty) empty.style.display = state.assets.length ? 'none' : '';
    }
    // 流式加载到底后才显示「已经到底」，否则说明还有更多可拉取
    $$('.gal-foot').forEach(function (f) {
      f.style.display = (state.feedDone && state.items.length) ? '' : 'none';
    });
    paintCredits();
  }

  /* ---------------- 视图切换 ---------------- */
  function setView(name) {
    state.view = name;
    $$('.pane').forEach(function (p) {
      p.hidden = p.getAttribute('data-view') !== name;
    });
    $$('.nav-item').forEach(function (a) {
      a.classList.toggle('is-active', a.getAttribute('data-view') === name);
    });
    var hero = $('.hero');
    if (hero) hero.style.display = name === 'home' ? '' : 'none';
    if (name === 'me') { paintSignin(); paintCredits(); }
    try { history.replaceState(null, '', '#' + name); } catch (e) {}
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function bindViewLinks() {
    document.addEventListener('click', function (e) {
      var t = e.target.closest ? e.target.closest('[data-view]') : null;
      if (!t) return;
      e.preventDefault();
      setView(t.getAttribute('data-view'));
    });
  }

  /* ---------------- 筛选 ---------------- */
  function bindFilters() {
    $$('.gal-filters').forEach(function (group) {
      group.addEventListener('click', function (e) {
        var b = e.target.closest ? e.target.closest('.fchip') : null;
        if (!b) return;
        $$('.fchip', group).forEach(function (x) { x.classList.toggle('is-on', x === b); });
        var tag = b.getAttribute('data-tag');
        state.filters[group.id === 'filters2' ? 'gallery' : 'home'] = (tag && tag !== '全部') ? tag : 'all';
        render();
      });
    });
  }

  /* ---------------- 弹窗 ---------------- */
  function openModal(item) {
    state.current = item;
    $('#mImg').src = item.src;
    $('#mTitle').textContent = item.title || '未命名作品';
    $('#mTags').innerHTML = (item.tags || []).map(function (t) { return '<span>' + t + '</span>'; }).join('');
    $('#mPrompt').textContent = item.prompt || '';
    $('#mParams').innerHTML = [].concat(
      '比例 ' + (item.ratio || '—'),
      '清晰度 2K',
      '提示词完整可用'
    ).map(function (t) { return '<span>' + t + '</span>'; }).join('');
    $('#modal').hidden = false;
    document.body.style.overflow = 'hidden';
  }
  function closeModal() {
    $('#modal').hidden = true;
    document.body.style.overflow = '';
  }
  $$('[data-close]').forEach(function (b) { b.addEventListener('click', closeModal); });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { closeModal(); hidePops(); }
  });

  $('#copyBtn').addEventListener('click', function () {
    if (!state.current) return;
    var text = state.current.prompt || '';
    function fallback() {
      var ta = document.createElement('textarea');
      ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); toast('提示词已复制'); }
      catch (e) { toast('复制失败，请手动选择', true); }
      ta.remove();
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { toast('提示词已复制'); }, fallback);
    } else fallback();
  });

  $('#reuseBtn').addEventListener('click', function () {
    if (!state.current) return;
    $('#prompt').value = state.current.prompt || '';
    setMode('generate');
    closeModal();
    setView('home');
    setTimeout(function () { $('#prompt').focus(); }, 420);
    toast('提示词已填入，点右侧箭头生成');
  });

  $('#editBtn').addEventListener('click', function () {
    if (!state.current) return;
    var item = state.current;
    closeModal();
    startEdit(item, true);
  });

  /* ---------------- 编辑 ---------------- */
  function pushAsset(src, title, prompt) {
    if (!state.assets.some(function (a) { return a.src === src; })) {
      state.assets.unshift({ src: src, title: title || '参考图', prompt: prompt || '', ratio: '3:4' });
      save(LS.assets, state.assets);
    }
  }

  function startEdit(item, toAsset) {
    state.ref = { src: item.src, title: item.title, prompt: item.prompt };
    if (toAsset !== false) pushAsset(item.src, item.title, item.prompt);
    $('#refImg').src = item.src;
    $('#refbar').hidden = false;
    setMode('edit');
    $('#prompt').value = '';
    $('#prompt').placeholder = '描述你想怎么改：换背景、改光线、加元素、统一风格…';
    setView(state.view === 'home' ? 'home' : 'home');
    setTimeout(function () { $('#prompt').focus(); }, 420);
    toast('已载入参考图，说说想改哪里');
  }

  /* ---------------- 输入卡 ---------------- */
  function hidePops() { ['#modePop', '#ratioPop', '#sizePop'].forEach(function (s) { $(s).hidden = true; }); }
  function togglePop(sel, anchor) {
    var p = $(sel);
    var willShow = p.hidden;
    hidePops();
    if (!willShow) return;
    p.hidden = false;
    // 以 .composer 为参照（pop 的 offsetParent）定位，避免视口坐标错位
    var comp = $('.composer');
    var pr = p.getBoundingClientRect();
    var left = anchor.offsetLeft;
    var maxLeft = comp.clientWidth - pr.width - 12;
    left = Math.max(8, Math.min(left, Math.max(8, maxLeft)));
    p.style.left = left + 'px';
    p.style.bottom = (comp.clientHeight - anchor.offsetTop + 8) + 'px';
  }
  $('#modeChip').addEventListener('click', function (e) { e.stopPropagation(); togglePop('#modePop', e.currentTarget); });
  $('#ratioChip').addEventListener('click', function (e) { e.stopPropagation(); togglePop('#ratioPop', e.currentTarget); });
  $('#sizeChip').addEventListener('click', function (e) { e.stopPropagation(); togglePop('#sizePop', e.currentTarget); });
  document.addEventListener('click', function (e) {
    if (!e.target.closest('.pop') && !e.target.closest('.chip-select')) hidePops();
  });

  function setMode(m) {
    state.mode = m;
    $('#modeLabel').textContent = m === 'edit' ? '编辑' : '智能';
    $('#modeChip').querySelector('.dot').style.background = m === 'edit' ? '#ff5b7f' : '';
    if (m === 'generate') {
      $('#refbar').hidden = true;
      state.ref = null;
      $('#prompt').placeholder = '极简香水广告海报，一支磨砂玻璃方形香水瓶悬浮在浅米色石膏几何台面上，瓶身有细密水雾，侧逆光勾勒玻璃边缘，色调米白与浅杏色，杂志级商业摄影，画面无任何文字';
    }
  }

  $('#modePop').addEventListener('click', function (e) {
    var b = e.target.closest('button');
    if (!b) return;
    if (b.getAttribute('data-mode') === 'edit' && !state.ref) {
      hidePops();
      $('#fileInput').click();
      return;
    }
    setMode(b.getAttribute('data-mode'));
    hidePops();
  });
  $('#ratioPop').addEventListener('click', function (e) {
    var b = e.target.closest('button');
    if (!b) return;
    state.ratio = b.getAttribute('data-ratio');
    $('#ratioLabel').textContent = state.ratio;
    hidePops();
  });
  $('#sizePop').addEventListener('click', function (e) {
    var b = e.target.closest('button');
    if (!b) return;
    var v = b.getAttribute('data-size');
    state.size = v.indexOf('2K') === 0 ? '2K' : '1K';
    state.count = v.indexOf('x2') > 0 ? 2 : 1;
    $('#sizeLabel').textContent = state.size + ' · ' + state.count + '张';
    hidePops();
  });

  $('#uploadBtn').addEventListener('click', function () { $('#fileInput').click(); });
  var assetsUploadBtn = $('#assetsUploadBtn');
  if (assetsUploadBtn) assetsUploadBtn.addEventListener('click', function () { $('#fileInput').click(); });

  $('#fileInput').addEventListener('change', function (e) {
    var f = e.target.files && e.target.files[0];
    if (!f) return;
    var rd = new FileReader();
    rd.onload = function () {
      state.ref = { src: rd.result, title: f.name, prompt: '' };
      pushAsset(rd.result, f.name, '');
      $('#refImg').src = rd.result;
      $('#refbar').hidden = false;
      setMode('edit');
      render();
      setView('home');
      toast('参考图已就绪，描述想改的地方');
      $('#prompt').focus();
    };
    rd.readAsDataURL(f);
    e.target.value = '';
  });

  $('#refDel').addEventListener('click', function () {
    state.ref = null;
    $('#refbar').hidden = true;
    setMode('generate');
  });

  $('#prompt').addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
  });
  $('#submitBtn').addEventListener('click', submit);

  /* ---------------- 生成 ---------------- */
  function addLoadingCard(ratio) {
    var el = document.createElement('article');
    el.className = 'card is-loading';
    el.style.aspectRatio = ratio.replace(':', '/');
    el.innerHTML = '<div class="skel" style="position:absolute;inset:0"><div class="skel-inner">正在绘制…</div></div>';
    return el;
  }

  function submit() {
    if (state.busy) return;
    var prompt = $('#prompt').value.trim();
    if (!prompt) { toast('先写点提示词吧', true); $('#prompt').focus(); return; }
    if (state.mode === 'edit' && !state.ref) { toast('编辑模式需要先选一张参考图', true); return; }

    state.busy = true;
    var btn = $('#submitBtn');
    btn.classList.add('is-busy');
    btn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M12 3.5v4M12 16.5v4M3.5 12h4M16.5 12h4"/></svg>';

    var card = addLoadingCard(state.ratio);
    var drop = function (box) {
      if (!box) return;
      var cols = $$('.mcol', box);
      if (!cols.length) { box.appendChild(card); return; }
      var best = cols[0];
      cols.forEach(function (c) { if (c.offsetHeight < best.offsetHeight) best = c; });
      best.insertBefore(card, best.firstChild);
    };
    drop($('#mine')); drop($('#mine2'));
    var resetBtn = function () {
      state.busy = false;
      btn.classList.remove('is-busy');
      btn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M12 19V6M6.5 11.5 12 6l5.5 5.5"/></svg>';
    };

    fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: prompt, ratio: state.ratio, size: state.size, count: state.count,
        refs: state.mode === 'edit' && state.ref ? [state.ref.src] : []
      })
    }).then(function (r) { return r.json(); }).then(function (data) {
      card.remove();
      if (!data.ok) throw new Error(data.error || '生成失败');
      (data.items || []).forEach(function (it) {
        var item = {
          id: it.id || ('gen-' + Date.now()),
          title: it.title || (state.mode === 'edit' ? '新编辑作品' : '新生成作品'),
          tags: it.tags || [state.mode === 'edit' ? '编辑' : '新作'],
          ratio: it.ratio || state.ratio,
          prompt: it.prompt || prompt,
          src: it.src
        };
        state.mine.unshift(item);
        save(LS.mine, state.mine);
      });
      render();
      setView('create');
      toast(state.mode === 'edit' ? '编辑完成，已收进「我的创作」' : '生成完成，已收进「我的创作」');
    }).catch(function (err) {
      card.remove();
      var msg = String((err && err.message) || err);
      if (msg.indexOf('Failed to fetch') >= 0 || msg.indexOf('NetworkError') >= 0) {
        toast('未连接本地服务：请先运行 python server.py', true);
      } else {
        toast(msg.slice(0, 60), true);
      }
    }).then(resetBtn, resetBtn);
  }

  /* 横幅左右切换箭头已移除 */

  /* ---------------- 侧栏收起 ---------------- */
  (function rail() {
    var t = $('#railToggle');
    if (!t) return;
    t.addEventListener('click', function () {
      document.body.classList.toggle('rail-min');
      t.classList.toggle('is-min');
    });
  })();


  /* ---------------- 实时灵感库（公开图库接口 · 分页 + 滚动无限加载） ---------------- */
  state.feedOffset = 0;
  state.feedLoading = false;
  state.feedDone = false;
  state.feedTotal = 0;
  var FEED_PAGE = 20;

  function loadMoreFeed(btn) {
    if (state.feedLoading || state.feedDone) return Promise.resolve();
    state.feedLoading = true;
    if (btn) { btn.textContent = '加载中…'; }
    return fetch('/api/feed?offset=' + state.feedOffset + '&limit=' + FEED_PAGE, { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d.ok) throw new Error(d.error || '失败');
        var items = d.items || [];
        if (d.total) state.feedTotal = d.total;
        if (items.length) {
          var seen = {};
          state.items.forEach(function (i) { seen[i.src] = 1; });
          var fresh = items.filter(function (i) { return !seen[i.src]; });
          state.items = state.items.concat(fresh);
          state.feedOffset += FEED_PAGE;
        }
        if (items.length < FEED_PAGE) state.feedDone = true;
        if (state.feedTotal && state.feedOffset >= state.feedTotal) state.feedDone = true;
        render();
      })
      .catch(function () {
        state.feedDone = true;   // 未连接本地服务 / file:// → 停止拉取，保留内置灵感库
        render();
      })
      .then(function () {
        state.feedLoading = false;
        if (btn) { btn.textContent = '换一批灵感'; }
      });
  }

  /* 启动时连续加载，直到有 ~240 个实时作品或被服务端判定到底 */
  (function bootstrapFeed() {
    function step() {
      if (state.feedDone || state.items.length >= 240) return;
      return loadMoreFeed().then(step);
    }
    step();
  })();

  /* 滚动到底自动加载下一页（仅本地服务在线时有效） */
  (function infiniteScroll() {
    var ticking = false;
    window.addEventListener('scroll', function () {
      if (ticking) return;
      ticking = setTimeout(function () {
        ticking = false;
        var near = (window.innerHeight + window.pageYOffset) >= (document.body.scrollHeight - 600);
        if (near && (state.view === 'home' || state.view === 'gallery')) loadMoreFeed();
      }, 120);
    }, { passive: true });
  })();

  /* ---------------- 启动 ---------------- */
  (function init() {
    state.items = loadData();
    state.mine = load(LS.mine, []);
    state.assets = load(LS.assets, []);
    state.credits = load(LS.credits, 630);
    state.signin = load(LS.sign, { last: '', streak: 0 });

    render();
    bindFilters();
    bindViewLinks();
    paintCredits();
    paintSignin();

    ['#feedBtn', '#feedBtn2'].forEach(function (id) {
      var b = $(id);
      if (b) b.addEventListener('click', function () { loadMoreFeed(b); });
    });

    var signBtn = $('#signBtn');
    if (signBtn) signBtn.addEventListener('click', doSignin);

    // 顶部「立即签到」：跳到「我的」并高亮签到卡
    var topSign = $('#topSign');
    if (topSign) topSign.addEventListener('click', function () {
      setView('me');
      setTimeout(function () {
        var s = $('.signin');
        if (!s) return;
        s.scrollIntoView({ behavior: 'smooth', block: 'center' });
        s.style.transition = 'box-shadow .3s';
        s.style.boxShadow = '0 0 0 3px #cbb8ff';
        setTimeout(function () { s.style.boxShadow = ''; }, 1300);
      }, 460);
    });
    var toCompose = $('#toCompose');
    if (toCompose) toCompose.addEventListener('click', function () { setView('home'); setTimeout(function () { $('#prompt').focus(); }, 420); });

    var h = (location.hash || '').replace('#', '');
    if (['home', 'gallery', 'create', 'assets', 'me'].indexOf(h) >= 0) setView(h);

    var st = signinStatus();
    if (!st.signed) {
      setTimeout(function () { toast('今日还没签到 · 去「我的」领 ' + st.reward + ' 灵感值'); }, 900);
    }
    var rz;
    window.addEventListener('resize', function () {
      clearTimeout(rz);
      rz = setTimeout(render, 200);
    });
  })();
})();
