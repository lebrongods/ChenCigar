const fs = require('fs');
const path = require('path');
const L = require('./lib');
const Z = require('./zip');
const { assert } = L;
const { readXlsx } = require('./xlsx');

const val = (page, n) => page.inputValue('form[data-form=seized] [name=' + n + ']');
async function openSeized(page) { await page.click('[data-action=seized-add]'); await page.waitForSelector('form[data-form=seized]'); }
async function pickKind(page, label) { await page.click('.kind-tabs .btn:has-text("' + label + '")'); await page.waitForSelector('.kind-tabs .btn.active:has-text("' + label + '")'); }
async function waitIdleForm(page) { await page.waitForFunction(() => window.__EVIDENCE_APP__.idle && !!document.querySelector('form[data-form=seized]')); }
// 登记一项非卷烟物品（在已打开的弹窗里），saveNext=true 时保存并继续
async function addOther(page, { kind, sub, spec, qty, price, next }) {
  await pickKind(page, kind);
  if (sub) { await page.click('[data-action=seized-sub][data-v="' + sub + '"]'); await page.waitForSelector('.seg .btn.active:has-text("' + sub + '")'); }
  if (spec) await page.fill('form[data-form=seized] [name=spec]', spec);
  await page.fill('form[data-form=seized] [name=qty]', String(qty));
  if (price !== undefined) await page.fill('form[data-form=seized] [name=price]', String(price));
  if (next) { await page.click('[data-action=seized-save-next]'); await waitIdleForm(page); }
  else { await page.click('form[data-form=seized] [type=submit]'); await page.waitForSelector('form[data-form=seized]', { state: 'detached' }); }
}
function caseOf(w) { return JSON.parse(w.shared.get('case:' + JSON.parse(w.shared.get('case-index'))[0].id)); }

module.exports = [
  {
    name: '涉案物品录入：默认卷烟；烟叶 66.14 元/公斤、烟丝 = 烟叶×1.5、空管烟 468 元/万支（固定单位、单价只读）；电子烟分烟弹/烟具按个计',
    fn: async () => {
      const w = L.createWorld(); const p = await L.openPage(w); const page = p.page;
      try {
        await L.setupAdmin(page);
        await L.createCase(page, 'IT-001', '制假窝点');
        assert((await page.textContent('.section-title:has-text("涉案物品录入")')).includes('涉案物品录入'), '标题应为"涉案物品录入"');
        await openSeized(page);
        assert(await page.$('.kind-tabs .btn.active:has-text("卷烟")'), '默认应为卷烟');
        assert(await page.$('form[data-form=seized] [name=barcode]'), '卷烟应有条码框');
        // 烟叶
        await pickKind(page, '烟叶');
        assert(!(await page.$('form[data-form=seized] [name=barcode]')), '烟叶不应有条码框');
        assert((await page.textContent('.unit-fixed')).includes('公斤'), '烟叶单位应为公斤');
        assert(await val(page, 'price') === '66.14' && await page.$eval('form[data-form=seized] [name=price]', e => e.readOnly), '烟叶单价应为 66.14 且只读');
        await page.fill('form[data-form=seized] [name=spec]', '上等烟');
        await page.fill('form[data-form=seized] [name=qty]', '30');
        assert((await page.textContent('#subtotal')).includes('1,984.2 元'), '30×66.14=1984.2：' + await page.textContent('#subtotal'));
        await page.click('[data-action=seized-save-next]'); await waitIdleForm(page);
        assert(await page.$('.kind-tabs .btn.active:has-text("烟叶")'), '保存并继续后应保持烟叶类型');
        // 烟丝
        await pickKind(page, '烟丝');
        assert(await val(page, 'price') === '99.21', '烟丝应为 66.14×1.5=99.21');
        await page.fill('form[data-form=seized] [name=qty]', '20');
        await page.click('[data-action=seized-save-next]'); await waitIdleForm(page);
        // 空管烟
        await addOther(page, { kind: '空管烟', qty: 2.5, next: true });
        // 电子烟：未设标准价，需手填
        await pickKind(page, '电子烟');
        assert(await page.$('.seg .btn.active:has-text("烟弹")'), '电子烟默认烟弹');
        assert(await val(page, 'price') === '' && !(await page.$eval('form[data-form=seized] [name=price]', e => e.readOnly)), '电子烟未设标准价时单价应可填写');
        await addOther(page, { kind: '电子烟', sub: '烟具', spec: '某品牌', qty: 10, price: 80 });
        const c = caseOf(w);
        const [leaf, shred, tube, ecig] = c.seizedItems;
        assert(leaf.kind === 'leaf' && leaf.brand === '烟叶（上等烟）' && leaf.unit === '公斤' && leaf.price === 66.14 && leaf.priceSource === 'standard', '烟叶记录不符：' + JSON.stringify(leaf));
        assert(shred.brand === '烟丝' && shred.price === 99.21 && shred.unit === '公斤', '烟丝记录不符');
        assert(tube.brand === '空管烟' && tube.unit === '万支' && tube.price === 468 && tube.qty === 2.5, '空管烟记录不符');
        assert(ecig.kind === 'ecig' && ecig.sub === '烟具' && ecig.brand === '电子烟烟具（某品牌）' && ecig.unit === '个' && ecig.priceSource === 'manual', '电子烟记录不符：' + JSON.stringify(ecig));
        const t = await page.textContent('#seized-list');
        assert(t.includes('涉案金额：5,938.4 元') && t.includes('数量合计：50 公斤，2.5 万支，10 个'), '涉案金额应为 1984.2+1984.2+1170+800=5938.4：' + t);
        return '烟叶 30 公斤 1,984.2 元；烟丝 20 公斤 1,984.2 元；空管烟 2.5 万支 1,170 元；电子烟烟具 10 个 800 元';
      } finally { await p.close(); }
    }
  },
  {
    name: '标准价维护：管理员修改烟叶/空管烟/电子烟单价，烟丝自动 1.5 倍；只影响之后登记的物品',
    fn: async () => {
      const w = L.createWorld(); const p = await L.openPage(w); const page = p.page;
      try {
        await L.setupAdmin(page);
        await L.createCase(page, 'IT-002', '制假窝点');
        await openSeized(page);
        await addOther(page, { kind: '烟叶', qty: 10 });
        await page.click('[data-action=back]');
        await page.click('.tabbar [data-view=admin]');
        await page.click('[data-action=goto][data-view=prices]');
        await page.fill('form[data-form=stdPrices] [name=leafPrice]', '70');
        assert((await page.textContent('#shred-price')) === '105', '烟丝应实时显示 105');
        await page.fill('form[data-form=stdPrices] [name=tubePrice]', '500');
        await page.fill('form[data-form=stdPrices] [name=ecigPodPrice]', '25');
        await page.click('form[data-form=stdPrices] [type=submit]');
        await page.waitForSelector('.toast:has-text("已保存标准价")');
        const st = JSON.parse(w.shared.get('settings'));
        assert(st.leafPrice === 70 && st.tubePrice === 500 && st.ecigPodPrice === 25 && st.ecigDevicePrice === '', '设置未保存：' + JSON.stringify(st));
        await page.click('[data-action=back]');
        await page.click('.tabbar [data-view=cases]');
        await page.click('#case-list .case-card');
        await page.waitForSelector('#seized-list');
        await openSeized(page);
        await pickKind(page, '烟叶'); assert(await val(page, 'price') === '70', '新登记烟叶应为 70');
        await pickKind(page, '烟丝'); assert(await val(page, 'price') === '105', '新登记烟丝应为 105');
        await pickKind(page, '空管烟'); assert(await val(page, 'price') === '500', '空管烟应为 500');
        await pickKind(page, '电子烟'); assert(await val(page, 'price') === '25' && await page.$eval('form[data-form=seized] [name=price]', e => !e.readOnly), '烟弹应带出 25 且可改');
        await page.click('[data-action=seized-sub][data-v="烟具"]'); await page.waitForSelector('.seg .btn.active:has-text("烟具")');
        assert(await val(page, 'price') === '', '烟具未设标准价应为空');
        await page.click('[data-action=modal-close]');
        assert(caseOf(w).seizedItems[0].price === 66.14, '已登记的烟叶应保持 66.14');
        return '';
      } finally { await p.close(); }
    }
  },
  {
    name: '非卷烟物品：同名称同单价再次录入提示合并；仅有非卷烟物品也可打包',
    fn: async () => {
      const w = L.createWorld(); const p = await L.openPage(w); const page = p.page;
      try {
        await L.setupAdmin(page);
        await L.createCase(page, 'IT-003', '制假窝点');
        await L.captureAllRequired(page);
        await openSeized(page);
        await addOther(page, { kind: '烟丝', qty: 5, next: true });
        await page.fill('form[data-form=seized] [name=qty]', '7');
        await page.click('[data-action=seized-save-next]');
        await page.waitForSelector('.modal:has-text("重复品规")');
        await page.click('.modal [data-action=modal-ok]');
        await waitIdleForm(page);
        await page.click('[data-action=modal-close]');
        const c = caseOf(w);
        assert(c.seizedItems.length === 1 && c.seizedItems[0].qty === 12, '应合并为 12 公斤：' + JSON.stringify(c.seizedItems));
        const { zip } = await L.packageCase(page);
        const u = Z.unzip(zip);
        assert(u.manifest.includes('【烟丝】名称：烟丝　数量：12 公斤') && u.manifest.includes('单价：99.21 元/公斤（系统标准价）'), '清单应记录烟丝');
        const x = await readXlsx(fs.readFileSync(path.join(u.dir, 'IT-003_涉案烟草专卖品核价表.xlsx')));
        assert(x.cells.C4 === '数量(公斤)' && x.cells.C5 === 12 && x.cells.E5 === 1190.52 && x.formulas.C6 === 'SUM(C5:C5)', '只有烟丝时表头应为公斤并可合计：' + JSON.stringify([x.cells.C4, x.cells.E5]));
        return '';
      } finally { await p.close(); }
    }
  },
  {
    name: '核价表：卷烟与烟叶、烟丝、空管烟、电子烟混合时，各行注明单位，合计注明未计入数量，价格依据写明标准价',
    fn: async (ctx) => {
      const w = L.createWorld(); const p = await L.openPage(w); const page = p.page;
      try {
        await L.setupAdmin(page);
        await L.createCase(page, 'IT-004', '制假窝点');
        await L.addSeized(page, { barcode: '075015', qty: 10 });
        await openSeized(page);
        await addOther(page, { kind: '烟叶', qty: 30, next: true });
        await addOther(page, { kind: '烟丝', qty: 20, next: true });
        await addOther(page, { kind: '空管烟', qty: 2.5, next: true });
        await addOther(page, { kind: '电子烟', qty: 10, price: 30 });
        const dl = page.waitForEvent('download');
        await page.click('[data-action=price-sheet]');
        const file = path.join(L.TMP, 'mixed-' + Date.now() + '.xlsx'); await (await dl).saveAs(file);
        const x = await readXlsx(fs.readFileSync(file)); const C = x.cells;
        assert(C.C4 === '数量(条)', '表头：' + C.C4);
        assert(C.B6 === '烟叶' && C.C6 === 30 && C.D6 === 66.14 && C.F6.includes('单位：公斤'), '烟叶行：' + JSON.stringify([C.B6, C.C6, C.D6, C.F6]));
        assert(C.B7 === '烟丝' && C.D7 === 99.21 && C.B8 === '空管烟' && C.D8 === 468 && C.F8.includes('单位：万支'), '烟丝/空管烟行不符');
        assert(C.B9 === '电子烟烟弹' && C.F9.includes('单位：个') && C.F9.includes('价格手工录入'), '电子烟行：' + C.F9);
        assert(C.C10 === 10 && C.F10 === '另有 50 公斤、2.5 万支、10 个未计入', '合计行：' + JSON.stringify([C.C10, C.F10]));
        assert(C.E10 === 4500 + 1984.2 + 1984.2 + 1170 + 300, '合计金额：' + C.E10);
        assert(C.B11.includes('烟叶按 66.14 元/公斤、烟丝按烟叶价格的 1.5 倍计 99.21 元/公斤、空管烟按 468 元/万支核定。') && C.B11.includes('第5项价格为手工录入'), '价格依据：' + C.B11);
        ctx.note('**混合物品核价表样例**：中华（硬）10 条 4,500 元；烟叶 30 公斤 × 66.14 = 1,984.2 元；烟丝 20 公斤 × 99.21 = 1,984.2 元；空管烟 2.5 万支 × 468 = 1,170 元；电子烟烟弹 10 个 × 30（手工价）= 300 元；合计 9,938.4 元。');
        return '合计 9,938.4 元';
      } finally { await p.close(); }
    }
  }
];
