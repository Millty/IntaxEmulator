/* ============================================================
   render.js — Canvas 渲染管线（滤镜 / 颗粒 / 暗角 / 覆盖裁剪）
   拍立得模拟器 · 阶段三 Round 2
   原则：预览即导出（同一套绘制，导出仅放大倍率）
   ============================================================ */
window.App = window.App || {};
(function (App) {
  'use strict';

  /* 预生成噪点纹理（一次生成，平铺复用） */
  let _noise;
  App.getNoise = function () {
    if (_noise) return _noise;
    const s = 128;
    const c = document.createElement('canvas');
    c.width = s; c.height = s;
    const x = c.getContext('2d');
    const img = x.createImageData(s, s);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = 200 + Math.random() * 55;        // 浅灰噪点
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = Math.random() * 38;       // 低 alpha
    }
    x.putImageData(img, 0, 0);
    _noise = c;
    return c;
  };

  /* 把照片绘制进 canvas：cover 适配 + 用户平移(dx,dy) + 滤镜 + 颗粒 + 暗角
     返回校正后的 {dx, dy}（已按 cover 余量夹紧，避免露白边） */
  App.drawPhoto = function (canvas, img, dx, dy, filterDef, intensity) {
    const ctx = canvas.getContext('2d');
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const W = Math.max(1, Math.round(rect.width * dpr));
    const H = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width !== W) canvas.width = W;
    if (canvas.height !== H) canvas.height = H;
    ctx.clearRect(0, 0, W, H);

    if (!img || !img.complete || !img.naturalWidth) return { dx: dx || 0, dy: dy || 0 };

    intensity = intensity == null ? 1 : intensity;
    const scale = Math.max(W / img.naturalWidth, H / img.naturalHeight); // cover
    const dw = img.naturalWidth * scale, dh = img.naturalHeight * scale;
    const baseX = (W - dw) / 2, baseY = (H - dh) / 2;
    const maxX = (dw - W) / 2, maxY = (dh - H) / 2;
    dx = Math.max(-maxX, Math.min(maxX, dx || 0));
    dy = Math.max(-maxY, Math.min(maxY, dy || 0));

    // 滤镜层
    ctx.save();
    if (filterDef && filterDef.filter) ctx.filter = filterDef.filter;
    ctx.drawImage(img, baseX + dx, baseY + dy, dw, dh);
    ctx.restore();

    // 滤镜强度 < 1：叠加未滤镜原图降低强度
    if (intensity < 1) {
      ctx.save();
      ctx.globalAlpha = 1 - intensity;
      ctx.drawImage(img, baseX + dx, baseY + dy, dw, dh);
      ctx.restore();
    }

    // 胶片颗粒
    if (filterDef && filterDef.grain) {
      const n = App.getNoise();
      const pat = ctx.createPattern(n, 'repeat');
      ctx.save();
      ctx.globalAlpha = filterDef.grain * intensity;
      ctx.globalCompositeOperation = 'overlay';
      ctx.fillStyle = pat;
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }

    // 暗角
    if (filterDef && filterDef.vignette) {
      const vg = filterDef.vignette * intensity;
      const g = ctx.createRadialGradient(
        W / 2, H / 2, Math.min(W, H) * 0.35,
        W / 2, H / 2, Math.max(W, H) * 0.72
      );
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, 'rgba(0,0,0,' + vg.toFixed(3) + ')');
      ctx.save();
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }
    return { dx, dy };
  };

})(window.App);
