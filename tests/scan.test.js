// 摄像头扫码、拍照识别条码、图片计数
const L = require('./lib');
const Z = require('./zip');
const S = require('./synth');
const { assert } = L;

const ZHONGHUA = '6901028075015'; // 价格目录：中华（硬），450 元/条

async function newCase(w, opts, number = 'SC-001', required = false) {
  const p = await L.openPage(w, opts); const page = p.page;
  await L.setupAdmin(page);
  await L.createCase(page, number);
  if (required) await L.captureAllRequired(page);
  return p;
}
const brandValue = page => page.inputValue('form[data-form=seized] [name=brand]');
// 在计数画布上从照片坐标 a 拖到 b（框选）
async function dragOnCounter(page, W, H, a, b) {
  const r = await page.$eval('.counter canvas', c => { const x = c.getBoundingClientRect(); return { left: x.left, top: x.top, width: x.width, height: x.height }; });
  const pt = q => [r.left + q.x / W * r.width, r.top + q.y / H * r.height];
  await page.mouse.move(...pt(a)); await page.mouse.down();
  await page.mouse.move(...pt({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }), { steps: 4 });
  await page.mouse.move(...pt(b), { steps: 4 }); await page.mouse.up();
}
async function tapOnCounter(page, W, H, q) {
  const r = await page.$eval('.counter canvas', c => { const x = c.getBoundingClientRect(); return { left: x.left, top: x.top, width: x.width, height: x.height }; });
  await page.mouse.click(r.left + q.x / W * r.width, r.top + q.y / H * r.height);
}
const center = b => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });
const countNow = async page => Number(await page.textContent('.cnt-n'));
async function boxFirst(page, pile, i = 0) {
  const b = pile.boxes[i];
  await dragOnCounter(page, pile.W, pile.H, { x: b.x + 3, y: b.y + 3 }, { x: b.x + b.w - 3, y: b.y + b.h - 3 });
  await page.waitForSelector('.cnt-n', { timeout: 20000 });
}

module.exports = [
  {
    name: '实时扫码（内置识别库）：摄像头画面出现条码后自动识别、关闭摄像头、带出品规和价格',
    fn: async () => {
      const w = L.createWorld();
      const p = await newCase(w, { initScript: S.fakeCameraScript(ZHONGHUA, { delayMs: 800 }) }); const page = p.page;
      try {
        assert(!(await page.evaluate(() => 'BarcodeDetector' in window)), '测试前提：浏览器没有 BarcodeDetector');
        await page.click('[data-action=seized-scan]');
        await page.waitForSelector('.scanner video');
        await page.waitForFunction(() => document.querySelector('.scanner .scan-engine') && document.querySelector('.scanner .scan-engine').textContent === '内置识别库');
        const t0 = Date.now();
        await page.waitForSelector('.scanner', { state: 'detached', timeout: 15000 });
        const ms = Date.now() - t0;
        assert(await brandValue(page) === '中华（硬）', '应带出品规：' + await brandValue(page));
        assert(await page.inputValue('form[data-form=seized] [name=price]') === '450', '应带出建议零售价');
        assert(await page.inputValue('form[data-form=seized] [name=barcode]') === ZHONGHUA, '条码框应填入完整条码');
        const cam = await page.evaluate(() => ({ opened: window.__cam.opened, stopped: window.__cam.stopped, live: window.__cam.tracks.filter(t => t.readyState === 'live').length }));
        assert(cam.opened === 1 && cam.stopped >= 1 && cam.live === 0, '识别后应关闭摄像头：' + JSON.stringify(cam));
        assert(!(await page.evaluate(() => document.body.classList.contains('overlay-open'))), '应恢复页面滚动');
        // 保存并继续：上一条是扫码录入的，自动再次打开摄像头
        await page.fill('form[data-form=seized] [name=qty]', '3');
        await page.click('[data-action=seized-save-next]');
        await page.waitForSelector('.scanner video');
        await page.click('.scanner [data-sc=close]');
        await page.waitForSelector('.scanner', { state: 'detached' });
        assert((await page.textContent('#seized-list')).includes('中华（硬）'), '第一条应已保存');
        assert(p.errors.length === 0, '控制台不应有错误：' + p.errors.join(';'));
        return '从打开摄像头到识别完成约 ' + ms + ' ms（其中前 0.8 秒画面里没有条码）；合成画面，真机效果需现场验证';
      } finally { await p.close(); }
    }
  },
  {
    name: '实时扫码（浏览器自带 BarcodeDetector，测试桩）：使用自带识别，连续两帧一致才采用',
    fn: async () => {
      const w = L.createWorld();
      const p = await newCase(w, { initScript: S.fakeCameraScript(ZHONGHUA, { native: ZHONGHUA, delayMs: 300 }) }); const page = p.page;
      try {
        await page.click('[data-action=seized-add]');
        await page.click('[data-action=scan-barcode]');
        await page.waitForFunction(() => document.querySelector('.scanner .scan-engine') && document.querySelector('.scanner .scan-engine').textContent === '浏览器自带识别');
        await page.waitForSelector('.scanner', { state: 'detached', timeout: 15000 });
        assert(await brandValue(page) === '中华（硬）', '应带出品规');
        const calls = await page.evaluate(() => window.__cam.nativeCalls);
        assert(calls >= 2, '应至少识别两帧：' + calls);
        return '';
      } finally { await p.close(); }
    }
  },
  {
    name: '扫码：拒绝摄像头权限时给出说明，可改用"拍照识别"（内置识别库识别照片中的条码，照片作为品规照片）',
    fn: async () => {
      const w = L.createWorld();
      const photo = await S.barcodePhoto('bc-zhonghua', ZHONGHUA, { rot: 4 });
      const p = await newCase(w, { initScript: S.fakeCameraScript(ZHONGHUA, { deny: true }) }); const page = p.page;
      try {
        await page.click('[data-action=seized-add]');
        await page.click('[data-action=scan-barcode]');
        await page.waitForSelector('.scan-status.bad:has-text("没有摄像头权限")');
        assert(await page.isVisible('.scanner [data-sc=retry]'), '应显示"重试"');
        const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.click('.scanner [data-sc=photo]')]);
        await fc.setFiles(photo);
        await page.waitForFunction(() => { const i = document.querySelector('form[data-form=seized] [name=brand]'); return i && i.value === '中华（硬）'; }, null, { timeout: 15000 });
        assert(await page.$('.modal .mini img'), '扫码照片应作为品规照片');
        assert(await page.evaluate(() => document.activeElement && document.activeElement.name === 'qty'), '识别成功后光标应跳到数量');
        return '';
      } finally { await p.close(); }
    }
  },
  {
    name: '扫码：不能直接用摄像头时（如 http 局域网地址）自动改用拍照识别；竖拍的条码也能识别；照片中没有条码时提示',
    fn: async () => {
      const w = L.createWorld();
      const vertical = await S.barcodePhoto('bc-zhonghua-v', ZHONGHUA, { rot: 88, module: 5 });
      const noCam = () => { delete window.BarcodeDetector; Object.defineProperty(Navigator.prototype, 'mediaDevices', { get: () => undefined, configurable: true }); };
      const p = await newCase(w, { initScript: noCam }); const page = p.page;
      try {
        await page.click('[data-action=seized-add]');
        let [fc] = await Promise.all([page.waitForEvent('filechooser'), page.click('[data-action=scan-barcode]')]);
        assert((await L.toastText(page)).includes('已改用拍照识别'), '应提示改用拍照识别');
        await fc.setFiles(vertical);
        await page.waitForFunction(() => { const i = document.querySelector('form[data-form=seized] [name=brand]'); return i && i.value === '中华（硬）'; }, null, { timeout: 15000 });
        [fc] = await Promise.all([page.waitForEvent('filechooser'), page.click('[data-action=scan-barcode]')]);
        await fc.setFiles(L.img('sharp'));
        await page.waitForFunction(() => [...document.querySelectorAll('.toast')].some(t => t.textContent.includes('未识别到条码')), null, { timeout: 15000 });
        assert(await brandValue(page) === '中华（硬）', '识别失败时保留上一次的识别结果');
        return '';
      } finally { await p.close(); }
    }
  },
  {
    name: '扫码：浏览器既无自带识别、内置识别库也不可用时，提示手工输入，不打开摄像头',
    fn: async () => {
      const w = L.createWorld();
      const p = await newCase(w, { initScript: () => { delete window.BarcodeDetector; Object.defineProperty(window, 'ZXingLite', { get: () => undefined, set: () => {}, configurable: true }); } }); const page = p.page;
      try {
        await page.click('[data-action=seized-add]');
        await page.click('[data-action=scan-barcode]');
        await page.waitForSelector('#barcode-msg:has-text("无法识别条码")');
        assert(!(await page.$('.scanner')), '不应打开扫码界面');
        await page.fill('form[data-form=seized] [name=barcode]', '075015');
        await page.waitForSelector('#barcode-msg:has-text("中华（硬）")');
        return '';
      } finally { await p.close(); }
    }
  },
  {
    name: '扫码：手机返回键 / Esc 关闭扫码界面并关闭摄像头，录入弹窗保留',
    fn: async () => {
      const w = L.createWorld();
      const p = await newCase(w, { initScript: S.fakeCameraScript('') }); const page = p.page;
      try {
        await page.click('[data-action=seized-add]');
        await page.click('[data-action=scan-barcode]');
        await page.waitForFunction(() => window.__cam.opened === 1 && document.querySelector('.scanner video').readyState >= 2);
        await page.evaluate(() => history.back());
        await page.waitForSelector('.scanner', { state: 'detached' });
        assert(await page.$('form[data-form=seized]'), '录入弹窗应保留');
        assert(await page.evaluate(() => window.__cam.stopped >= 1), '应关闭摄像头');
        await page.click('[data-action=scan-barcode]');
        await page.waitForFunction(() => window.__cam.opened === 2);
        await page.keyboard.press('Escape');
        await page.waitForSelector('.scanner', { state: 'detached' });
        await page.click('[data-action=scan-barcode]');
        await page.waitForFunction(() => window.__cam.opened === 3);
        await page.click('.scanner [data-sc=manual]');
        await page.waitForSelector('.scanner', { state: 'detached' });
        assert(await page.evaluate(() => document.activeElement && document.activeElement.name === 'barcode'), '"手动输入"应把光标放到条码框');
        const live = await page.evaluate(() => window.__cam.tracks.filter(t => t.readyState === 'live').length);
        assert(live === 0, '所有摄像头画面都应已关闭：' + live);
        return '';
      } finally { await p.close(); }
    }
  },
  {
    name: '图片计数：框选一条 → 自动数出相同的（不数其他品牌）→ 点标记剔除/恢复、点漏数处补上 → 填入数量；计数照片作为品规照片，数量依据写入证据清单',
    fn: async () => {
      const w = L.createWorld();
      const pile = await S.pilePhoto('pile-a', { other: [1, 5, 7, 12] }); // 16 条中华 + 4 条其他品牌
      const p = await newCase(w, {}, 'SC-002', true); const page = p.page;
      try {
        await page.click('[data-action=seized-add]');
        await page.fill('form[data-form=seized] [name=barcode]', '075015');
        await page.waitForSelector('#barcode-msg:has-text("中华（硬）")');
        const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.click('[data-action=count-photo][data-src=camera]')]);
        await fc.setFiles(pile.file);
        await page.waitForSelector('.counter canvas.boxing');
        await boxFirst(page, pile);
        let n = await countNow(page);
        assert(n === 16, '应数出 16 条（不含其他品牌）：' + n);
        await tapOnCounter(page, pile.W, pile.H, center(pile.boxes[2]));
        assert(await countNow(page) === 15 && (await page.textContent('.cnt-panel')).includes('人工剔除 1'), '点标记应剔除');
        await tapOnCounter(page, pile.W, pile.H, center(pile.boxes[2]));
        assert(await countNow(page) === 16, '再点应恢复');
        await tapOnCounter(page, pile.W, pile.H, center(pile.boxes[1]));
        assert(await countNow(page) === 17 && (await page.textContent('.cnt-panel')).includes('人工补 1'), '点空白处应补一个');
        await tapOnCounter(page, pile.W, pile.H, center(pile.boxes[1]));
        assert(await countNow(page) === 16, '再点补上的标记应撤销');
        await page.click('.counter [data-ct=done]');
        await page.waitForSelector('.counter', { state: 'detached' });
        await page.waitForFunction(() => document.querySelector('form[data-form=seized] [name=qty]') && document.querySelector('form[data-form=seized] [name=qty]').value === '16');
        assert(await page.$('.modal .mini img'), '计数照片应作为品规照片');
        assert((await page.textContent('.count-box')).includes('图片计数 16 条'), '弹窗中应显示计数结果');
        await page.click('form[data-form=seized] [type=submit]');
        await page.waitForSelector('form[data-form=seized]', { state: 'detached' });
        const list = await page.textContent('#seized-list');
        assert(list.includes('16 条') && list.includes('图片计数 16 条（自动识别 16，人工补 0，人工剔除 0）'), '列表应显示数量依据：' + list);
        const { zip } = await L.packageCase(page);
        const u = Z.unzip(zip);
        assert(u.manifest.includes('数量依据：图片计数 16 条（自动识别 16，人工补 0，人工剔除 0）'), '证据清单应写明数量依据');
        assert(u.files.includes('SC-002_涉案物品_1_中华（硬）.jpg'), '应含计数照片：' + u.files.join(','));
        assert(u.manifest.includes('图片计数'), '操作日志应记录图片计数');
        return '';
      } finally { await p.close(); }
    }
  },
  {
    name: '图片计数：分两张照片累加；第二张存为补充照片；之后手工改数量会注明"已人工修改"',
    fn: async () => {
      const w = L.createWorld();
      const a = await S.pilePhoto('pile-b1', { rows: 4, cols: 4, seed: 11 });
      const b = await S.pilePhoto('pile-b2', { rows: 2, cols: 4, seed: 21, y0: 300 });
      const p = await newCase(w, {}, 'SC-003'); const page = p.page;
      try {
        await page.click('[data-action=seized-add]');
        await page.fill('form[data-form=seized] [name=barcode]', '075015');
        await page.waitForSelector('#barcode-msg:has-text("中华（硬）")');
        let [fc] = await Promise.all([page.waitForEvent('filechooser'), page.click('[data-action=count-photo][data-src=album]')]);
        await fc.setFiles(a.file);
        await page.waitForSelector('.counter canvas.boxing');
        await boxFirst(page, a, 5);
        assert(await countNow(page) === 16, '第一张应为 16：' + await countNow(page));
        await page.click('.counter [data-ct=done]');
        await page.waitForFunction(() => document.querySelector('form[data-form=seized] [name=qty]').value === '16');
        [fc] = await Promise.all([page.waitForEvent('filechooser'), page.click('[data-action=count-photo][data-src=album]')]);
        await fc.setFiles(b.file);
        await page.waitForSelector('.counter canvas.boxing');
        await boxFirst(page, b, 0);
        assert(await countNow(page) === 8, '第二张应为 8：' + await countNow(page));
        assert(await page.isVisible('.counter [data-ct=done][data-mode=add]:has-text("累加为 24")'), '已有数量时应可累加');
        await page.click('.counter [data-ct=done][data-mode=add]');
        await page.waitForFunction(() => document.querySelector('form[data-form=seized] [name=qty]').value === '24');
        await page.click('form[data-form=seized] [type=submit]');
        await page.waitForSelector('form[data-form=seized]', { state: 'detached' });
        let list = await page.textContent('#seized-list');
        assert(list.includes('图片计数 2 张照片 16 + 8 = 24 条'), '应注明两张照片累加：' + list);
        const extras = await page.textContent('#sec-extras + .card');
        assert(extras.includes('图片计数：中华（硬） 8条'), '第二张计数照片应存为补充照片：' + extras);
        await page.click('[data-action=seized-edit]');
        await page.fill('form[data-form=seized] [name=qty]', '23');
        await page.click('form[data-form=seized] [type=submit]');
        await page.waitForSelector('form[data-form=seized]', { state: 'detached' });
        list = await page.textContent('#seized-list');
        assert(list.includes('登记数量已人工改为 23 条'), '手工改数量后应注明：' + list);
        return '';
      } finally { await p.close(); }
    }
  },
  {
    name: '图片计数：重新计数选"填入"时替换本次之前的计数（照片和数量依据都只保留最后一次），不多存补充照片',
    fn: async () => {
      const w = L.createWorld();
      const a = await S.pilePhoto('pile-d', { rows: 3, cols: 4, seed: 5 });
      const p = await newCase(w, {}, 'SC-004'); const page = p.page;
      try {
        await page.click('[data-action=seized-add]');
        await page.fill('form[data-form=seized] [name=barcode]', '075015');
        await page.waitForSelector('#barcode-msg:has-text("中华（硬）")');
        for (const removeOne of [false, true]) {
          const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.click('[data-action=count-photo][data-src=album]')]);
          await fc.setFiles(a.file);
          await page.waitForSelector('.counter canvas.boxing');
          await boxFirst(page, a, 0);
          if (removeOne) await tapOnCounter(page, a.W, a.H, center(a.boxes[11]));
          await page.click('.counter [data-ct=done][data-mode=replace]');
          await page.waitForSelector('.counter', { state: 'detached' });
        }
        await page.waitForFunction(() => document.querySelector('form[data-form=seized] [name=qty]').value === '11');
        await page.click('form[data-form=seized] [type=submit]');
        await page.waitForSelector('form[data-form=seized]', { state: 'detached' });
        const list = await page.textContent('#seized-list');
        assert(list.includes('11 条') && list.includes('图片计数 11 条（自动识别 12，人工补 0，人工剔除 1）') && !list.includes('12 条（'), '应只保留最后一次计数：' + list);
        assert(!(await page.$('#sec-extras + .card .list-item')), '不应多存补充照片');
        assert(await page.$('#seized-list .mini img'), '最后一次的计数照片作为品规照片');
        return '';
      } finally { await p.close(); }
    }
  },
  {
    name: '图片计数算法：合成的码放照片（透视、轻微旋转、调头、光照不均、模糊噪声、混入外观相近的品牌）计数准确',
    fn: async () => {
      const w = L.createWorld();
      const configs = [
        { name: '4×5 整齐', o: {} },
        { name: '混入外观相近的红色品牌', o: { other: [1, 5, 7, 12], otherBrand: 'fur' } },
        { name: '透视明显', o: { persp: 0.35, rows: 7, cols: 5, cw: 220, ch: 70, x0: 20, y0: 10 } },
        { name: '旋转±8°、错位、模糊', o: { rot: 8, jitter: 10, blur: 1.5, noise: 15 } },
        { name: '部分调头摆放', o: { flip: [2, 3, 9] } },
        { name: '80 条小目标', o: { rows: 10, cols: 8, cw: 140, ch: 46, x0: 10, y0: 10, gap: 2 } },
        { name: '侧面窄条 12 层', o: { cw: 250, ch: 42, rows: 12, cols: 4, gap: 1, x0: 40, y0: 20 } }
      ];
      const p = await L.openPage(w); const page = p.page;
      const out = [];
      try {
        for (const c of configs) {
          const pile = await S.pilePhoto('algo-' + out.length, c.o);
          const url = 'data:image/jpeg;base64,' + require('fs').readFileSync(pile.file).toString('base64');
          const r = await page.evaluate(async ({ url, pile }) => {
            const img = new Image(); img.src = url; await img.decode();
            const cv = document.createElement('canvas'); cv.width = img.width; cv.height = img.height; const x = cv.getContext('2d'); x.drawImage(img, 0, 0);
            const d = x.getImageData(0, 0, cv.width, cv.height).data; const g = new Float32Array(cv.width * cv.height);
            for (let i = 0, j = 0; i < g.length; i++, j += 4) g[i] = 0.299 * d[j] + 0.587 * d[j + 1] + 0.114 * d[j + 2];
            const A = window.__EVIDENCE_APP__;
            const pick = pile.boxes[0];
            const t0 = performance.now();
            const cands = A.findSimilar(g, cv.width, cv.height, { x: pick.x + 3, y: pick.y + 3, w: pick.w - 6, h: pick.h - 6 }, {});
            const ms = performance.now() - t0;
            const thr = A.autoThreshold(cands);
            const acc = cands.filter(c => c.score >= thr);
            const truth = pile.boxes.filter(b => b.brand === pick.brand);
            const hit = b => acc.some(c => Math.abs(c.x + c.w / 2 - (b.x + b.w / 2)) < b.w * 0.3 && Math.abs(c.y + c.h / 2 - (b.y + b.h / 2)) < b.h * 0.3);
            return { truth: truth.length, found: acc.length, tp: truth.filter(hit).length, ms: Math.round(ms) };
          }, { url, pile: { boxes: pile.boxes } });
          out.push(c.name + ' ' + r.found + '/' + r.truth + '（' + r.ms + 'ms）');
          assert(r.found === r.truth && r.tp === r.truth, c.name + '：应数出 ' + r.truth + '，实际 ' + r.found + '（命中 ' + r.tp + '）');
        }
        return out.join('；') + '。仅为合成图测试，真实照片效果需现场验证';
      } finally { await p.close(); }
    }
  },
  {
    name: '扫码、计数界面在 360px 宽手机上不出现横向滚动，按钮都在屏幕内',
    fn: async () => {
      const w = L.createWorld();
      const pile = await S.pilePhoto('pile-c', { rows: 3, cols: 3 });
      const p = await newCase(w, { viewport: { width: 360, height: 640 }, initScript: S.fakeCameraScript('', { deny: true }) }); const page = p.page;
      try {
        const check = async label => {
          const r = await page.evaluate(() => {
            const vw = window.innerWidth, vh = window.innerHeight;
            const bad = [...document.querySelectorAll('.overlay button')].filter(b => b.offsetParent !== null).filter(b => { const r = b.getBoundingClientRect(); return r.left < -1 || r.right > vw + 1 || r.bottom > vh + 1 || r.top < -1; }).map(b => b.textContent);
            return { sw: document.documentElement.scrollWidth, vw, bad };
          });
          assert(r.sw <= r.vw && !r.bad.length, label + '：横向溢出或按钮超出屏幕 ' + JSON.stringify(r));
        };
        await page.click('[data-action=seized-scan]');
        await page.waitForSelector('.scan-status.bad');
        await check('扫码界面（无权限）');
        await page.click('.scanner [data-sc=close]');
        const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.click('[data-action=count-photo][data-src=album]')]);
        await fc.setFiles(pile.file);
        await page.waitForSelector('.counter canvas.boxing');
        await check('计数界面（框选）');
        await boxFirst(page, pile);
        await check('计数界面（核对）');
        await page.click('.counter [data-ct=zoom]');
        await check('计数界面（放大）');
        return '';
      } finally { await p.close(); }
    }
  }
];
