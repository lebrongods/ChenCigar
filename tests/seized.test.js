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
    name: '涉案物品（卷烟）：品规为空 / 数量为 0 均拦截打包；补全后可打包',
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
    name: '涉案物品（卷烟）：目录外条码手工录入品规和单价；校验位错误提示；自动记入本地条码库，下次输后 6 位带出',
    fn: async () => {
      const w = L.createWorld(); const p = await readyCase(w); const page = p.page;
      try {
        await page.click('[data-action=seized-add]');
        await page.fill('form[data-form=seized] [name=barcode]', '6901028999990');
        await page.waitForSelector('#barcode-msg:has-text("校验位不符")');
        await page.fill('form[data-form=seized] [name=barcode]', '6901028999991');
        await page.waitForSelector('#barcode-msg:has-text("都没有该条码")');
        await page.fill('form[data-form=seized] [name=brand]', '测试品规甲');
        await page.fill('form[data-form=seized] [name=qty]', '2');
        await page.fill('form[data-form=seized] [name=price]', '88');
        await page.click('form[data-form=seized] [type=submit]');
        await page.waitForSelector('form[data-form=seized]', { state: 'detached' });
        const dict = JSON.parse(w.shared.get('barcode-dict'))['6901028999991'];
        assert(dict && dict.brand === '测试品规甲' && dict.price === 88, '应写入本地条码库：' + JSON.stringify(dict));
        assert((await page.textContent('#seized-list')).includes('手工价'), '手工录入的价格应标"手工价"');
        await page.click('[data-action=seized-add]');
        await page.fill('form[data-form=seized] [name=barcode]', '999991');
        await page.waitForSelector('#barcode-msg:has-text("本地条码库")');
        assert(await page.inputValue('form[data-form=seized] [name=brand]') === '测试品规甲', '输入后 6 位应带出品规');
        assert(await page.inputValue('form[data-form=seized] [name=price]') === '88', '应带出单价');
        await page.click('[data-action=modal-close]');
        return '';
      } finally { await p.close(); }
    }
  },
  {
    name: '条码：拍照识别时 BarcodeDetector 可用（测试桩）则用它识别，填入条码，并把该照片作为品规照片',
    fn: async () => {
      const w = L.createWorld();
      const stub = () => {
        window.BarcodeDetector = class { constructor(o) { this.o = o; } static async getSupportedFormats() { return ['ean_13', 'code_128']; } async detect() { return [{ rawValue: '6901028075015', format: 'ean_13' }]; } };
        Object.defineProperty(Navigator.prototype, 'mediaDevices', { get: () => undefined, configurable: true }); // 不能直接用摄像头 → 拍照识别
      };
      const p = await readyCase(w, { initScript: stub }); const page = p.page;
      try {
        await page.click('[data-action=seized-add]');
        const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.click('[data-action=scan-barcode]')]);
        await fc.setFiles(L.img('sharp'));
        await page.waitForFunction(() => { const i = document.querySelector('form[data-form=seized] [name=barcode]'); return i && i.value === '6901028075015'; });
        assert((await page.textContent('#barcode-msg')).includes('中华（硬）'), '扫码后应从价格目录带出品规');
        assert(await page.inputValue('form[data-form=seized] [name=price]') === '450', '应带出建议零售价');
        assert(await page.evaluate(() => document.activeElement && document.activeElement.name === 'qty'), '扫码成功后光标应跳到数量');
        assert(await page.$('.modal .mini img'), '扫码照片应作为品规照片显示');
        await page.fill('form[data-form=seized] [name=qty]', '4');
        await page.click('form[data-form=seized] [type=submit]');
        await page.waitForSelector('form[data-form=seized]', { state: 'detached' });
        const { zip } = await L.packageCase(page);
        const u = Z.unzip(zip);
        assert(u.files.includes('S-001_涉案物品_1_中华（硬）.jpg'), '证据包应含涉案物品照片：' + u.files.join(','));
        return '仅验证识别结果的处理流程；真机识别率未测';
      } finally { await p.close(); }
    }
  }
];
