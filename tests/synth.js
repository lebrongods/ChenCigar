// 测试用合成图像：条烟条码照片、码放的条烟照片、模拟摄像头（不依赖真实设备）
const fs = require('fs');
const path = require('path');
const L = require('./lib');
const { ean13Modules } = require('./ean');

// 在页面画布上画一个 EAN-13 条码（含数字），返回绘制宽度
function drawEanSource() {
  return function drawEan(x, bits, digits, left, top, module, height) {
    const quiet = 11 * module, w = (95 + 22) * module;
    x.fillStyle = '#fff'; x.fillRect(left, top, w, height + module * 14);
    x.fillStyle = '#111';
    for (let i = 0; i < 95; i++) if (bits[i] === '1') x.fillRect(left + quiet + i * module, top + module * 4, module, height + ([0, 1, 2, 45, 46, 47, 48, 49, 92, 93, 94].includes(i) ? module * 5 : 0));
    x.font = Math.round(module * 8) + 'px monospace'; x.textBaseline = 'top';
    x.fillText(digits[0] + '  ' + digits.slice(1, 7) + '  ' + digits.slice(7), left + module * 2, top + height + module * 5);
    return w;
  };
}

// 生成"拍到的条烟侧面条码"照片文件
async function barcodePhoto(name, code, o = {}) {
  const file = path.join(L.TMP, name + '.jpg');
  if (fs.existsSync(file)) return file;
  const b = await L.getBrowser(); const page = await b.newPage();
  const url = await page.evaluate(({ bits, code, o, src }) => {
    const drawEan = eval('(' + src + ')');
    const W = o.W || 1600, H = o.H || 1200;
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H; const x = cv.getContext('2d');
    const g = x.createLinearGradient(0, 0, W, H); g.addColorStop(0, '#5a5048'); g.addColorStop(1, '#8c8378'); x.fillStyle = g; x.fillRect(0, 0, W, H);
    x.save(); x.translate(W / 2, H / 2); x.rotate((o.rot || 0) * Math.PI / 180);
    x.fillStyle = '#b3121b'; x.fillRect(-W * 0.42, -H * 0.2, W * 0.84, H * 0.4); // 条烟侧面
    const m = o.module || 4; const bw = (95 + 22) * m;
    drawEan(x, bits, code, -bw / 2, -m * 40, m, m * 55);
    x.restore();
    const c2 = document.createElement('canvas'); c2.width = W; c2.height = H; const y = c2.getContext('2d');
    y.filter = 'blur(' + (o.blur || 0.6) + 'px)'; y.drawImage(cv, 0, 0);
    return c2.toDataURL('image/jpeg', 0.88);
  }, { bits: ean13Modules(code), code, o, src: drawEanSource().toString() });
  await page.close();
  fs.writeFileSync(file, Buffer.from(url.split(',')[1], 'base64'));
  return file;
}

// 模拟摄像头：getUserMedia 返回画布视频流，画面中间是条码（code 为空时只有背景）
// opts.deny：模拟拒绝授权；opts.delayMs：多少毫秒后条码才出现在画面中
function fakeCameraScript(code, opts = {}) {
  const arg = { bits: code ? ean13Modules(code) : '', code: code || '', deny: !!opts.deny, delayMs: opts.delayMs || 0, native: opts.native || '' };
  return '(' + function (a, src) {
    const drawEan = eval('(' + src + ')');
    window.__cam = { opened: 0, tracks: [], stopped: 0 };
    if (a.native !== undefined && a.native !== '') {
      window.BarcodeDetector = class {
        static async getSupportedFormats() { return ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'qr_code']; }
        async detect(src) { window.__cam.nativeCalls = (window.__cam.nativeCalls || 0) + 1; return window.__cam.showCode ? [{ rawValue: a.native, format: 'ean_13' }] : []; }
      };
    } else { delete window.BarcodeDetector; }
    const md = navigator.mediaDevices;
    if (!md) return;
    md.getUserMedia = async () => {
      window.__cam.opened++;
      if (a.deny) { const e = new Error('Permission denied'); e.name = 'NotAllowedError'; throw e; }
      const cv = document.createElement('canvas'); cv.width = 720; cv.height = 1280; const x = cv.getContext('2d'); // 手机竖拿时摄像头画面是竖的
      const t0 = Date.now();
      const draw = () => {
        x.fillStyle = '#6b6257'; x.fillRect(0, 0, 720, 1280);
        x.fillStyle = '#b3121b'; x.fillRect(40, 380, 640, 300);
        const show = a.bits && Date.now() - t0 >= a.delayMs;
        window.__cam.showCode = show;
        if (show) drawEan(x, a.bits, a.code, 360 - (117 * 3) / 2, 420, 3, 150);
      };
      draw(); const iv = setInterval(draw, 40);
      const st = cv.captureStream(25);
      st.getTracks().forEach(t => {
        const stop = t.stop.bind(t);
        t.stop = () => { window.__cam.stopped++; clearInterval(iv); stop(); };
        window.__cam.tracks.push(t);
      });
      return st;
    };
  }.toString() + ')(' + JSON.stringify(arg) + ',' + JSON.stringify(drawEanSource().toString()) + ');';
}

// 码放的条烟照片：rows×cols 条，other 中的序号为另一品牌；返回 { file, boxes, W, H }
async function pilePhoto(name, o = {}) {
  const b = await L.getBrowser(); const page = await b.newPage();
  const r = await page.evaluate(o => {
    o = Object.assign({ W: 1280, H: 960, rows: 5, cols: 4, cw: 250, ch: 80, gap: 4, jitter: 3, rot: 1.5, persp: 0.12, blur: 0.8, noise: 10, light: 0.35, seed: 3, other: [], x0: 60, y0: 80, q: 0.85, flip: [], otherBrand: 'blue' }, o);
    let s = o.seed; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
    const cv = document.createElement('canvas'); cv.width = o.W; cv.height = o.H; const x = cv.getContext('2d');
    const bg = x.createLinearGradient(0, 0, o.W, o.H); bg.addColorStop(0, '#6b6257'); bg.addColorStop(1, '#a39a8c'); x.fillStyle = bg; x.fillRect(0, 0, o.W, o.H);
    for (let i = 0; i < 300; i++) { x.fillStyle = 'rgba(' + (rnd() > 0.5 ? '255,255,255' : '0,0,0') + ',' + (rnd() * 0.08) + ')'; x.fillRect(rnd() * o.W, rnd() * o.H, 5 + rnd() * 60, 5 + rnd() * 60); }
    function carton(brand, w, h) {
      if (brand === 'red') {
        x.fillStyle = '#b3121b'; x.fillRect(0, 0, w, h);
        x.fillStyle = '#f2d16b'; x.fillRect(w * 0.05, h * 0.15, w * 0.03, h * 0.7);
        x.fillStyle = '#fff'; x.fillRect(w * 0.62, 0, w * 0.06, h);
        x.beginPath(); x.arc(w * 0.3, h * 0.5, h * 0.3, 0, 7); x.fillStyle = '#f2d16b'; x.fill();
        x.fillStyle = '#fff'; x.font = 'bold ' + Math.round(h * 0.38) + 'px sans-serif'; x.fillText('中华', w * 0.4, h * 0.62);
        x.fillStyle = '#222'; for (let i = 0; i < 18; i++) x.fillRect(w * 0.75 + i * w * 0.011, h * 0.25, (i % 3 ? 1 : 2.5) * w / 250, h * 0.5);
      } else if (brand === 'blue') {
        x.fillStyle = '#1f4e9c'; x.fillRect(0, 0, w, h);
        x.fillStyle = '#e8eef8'; x.fillRect(w * 0.1, h * 0.2, w * 0.45, h * 0.6);
        x.fillStyle = '#1f4e9c'; x.font = 'bold ' + Math.round(h * 0.36) + 'px sans-serif'; x.fillText('利群', w * 0.15, h * 0.62);
        x.fillStyle = '#fff'; for (let i = 0; i < 18; i++) x.fillRect(w * 0.7 + i * w * 0.011, h * 0.25, (i % 3 ? 1 : 2.5) * w / 250, h * 0.5);
      } else {
        x.fillStyle = '#b3141f'; x.fillRect(0, 0, w, h);
        x.fillStyle = '#fff'; x.font = 'bold ' + Math.round(h * 0.4) + 'px sans-serif'; x.fillText('芙蓉王', w * 0.1, h * 0.65);
        x.fillStyle = '#e8c35a'; x.fillRect(w * 0.7, h * 0.1, w * 0.2, h * 0.8);
      }
      x.strokeStyle = 'rgba(0,0,0,0.5)'; x.lineWidth = 1.5; x.strokeRect(0.5, 0.5, w - 1, h - 1);
    }
    const boxes = [];
    const scOf = r => 1 - o.persp * (1 - r / Math.max(1, o.rows - 1)); // 上排远、小
    let yy = o.y0;
    for (let r = 0; r < o.rows; r++) {
      const sc = scOf(r), w = o.cw * sc, h = o.ch * sc;
      const rowW = o.cols * w + (o.cols - 1) * o.gap; const xx0 = o.x0 + (o.cols * o.cw + (o.cols - 1) * o.gap - rowW) / 2;
      for (let c = 0; c < o.cols; c++) {
        const idx = r * o.cols + c;
        const brand = o.other.includes(idx) ? o.otherBrand : 'red';
        const cx = xx0 + c * (w + o.gap) + w / 2 + (rnd() - 0.5) * 2 * o.jitter, cy = yy + h / 2 + (rnd() - 0.5) * 2 * o.jitter;
        x.save(); x.translate(cx, cy); x.rotate(((rnd() - 0.5) * 2 * o.rot + (o.flip.includes(idx) ? 180 : 0)) * Math.PI / 180); x.translate(-w / 2, -h / 2);
        carton(brand, w, h); x.restore();
        boxes.push({ x: cx - w / 2, y: cy - h / 2, w, h, brand });
      }
      yy += h + o.gap;
    }
    const lg = x.createRadialGradient(o.W * 0.2, o.H * 0.2, 50, o.W * 0.5, o.H * 0.5, o.W * 0.8); lg.addColorStop(0, 'rgba(255,255,240,' + o.light * 0.5 + ')'); lg.addColorStop(1, 'rgba(0,0,0,' + o.light + ')');
    x.fillStyle = lg; x.fillRect(0, 0, o.W, o.H);
    const c2 = document.createElement('canvas'); c2.width = o.W; c2.height = o.H; const y = c2.getContext('2d'); y.filter = 'blur(' + o.blur + 'px)'; y.drawImage(cv, 0, 0);
    const d = y.getImageData(0, 0, o.W, o.H); for (let i = 0; i < d.data.length; i += 4) { const n = (rnd() - 0.5) * 2 * o.noise; d.data[i] += n; d.data[i + 1] += n; d.data[i + 2] += n; } y.putImageData(d, 0, 0);
    return { url: c2.toDataURL('image/jpeg', o.q), boxes, W: o.W, H: o.H };
  }, o);
  await page.close();
  const file = path.join(L.TMP, name + '.jpg');
  fs.writeFileSync(file, Buffer.from(r.url.split(',')[1], 'base64'));
  return { file, boxes: r.boxes, W: r.W, H: r.H };
}

// 仿真实拍摄的难例：条烟竖立在白色亮面柜子上（只露出窄端面）、多个品牌混放、目标小、
// 背景有塑料袋、柜子边线，柜面有倒影。返回 { file, boxes（全部条烟）, W, H }，target 品牌为 'lotus'
async function shelfPhoto(name, o = {}) {
  const b = await L.getBrowser(); const page = await b.newPage();
  const r = await page.evaluate(o => {
    o = Object.assign({ W: 1600, H: 1200, scale: 1, seed: 7, reflect: 0.22, blur: 1, noise: 6, q: 0.85,
      order: ['pink', 'lotus', 'orange', 'red', 'lotus', 'gold', 'blue', 'lotus', 'green', 'pink'] }, o);
    let s = o.seed; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
    const W = o.W, H = o.H;
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H; const x = cv.getContext('2d');
    // 墙、柜面、柜门、地面
    let g = x.createLinearGradient(0, 0, W, 0); g.addColorStop(0, '#e4e4e0'); g.addColorStop(1, '#c9c9c4'); x.fillStyle = g; x.fillRect(0, 0, W, H);
    const top = Math.round(H * 0.47), front = Math.round(H * 0.52), bottom = Math.round(H * 0.78);
    x.fillStyle = '#d6d1c8'; x.fillRect(0, top, W, front - top);
    g = x.createLinearGradient(0, front, 0, bottom); g.addColorStop(0, '#e3dfd7'); g.addColorStop(1, '#cfcac1'); x.fillStyle = g; x.fillRect(0, front, W, bottom - front);
    x.fillStyle = '#9a958d'; x.fillRect(0, front - 2, W, 3); x.fillRect(W * 0.5, front, 3, bottom - front); x.fillRect(W * 0.04, front, 2, bottom - front); x.fillRect(W * 0.96, front, 2, bottom - front);
    x.fillStyle = '#bdb8af'; x.fillRect(0, front + (bottom - front) * 0.12, W, 2);
    x.fillStyle = '#8f8a83'; x.fillRect(0, bottom, W, H - bottom);
    for (let i = 0; i < 6; i++) { x.fillStyle = '#7d7871'; x.fillRect(0, bottom + i * 50, W, 1); }
    // 塑料袋（左侧，半透明褶皱）
    for (let i = 0; i < 70; i++) { x.strokeStyle = 'rgba(' + (rnd() > 0.4 ? '255,255,255' : '120,120,120') + ',' + (0.15 + rnd() * 0.35) + ')'; x.lineWidth = 2 + rnd() * 8; x.beginPath(); const sx = W * 0.02 + rnd() * W * 0.18, sy = top - 160 + rnd() * 200; x.moveTo(sx, sy); x.quadraticCurveTo(sx + rnd() * 120 - 40, sy + rnd() * 80 - 40, sx + rnd() * 160 - 60, sy + rnd() * 120 - 30); x.stroke(); }
    const colors = { pink: ['#e88fb0', '#fff', '#b03060'], orange: ['#f08a24', '#fff3d6', '#7a3c00'], red: ['#c4161c', '#f5d36b', '#fff'], gold: ['#d9b44a', '#5a3b00', '#fff'], blue: ['#2a5caa', '#fff', '#dfe8f5'], green: ['#2f8a4c', '#fff', '#e9d36b'] };
    function face(c, brand, w, h) {
      if (brand === 'lotus') { // 白底、绿色横带、粉色荷花、竖排小字
        c.fillStyle = '#f4f4ef'; c.fillRect(0, 0, w, h);
        c.fillStyle = '#1f8a5a'; c.fillRect(0, h * 0.62, w, h * 0.1); c.fillRect(0, h * 0.9, w, h * 0.05);
        c.fillStyle = '#e46a9a'; c.beginPath(); c.arc(w * 0.5, h * 0.3, w * 0.26, 0, 7); c.fill();
        c.fillStyle = '#1f8a5a'; for (let i = 0; i < 4; i++) c.fillRect(w * 0.42, h * (0.4 + i * 0.045), w * 0.16, h * 0.025);
      } else {
        const k = colors[brand]; c.fillStyle = k[0]; c.fillRect(0, 0, w, h);
        c.fillStyle = k[1]; c.fillRect(w * 0.15, h * 0.18, w * 0.7, h * 0.3);
        c.fillStyle = k[2]; c.fillRect(w * 0.3, h * 0.6, w * 0.4, h * 0.22);
      }
      c.strokeStyle = 'rgba(0,0,0,.35)'; c.lineWidth = 1; c.strokeRect(0.5, 0.5, w - 1, h - 1);
    }
    const boxes = [];
    const fw = 40 * o.scale, fh = 150 * o.scale; let cx = W * 0.36;
    const items = o.order.map((brand, i) => { const it = { brand, x: cx + (rnd() - 0.5) * 4, y: top + 30 - fh - (i % 3 === 1 ? 14 : 0) + (rnd() - 0.5) * 4, w: fw * (0.96 + rnd() * 0.08), h: fh }; cx += fw + 2 + rnd() * 4; return it; });
    // 倒影（柜面亮，倒影淡而模糊）
    const rc = document.createElement('canvas'); rc.width = W; rc.height = H; const rx = rc.getContext('2d');
    items.forEach(it => { rx.save(); rx.translate(it.x, 2 * (top + 30) - it.y); rx.scale(1, -1); face(rx, it.brand, it.w, it.h); rx.restore(); });
    x.save(); x.globalAlpha = o.reflect; x.filter = 'blur(2px)'; x.drawImage(rc, 0, 0); x.restore();
    items.forEach(it => { x.save(); x.translate(it.x, it.y); face(x, it.brand, it.w, it.h); x.restore(); boxes.push({ x: it.x, y: it.y, w: it.w, h: it.h, brand: it.brand }); });
    // 窗光
    g = x.createLinearGradient(0, 0, W, H); g.addColorStop(0, 'rgba(255,255,250,.18)'); g.addColorStop(1, 'rgba(0,0,0,.18)'); x.fillStyle = g; x.fillRect(0, 0, W, H);
    const c2 = document.createElement('canvas'); c2.width = W; c2.height = H; const y = c2.getContext('2d'); y.filter = 'blur(' + o.blur + 'px)'; y.drawImage(cv, 0, 0);
    const d = y.getImageData(0, 0, W, H); for (let i = 0; i < d.data.length; i += 4) { const n = (rnd() - 0.5) * 2 * o.noise; d.data[i] += n; d.data[i + 1] += n; d.data[i + 2] += n; } y.putImageData(d, 0, 0);
    return { url: c2.toDataURL('image/jpeg', o.q), boxes, W, H };
  }, o);
  await page.close();
  const file = path.join(L.TMP, name + '.jpg');
  fs.writeFileSync(file, Buffer.from(r.url.split(',')[1], 'base64'));
  return { file, boxes: r.boxes, W: r.W, H: r.H };
}

module.exports = { barcodePhoto, fakeCameraScript, pilePhoto, shelfPhoto };
