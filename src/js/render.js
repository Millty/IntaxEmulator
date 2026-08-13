/* ============================================================
   render.js — Canvas 渲染管线（像素级滤镜 / 化学色偏 / 颗粒 / 暗角 / 显影 / 导出）
   拍立得模拟器 · 阶段三
   原则：预览即导出（同一套绘制，导出仅放大倍率）
   关键：主调色走像素级 getImageData（全浏览器一致），不依赖 ctx.filter
        （iOS Safari / WebView 对 ctx.filter 支持不完整，会导致手机端滤镜很弱）
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

  /* —— 像素级调色：仿 instax 化学显影（全浏览器一致，替代 ctx.filter）——
     data: Uint8ClampedArray(RGBA)；fd: 滤镜定义；intensity: 浓度(0~1) */
  App.gradeImageData = function (data, fd, intensity) {
    if (!fd || !fd.grade) return;
    const g = fd.grade;
    const k = (intensity == null) ? 1 : intensity;
    const exposure = 1 + (g.exposure || 0) * k;     // 曝光补偿(亮度乘子)
    const contrast = 1 + (g.contrast || 0) * k;     // 中灰对比强化
    const temp    = (g.temp || 0) * k;              // 色温：正=暖 / 负=冷
    const sat     = 1 + (g.sat || 0) * k;           // 饱和度：负=去饱和
    const hiWarm  = (g.hiWarm || 0) * k;            // 亮部暖黄
    const loTeal  = (g.loTeal || 0) * k;            // 暗部青蓝
    const lift    = (g.lift || 0) * k;             // 黑位抬升(褪色)
    const TEMP_R = 30, TEMP_B = 28;                 // 色温强度调参
    const len = data.length;
    for (let i = 0; i < len; i += 4) {
      let r = data[i]     * exposure;
      let gg = data[i + 1] * exposure;
      let b = data[i + 2] * exposure;
      // 黑位抬升（褪色感）：把暗部往浅灰拉
      if (lift) {
        r  = r  + lift * (235 - r);
        gg = gg + lift * (235 - gg);
        b  = b  + lift * (235 - b);
      }
      // 对比度（围绕中灰 128）
      r  = (r  - 128) * contrast + 128;
      gg = (gg - 128) * contrast + 128;
      b  = (b  - 128) * contrast + 128;
      // 色温：暖 = 加 R 减 B
      r  += temp * TEMP_R;
      gg += temp * 6;
      b  -= temp * TEMP_B;
      // 饱和度（去饱和向亮度灰靠拢）
      let lum = 0.299 * r + 0.587 * gg + 0.114 * b;
      r  = lum + (r  - lum) * sat;
      gg = lum + (gg - lum) * sat;
      b  = lum + (b  - lum) * sat;
      // 亮度相关化学色偏：亮部暖黄 / 暗部青蓝
      let L = 0.299 * r + 0.587 * gg + 0.114 * b;
      let lum01 = L / 255;
      let hw = hiWarm * lum01 * lum01;            // 越亮越强
      r  += hw * 26; gg += hw * 12; b -= hw * 14;
      let st = loTeal * (1 - lum01) * (1 - lum01); // 越暗越强
      r  -= st * 16; gg += st * 10; b += st * 22;
      // 夹紧
      data[i]     = r  < 0 ? 0 : r  > 255 ? 255 : r;
      data[i + 1] = gg < 0 ? 0 : gg > 255 ? 255 : gg;
      data[i + 2] = b  < 0 ? 0 : b  > 255 ? 255 : b;
    }
  };

  /* —— 分级源缓存：把原图按滤镜/浓度一次性像素调色，后续直接 drawImage 复用 ——
     避免显影动画逐帧重复 getImageData；保证桌面/移动端完全一致 */
  let _gidSeq = 0;
  const _gradeCache = new Map();
  function gradeKey(img, fd, intensity) {
    if (!img._gid) img._gid = ++_gidSeq;
    return img._gid + '|' + (fd ? fd.id : '') + '|' + (intensity == null ? 1 : intensity);
  }
  /* 软焦 + 光晕：模仿即时胶片扩散层 + 塑料镜头的柔化观感
     用「降采样→升采样」得到低代价扩散模糊，再与清晰层混合产生 soft focus，
     并用 screen 混合叠一层模糊亮部形成柔光晕。返回新 canvas（GPU 加速）。 */
  function applySoft(src, lvl) {
    const w = src.width, h = src.height;
    const out = document.createElement('canvas');
    out.width = w; out.height = h;
    const o = out.getContext('2d');
    o.imageSmoothingEnabled = true; o.imageSmoothingQuality = 'high';
    // 低分辨率模糊版本（双线性扩散）
    const f = 0.20;
    const bw = Math.max(1, Math.round(w * f)), bh = Math.max(1, Math.round(h * f));
    const bc = document.createElement('canvas');
    bc.width = bw; bc.height = bh;
    const bx = bc.getContext('2d');
    bx.imageSmoothingEnabled = true; bx.imageSmoothingQuality = 'high';
    bx.drawImage(src, 0, 0, bw, bh);
    // 底图：清晰
    o.drawImage(src, 0, 0);
    // 柔化：低透明度叠模糊层（soft focus）
    o.globalCompositeOperation = 'source-over';
    o.globalAlpha = 0.30 * lvl;
    o.drawImage(bc, 0, 0, w, h);
    // 柔光晕：screen 混合模糊亮部（高光轻微溢出，似化学显影）
    o.globalCompositeOperation = 'screen';
    o.globalAlpha = 0.16 * lvl;
    o.drawImage(bc, 0, 0, w, h);
    o.globalAlpha = 1; o.globalCompositeOperation = 'source-over';
    return out;
  }

  App.getGradedSource = function (img, fd, intensity) {
    const sw = img && (img.naturalWidth || img.width);
    const sh = img && (img.naturalHeight || img.height);
    if (!sw || !sh) return null;
    const key = gradeKey(img, fd, intensity);
    const hit = _gradeCache.get(key);
    if (hit) return hit;
    const c = document.createElement('canvas');
    c.width = sw; c.height = sh;
    const x = c.getContext('2d');
    x.drawImage(img, 0, 0);
    const d = x.getImageData(0, 0, c.width, c.height);
    App.gradeImageData(d.data, fd, intensity);
    x.putImageData(d, 0, 0);
    // 软焦（默认「经典」滤镜开启）：先调色后再做扩散柔化
    if (fd && fd.soft) {
      const softCanvas = applySoft(c, fd.soft);
      _gradeCache.set(key, softCanvas);
      return softCanvas;
    }
    _gradeCache.set(key, c);
    return c;
  };

  /* 统一叠加层：颗粒 + 暗角 + 显影白遮罩（均走合成混合，不依赖 ctx.filter）
     region(x,y,w,h)；whiteAmt: 0~1 显影白遮罩强度 */
  App.applyOverlays = function (ctx, x, y, w, h, fd, intensity, whiteAmt) {
    intensity = (intensity == null) ? 1 : intensity;
    // 胶片颗粒（overlay 混合）
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

  /* 把照片绘制进 canvas：cover + 用户平移/缩放 + 像素级滤镜 + 叠加层
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
    intensity = (intensity == null) ? 1 : intensity;
    if (!img || !img.complete || !img.naturalWidth) return { dx: dx || 0, dy: dy || 0, scale: scale || 1 };

    const userScale = Math.max(1, scale || 1);                 // ≥1 避免缩到比 cover 更小（露白）
    const gs = App.getGradedSource(img, filterDef, intensity); // 像素级调色源
    const srcW = gs ? gs.width : img.naturalWidth;
    const srcH = gs ? gs.height : img.naturalHeight;
    const coverScale = Math.max(W / srcW, H / srcH);
    const s = coverScale * userScale;
    const dw = srcW * s, dh = srcH * s;
    const baseX = (W - dw) / 2, baseY = (H - dh) / 2;
    const maxX = (dw - W) / 2, maxY = (dh - H) / 2;
    dx = Math.max(-maxX, Math.min(maxX, dx || 0));
    dy = Math.max(-maxY, Math.min(maxY, dy || 0));

    ctx.drawImage(gs || img, baseX + dx, baseY + dy, dw, dh);

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
    intensity = (intensity == null) ? 1 : intensity;
    const gs = App.getGradedSource(source, filterDef, intensity);
    const srcW = gs ? gs.width : sw, srcH = gs ? gs.height : sh;
    const sc = Math.max(W / srcW, H / srcH);            // cover
    const dw = srcW * sc, dh = srcH * sc;
    const dx = (W - dw) / 2, dy = (H - dh) / 2;
    ctx.drawImage(gs || source, dx, dy, dw, dh);
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

  /* 显影绘制：调色源 + 随进度衰减的过曝白遮罩（从纯白逐渐显影）
     developT: 0(全白空白)→1(完全显影)。返回 {dx,dy,scale}（已夹紧）。
     注：过曝/模糊改用白遮罩 + 透明度渐入实现（不依赖 ctx.filter，移动端一致） */
  App.drawCellDevelop = function (canvas, img, dx, dy, filterDef, intensity, developT, scale) {
    const ctx = canvas.getContext('2d');
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const W = Math.max(1, Math.round(rect.width * dpr));
    const H = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width !== W) canvas.width = W;
    if (canvas.height !== H) canvas.height = H;
    ctx.clearRect(0, 0, W, H);
    intensity = (intensity == null) ? 1 : intensity;
    if (!img || !img.complete || !img.naturalWidth) return { dx: dx || 0, dy: dy || 0, scale: scale || 1 };

    const userScale = Math.max(1, scale || 1);
    const gs = App.getGradedSource(img, filterDef, intensity);
    const srcW = gs ? gs.width : img.naturalWidth;
    const srcH = gs ? gs.height : img.naturalHeight;
    const coverScale = Math.max(W / srcW, H / srcH);
    const s0 = coverScale * userScale;
    const dw = srcW * s0, dh = srcH * s0;
    const baseX = (W - dw) / 2, baseY = (H - dh) / 2;
    const maxX = (dw - W) / 2, maxY = (dh - H) / 2;
    dx = Math.max(-maxX, Math.min(maxX, dx || 0));
    dy = Math.max(-maxY, Math.min(maxY, dy || 0));

    const d = (developT == null) ? 0 : Math.max(0, Math.min(1, developT));
    // 显影底色（偏暖白纸）
    ctx.save();
    ctx.fillStyle = '#f7f4ee';
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
    // 调色照片（后期用白遮罩控制显影程度）
    ctx.drawImage(gs || img, baseX + dx, baseY + dy, dw, dh);
    // 白遮罩：developT 越大越透明，照片从纯白浮现（模拟过曝/显影不均）
    const whiteAmt = Math.max(0, 1 - d) * 0.92;
    App.applyOverlays(ctx, 0, 0, W, H, filterDef, intensity, whiteAmt);
    return { dx, dy, scale: userScale };
  };

  /* 把单格照片绘制进指定 ctx 区域（供整图导出复用，不依赖 DOM rect） */
  function drawCellInto(ctx, img, x, y, w, h, fd, intensity) {
    ctx.save();
    ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
    if (img && img.complete && img.naturalWidth) {
      const gs = App.getGradedSource(img, fd, intensity);
      const srcW = gs ? gs.width : img.naturalWidth;
      const srcH = gs ? gs.height : img.naturalHeight;
      const userScale = Math.max(1, img._scale || 1);
      const coverScale = Math.max(w / srcW, h / srcH);
      const s = coverScale * userScale;
      const dw = srcW * s, dh = srcH * s;
      const baseX = x + (w - dw) / 2, baseY = y + (h - dh) / 2;
      const maxX = (dw - w) / 2, maxY = (dh - h) / 2;
      let dx = Math.max(-maxX, Math.min(maxX, img._dx || 0));
      let dy = Math.max(-maxY, Math.min(maxY, img._dy || 0));
      ctx.drawImage(gs || img, baseX + dx, baseY + dy, dw, dh);
    } else {
      ctx.fillStyle = '#1a1a1a'; ctx.fillRect(x, y, w, h);
    }
    ctx.restore();
    // 叠加颗粒/暗角（限制在格内）
    ctx.save();
    ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
    App.applyOverlays(ctx, x, y, w, h, fd, intensity, 0);
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
