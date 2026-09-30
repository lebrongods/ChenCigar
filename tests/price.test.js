const fs = require('fs');
const path = require('path');
const JSZip = require('jszip');
const L = require('./lib');
const Z = require('./zip');
const { assert } = L;

// 读取 xlsx 第一个工作表：返回 {cells: {A1: 值}, formulas: {E5: 'C5*D5'}, merges: [...], workbook}
async function readXlsx(buf) {
  const zip = await JSZip.loadAsync(buf);
  const xml = await zip.file('xl/worksheets/sheet1.xml').async('string');
  const workbook = await zip.file('xl/workbook.xml').async('string');
  const cells = {}, formulas = {};
  const unesc = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
  for (const m of xml.matchAll(/<c r="([A-Z]+\d+)"[^>]*?(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    const body = m[2] || '';
    const t = body.match(/<t[^>]*>([\s\S]*?)<\/t>/);
    const v = body.match(/<v>([\s\S]*?)<\/v>/);
    const f = body.match(/<f>([\s\S]*?)<\/f>/);
    if (t) cells[m[1]] = unesc(t[1]); else if (v) cells[m[1]] = Number(v[1]);
    if (f) formulas[m[1]] = f[1];
  }
  const merges = [...xml.matchAll(/<mergeCell ref="([^"]+)"/g)].map(m => m[1]);
  return { cells, formulas, merges, workbook };
}
async function openSeized(page) { await page.click('[data-action=seized-add]'); await page.waitForSelector('form[data-form=seized]'); }
const val = (page, n) => page.inputValue('form[data-form=seized] [name=' + n + ']');

module.exports = [
  {
    name: '价格目录：输入条码后 6 位自动带出品规和建议零售价，小计实时计算',
    fn: async () => {
      const w = L.createWorld(); const p = await L.openPage(w); const page = p.page;
      try {
        await L.setupAdmin(page);
        await L.createCase(page, 'PR-001');
        await openSeized(page);
        await page.fill('form[data-form=seized] [name=barcode]', '075015');
        await page.waitForSelector('#barcode-msg .match.ok');
        assert(await val(page, 'brand') === '中华（硬）' && await val(page, 'price') === '450', '后 6 位应带出 中华（硬） 450');
        assert((await page.textContent('#barcode-msg')).includes('6901028075015'), '应显示完整条码');
        await page.fill('form[data-form=seized] [name=qty]', '20');
        assert((await page.textContent('#subtotal')).includes('9,000 元'), '小计应为 9,000 元：' + await page.textContent('#subtotal'));
        // 包折算
        await page.selectOption('form[data-form=seized] [name=unit]', '包');
        await page.fill('form[data-form=seized] [name=qty]', '25');
        const t = await page.textContent('#subtotal');
        assert(t.includes('25包 = 2.5 条') && t.includes('1,125 元'), '25 包应折算为 2.5 条、1125 元：' + t);
        // 完整 13 位
        await page.fill('form[data-form=seized] [name=barcode]', '6901028118187');
        await page.waitForFunction(() => document.querySelector('form[data-form=seized] [name=brand]').value === '利群（新版）');
        assert(await val(page, 'price') === '180', '完整条码应带出 180');
        // 雪茄按支计价，单位自动改为支
        await page.fill('form[data-form=seized] [name=barcode]', '131834');
        await page.waitForFunction(() => document.querySelector('form[data-form=seized] [name=brand]').value === '王冠（国粹）');
        assert(await val(page, 'unit') === '支' && (await page.textContent('#price-unit')) === '支', '雪茄单位应自动为支');
        // 查不到
        await page.fill('form[data-form=seized] [name=barcode]', '000000');
        await page.waitForSelector('#barcode-msg:has-text("没有条码后 6 位为 000000")');
        assert(await val(page, 'brand') === '' && await val(page, 'price') === '', '查不到时应清空自动带出的品规和单价');
        return '075015→中华（硬）450；25 包→2.5 条；雪茄自动按支';
      } finally { await p.close(); }
    }
  },
  {
    name: '录入体验：扫码枪式回车流程、"保存并继续"、同品规自动合并数量、常用数量按钮',
    fn: async () => {
      const w = L.createWorld(); const p = await L.openPage(w); const page = p.page;
      try {
        await L.setupAdmin(page);
        await L.createCase(page, 'PR-002');
        await openSeized(page);
        // 条码框回车 → 光标到数量；数量框回车 → 保存并继续
        await page.fill('form[data-form=seized] [name=barcode]', '6901028075015');
        await page.press('form[data-form=seized] [name=barcode]', 'Enter');
        assert(await page.evaluate(() => document.activeElement.name === 'qty'), '条码回车后光标应到数量');
        await page.keyboard.type('10');
        await page.keyboard.press('Enter');
        await page.waitForFunction(() => window.__EVIDENCE_APP__.idle && document.querySelector('form[data-form=seized] [name=barcode]') && document.querySelector('form[data-form=seized] [name=barcode]').value === '');
        assert(await page.evaluate(() => document.activeElement.name === 'barcode'), '保存并继续后光标应回到条码框');
        // 第二条：用"保存并继续"按钮 + 常用数量按钮
        await page.fill('form[data-form=seized] [name=barcode]', '118187');
        await page.click('[data-action=qty-set][data-v="5"]');
        await page.click('[data-action=qty-step][data-d="1"]');
        assert(await val(page, 'qty') === '6', '5 再 +1 应为 6');
        await page.click('[data-action=seized-save-next]');
        await page.waitForFunction(() => window.__EVIDENCE_APP__.idle && document.querySelector('form[data-form=seized] [name=barcode]').value === '');
        // 第三条：重复的中华（硬）→ 合并
        await page.fill('form[data-form=seized] [name=barcode]', '075015');
        await page.fill('form[data-form=seized] [name=qty]', '5');
        await page.click('[data-action=seized-save-next]');
        await page.waitForSelector('.modal:has-text("重复品规")');
        await page.click('.modal [data-action=modal-ok]');
        await page.waitForFunction(() => window.__EVIDENCE_APP__.idle && !!document.querySelector('form[data-form=seized]'));
        await page.click('[data-action=modal-close]');
        const c = JSON.parse(w.shared.get('case:' + JSON.parse(w.shared.get('case-index'))[0].id));
        assert(c.seizedItems.length === 2, '应只有 2 条记录：' + c.seizedItems.length);
        const zh = c.seizedItems.find(x => x.barcode === '6901028075015');
        assert(zh.qty === 15 && zh.price === 450 && zh.priceSource === 'catalog', '中华应合并为 15 条：' + JSON.stringify(zh));
        const t = await page.textContent('#seized-list');
        assert(t.includes('涉案金额：7,830 元'), '涉案金额应为 15×450+6×180=7830：' + t);
        return '3 次录入 → 2 条记录，涉案金额 7,830 元';
      } finally { await p.close(); }
    }
  },
  {
    name: '品名搜索带出条码与价格；退出目录品规标注；手工改价标"手工价"',
    fn: async () => {
      const w = L.createWorld(); const p = await L.openPage(w); const page = p.page;
      try {
        await L.setupAdmin(page);
        await L.createCase(page, 'PR-003');
        await openSeized(page);
        await page.fill('form[data-form=seized] [name=brand]', '芙蓉王（硬）');
        await page.waitForSelector('#barcode-msg .match.ok');
        assert(await val(page, 'price') === '250', '芙蓉王（硬）应为 250');
        await page.fill('form[data-form=seized] [name=qty]', '2');
        await page.fill('form[data-form=seized] [name=price]', '260');
        await page.click('[data-action=seized-save-next]');
        await page.waitForFunction(() => window.__EVIDENCE_APP__.idle && document.querySelector('form[data-form=seized] [name=barcode]').value === '');
        await page.fill('form[data-form=seized] [name=barcode]', '121460');
        await page.waitForSelector('#barcode-msg:has-text("退出目录品规")');
        await page.fill('form[data-form=seized] [name=qty]', '1');
        await page.click('form[data-form=seized] [type=submit]');
        await page.waitForSelector('form[data-form=seized]', { state: 'detached' });
        const c = JSON.parse(w.shared.get('case:' + JSON.parse(w.shared.get('case-index'))[0].id));
        assert(c.seizedItems[0].barcode === '6901028193504' && c.seizedItems[0].priceSource === 'manual', '品名搜索应带出条码；改价后为手工价');
        assert(c.seizedItems[1].priceExit === true, '利群（红利）应标退出目录');
        const t = await page.textContent('#seized-list');
        assert(t.includes('手工价') && t.includes('退出目录'), '列表应显示标记');
        return '';
      } finally { await p.close(); }
    }
  },
  {
    name: '核价表：打包时按模板生成 xlsx（标题、立案信息、明细、合计、价格依据），并计入 SHA256SUMS',
    fn: async (ctx) => {
      const w = L.createWorld(); const p = await L.openPage(w); const page = p.page;
      try {
        await L.setupAdmin(page);
        await L.createCase(page, '桂烟立[2025]第36号', '无证运输');
        await page.click('[data-action=edit-info]');
        await page.fill('form[data-form=caseInfo] [name=filingDate]', '2025-09-12');
        await page.click('form[data-form=caseInfo] [type=submit]');
        await page.waitForSelector('.modal-mask', { state: 'detached' });
        await L.captureAllRequired(page);
        await L.addSeized(page, { barcode: '075015', qty: 1601 });
        await L.addSeized(page, { barcode: '6901028314985', qty: 25, unit: '包' });
        await L.addSeized(page, { barcode: '131834', qty: 12, unit: '支' });
        await L.addSeized(page, { barcode: '6901028999991', brand: '钻石(荷花)', qty: 1100, price: 350 });
        await L.addSeized(page, { brand: '无码品规', qty: 5 });
        const { zip } = await L.packageCase(page);
        const u = Z.unzip(zip);
        const name = '桂烟立[2025]第36号_涉案烟草专卖品核价表.xlsx';
        assert(u.files.includes(name), '证据包应含核价表：' + u.files.join(','));
        assert(fs.readFileSync(path.join(u.dir, 'SHA256SUMS.txt'), 'utf8').includes(name), 'SHA256SUMS 应包含核价表');
        Z.sha256check(u.dir);
        const x = await readXlsx(fs.readFileSync(path.join(u.dir, name)));
        const C = x.cells;
        assert(C.A1 === '桂阳县烟草专卖局\n涉案烟草专卖品核价表', '标题：' + C.A1);
        assert(C.A3.includes('于 2025 年 9 月 12 日立案（立案编号：桂烟立[2025]第36号）的 涉嫌无烟草专卖品准运证运输烟草专卖品 案件中'), '立案信息：' + C.A3);
        assert(C.A4 === '序号' && C.B4 === '品种规格' && C.C4 === '数量(条)' && C.D4 === '单价（元）' && C.E4 === '合计(元)' && C.F4 === '备注', '表头不符');
        assert(C.B5 === '中华（硬）' && C.C5 === 1601 && C.D5 === 450 && C.E5 === 720450 && x.formulas.E5 === 'C5*D5', '第 1 行不符');
        assert(C.C6 === 2.5 && C.E6 === 225 && C.F6.includes('按25包折算'), '包折算行不符');
        assert(C.C7 === 12 && C.F7.includes('单位：支'), '雪茄行应注明按支');
        assert(C.F8.includes('价格手工录入') && C.F9.includes('未查到价格'), '手工价/未核价备注不符');
        assert(C.H5 === '6901028075015', '条码列不符');
        assert(C.A10 === '合计' && C.E10 === 1107475 && C.C10 === 2708.5 && C.F10 === '另有 12 支未计入', '合计行不符：' + JSON.stringify([C.C10, C.E10, C.F10]));
        assert(C.A11 === '价格依据' && C.B11.includes('湖南省烟草专卖局办公室 2025年6月26日印发的《2025年下半年湖南省国产卷烟品牌价格目录》') && C.B11.includes('第4项价格为手工录入') && C.B11.includes('第5项未查到价格'), '价格依据：' + C.B11);
        assert(C.A13 === '经办人：', '应有经办人行');
        ['A1:F2', 'A3:F3', 'B11:F11'].forEach(m => assert(x.merges.includes(m), '缺少合并单元格 ' + m));
        assert(x.workbook.includes('核价单!$A$1:$F$14'), '打印区域应为 A1:F14');
        const m = u.manifest;
        assert(m.includes('核价表：' + name) && m.includes('涉案金额 1,107,475 元（另有 1 条未核价）'), '清单应记录核价表与涉案金额');
        ctx.note('**核价表样例**（本次测试生成）：5 条查获记录 → 中华（硬）1601 条×450、红塔山（硬经典）25 包折 2.5 条×90、王冠（国粹）12 支×150（按支计价）、手工价 1 条、未核价 1 条；合计 1,107,475 元。已用 LibreOffice 打开并转 PDF 目视核对版式。');
        return '核价表单元格、公式、合并单元格、打印区域均符合模板';
      } finally { await p.close(); }
    }
  },
  {
    name: '核价表：案件页"生成核价表"单独下载；管理员设置的单位名称与价格依据生效',
    fn: async () => {
      const w = L.createWorld(); const p = await L.openPage(w); const page = p.page;
      try {
        await L.setupAdmin(page);
        await page.click('.tabbar [data-view=admin]');
        await page.click('[data-action=goto][data-view=prices]');
        await page.fill('form[data-form=priceSettings] [name=org]', '某某县烟草专卖局');
        await page.fill('form[data-form=priceSettings] [name=basis]', '根据测试价格依据核定。');
        await page.click('form[data-form=priceSettings] [type=submit]');
        await page.waitForSelector('.toast:has-text("已保存核价表设置")');
        await page.click('[data-action=back]');
        await page.click('.tabbar [data-view=cases]');
        await L.createCase(page, 'PR-005', '假烟销售');
        await L.addSeized(page, { barcode: '075015', qty: 2 });
        const dl = page.waitForEvent('download');
        await page.click('[data-action=price-sheet]');
        const d = await dl;
        assert(d.suggestedFilename() === 'PR-005_涉案烟草专卖品核价表.xlsx', '文件名：' + d.suggestedFilename());
        const file = path.join(L.TMP, 'sheet-' + Date.now() + '.xlsx'); await d.saveAs(file);
        const x = await readXlsx(fs.readFileSync(file));
        assert(x.cells.A1.startsWith('某某县烟草专卖局'), '单位名称应生效');
        assert(x.cells.A3.includes('涉嫌销售假冒注册商标的卷烟') && x.cells.A3.includes('年    月    日立案'), '未填立案日期时应留空、案由按类型默认：' + x.cells.A3);
        assert(x.cells.B7 === '根据测试价格依据核定。', '价格依据应使用管理员设置：' + x.cells.B7);
        return '';
      } finally { await p.close(); }
    }
  },
  {
    name: '价格目录管理：价格查询；导入新目录（CSV）后按新价格带出；可恢复内置目录；旧版条码库格式兼容',
    fn: async () => {
      const w = L.createWorld();
      w.shared.set('barcode-dict', JSON.stringify({ '6901028888882': '旧格式品规' }));
      const p = await L.openPage(w); const page = p.page;
      try {
        await L.setupAdmin(page);
        await page.click('.tabbar [data-view=admin]');
        await page.click('[data-action=goto][data-view=prices]');
        assert((await page.textContent('#view-root')).includes('401'), '应显示内置目录 401 个品规');
        await page.fill('[data-price-q]', '和天下');
        assert((await page.$$('#price-results .list-item')).length === 7, '"和天下"应查到 7 个');
        await page.fill('[data-price-q]', '888882');
        assert((await page.textContent('#price-results')).includes('旧格式品规'), '旧格式条码库应可查询');
        const csv = path.join(L.TMP, 'catalog.csv');
        fs.writeFileSync(csv, '﻿序号,条包条形码,规格名称,工业公司名称,建议零售价,单位\n1,6901028075015,中华（硬）,上海烟草,480,元/条\n2,6901028123456,新品规,某中烟,99,元/条\n3,坏行,,,,\n');
        const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.click('[data-action=catalog-import]')]);
        await fc.setFiles(csv);
        await page.waitForSelector('form[data-form=prompt]');
        await page.fill('form[data-form=prompt] [name=value]', '测试目录');
        await page.click('form[data-form=prompt] [type=submit]');
        await page.waitForSelector('.modal:has-text("读到 2 个品规")');
        await L.confirmModal(page, true);
        await page.waitForSelector('.toast:has-text("已导入价格目录：2 个品规")');
        await page.click('[data-action=back]');
        await page.click('.tabbar [data-view=cases]');
        await L.createCase(page, 'PR-006');
        await openSeized(page);
        await page.fill('form[data-form=seized] [name=barcode]', '075015');
        await page.waitForSelector('#barcode-msg .match.ok');
        assert(await val(page, 'price') === '480', '导入后应按新目录带出 480');
        await page.fill('form[data-form=seized] [name=barcode]', '888882');
        await page.waitForSelector('#barcode-msg:has-text("本地条码库")');
        assert(await val(page, 'brand') === '旧格式品规' && await val(page, 'price') === '', '旧格式条码库：带出品规、无单价');
        await page.click('[data-action=modal-close]');
        await page.click('[data-action=back]');
        await page.click('.tabbar [data-view=admin]');
        await page.click('[data-action=goto][data-view=prices]');
        await page.click('[data-action=catalog-reset]');
        await L.confirmModal(page, true);
        await page.waitForSelector('.toast:has-text("已恢复内置目录")');
        assert(!w.shared.has('price-catalog'), '应删除导入的目录');
        return '';
      } finally { await p.close(); }
    }
  }
];
