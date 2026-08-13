/* ============================================================
   core.js — 全局状态 / 相纸规格 / 滤镜预设（数据层）
   拍立得模拟器 · 阶段三 Round 1
   ============================================================ */
window.App = window.App || {};
(function (App) {
  'use strict';

  /* —— 相纸规格：真实 instax 毫米比例 ——
     borders: 上 / 左右 / 下 白边（mm） */
  App.PAPER_SPECS = {
    // mini 调整为真实 instax mini 比例：成像区 46×62mm，下留白 18mm（参考实拍图）
    mini: { name: 'mini 系列', w: 54,  h: 86, borders: { top: 6,   side: 4,   bottom: 18 } },
    sq:   { name: 'sq 系列',   w: 72,  h: 86, borders: { top: 5,   side: 5,   bottom: 19 } },
    wide: { name: 'wide 系列', w: 108, h: 86, borders: { top: 2,   side: 4.5, bottom: 22 } }
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

  /* —— 滤镜预设：instax / 富士感（参数化，供 Canvas 管线复用）——
     filter: ctx.filter 字符串；grain 颗粒强度 0~1；vignette 暗角 0~1 */
  App.FILTERS = [
    { id: 'standard', name: '标准', filter: 'sepia(.22) saturate(1.14) contrast(1.10) brightness(1.02)', grain: .09, vignette: .18 },
    { id: 'vivid',    name: '鲜艳', filter: 'saturate(1.45) contrast(1.20) brightness(1.03)',            grain: .08, vignette: .20 },
    { id: 'mono',     name: '单色', filter: 'grayscale(1) contrast(1.28) brightness(1.03)',              grain: .12, vignette: .22 },
    { id: 'faded',    name: '褪色', filter: 'sepia(.14) saturate(.78) contrast(.90) brightness(1.10)',  grain: .07, vignette: .15 },
    { id: 'teal',     name: '青影', filter: 'sepia(.18) hue-rotate(-22deg) saturate(1.10) contrast(1.08)', grain: .09, vignette: .20 },
    { id: 'warm',     name: '暖阳', filter: 'sepia(.38) saturate(1.20) contrast(1.06) brightness(1.04)', grain: .08, vignette: .18 }
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
