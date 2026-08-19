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

  /* —— 滤镜预设：仿 instax 化学显影（像素级调色，全浏览器一致）——
     主调色不再依赖 ctx.filter（iOS Safari / WebView 支持不完整），
     全部在 render.js 的 gradeImageData 中按像素计算。
     grade 字段（按官方成像参数）：
       exposure : 曝光补偿(+0.3~0.7EV) → 亮度乘子(如 .12 = ×1.12)
       contrast : 对比度(+15~25%)      → 中灰对比强化
       temp     : 色温(+400~800K 偏暖) → 正=暖(R↑B↓) / 负=冷
       sat      : 饱和度(-10~20% 褪色) → 负=去饱和
       hiWarm   : 亮部暖黄化学色偏
       loTeal   : 暗部青/蓝化学色偏
       lift     : 黑位抬升(褪色感)
     grain  : 颗粒强度(ISO800~1600 中等)；vignette : 暗角 */
  App.FILTERS = [
    /* 默认「经典」：还原真实拍立得/Instax 相纸质感
       黑位抬升(lift) + 暖白(hiWarm) + 中等对比 + 去饱和 + 软焦(soft)
       —— 对应即时胶片的扩散染料成像：lifted blacks / warm highlights /
        moderate contrast / muted colour / soft focus */
    { id: 'standard', name: '经典', grain: .18, vignette: .22, soft: .7,
      grade: { exposure: .07, contrast: .12, temp: .20, sat: -.10, hiWarm: .28, loTeal: 0, lift: .08 } },
    { id: 'vivid',    name: '鲜艳', grain: .14, vignette: .22,
      grade: { exposure: .12, contrast: .24, temp: .22, sat: .06, hiWarm: .28, loTeal: .24 } },
    { id: 'mono',     name: '单色', grain: .20, vignette: .26,
      grade: { exposure: .10, contrast: .28, temp: 0, sat: -1.0, hiWarm: .18, loTeal: .34 } },
    { id: 'faded',    name: '褪色', grain: .12, vignette: .15,
      grade: { exposure: .16, contrast: .08, temp: .20, sat: -.18, hiWarm: .40, loTeal: .18, lift: .14 } },
    { id: 'teal',     name: '青影', grain: .16, vignette: .22,
      grade: { exposure: .11, contrast: .18, temp: -.22, sat: -.10, hiWarm: .14, loTeal: .70 } },
    { id: 'warm',     name: '暖阳', grain: .15, vignette: .20,
      grade: { exposure: .13, contrast: .15, temp: .62, sat: -.05, hiWarm: .66, loTeal: .20 } }
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
