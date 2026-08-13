/* ============================================================
   render.js — Canvas 渲染管线（滤镜 / 化学色偏 / 颗粒 / 暗角 / 显影 / 导出）
   拍立得模拟器 · 阶段三
   原则：预览即导出（同一套绘制，导出仅放大倍率）
   ============================================================ */
window.App = window.App || {};
(function (App) {
  'use strict';

  /* 预生成噪点纹理（一次生成，平铺复用）— ISO800~1600 中等颗粒 */
  let _noise;
  App.getNoise = function () {
    if (_noise) return _noise;
    const s = 160;
    const c = document.createElement('canvas');
    c.width = s; c.height = s;
    const x = c.getContext('2d');
    const img = x.createImageData(s, s);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = 180 + Math.random() * 75;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = Math.random() * 46;       // 中等颗粒
    }
    x.putImageData(img, 0, 0);
    _noise = c;
    return c;
  };

  function roundRect(ctx, x, y, w, h, r) {
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /* 统一调色叠加：化学色偏(tint) + 颗粒 + 暗角 + 显影白遮罩
     region(x,y,w,h)；whiteAmt: 0~1 显影白遮罩强度
     tint 用 soft-light 混合，全浏览器生效——即使 ctx.filter 不被支持，滤镜切换仍明显可辨 */
  App.applyOverlays = function (ctx, x, y, w, h, fd, intensity, whiteAmt) {
    intensity = intensity == null ? 1 : intensity;
    // 化学色偏：亮部暖黄 / 暗部青蓝
    if (fd && fd.tint) {
      const g = ctx.createLinearGradient(0, y, 0, y + h);
      g.addColorStop(0, fd.tint.hi);
      g.addColorStop(1, fd.tint.lo);
      ctx.save();
      ctx.globalCompositeOperation = 'soft-light';
      ctx.globalAlpha = fd.tint.amt * intensity;
      ctx.fillStyle = g;
      ctx.fillRect(x, y, w, h);
      ctx.restore();
    }
    // 胶片颗粒（overlay）
    if (fd && fd.grain) {
      const n = App.getNoise();
      const pat = ctx.createPattern(n, 'repeat');
      ctx.save();
      ctx.globalAlpha = fd.grain * intensity;
      ctx.globalCompositeOperation = 'overlay';
      ctx.fillStyle = pat;
      ctx.fillRect(x, y, w, h);
      ctx.restore();
    }
    // 暗角
    if (fd && fd.vignette) {
      const vg = fd.vignette * intensity;
      const rg = ctx.createRadialGradient(
        x + w / 2, y + h / 2, Math.min(w, h) * 0.34,
        x + w / 2, y + h / 2, Math.max(w, h) * 0.74
      );
      rg.addColorStop(0, 'rgba(0,0,0,0)');
      rg.addColorStop(1, 'rgba(0,0,0,' + vg.toFixed(3) + ')');
      ctx.save();
      ctx.fillStyle = rg;
      ctx.fillRect(x, y, w, h);
      ctx.restore();
    }
    // 显影白遮罩（由纯白浮现）
    if (whiteAmt > 0.001) {
      ctx.save();
      ctx.fillStyle = 'rgba(250,248,243,' + whiteAmt.toFixed(3) + ')';
      ctx.fillRect(x, y, w, h);
      ctx.restore();
    }
  };

  /* 把照片绘制进 canvas：cover + 用户平移/缩放 + 滤镜 + 调色叠加
     返回校正后的 {dx, dy, scale}（已按 cover 余量夹紧，避免露白边） */
  App.drawPhoto = function (canvas, img, dx, dy, filterDef, intensity, scale) {
    const ctx = canvas.getContext('2d');
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const W = Math.max(1, Math.round(rect.width * dpr));
    const H = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width !== W) canvas.width = W;
    if (canvas.height !== H) canvas.height = H;
    ctx.clearRect(0, 0, W, H);

    if (!img || !img.complete || !img.naturalWidth) return { dx: dx || 0, dy: dy || 0, scale: scale || 1 };

    intensity = intensity == null ? 1 : intensity;
    const userScale = Math.max(1, scale || 1);               // ≥1 避免缩到比 cover 更小（露白）
    const coverScale = Math.max(W / img.naturalWidth, H / img.naturalHeight);
    const s = coverScale * userScale;
    const dw = img.naturalWidth * s, dh = img.naturalHeight * s;
    const baseX = (W - dw) / 2, baseY = (H - dh) / 2;
    const maxX = (dw - W) / 2, maxY = (dh - H) / 2;
    dx = Math.max(-maxX, Math.min(maxX, dx || 0));
    dy = Math.max(-maxY, Math.min(maxY, dy || 0));

    ctx.save();
    if (filterDef && filterDef.filter) ctx.filter = filterDef.filter;
    ctx.drawImage(img, baseX + dx, baseY + dy, dw, dh);
    ctx.filter = 'none';
    ctx.restore();

    App.applyOverlays(ctx, 0, 0, W, H, filterDef, intensity, 0);
    return { dx, dy, scale: userScale };
  };

  /* 缩略图绘制（滤镜选择条实时预览） */
  App.drawFilterThumb = function (canvas, source, filterDef, intensity) {
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    if (!source) return;
    const sw = source.naturalWidth || source.width;
    const sh = source.naturalHeight || source.height;
    if (!sw || !sh) return;
    const sc = Math.max(W / sw, H / sh);            // cover
    const dw = sw * sc, dh = sh * sc;
    const dx = (W - dw) / 2, dy = (H - dh) / 2;
    intensity = intensity == null ? 1 : intensity;

    ctx.save();
    if (filterDef && filterDef.filter) ctx.filter = filterDef.filter;
    ctx.drawImage(source, dx, dy, dw, dh);
    ctx.filter = 'none';
    ctx.restore();

    App.applyOverlays(ctx, 0, 0, W, H, filterDef, intensity, 0);
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

  /* 显影绘制：目标滤镜 + 随进度衰减的过曝/模糊/低对比 + 白遮罩
     developT: 0(全白空白)→1(完全显影)。返回 {dx,dy,scale}（已夹紧）。 */
  App.drawCellDevelop = function (canvas, img, dx, dy, filterDef, intensity, developT, scale) {
    const ctx = canvas.getContext('2d');
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const W = Math.max(1, Math.round(rect.width * dpr));
    const H = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width !== W) canvas.width = W;
    if (canvas.height !== H) canvas.height = H;
    ctx.clearRect(0, 0, W, H);
    if (!img || !img.complete || !img.naturalWidth) return { dx: dx || 0, dy: dy || 0, scale: scale || 1 };

    intensity = intensity == null ? 1 : intensity;
    const userScale = Math.max(1, scale || 1);
    const coverScale = Math.max(W / img.naturalWidth, H / img.naturalHeight);
    const s0 = coverScale * userScale;
    const dw = img.naturalWidth * s0, dh = img.naturalHeight * s0;
    const baseX = (W - dw) / 2, baseY = (H - dh) / 2;
    const maxX = (dw - W) / 2, maxY = (dh - H) / 2;
    dx = Math.max(-maxX, Math.min(maxX, dx || 0));
    dy = Math.max(-maxY, Math.min(maxY, dy || 0));

    const d = (developT == null) ? 0 : Math.max(0, Math.min(1, 1 - developT));
    const sm = d * d * (3 - 2 * d);   // smoothstep 平滑显影

    let filterStr = (filterDef && filterDef.filter) || '';
    if (sm > 0.001) {
      filterStr += ` brightness(${(1 + sm * 1.25).toFixed(3)}) contrast(${(1 - sm * 0.58).toFixed(3)}) saturate(${(1 - sm * 0.42).toFixed(3)}) blur(${(sm * 7).toFixed(2)}px)`;
    }
    ctx.save();
    if (filterStr) ctx.filter = filterStr;
    ctx.drawImage(img, baseX + dx, baseY + dy, dw, dh);
    ctx.filter = 'none';
    ctx.restore();

    // 显影中颗粒更明显（不均匀显影感）
    const grainAmt = filterDef && filterDef.grain ? filterDef.grain * (1 + sm * 0.8) : 0;
    App.applyOverlays(ctx, 0, 0, W, H,
      Object.assign({}, filterDef, { grain: grainAmt }), intensity, sm);
    return { dx, dy, scale: userScale };
  };

  /* 把单格照片绘制进指定 ctx 区域（供整图导出复用，不依赖 DOM rect） */
  function drawCellInto(ctx, img, x, y, w, h, fd, intensity) {
    ctx.save();
    ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
    if (img && img.complete && img.naturalWidth) {
      const userScale = Math.max(1, img._scale || 1);
      const coverScale = Math.max(w / img.naturalWidth, h / img.naturalHeight);
      const s = coverScale * userScale;
      const dw = img.naturalWidth * s, dh = img.naturalHeight * s;
      const baseX = x + (w - dw) / 2, baseY = y + (h - dh) / 2;
      const maxX = (dw - w) / 2, maxY = (dh - h) / 2;
      let dx = Math.max(-maxX, Math.min(maxX, img._dx || 0));
      let dy = Math.max(-maxY, Math.min(maxY, img._dy || 0));
      ctx.save();
      if (fd && fd.filter) ctx.filter = fd.filter;
      ctx.drawImage(img, baseX + dx, baseY + dy, dw, dh);
      ctx.filter = 'none';
      ctx.restore();
      App.applyOverlays(ctx, x, y, w, h, fd, intensity, 0);
    } else {
      ctx.fillStyle = '#1a1a1a'; ctx.fillRect(x, y, w, h);
    }
    ctx.restore();
  }

  /* 生成整张拍立得相纸（圆角白纸 + 投影 + 成像区 + 网格 + 滤镜），返回离屏 canvas
     scaleOverride 不传则用 App.EXPORT.scale（默认 3x）。无文字水印。 */
  App.renderWholePaper = function (scaleOverride) {
    const type = App.state.type, spec = App.PAPER_SPECS[type];
    const scale = scaleOverride || App.EXPORT.scale;
    const BASE = 1024;                                  // wide 基准宽(1x)
    const pW = Math.round(BASE * (spec.w / 108) * scale);   // 相纸宽
    const pH = Math.round(pW * (spec.h / spec.w));          // 相纸高
    const R = Math.round(12 * scale);                      // 圆角
    const SH = Math.round(28 * scale);                     // 外阴影留白
    const W = pW + SH * 2, H = pH + SH * 2;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, W, H);

    // 白纸（圆角）+ 投影，模拟实体照片
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,.32)';
    ctx.shadowBlur = SH * 0.85;
    ctx.shadowOffsetY = Math.round(10 * scale);
    roundRect(ctx, SH, SH, pW, pH, R);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.restore();

    // 裁剪进白纸范围
    ctx.save();
    roundRect(ctx, SH, SH, pW, pH, R);
    ctx.clip();

    // 成像区
    const r = App.imageAreaRatio(type);
    const ix = SH + Math.round(r.x * pW), iy = SH + Math.round(r.y * pH);
    const iw = Math.round(r.w * pW), ih = Math.round(r.h * pH);
    ctx.fillStyle = '#111'; ctx.fillRect(ix, iy, iw, ih);

    // 网格切分（1 / 4 / 9）
    const nCell = App.state.mode;
    const cols = nCell === 4 ? 2 : (nCell === 9 ? 3 : 1);
    const rows = cols;
    const gap = Math.round(pW * 0.004);
    const cw = (iw - gap * (cols - 1)) / cols;
    const ch = (ih - gap * (rows - 1)) / rows;

    const fd = App.getFilter(App.state.filterId);
    const intensity = App.state.filterIntensity;
    for (let i = 0; i < nCell; i++) {
      const p = App.state.photos[i];
      const cx = ix + (i % cols) * (cw + gap);
      const cy = iy + Math.floor(i / cols) * (ch + gap);
      const img = p && p.img;
      if (img) { img._dx = p.dx || 0; img._dy = p.dy || 0; img._scale = Math.max(1, p.scale || 1); }
      drawCellInto(ctx, img, cx, cy, Math.round(cw), Math.round(ch), fd, intensity);
    }

    // 成像区与白纸之间极细压痕线（真实照片边缘感）
    ctx.save();
    ctx.strokeStyle = 'rgba(0,0,0,.10)';
    ctx.lineWidth = Math.max(1, scale);
    ctx.strokeRect(ix - ctx.lineWidth / 2, iy - ctx.lineWidth / 2, iw + ctx.lineWidth, ih + ctx.lineWidth);
    ctx.restore();

    // 取消水印：不再绘制日期戳
    ctx.restore();
    return c;
  };

  /* 导出：优先存入系统相册（Web Share），不支持则回退为文件下载 */
  App.exportPaper = function () {
    const c = App.renderWholePaper();
    const fallback = () => {
      c.toBlob((b) => {
        if (!b) return;
        const url = URL.createObjectURL(b);
        const a = document.createElement('a');
        a.href = url; a.download = 'polaroid-' + Date.now() + '.png';
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1500);
      }, 'image/png');
    };
    if (!c.toBlob) { fallback(); return; }
    c.toBlob((blob) => {
      if (!blob) { fallback(); return; }
      const file = new File([blob], 'polaroid-' + Date.now() + '.png', { type: 'image/png' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        navigator.share({ files: [file], title: '拍立得照片' }).catch(() => fallback());
      } else {
        fallback();
      }
    }, 'image/png');
  };

})(window.App);
