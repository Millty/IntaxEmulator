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

  /* 显影绘制：在 drawPhoto 基础上叠加「从空白渐显」显影过程
     developT: 0(全白空白)→1(完全显影)。返回 {dx,dy}（已夹紧）。
     做法：目标滤镜字符串 + 随显影进度衰减的附加项（过曝/模糊/低对比），
           最上层再叠一层从纯白衰减的白色遮罩，模拟化学显影由白浮现。 */
  App.drawCellDevelop = function (canvas, img, dx, dy, filterDef, intensity, developT) {
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

    const d = (developT == null) ? 0 : Math.max(0, Math.min(1, 1 - developT));
    const s = d * d * (3 - 2 * d);   // smoothstep 平滑显影

    let filterStr = (filterDef && filterDef.filter) || '';
    if (s > 0.001) {
      filterStr += ` brightness(${(1 + s * 1.25).toFixed(3)}) contrast(${(1 - s * 0.58).toFixed(3)}) saturate(${(1 - s * 0.42).toFixed(3)}) blur(${(s * 7).toFixed(2)}px)`;
    }
    ctx.save();
    if (filterStr) ctx.filter = filterStr;
    ctx.drawImage(img, baseX + dx, baseY + dy, dw, dh);
    ctx.restore();

    if (intensity < 1) {
      ctx.save(); ctx.globalAlpha = 1 - intensity;
      ctx.drawImage(img, baseX + dx, baseY + dy, dw, dh); ctx.restore();
    }
    if (filterDef && filterDef.grain) {
      const n = App.getNoise();
      const pat = ctx.createPattern(n, 'repeat');
      ctx.save();
      ctx.globalAlpha = filterDef.grain * intensity * (1 + s * 0.8);  // 显影中颗粒更明显
      ctx.globalCompositeOperation = 'overlay';
      ctx.fillStyle = pat; ctx.fillRect(0, 0, W, H); ctx.restore();
    }
    if (filterDef && filterDef.vignette) {
      const vg = filterDef.vignette * intensity;
      const g = ctx.createRadialGradient(W/2, H/2, Math.min(W,H)*0.35, W/2, H/2, Math.max(W,H)*0.72);
      g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,' + vg.toFixed(3) + ')');
      ctx.save(); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H); ctx.restore();
    }
    if (s > 0.001) {   // 白色显影遮罩：从纯白浮现
      ctx.save();
      ctx.fillStyle = 'rgba(250,248,243,' + s.toFixed(3) + ')';
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }
    return { dx, dy };
  };

  /* 把单格照片绘制进指定 ctx 区域（供整图导出复用，不依赖 DOM rect） */
  function drawCellInto(ctx, img, x, y, w, h, fd, intensity) {
    ctx.save();
    ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
    if (img && img.complete && img.naturalWidth) {
      const scale = Math.max(w / img.naturalWidth, h / img.naturalHeight);
      const dw = img.naturalWidth * scale, dh = img.naturalHeight * scale;
      const baseX = x + (w - dw) / 2, baseY = y + (h - dh) / 2;
      const maxX = (dw - w) / 2, maxY = (dh - h) / 2;
      let dx = Math.max(-maxX, Math.min(maxX, img._dx || 0));
      let dy = Math.max(-maxY, Math.min(maxY, img._dy || 0));
      if (fd && fd.filter) ctx.filter = fd.filter;
      ctx.drawImage(img, baseX + dx, baseY + dy, dw, dh);
      ctx.filter = 'none';
      if (intensity < 1) { ctx.globalAlpha = 1 - intensity; ctx.drawImage(img, baseX + dx, baseY + dy, dw, dh); ctx.globalAlpha = 1; }
      if (fd && fd.grain) {
        const n = App.getNoise(); const pat = ctx.createPattern(n, 'repeat');
        ctx.globalAlpha = fd.grain * intensity; ctx.globalCompositeOperation = 'overlay';
        ctx.fillStyle = pat; ctx.fillRect(x, y, w, h); ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
      }
      if (fd && fd.vignette) {
        const vg = fd.vignette * intensity;
        const g = ctx.createRadialGradient(x+w/2, y+h/2, Math.min(w,h)*0.35, x+w/2, y+h/2, Math.max(w,h)*0.72);
        g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,' + vg.toFixed(3) + ')');
        ctx.fillStyle = g; ctx.fillRect(x, y, w, h);
      }
    } else {
      ctx.fillStyle = '#1a1a1a'; ctx.fillRect(x, y, w, h);
    }
    ctx.restore();
  }

  /* 生成整张拍立得相纸（含白边 + 成像区 + 网格 + 滤镜 + 日期戳），返回离屏 canvas
     scaleOverride 不传则用 App.EXPORT.scale（默认 3x） */
  App.renderWholePaper = function (scaleOverride) {
    const type = App.state.type, spec = App.PAPER_SPECS[type];
    const scale = scaleOverride || App.EXPORT.scale;
    const BASE = 1024;                                  // wide 基准宽(1x)
    const W = Math.round(BASE * (spec.w / 108) * scale);
    const H = Math.round(W * (spec.h / spec.w));
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const ctx = c.getContext('2d');

    // 白纸底
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, W, H);

    // 成像区
    const r = App.imageAreaRatio(type);
    const ix = Math.round(r.x * W), iy = Math.round(r.y * H);
    const iw = Math.round(r.w * W), ih = Math.round(r.h * H);
    ctx.fillStyle = '#111'; ctx.fillRect(ix, iy, iw, ih);

    // 网格切分（1 / 4 / 9）
    const n = App.state.mode;
    const cols = n === 4 ? 2 : (n === 9 ? 3 : 1);
    const rows = cols;
    const gap = Math.round(W * 0.005);
    const cw = (iw - gap * (cols - 1)) / cols;
    const ch = (ih - gap * (rows - 1)) / rows;

    const fd = App.getFilter(App.state.filterId);
    const intensity = App.state.filterIntensity;
    for (let i = 0; i < n; i++) {
      const p = App.state.photos[i];
      const cx = ix + (i % cols) * (cw + gap);
      const cy = iy + Math.floor(i / cols) * (ch + gap);
      const img = p && p.img;
      if (img) { img._dx = p.dx || 0; img._dy = p.dy || 0; }
      drawCellInto(ctx, img, cx, cy, Math.round(cw), Math.round(ch), fd, intensity);
    }

    // 日期戳（底部白边中央，等宽体还原拍立得日期）
    const d = new Date();
    const cap = d.getFullYear() + ' · ' + String(d.getMonth() + 1).padStart(2, '0');
    ctx.fillStyle = '#8d877b';
    ctx.font = Math.round(W * 0.025) + 'px ui-monospace, "SF Mono", Menlo, monospace';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(cap, W / 2, H - Math.round(spec.borders.bottom / spec.h * H * 0.5));

    return c;
  };

  /* 长按保存：导出整张相纸为 PNG（默认 3x），触发下载 */
  App.exportPaper = function () {
    const c = App.renderWholePaper();
    if (!c.toBlob) {                       // 兜底
      const a = document.createElement('a');
      a.href = c.toDataURL('image/png');
      a.download = 'polaroid-' + Date.now() + '.png';
      a.click();
      return;
    }
    c.toBlob((blob) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'polaroid-' + Date.now() + '.png';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1500);
    }, 'image/png');
  };

})(window.App);
