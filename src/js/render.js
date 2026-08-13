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

  /* 缩略图绘制：把 source(用户照片 或 样本图) 以某滤镜画进小 canvas（供滤镜选择条预览） */
  App.drawFilterThumb = function (canvas, source, filterDef, intensity) {
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    if (!source) return;
    const sw = source.naturalWidth || source.width;
    const sh = source.naturalHeight || source.height;
    if (!sw || !sh) return;
    const scale = Math.max(W / sw, H / sh);           // cover
    const dw = sw * scale, dh = sh * scale;
    const dx = (W - dw) / 2, dy = (H - dh) / 2;
    intensity = intensity == null ? 1 : intensity;

    ctx.save();
    if (filterDef && filterDef.filter) ctx.filter = filterDef.filter;
    ctx.drawImage(source, dx, dy, dw, dh);
    ctx.restore();
    if (intensity < 1) {
      ctx.save();
      ctx.globalAlpha = 1 - intensity;
      ctx.drawImage(source, dx, dy, dw, dh);
      ctx.restore();
    }
    if (filterDef && filterDef.grain) {
      const n = App.getNoise();
      const pat = ctx.createPattern(n, 'repeat');
      ctx.save();
      ctx.globalAlpha = filterDef.grain * intensity;
      ctx.globalCompositeOperation = 'overlay';
      ctx.fillStyle = pat; ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }
    if (filterDef && filterDef.vignette) {
      const vg = filterDef.vignette * intensity;
      const g = ctx.createRadialGradient(W/2, H/2, Math.min(W,H)*0.35, W/2, H/2, Math.max(W,H)*0.72);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, 'rgba(0,0,0,' + vg.toFixed(3) + ')');
      ctx.save(); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H); ctx.restore();
    }
  };

  /* 生成一张彩色「样本照片」（无上传时也能预览滤镜色调），返回 canvas */
  let _sample;
  App.getSample = function () {
    if (_sample) return _sample;
    const c = document.createElement('canvas');
    c.width = 200; c.height = 200;
    const x = c.getContext('2d');
    const sky = x.createLinearGradient(0, 0, 0, 200);
    sky.addColorStop(0, '#7fb2e6'); sky.addColorStop(.55, '#cfe3f5'); sky.addColorStop(1, '#efe2c4');
    x.fillStyle = sky; x.fillRect(0, 0, 200, 200);
    x.fillStyle = '#ffd98a'; x.beginPath(); x.arc(150, 58, 30, 0, 7); x.fill();   // 暖阳
    x.fillStyle = '#e0584f'; x.beginPath(); x.arc(52, 96, 16, 0, 7); x.fill();    // 红色块（看饱和度）
    x.fillStyle = '#6fa06a'; x.beginPath();
    x.moveTo(0, 150); x.quadraticCurveTo(60, 110, 130, 148); x.quadraticCurveTo(190, 175, 200, 140);
    x.lineTo(200, 200); x.lineTo(0, 200); x.fill();
    x.fillStyle = '#4f7d52'; x.beginPath();
    x.moveTo(0, 178); x.quadraticCurveTo(80, 150, 150, 182); x.quadraticCurveTo(185, 195, 200, 172);
    x.lineTo(200, 200); x.lineTo(0, 200); x.fill();
    _sample = c;
    return c;
  };

})(window.App);
