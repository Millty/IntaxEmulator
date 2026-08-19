/* ============================================================
   ui.js — DOM 助手 / 屏幕路由（iOS 推送转场）/ 状态栏时钟
   拍立得模拟器 · 阶段三 Round 1
   ============================================================ */
window.App = window.App || {};
(function (App) {
  'use strict';

  /* —— DOM 助手 —— */
  App.$  = (sel, root) => (root || document).querySelector(sel);
  App.$$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  App.el = function (tag, cls, html) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  };

  /* —— 屏幕路由（栈式 push / pop，iOS 推送缓动） —— */
  App.screens = {};
  App.stack = [];
  App._z = 10;

  App.registerScreen = function (id, show) {
    App.screens[id] = { id, show: show || function () {} };
  };

  /* 前进：新屏幕从右侧滑入，原屏幕留在底层 */
  App.go = function (id, opts) {
    const scr = document.getElementById('screen-' + id);
    if (!scr) return;
    if (App.stack[App.stack.length - 1] === id) return;
    App.stack.push(id);
    scr.style.zIndex = ++App._z;
    scr.classList.add('from-right');
    void scr.offsetWidth;                 // 强制回流，确保起始态生效
    requestAnimationFrame(() => {
      scr.classList.add('active');
      scr.classList.remove('from-right');
    });
    if (App.screens[id]) App.screens[id].show(opts);
  };

  /* 返回：当前屏幕向右滑出，露出底层屏幕 */
  App.back = function () {
    if (App.stack.length <= 1) return;
    const curId = App.stack.pop();
    const cur = document.getElementById('screen-' + curId);
    if (cur) cur.classList.remove('active');   // -> translateX(100%) 滑出
    const prevId = App.stack[App.stack.length - 1];
    const prev = document.getElementById('screen-' + prevId);
    if (prev) {
      prev.style.zIndex = ++App._z;
      prev.classList.add('active');
      if (App.screens[prevId]) App.screens[prevId].show();
    }
  };

  /* —— 状态栏时钟 —— */
  App.updateClock = function () {
    const t = App.$('#sbTime');
    if (!t) return;
    const d = new Date();
    let h = d.getHours();
    const m = String(d.getMinutes()).padStart(2, '0');
    t.textContent = h + ':' + m;
  };

})(window.App);
