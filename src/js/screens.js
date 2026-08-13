/* ============================================================
   screens.js — 各屏幕逻辑与启动
   拍立得模拟器 · 阶段三 Round 1
   本轮回合：① 主页 / ② 选相纸 已完整实现；
            ③ 编辑 / ④ 显影 / ⑤ 成片 为占位，下轮实现。
   ============================================================ */
(function (App) {
  'use strict';
  const { $, $$, el } = App;

  /* —— ① 主页 —— */
  App.registerScreen('home', function () {});
  $('#btnAdd').addEventListener('click', () => App.go('select'));

  /* —— ② 选相纸 —— */
  App.registerScreen('select', function () { syncSelectUI(); });

  function syncSelectUI() {
    // 相纸类型高亮
    $$('#typeCards .type-card').forEach(c => {
      c.classList.toggle('sel', c.dataset.type === App.state.type);
    });
    // sq 才显示 1/4/9
    const isSq = App.state.type === 'sq';
    $('#modeField').hidden = !isSq;
    if (!isSq) App.state.mode = 1;
    // 分段控件滑动指示
    const seg = $('#modeSeg');
    const idx = App.MODES.indexOf(App.state.mode);
    seg.style.setProperty('--seg', idx < 0 ? 0 : idx);
    $$('#modeSeg button').forEach(b => {
      b.classList.toggle('sel', +b.dataset.mode === App.state.mode);
    });
  }

  $$('#typeCards .type-card').forEach(c => {
    c.addEventListener('click', () => { App.state.type = c.dataset.type; syncSelectUI(); });
  });
  $$('#modeSeg button').forEach(b => {
    b.addEventListener('click', () => { App.state.mode = +b.dataset.mode; syncSelectUI(); });
  });

  $('#btnNext').addEventListener('click', () => {
    App.resetPhotos();
    App.go('editor');
  });

  /* —— ③ 编辑：上传 + 居中相纸 + 每格拖拽取景 + 滤镜实时预览 —— */
  const PLUS_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>';

  App.registerScreen('editor', function () { buildEditor(); });

  function buildEditor() {
    const paper = $('#editorPaper');
    paper.className = 'editor-paper ' + App.state.type;

    // 成像区按真实比例定位
    const r = App.imageAreaRatio(App.state.type);
    const img = $('#editorImage');
    img.style.left = (r.x * 100) + '%';
    img.style.top  = (r.y * 100) + '%';
    img.style.width  = (r.w * 100) + '%';
    img.style.height = (r.h * 100) + '%';

    // 网格（1 / 4 / 9）
    const grid = $('#cellGrid');
    grid.className = 'ecell-grid g' + App.state.mode;
    grid.innerHTML = '';
    const n = App.state.mode;
    for (let i = 0; i < n; i++) {
      const cell = App.el('div', 'ecell');
      const canvas = App.el('canvas', 'ecanvas');
      const empty = App.el('div', 'ecell-empty', PLUS_SVG);
      cell.append(canvas, empty);
      cell.addEventListener('click', () => { if (!hasPhoto(i)) openPicker(i); });
      attachDrag(cell, i);
      grid.appendChild(cell);
      renderCell(i);
    }
    buildFilterBar();
    updateHint();
  }

  function updateHint() {
    const hint = $('#editorHint');
    if (!hint) return;
    if (App.state.mode === 1) {
      const filled = hasPhoto(0);
      hint.textContent = filled ? '可拖拽调整取景' : '点击相纸中央选择照片';
      return;
    }
    const empty = App.state.photos.filter(p => !(p && p.img)).length;
    if (empty === 0) hint.textContent = '已选满 ' + App.state.mode + ' 张 · 点格子可替换';
    else hint.textContent = '点击每个空白格子上传照片（还需 ' + empty + ' 张）';
  }

  function hasPhoto(i) {
    const p = App.state.photos[i];
    return !!(p && p.img);
  }

  function renderCell(i) {
    const grid = $('#cellGrid');
    const cell = grid.children[i];
    if (!cell) return;
    const canvas = cell.querySelector('canvas');
    const empty = cell.querySelector('.ecell-empty');
    const p = App.state.photos[i];
    if (p && p.img) {
      empty.style.display = 'none';
      const fd = App.getFilter(App.state.filterId);
      const res = App.drawPhoto(canvas, p.img, p.dx, p.dy, fd, App.state.filterIntensity);
      p.dx = res.dx; p.dy = res.dy;
    } else {
      empty.style.display = 'grid';
      const ctx = canvas.getContext('2d');
      if (canvas.width) ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
  }

  /* 拖拽取景：平移夹紧在 cover 余量内，不露白边 */
  function attachDrag(cell, i) {
    let sx, sy, bdx, bdy;
    cell.addEventListener('pointerdown', (e) => {
      const p = App.state.photos[i];
      if (!p || !p.img) return;
      sx = e.clientX; sy = e.clientY; bdx = p.dx || 0; bdy = p.dy || 0;
      cell.setPointerCapture(e.pointerId);
    });
    cell.addEventListener('pointermove', (e) => {
      const p = App.state.photos[i];
      if (!p || !p.img) return;
      const dpr = window.devicePixelRatio || 1;
      p.dx = bdx + (e.clientX - sx) * dpr;
      p.dy = bdy + (e.clientY - sy) * dpr;
      renderCell(i);
    });
    cell.addEventListener('pointerup', (e) => {
      try { cell.releasePointerCapture(e.pointerId); } catch (_) {}
    });
  }

  /* 文件选择：单次选 1 张，落到指定格子（每格独立，不依赖 multiple） */
  function openPicker(i) {
    const inp = $('#fileInput');
    inp.multiple = false;          // 移动端多选不可靠，统一单次选，按格点击
    inp.value = '';
    inp.onchange = () => {
      const f = inp.files && inp.files[0];
      if (f) loadFile(f, i);
    };
    inp.click();
  }

  function loadFile(file, idx) {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        App.state.photos[idx] = { src: reader.result, img, dx: 0, dy: 0 };
        renderCell(idx);
        updateHint();
        if (App.stack[App.stack.length - 1] === 'editor') refreshThumbs();
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  }

  /* 取第一张已上传照片作为滤镜缩略图源；无则用样本图 */
  function firstPhotoImg() {
    for (let i = 0; i < App.state.photos.length; i++) {
      const p = App.state.photos[i];
      if (p && p.img) return p.img;
    }
    return null;
  }

  let _filterThumbs = [];   // 记录每款滤镜的缩略图 canvas，便于上传后刷新

  function buildFilterBar() {
    const bar = $('#filterBar');
    bar.innerHTML = '';
    _filterThumbs = [];
    App.FILTERS.forEach((f) => {
      const b = App.el('button', 'fpill' + (f.id === App.state.filterId ? ' sel' : ''));
      const thumb = App.el('span', 'fpill-thumb');
      const cv = document.createElement('canvas');
      cv.width = 108; cv.height = 108;          // 2x 清晰度
      thumb.appendChild(cv);
      const name = App.el('span', 'fpill-name', f.name);
      b.append(thumb, name);
      b.addEventListener('click', () => {
        App.state.filterId = f.id;
        $$('#filterBar .fpill').forEach((x) => x.classList.remove('sel'));
        b.classList.add('sel');
        for (let i = 0; i < App.state.mode; i++) renderCell(i);
      });
      bar.appendChild(b);
      _filterThumbs.push({ canvas: cv, def: f });
    });
    refreshThumbs();
  }

  /* 重新绘制滤镜缩略图（上传照片后调用，让预览用真实照片） */
  function refreshThumbs() {
    const src = firstPhotoImg() || App.getSample();
    _filterThumbs.forEach((t) => App.drawFilterThumb(t.canvas, src, t.def, 1));
  }

  $('#btnConfirm').addEventListener('click', () => App.go('develop'));

  // 视口变化时重绘当前编辑格（保持清晰度）
  let _rzTimer;
  window.addEventListener('resize', () => {
    clearTimeout(_rzTimer);
    _rzTimer = setTimeout(() => {
      if (App.stack[App.stack.length - 1] === 'editor') {
        for (let i = 0; i < App.state.mode; i++) renderCell(i);
      }
    }, 120);
  });

  /* —— ④ 显影 / ⑤ 成片（占位） —— */
  App.registerScreen('develop', function () {});
  App.registerScreen('result', function () {});

  /* —— 全局返回按钮 —— */
  $$('[data-back]').forEach(b => b.addEventListener('click', () => App.back()));

  /* —— 启动 —— */
  App.updateClock();
  setInterval(App.updateClock, 15000);
  App.stack = ['home'];   // 初始栈底

})(window.App);
