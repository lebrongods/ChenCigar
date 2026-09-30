// 测试公共工具：浏览器启动、window.storage 模拟、测试图片生成、常用操作
const fs = require('fs');
const path = require('path');
const os = require('os');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const APP = path.join(ROOT, '证据采集系统.html');
const APP_URL = 'file://' + APP;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'evidence-test-'));
const IMG = path.join(TMP, 'img');
const CHROME = fs.existsSync('/opt/pw-browsers/chromium-1194/chrome-linux/chrome') ? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' : undefined;

let browser = null;
async function getBrowser() {
  if (!browser) browser = await chromium.launch({ executablePath: CHROME, env: Object.assign({}, process.env, { LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8' }) });
  return browser;
}
async function closeBrowser() { if (browser) await browser.close(); browser = null; }

// 一个"世界"= 一份共享存储（模拟宿主 window.storage 的 shared 区），可被多个页面（多台手机）共用
function createWorld() {
  return { shared: new Map(), failSet: false, writes: 0 };
}

// 打开一个页面（相当于一台手机）。opts.noStorage=true 时不注入 window.storage（测试 IndexedDB 退化）
async function openPage(world, opts = {}) {
  const b = await getBrowser();
  const context = await b.newContext({
    viewport: opts.viewport || { width: 390, height: 844 },
    deviceScaleFactor: opts.deviceScaleFactor || 1,
    acceptDownloads: true,
    permissions: opts.permissions || [],
    geolocation: opts.geolocation
  });
  const page = await context.newPage();
  const personal = new Map();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  const requests = [];
  page.on('request', r => { if (!r.url().startsWith('file:') && !r.url().startsWith('data:') && !r.url().startsWith('blob:')) requests.push(r.url()); });
  if (!opts.noStorage) {
    const pick = shared => (shared ? world.shared : personal);
    await page.exposeFunction('__stGet', (k, s) => { const v = pick(s).get(k); return v === undefined ? null : { key: k, value: v, shared: s }; });
    await page.exposeFunction('__stSet', (k, v, s) => {
      if (world.failSet) return null;
      world.writes++;
      pick(s).set(k, v); return { key: k, value: v, shared: s };
    });
    await page.exposeFunction('__stDel', (k, s) => { pick(s).delete(k); return { key: k, deleted: true, shared: s }; });
    await page.exposeFunction('__stList', (p, s) => ({ keys: [...pick(s).keys()].filter(k => k.startsWith(p || '')), prefix: p, shared: s }));
    await page.addInitScript(() => {
      window.storage = {
        get: (k, s) => window.__stGet(k, !!s),
        set: (k, v, s) => window.__stSet(k, v, !!s),
        delete: (k, s) => window.__stDel(k, !!s),
        list: (p, s) => window.__stList(p, !!s)
      };
    });
  }
  if (opts.initScript) await page.addInitScript(opts.initScript);
  if (opts.clock) await page.clock.install();
  await page.goto(APP_URL);
  await page.waitForFunction(() => window.__EVIDENCE_APP__ && window.__EVIDENCE_APP__.state.view !== 'loading');
  return { page, context, personal, errors, requests, close: () => context.close() };
}

// 生成测试图片（在浏览器 canvas 中绘制）
async function makeImages() {
  if (fs.existsSync(path.join(IMG, 'sharp.jpg'))) return IMG;
  fs.mkdirSync(IMG, { recursive: true });
  const b = await getBrowser();
  const page = await b.newPage();
  const out = await page.evaluate(() => {
    const W = 1600, H = 1200;
    function scene(x, seed) {
      const g = x.createLinearGradient(0, 0, W, H); g.addColorStop(0, '#8aa0a8'); g.addColorStop(1, '#c9b48a');
      x.fillStyle = g; x.fillRect(0, 0, W, H);
      let s = seed || 7; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
      for (let i = 0; i < 40; i++) { x.fillStyle = 'hsl(' + Math.floor(rnd() * 360) + ',50%,' + Math.floor(30 + rnd() * 40) + '%)'; x.fillRect(rnd() * W, rnd() * H, 60 + rnd() * 300, 40 + rnd() * 200); }
      x.fillStyle = '#111'; x.font = '48px sans-serif';
      for (let i = 0; i < 12; i++) x.fillText('卷烟 条码 6901028000000 样本 ' + i, 40 + rnd() * 200, 80 + i * 90);
      x.strokeStyle = '#222'; x.lineWidth = 2;
      for (let i = 0; i < W; i += 24) { x.beginPath(); x.moveTo(i, H - 200); x.lineTo(i, H - 40); x.stroke(); }
    }
    const res = {};
    const mk = (name, fn) => { const c = document.createElement('canvas'); c.width = W; c.height = H; fn(c.getContext('2d'), c); res[name] = c.toDataURL('image/jpeg', 0.92); };
    mk('sharp', x => scene(x, 7));
    mk('sharp2', x => scene(x, 99));
    mk('sharp3', x => scene(x, 1234));
    [0.6, 0.75, 0.85].forEach(a => mk('dark_' + a, x => { scene(x, 7); x.fillStyle = 'rgba(0,0,0,' + a + ')'; x.fillRect(0, 0, W, H); }));
    [0.6, 0.75, 0.85].forEach(a => mk('bright_' + a, x => { scene(x, 7); x.fillStyle = 'rgba(255,255,255,' + a + ')'; x.fillRect(0, 0, W, H); }));
    [1, 2, 4, 8].forEach(r => mk('blur_' + r, x => { const t = document.createElement('canvas'); t.width = W; t.height = H; scene(t.getContext('2d'), 7); x.filter = 'blur(' + r + 'px)'; x.drawImage(t, 0, 0); }));
    mk('flat', x => { const g = x.createLinearGradient(0, 0, W, 0); g.addColorStop(0, '#d8d4cc'); g.addColorStop(1, '#c8c4bc'); x.fillStyle = g; x.fillRect(0, 0, W, H); });
    mk('screenshot', x => { x.fillStyle = '#ededed'; x.fillRect(0, 0, W, H); x.font = '44px sans-serif'; for (let i = 0; i < 8; i++) { x.fillStyle = i % 2 ? '#95ec69' : '#fff'; x.fillRect(i % 2 ? 700 : 80, 60 + i * 140, 800, 100); x.fillStyle = '#111'; x.fillText('聊天记录 转账 ' + i, i % 2 ? 730 : 110, 125 + i * 140); } });
    return res;
  });
  for (const [k, v] of Object.entries(out)) fs.writeFileSync(path.join(IMG, k + '.jpg'), Buffer.from(v.split(',')[1], 'base64'));
  await page.close();
  return IMG;
}
const img = name => path.join(IMG, name + '.jpg');

/* ---------- 常用操作 ---------- */
async function setupAdmin(page, name = '管理员甲', pin = '123456') {
  await page.waitForSelector('form[data-form=setup]');
  await page.fill('form[data-form=setup] [name=name]', name);
  await page.fill('form[data-form=setup] [name=pin]', pin);
  await page.fill('form[data-form=setup] [name=pin2]', pin);
  await page.click('form[data-form=setup] [type=submit]');
  await page.waitForSelector('#case-list');
}
async function login(page, name, pin) {
  await page.waitForSelector('form[data-form=login]');
  const val = await page.$eval('form[data-form=login] select', (s, n) => [...s.options].find(o => o.textContent.startsWith(n + '（')).value, name);
  await page.selectOption('form[data-form=login] select', val);
  await page.fill('form[data-form=login] [name=pin]', pin);
  await page.click('form[data-form=login] [type=submit]');
}
async function loginOk(page, name, pin) { await login(page, name, pin); await page.waitForSelector('#case-list'); }
async function logout(page) {
  while (!(await page.$('.tabbar'))) await page.click('[data-action=back]');
  await page.click('.tabbar [data-view=me]');
  await page.click('[data-action=logout]');
  await page.waitForSelector('form[data-form=login]');
}
async function addUser(page, name, role, pin) {
  await page.click('.tabbar [data-view=admin]');
  await page.click('[data-action=goto][data-view=users]');
  await page.fill('form[data-form=addUser] [name=name]', name);
  await page.selectOption('form[data-form=addUser] [name=role]', role);
  await page.fill('form[data-form=addUser] [name=pin]', pin);
  await page.click('form[data-form=addUser] [type=submit]');
  await page.waitForSelector('.list-item >> text=' + name);
  await page.click('[data-action=back]');
}
async function createCase(page, number, typeName = '无证运输', extra = {}) {
  await page.click('.tabbar [data-view=cases]').catch(() => {});
  await page.click('[data-action=new-case]');
  await page.fill('form[data-form=newCase] [name=number]', number);
  await page.click('.type-choice label:has-text("' + typeName + '")');
  if (extra.address) await page.fill('form[data-form=newCase] [name=address]', extra.address);
  if (extra.party) await page.fill('form[data-form=newCase] [name=party]', extra.party);
  await page.click('form[data-form=newCase] [type=submit]');
  await page.waitForSelector('.tiles');
}
async function capture(page, selector, file) {
  const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.click(selector)]);
  await fc.setFiles(file);
  // 等待处理完成，或等待出现需要用户选择的弹窗（如替换确认）
  await page.waitForFunction(() => window.__EVIDENCE_APP__.idle || document.querySelector('.modal'));
}
async function captureItem(page, itemName, file, src = 'camera') {
  const tile = page.locator('.tile', { has: page.locator('.tile-name', { hasText: itemName }) }).first();
  const id = await tile.getAttribute('data-item-id');
  await capture(page, '.tile[data-item-id="' + id + '"] [data-action=capture][data-src=' + src + ']', file);
  return id;
}
async function captureAllRequired(page) {
  const ids = await page.$$eval('.tile.missing', els => els.map(e => e.dataset.itemId));
  const files = ['sharp', 'sharp2', 'sharp3'];
  let i = 0;
  for (const id of ids) {
    await capture(page, '.tile[data-item-id="' + id + '"] [data-action=capture][data-src=camera]', img(files[i++ % 3]));
    await page.waitForSelector('.tile.done[data-item-id="' + id + '"]');
  }
  return ids.length;
}
async function addSeized(page, { brand = '', qty = '', unit = '条', barcode = '', price } = {}) {
  await page.click('[data-action=seized-add]');
  await page.waitForSelector('form[data-form=seized]');
  if (barcode) await page.fill('form[data-form=seized] [name=barcode]', barcode);
  if (brand) await page.fill('form[data-form=seized] [name=brand]', brand);
  if (price !== undefined) await page.fill('form[data-form=seized] [name=price]', String(price));
  if (qty !== '') await page.fill('form[data-form=seized] [name=qty]', String(qty));
  await page.selectOption('form[data-form=seized] [name=unit]', unit);
  await page.click('form[data-form=seized] [type=submit]');
  await page.waitForSelector('form[data-form=seized]', { state: 'detached' });
}
async function packageCase(page) {
  const dl = page.waitForEvent('download', { timeout: 15000 });
  await page.click('[data-action=package]');
  const d = await dl;
  const target = path.join(TMP, 'dl-' + Date.now() + '-' + Math.random().toString(36).slice(2) + '.zip');
  await d.saveAs(target);
  await page.waitForSelector('#pack-result.alert-ok');
  return { zip: target, suggested: d.suggestedFilename() };
}
async function confirmModal(page, ok = true) {
  await page.waitForSelector('.modal [data-action=modal-ok]');
  await page.click('.modal [data-action=' + (ok ? 'modal-ok' : 'modal-cancel') + ']');
  await page.waitForSelector('.modal-mask', { state: 'detached' });
}
async function toastText(page) { return page.$$eval('.toast', els => els.map(e => e.textContent).join(' | ')); }

function assert(cond, msg) { if (!cond) throw new Error(msg || '断言失败'); }

module.exports = {
  ROOT, APP, APP_URL, TMP, getBrowser, closeBrowser, createWorld, openPage, makeImages, img,
  setupAdmin, login, loginOk, logout, addUser, createCase, capture, captureItem, captureAllRequired, addSeized, packageCase, confirmModal, toastText, assert
};
