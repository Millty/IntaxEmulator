/* ============================================================
   core.js — 全局状态 / 相纸规格 / 滤镜预设（数据层）
   拍立得模拟器 · 阶段三 Round 1
   ============================================================ */
window.App = window.App || {};
(function (App) {
  'use strict';

  /* —— 相纸规格：真实 instax 毫米比例 ——
     borders: 上 / 左右 / 下 白边（mm）
     Mini 成像 46×62（下白边约 25%）；Square 成像 62×62（四周对称）；Wide 官方 108×86 / 成像 99×62 */
  App.PAPER_SPECS = {
    mini: { name: 'mini 系列', w: 54,  h: 86, borders: { top: 2.5, side: 4,   bottom: 21.5 } },
    sq:   { name: 'sq 系列',   w: 72,  h: 86, borders: { top: 12,  side: 5,   bottom: 12 } },
    wide: { name: 'wide 系列', w: 108, h: 86, borders: { top: 4,   side: 4.5, bottom: 20 } }
  };

  /* 计算成像区相对整张相纸的归一化比例 {x,y,w,h}（0~1） */
  App.imageAreaRatio = function (type) {
    const s = App.PAPER_SPECS[type];
    const b = s.borders;
    return {
      x: b.side / s.w,
      y: b.top / s.h,
      w: (s.w - b.side * 2) / s.w,
      h: (s.h - b.top - b.bottom) / s.h
    };
  };

  /* —— 滤镜预设：仿 instax 化学显影（参数化，供 Canvas 管线复用）——
     filter : ctx.filter 字符串（曝光/对比/色温/饱和，现代浏览器生效）
     tint   : 化学色偏叠加 {hi:亮部色, lo:暗部色, amt}（soft-light 混合，全浏览器生效，保证滤镜可辨）
     grain  : 颗粒强度(ISO800~1600 中等)；vignette : 暗角 */
  App.FILTERS = [
    { id: 'standard', name: '标准', filter: 'sepia(.30) saturate(.88) contrast(1.20) brightness(1.12)',
      tint: { hi: '#ffd9a0', lo: '#41607f', amt: .22 }, grain: .16, vignette: .20 },
    { id: 'vivid',    name: '鲜艳', filter: 'saturate(1.18) contrast(1.28) brightness(1.08)',
      tint: { hi: '#ffcf8f', lo: '#2e4a66', amt: .18 }, grain: .14, vignette: .22 },
    { id: 'mono',     name: '单色', filter: 'grayscale(1) contrast(1.35) brightness(1.06)',
      tint: null, grain: .20, vignette: .26 },
    { id: 'faded',    name: '褪色', filter: 'sepia(.12) saturate(.72) contrast(.92) brightness(1.16)',
      tint: { hi: '#fff0d0', lo: '#9fb6c4', amt: .12 }, grain: .12, vignette: .15 },
    { id: 'teal',     name: '青影', filter: 'sepia(.20) hue-rotate(-16deg) saturate(.95) contrast(1.16) brightness(1.10)',
      tint: { hi: '#bfeae0', lo: '#1f4a5a', amt: .24 }, grain: .16, vignette: .22 },
    { id: 'warm',     name: '暖阳', filter: 'sepia(.42) saturate(1.10) contrast(1.14) brightness(1.14)',
      tint: { hi: '#ffcf8a', lo: '#6a4a5a', amt: .30 }, grain: .15, vignette: .20 }
  ];

  App.getFilter = function (id) {
    return App.FILTERS.find(f => f.id === id) || App.FILTERS[0];
  };

  /* —— 全局工程状态 —— */
  App.state = {
    type: 'sq',        // 'mini' | 'sq' | 'wide'
    mode: 1,           // 1 | 4 | 9（仅 sq 可用；mini/wide 恒为 1）
    photos: [],        // dataURL 列表（长度 = mode）
    filterId: 'standard',
    filterIntensity: 1 // 0~1 滤镜浓度
  };

  App.resetPhotos = function () {
    App.state.photos = new Array(App.state.mode).fill(null);
  };

  /* —— 导出 / 动画参数 —— */
  App.EXPORT    = { scale: 3, format: 'png' };   // 长按保存默认 3x
  App.EJECT_MS  = 5000;   // 出纸上滑时长（匀速）
  App.DEV_MS    = 5000;   // 显影渐显时长

  /* sq 可用模式 */
  App.MODES = [1, 4, 9];

})(window.App);
