// 测试报告问题的回归测试
const L = require('./lib');
const Z = require('./zip');
const { assert } = L;
const fs = require('fs');
const path = require('path');
const { readXlsx } = require('./xlsx');

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
  },
  {
    name: 'BUG-04 价格目录更新后：旧记录的核价表价格依据仍引用登记时的目录；新旧混合时分别列出；导入目录名称不重复拼接',
    fn: async () => {
      const w = L.createWorld(); const p = await readyCase(w, 'F-004'); const page = p.page;
      try {
        await L.addSeized(page, { barcode: '075015', qty: 10 });
        // 管理员导入 2026 年目录
        await page.click('[data-action=back]').catch(() => {});
        await page.waitForSelector('.tabbar');
        await page.click('.tabbar [data-view=admin]');
        await page.click('[data-action=goto][data-view=prices]');
        const csv = path.join(L.TMP, 'catalog-2026.csv');
        fs.writeFileSync(csv, '﻿序号,条包条形码,规格名称,工业公司名称,建议零售价,单位\n1,6901028075015,中华（硬）,上海烟草,480,元/条\n2,6901028123456,新品规,某中烟,99,元/条\n');
        const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.click('[data-action=catalog-import]')]);
        await fc.setFiles(csv);
        await page.fill('form[data-form=prompt] [name=value]', '2026年上半年湖南省卷烟品牌价格目录');
        await page.click('form[data-form=prompt] [type=submit]');
        await L.confirmModal(page, true);
        await page.waitForSelector('.toast:has-text("已导入价格目录")');
        await page.click('[data-action=back]');
        await page.click('.tabbar [data-view=cases]');
        await page.click('#case-list .case-card:has-text("F-004")');
        await page.waitForSelector('#seized-list');
        let { zip } = await L.packageCase(page);
        let u = Z.unzip(zip);
        const sheetName = u.files.find(f => f.endsWith('核价表.xlsx'));
        let x = await readXlsx(fs.readFileSync(path.join(u.dir, sheetName)));
        let basis = Object.values(x.cells).find(v => typeof v === 'string' && v.startsWith('根据'));
        assert(basis.includes('2025年下半年') && !basis.includes('2026'), '旧记录应引用登记时的 2025 年目录：' + basis);
        assert(u.manifest.includes('价格目录 2025年下半年'), '清单与核价表一致');
        // 新登记一条（按 2026 年目录），价格依据两个版本都列出，且名称不重复拼接
        await L.addSeized(page, { barcode: '123456', qty: 1 });
        ({ zip } = await L.packageCase(page));
        u = Z.unzip(zip);
        x = await readXlsx(fs.readFileSync(path.join(u.dir, u.files.find(f => f.endsWith('核价表.xlsx')))));
        basis = Object.values(x.cells).find(v => typeof v === 'string' && v.startsWith('根据'));
        assert(basis.includes('2025年下半年湖南省国产卷烟品牌价格目录') && basis.includes('《2026年上半年湖南省卷烟品牌价格目录》') && !/价格目录湖南省/.test(basis), '两个版本分别列出且不重复拼接：' + basis);
        assert(u.manifest.includes('价格目录 2026年上半年'), '新记录清单写短版本号');
        return '';
      } finally { await p.close(); }
    }
  },
  {
    name: 'BUG-06 打包校验的错误卡在补拍后失效，不再显示"缺 N 项"',
    fn: async () => {
      const w = L.createWorld(); const p = await L.openPage(w); const page = p.page;
      try {
        await L.setupAdmin(page);
        await L.createCase(page, 'F-006');
        await page.click('[data-action=package]');
        await page.waitForSelector('#pack-result.alert-danger:has-text("缺")');
        await L.captureAllRequired(page);
        assert(!(await page.$('#pack-result')), '补拍后旧的错误卡应消失');
        return '';
      } finally { await p.close(); }
    }
  },
  {
    name: 'BUG-07 存储删除失败时不提示"已删除"；案件索引写入失败时不提示"案件已创建"',
    fn: async () => {
      const w = L.createWorld(); const p = await L.openPage(w); const page = p.page;
      try {
        await L.setupAdmin(page);
        await L.createCase(page, 'F-007');
        const id = await L.captureItem(page, '车头照片', L.img('sharp'));
        await page.evaluate(() => document.querySelectorAll('.toast').forEach(t => t.remove()));
        w.failDel = true;
        await page.click('.tile[data-item-id="' + id + '"] img[data-action=view-photo]');
        await page.click('[data-action=photo-del]');
        await L.confirmModal(page, true);
        await page.waitForSelector('#save-banner:not([hidden]):has-text("删除失败")');
        const t = await L.toastText(page);
        assert(!t.includes('已删除') && t.includes('删除失败'), '删除失败不应提示已删除：' + t);
        w.failDel = false;
        assert(JSON.parse(w.shared.get('case:' + JSON.parse(w.shared.get('case-index'))[0].id)).evidence, '案件仍可读');
        await page.click('#save-banner-close');
        // 索引写失败
        await page.click('[data-action=back]');
        await page.waitForSelector('#case-list');
        await page.evaluate(() => document.querySelectorAll('.toast').forEach(t => t.remove()));
        w.failKeys = new Set(['case-index']);
        await page.click('[data-action=new-case]');
        await page.fill('form[data-form=newCase] [name=number]', 'F-007B');
        await page.click('.type-choice label:has-text("无证运输")');
        await page.click('form[data-form=newCase] [type=submit]');
        await page.waitForSelector('#save-banner:not([hidden])');
        await page.waitForTimeout(300);
        assert(!(await L.toastText(page)).includes('案件已创建'), '索引写入失败不应提示案件已创建');
        assert(await page.$('form[data-form=newCase]'), '应留在新建页');
        w.failKeys = null;
        return '';
      } finally { await p.close(); }
    }
  },
  {
    name: 'BUG-10 本地条码库里的品名可以反查出条码和单价',
    fn: async () => {
      const w = L.createWorld(); const p = await readyCase(w, 'F-010'); const page = p.page;
      try {
        await page.click('[data-action=seized-add]');
        await page.fill('form[data-form=seized] [name=barcode]', '6901234567892');
        await page.fill('form[data-form=seized] [name=brand]', '本地测试品规');
        await page.fill('form[data-form=seized] [name=price]', '88');
        await page.fill('form[data-form=seized] [name=qty]', '1');
        await page.click('form[data-form=seized] [type=submit]');
        await page.waitForSelector('form[data-form=seized]', { state: 'detached' });
        await page.click('[data-action=seized-add]');
        await page.fill('form[data-form=seized] [name=brand]', '本地测试品规');
        await page.waitForFunction(() => document.querySelector('form[data-form=seized] [name=price]').value === '88');
        assert((await page.textContent('#barcode-msg')).includes('6901234567892'), '应带出本地条码库中的条码');
        await page.click('[data-action=modal-close]');
        return '';
      } finally { await p.close(); }
    }
  },
  {
    name: 'BUG-11 "临时编号"连续生成不重复，可连续建案',
    fn: async () => {
      const w = L.createWorld(); const p = await L.openPage(w); const page = p.page;
      try {
        await L.setupAdmin(page);
        const nums = [];
        for (let i = 0; i < 2; i++) {
          await page.click('.tabbar [data-view=cases]').catch(() => {});
          await page.click('[data-action=new-case]');
          await page.click('[data-action=gen-number]');
          nums.push(await page.inputValue('form[data-form=newCase] [name=number]'));
          await page.click('.type-choice label:has-text("无证运输")');
          await page.click('form[data-form=newCase] [type=submit]');
          await page.waitForSelector('.tiles');
          await page.click('[data-action=back]');
          await page.waitForSelector('#case-list');
        }
        assert(nums[0] !== nums[1], '两个临时编号应不同：' + nums.join(' / '));
        return nums.join('、');
      } finally { await p.close(); }
    }
  },
  {
    name: 'BUG-12 案件页点"返回"回到列表后，浏览器/手机返回不会再进入该案件',
    fn: async () => {
      const w = L.createWorld(); const p = await L.openPage(w); const page = p.page;
      try {
        await L.setupAdmin(page);
        await L.createCase(page, 'F-012');
        await page.click('[data-action=back]');
        await page.waitForSelector('#case-list');
        await page.click('#case-list .case-card:has-text("F-012")');
        await page.waitForSelector('.tiles');
        await page.click('[data-action=back]');
        await page.waitForSelector('#case-list');
        await page.evaluate(() => history.back());
        await page.waitForTimeout(600);
        assert(!(await page.$('.tiles')), '浏览器返回后不应又打开案件');
        return '';
      } finally { await p.close(); }
    }
  }
];
