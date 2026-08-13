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

  /* —— ③ 编辑（占位） —— */
  App.registerScreen('editor', function () {
    const m = $('#editorMeta');
    if (m) m.textContent =
      `相纸：${App.PAPER_SPECS[App.state.type].name} · ${App.state.mode} 张`;
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
