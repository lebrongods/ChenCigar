// 测试报告问题的回归测试
const L = require('./lib');
const Z = require('./zip');
const { assert } = L;

async function readyCase(w, number) {
  const p = await L.openPage(w); const page = p.page;
  await L.setupAdmin(page);
  await L.createCase(page, number);
  await L.captureAllRequired(page);
  return p;
}

module.exports = [
  {
    name: '"件"按每件 50 条计价；单位无法折算或未核价的物品打包前提示"涉案金额不完整"，可返回补填',
    fn: async () => {
      const w = L.createWorld(); const p = await readyCase(w, 'F-001'); const page = p.page;
      try {
        await L.addSeized(page, { barcode: '075015', qty: 2, unit: '件' });
        assert((await page.textContent('#seized-list')).includes('45,000'), '2 件中华（硬）应为 100 条 × 450 = 45,000 元：' + await page.textContent('#seized-list'));
        await L.addSeized(page, { brand: '无价品规', qty: 3 });
        await page.click('[data-action=package]');
        await page.waitForSelector('.modal:has-text("涉案金额不完整")');
        assert((await page.textContent('.modal')).includes('无价品规'), '应列出未核价物品');
        await L.confirmModal(page, false);
        await page.waitForSelector('#pack-result.alert-danger:has-text("未计入涉案金额")');
        const { zip } = await L.packageCase(page);
        assert(Z.unzip(zip).manifest.includes('无价品规'), '确认后仍可打包');
        return '';
      } finally { await p.close(); }
    }
  },
  {
    name: 'PIN 连续输错锁定保存在本机，刷新页面后仍锁定',
    fn: async () => {
      const w = L.createWorld(); const p = await L.openPage(w); const page = p.page;
      try {
        await L.setupAdmin(page, '管理员甲', '123456');
        await L.logout(page);
        for (let i = 0; i < 5; i++) {
          await L.login(page, '管理员甲', '000000');
          await page.waitForFunction(i => document.querySelector('#login-msg').textContent.includes(i < 4 ? '还可尝试 ' + (4 - i) : '锁定'), i);
        }
        assert((await page.textContent('#login-msg')).includes('锁定'), '5 次后应锁定');
        await page.reload();
        await L.login(page, '管理员甲', '123456');
        await page.waitForSelector('#login-msg:has-text("秒后再试")');
        assert(!(await page.$('#case-list')), '刷新后锁定期内正确 PIN 也不能登录');
        return '';
      } finally { await p.close(); }
    }
  },
  {
    name: '相册导入的照片不记录当前定位，清单写"导入时间/相册导入，不记录位置"',
    fn: async () => {
      const w = L.createWorld();
      const p = await L.openPage(w, { permissions: ['geolocation'], geolocation: { latitude: 25.75, longitude: 112.73 } }); const page = p.page;
      try {
        await L.setupAdmin(page);
        await L.createCase(page, 'F-002');
        await L.captureAllRequired(page);
        await L.capture(page, '[data-action=capture][data-src=album][data-kind=extra]', L.img('sharp'));
        await page.waitForSelector('form[data-form=prompt]');
        await page.click('form[data-form=prompt] [type=submit]');
        await page.waitForFunction(() => window.__EVIDENCE_APP__.idle && !document.querySelector('.modal'));
        await L.addSeized(page, { barcode: '075015', qty: 1 });
        const { zip } = await L.packageCase(page);
        const m = Z.unzip(zip).manifest;
        const block = m.slice(m.indexOf('补充照片 1'));
        assert(block.includes('导入时间：') && block.includes('相册导入，不记录位置'), '相册照片应注明导入时间且不记录位置：' + block.slice(0, 300));
        assert(m.includes('25.75'), '现场拍摄的照片仍记录定位');
        return '';
      } finally { await p.close(); }
    }
  },
  {
    name: '条码带出品规后手工改成目录外品名：价格来源改为手工录入；单价不同不提示合并',
    fn: async () => {
      const w = L.createWorld(); const p = await readyCase(w, 'F-003'); const page = p.page;
      try {
        await L.addSeized(page, { barcode: '075015', qty: 2 });
        await page.click('[data-action=seized-add]');
        await page.fill('form[data-form=seized] [name=barcode]', '075015');
        await page.waitForSelector('#barcode-msg:has-text("中华（硬）")');
        await page.fill('form[data-form=seized] [name=brand]', '中华（硬）疑似假冒');
        await page.waitForSelector('#barcode-msg:has-text("品规已手工修改")');
        await page.fill('form[data-form=seized] [name=price]', '300');
        await page.fill('form[data-form=seized] [name=qty]', '1');
        await page.click('form[data-form=seized] [type=submit]');
        await page.waitForSelector('form[data-form=seized]', { state: 'detached' });
        const list = await page.textContent('#seized-list');
        assert(list.includes('中华（硬）疑似假冒') && list.includes('手工价'), '应为单独一行、手工价：' + list);
        const items = JSON.parse(w.shared.get('case:' + JSON.parse(w.shared.get('case-index'))[0].id)).seizedItems;
        assert(items.length === 2 && items[1].priceSource === 'manual' && items[1].price === 300, '第二条应保留自己的单价：' + JSON.stringify(items.map(x => [x.brand, x.price, x.priceSource])));
        return '';
      } finally { await p.close(); }
    }
  }
];
