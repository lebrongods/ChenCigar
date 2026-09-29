const L = require('./lib');
const Z = require('./zip');
const { assert } = L;

async function readyCase(w, opts) {
  const p = await L.openPage(w, opts); const page = p.page;
  await L.setupAdmin(page);
  await L.createCase(page, 'S-001');
  await L.captureAllRequired(page);
  return p;
}
async function packBlockedText(page) {
  await page.click('[data-action=package]');
  await page.waitForSelector('#pack-result.alert-danger');
  return page.textContent('#pack-result');
}

module.exports = [
  {
    name: '查获卷烟：品规为空 / 数量为 0 均拦截打包；补全后可打包',
    fn: async () => {
      const w = L.createWorld(); const p = await readyCase(w); const page = p.page;
      try {
        await L.addSeized(page, { brand: '', qty: 10 });
        let t = await packBlockedText(page);
        assert(t.includes('信息不完整') && t.includes('第 1 条：品规未填'), '品规为空应拦截：' + t);
        await page.click('[data-action=seized-edit]');
        await page.fill('form[data-form=seized] [name=brand]', '某品牌（软）');
        await page.fill('form[data-form=seized] [name=qty]', '0');
        await page.click('form[data-form=seized] [type=submit]');
        await page.waitForSelector('form[data-form=seized]', { state: 'detached' });
        t = await packBlockedText(page);
        assert(t.includes('第 1 条：数量须大于 0'), '数量为 0 应拦截：' + t);
        await page.click('[data-action=seized-edit]');
        await page.fill('form[data-form=seized] [name=qty]', '3');
        await page.selectOption('form[data-form=seized] [name=unit]', '件');
        await page.click('form[data-form=seized] [type=submit]');
        await page.waitForSelector('form[data-form=seized]', { state: 'detached' });
        const { zip } = await L.packageCase(page);
        const u = Z.unzip(zip);
        assert(u.manifest.includes('品规：某品牌（软）　数量：3 件'), '清单应含查获登记');
        return '';
      } finally { await p.close(); }
    }
  },
  {
    name: '查获卷烟：手工输入条码；校验位错误给出提示；条码自动学习并带出品规',
    fn: async () => {
      const w = L.createWorld(); const p = await readyCase(w); const page = p.page;
      try {
        await page.click('[data-action=seized-add]');
        await page.fill('form[data-form=seized] [name=barcode]', '6901028075016');
        await page.waitForSelector('#barcode-msg:has-text("校验位不符")');
        await page.fill('form[data-form=seized] [name=barcode]', '6901028075015');
        await page.waitForFunction(() => !document.querySelector('#barcode-msg').textContent.includes('校验位不符'));
        await page.fill('form[data-form=seized] [name=brand]', '测试品规甲');
        await page.fill('form[data-form=seized] [name=qty]', '2');
        await page.click('form[data-form=seized] [type=submit]');
        await page.waitForSelector('form[data-form=seized]', { state: 'detached' });
        assert(JSON.parse(w.shared.get('barcode-dict'))['6901028075015'] === '测试品规甲', '条码应写入条码库');
        await page.click('[data-action=seized-add]');
        await page.fill('form[data-form=seized] [name=barcode]', '6901028075015');
        const brand = await page.inputValue('form[data-form=seized] [name=brand]');
        assert(brand === '测试品规甲', '同一条码应自动带出品规，实际：' + brand);
        await page.click('[data-action=modal-close]');
        return '';
      } finally { await p.close(); }
    }
  },
  {
    name: '条码：浏览器无 BarcodeDetector 时点"扫码"不崩溃，提示手工输入',
    fn: async () => {
      const w = L.createWorld(); const p = await readyCase(w, { initScript: () => { delete window.BarcodeDetector; } }); const page = p.page;
      try {
        assert(!(await page.evaluate(() => 'BarcodeDetector' in window)), '测试前提：无 BarcodeDetector');
        await page.click('[data-action=seized-add]');
        await page.click('[data-action=scan-barcode]');
        await page.waitForSelector('#barcode-msg:has-text("不支持条码自动识别")');
        await page.fill('form[data-form=seized] [name=barcode]', '6901028075015');
        await page.fill('form[data-form=seized] [name=brand]', '手工品规');
        await page.fill('form[data-form=seized] [name=qty]', '1');
        await page.click('form[data-form=seized] [type=submit]');
        await page.waitForSelector('form[data-form=seized]', { state: 'detached' });
        assert((await page.textContent('#seized-list')).includes('6901028075015'), '手工输入的条码应保存');
        assert(p.errors.length === 0, '控制台不应有错误：' + p.errors.join(';'));
        return '';
      } finally { await p.close(); }
    }
  },
  {
    name: '条码：BarcodeDetector 可用时（测试桩）扫码填入条码，并把该照片作为品规照片',
    fn: async () => {
      const w = L.createWorld();
      const stub = () => {
        window.BarcodeDetector = class { constructor(o) { this.o = o; } static async getSupportedFormats() { return ['ean_13', 'code_128']; } async detect() { return [{ rawValue: '6901028075015', format: 'ean_13' }]; } };
      };
      const p = await readyCase(w, { initScript: stub }); const page = p.page;
      try {
        await page.click('[data-action=seized-add]');
        const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.click('[data-action=scan-barcode]')]);
        await fc.setFiles(L.img('sharp'));
        await page.waitForFunction(() => { const i = document.querySelector('form[data-form=seized] [name=barcode]'); return i && i.value === '6901028075015'; });
        assert((await page.textContent('#barcode-msg')).includes('已识别条码'), '应提示已识别');
        assert(await page.$('.modal .mini img'), '扫码照片应作为品规照片显示');
        await page.fill('form[data-form=seized] [name=brand]', '扫码品规');
        await page.fill('form[data-form=seized] [name=qty]', '4');
        await page.click('form[data-form=seized] [type=submit]');
        await page.waitForSelector('form[data-form=seized]', { state: 'detached' });
        const { zip } = await L.packageCase(page);
        const u = Z.unzip(zip);
        assert(u.files.includes('S-001_查获卷烟_1_扫码品规.jpg'), '证据包应含查获卷烟照片：' + u.files.join(','));
        return '仅验证识别结果的处理流程；真机识别率未测';
      } finally { await p.close(); }
    }
  }
];
