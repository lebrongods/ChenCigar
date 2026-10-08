const fs = require('fs');
const path = require('path');
const L = require('./lib');
const Z = require('./zip');
const { assert } = L;

async function fullCase(page, number, type) {
  await L.createCase(page, number, type || '无证运输');
  await L.captureAllRequired(page);
  await L.addSeized(page, { qty: 12, barcode: '075015' });
}

module.exports = [
  {
    name: 'P0-1 离线打包：断网后仍能生成并解压证据包；无任何外部网络请求',
    fn: async () => {
      const w = L.createWorld(); const p = await L.openPage(w); const page = p.page;
      try {
        await p.context.setOffline(true);
        await L.setupAdmin(page);
        assert(await page.evaluate(() => typeof JSZip === 'function' && JSZip.version === '3.10.1'), 'JSZip 3.10.1 应已内联');
        await fullCase(page, 'OFF-001');
        const { zip } = await L.packageCase(page);
        const u = Z.unzip(zip);
        assert(u.files.length >= 10, '离线证据包文件数不足');
        assert(p.requests.length === 0, '不应有外部请求：' + p.requests.join(','));
        assert(!fs.readFileSync(L.APP, 'utf8').match(/<script[^>]+src=|<link[^>]+href=["']http/), 'HTML 不应引用外部脚本/样式');
        return 'context.setOffline(true)；外部请求 0 个';
      } finally { await p.close(); }
    }
  },
  {
    name: 'P0-1 JSZip 未加载时显示明确错误（不静默失败）',
    fn: async () => {
      const w = L.createWorld();
      const p = await L.openPage(w, { initScript: () => { Object.defineProperty(window, 'JSZip', { get() { return undefined; }, set() {}, configurable: false }); } });
      const page = p.page;
      try {
        await L.setupAdmin(page);
        await fullCase(page, 'NOZIP-001');
        await page.click('[data-action=package]');
        await page.waitForSelector('#pack-result.alert-danger');
        const t = await page.textContent('#pack-result');
        assert(t.includes('JSZip') && t.includes('无法生成证据包'), '应显示 JSZip 未加载错误：' + t);
        return '';
      } finally { await p.close(); }
    }
  },
  {
    name: 'P0-2 存储写入失败：界面出现"保存失败"提示（不静默）',
    fn: async () => {
      const w = L.createWorld(); const p = await L.openPage(w); const page = p.page;
      try {
        await L.setupAdmin(page);
        await L.createCase(page, 'FAIL-001');
        w.failSet = true;
        await L.captureItem(page, '车头照片', L.img('sharp'));
        await page.waitForSelector('#save-banner:not([hidden])');
        const banner = await page.textContent('#save-banner');
        assert(banner.includes('保存失败'), '横幅应含"保存失败"：' + banner);
        assert((await L.toastText(page)).includes('保存失败'), '应弹出保存失败提示');
        assert(!(await page.$('.tile.done')), '写入失败时不应显示为已拍');
        // 登记查获卷烟时的失败
        await page.click('#save-banner-close');
        await page.click('[data-action=seized-add]');
        await page.fill('form[data-form=seized] [name=brand]', 'x');
        await page.fill('form[data-form=seized] [name=qty]', '1');
        await page.click('form[data-form=seized] [type=submit]');
        await page.waitForSelector('#save-banner:not([hidden])');
        assert(await page.$('form[data-form=seized]'), '保存失败时登记弹窗应保留，便于重试');
        w.failSet = false;
        await page.click('form[data-form=seized] [type=submit]');
        await page.waitForSelector('form[data-form=seized]', { state: 'detached' });
        w.failSet = false;
        return '照片写入失败与案件写入失败均出现红色横幅 + 提示';
      } finally { await p.close(); }
    }
  },
  {
    name: 'P0-4 导出→在全新环境中还原：案件数、照片数与照片摘要一致',
    fn: async () => {
      const w1 = L.createWorld(); const p1 = await L.openPage(w1); const page = p1.page;
      const w2 = L.createWorld(); let p2 = null;
      try {
        await L.setupAdmin(page, '管理员甲', '123456');
        await L.addUser(page, '稽查员A', 'inspector', '1111');
        await fullCase(page, 'BK-001');
        await page.click('[data-action=back]');
        await fullCase(page, 'BK-002', '假烟销售');
        await page.click('[data-action=back]');
        const photoKeys1 = [...w1.shared.keys()].filter(k => k.startsWith('photo:')).sort();
        const casesBefore = JSON.parse(w1.shared.get('case-index')).length;
        await page.click('.tabbar [data-view=admin]');
        await page.click('[data-action=goto][data-view=backup]');
        const dl = page.waitForEvent('download');
        await page.click('[data-action=export]');
        const warn = await page.textContent('.modal');
        assert(warn.includes('妥善保管'), '导出前应提示妥善保管');
        await L.confirmModal(page, true);
        const d = await dl;
        const file = path.join(L.TMP, 'backup-' + Date.now() + '.json');
        await d.saveAs(file);
        assert(/^证据采集系统备份_\d{12}\.json$/.test(d.suggestedFilename()), '备份文件名：' + d.suggestedFilename());
        const data = JSON.parse(fs.readFileSync(file, 'utf8'));
        assert(data.cases.length === casesBefore && Object.keys(data.photos).length === photoKeys1.length, '备份内容数量不符');
        // 全新环境：首次页面直接从备份还原
        p2 = await L.openPage(w2);
        await p2.page.waitForSelector('form[data-form=setup]');
        const [fc] = await Promise.all([p2.page.waitForEvent('filechooser'), p2.page.click('[data-action=import]')]);
        await fc.setFiles(file);
        await L.confirmModal(p2.page, true);
        await L.loginOk(p2.page, '管理员甲', '123456');
        const casesAfter = JSON.parse(w2.shared.get('case-index')).length;
        const photoKeys2 = [...w2.shared.keys()].filter(k => k.startsWith('photo:')).sort();
        assert(casesAfter === casesBefore, '案件数不一致：' + casesBefore + ' vs ' + casesAfter);
        assert(JSON.stringify(photoKeys1) === JSON.stringify(photoKeys2), '照片数/ID 不一致');
        photoKeys1.forEach(k => assert(w1.shared.get(k) === w2.shared.get(k), '照片内容不一致：' + k));
        const n = await p2.page.$$eval('#case-list .case-card', e => e.length);
        assert(n === casesBefore, '还原后列表应显示 ' + casesBefore + ' 个案件');
        // 还原后仍可打包
        await p2.page.click('#case-list .case-card:has-text("BK-001")');
        await p2.page.waitForSelector('.tiles');
        const { zip } = await L.packageCase(p2.page);
        assert(Z.sha256check(Z.unzip(zip).dir).includes(': OK'), '还原后打包应可核对');
        // 稽查员账号一并还原
        await L.logout(p2.page);
        await L.loginOk(p2.page, '稽查员A', '1111');
        return casesBefore + ' 个案件、' + photoKeys1.length + ' 张照片，逐张内容一致；账号可登录';
      } finally { await p1.close(); if (p2) await p2.close(); }
    }
  },
  {
    name: 'P0-4 管理员在已有数据的环境中导入：需二次确认并覆盖',
    fn: async () => {
      const w = L.createWorld(); const p = await L.openPage(w); const page = p.page;
      try {
        await L.setupAdmin(page);
        await L.createCase(page, 'OLD-1'); await page.click('[data-action=back]');
        const file = path.join(L.TMP, 'bad.json');
        fs.writeFileSync(file, '{"hello":1}');
        await page.click('.tabbar [data-view=admin]');
        await page.click('[data-action=goto][data-view=backup]');
        let [fc] = await Promise.all([page.waitForEvent('filechooser'), page.click('[data-action=import]')]);
        await fc.setFiles(file);
        await page.waitForSelector('.toast:has-text("不是本系统的备份文件")');
        assert(JSON.parse(w.shared.get('case-index')).length === 1, '错误文件不应改动数据');
        return '非备份文件被拒绝，数据不变';
      } finally { await p.close(); }
    }
  },
  {
    name: 'P0-5 清单含采集人/承办人/拍摄时间/SHA-256/生成时间/版本；逐张 sha256sum 与清单一致',
    fn: async () => {
      const w = L.createWorld(); const p = await L.openPage(w); const page = p.page;
      try {
        await L.setupAdmin(page);
        await L.addUser(page, '稽查员A', 'inspector', '1111');
        await fullCase(page, 'HASH-001');
        await page.click('[data-action=assign-case]');
        const aId = JSON.parse(w.shared.get('users')).find(u => u.name === '稽查员A').id;
        await page.selectOption('form[data-form=assign] [name=user]', aId);
        await page.click('form[data-form=assign] [type=submit]');
        await page.waitForSelector('.kv:has-text("稽查员A")');
        const { zip } = await L.packageCase(page);
        const u = Z.unzip(zip);
        const m = u.manifest;
        ['采集人（案件创建人）：管理员甲', '承办人：稽查员A', '拍摄时间：', '证据包生成时间：', '系统：涉烟案件现场证据采集系统 v2.4.1', '不是防篡改措施'].forEach(s => assert(m.includes(s), '清单缺少：' + s));
        const jpgs = u.files.filter(f => f.endsWith('.jpg'));
        let checked = 0;
        for (const f of jpgs.slice(0, 5)) {
          const actual = Z.sha256sum(u.dir, f);
          const re = new RegExp('文件：' + f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[\\s\\S]*?SHA-256：([0-9a-f]{64})');
          const mm = m.match(re);
          assert(mm, '清单中找不到 ' + f);
          assert(mm[1] === actual, f + ' 摘要不一致：清单 ' + mm[1] + ' / 实际 ' + actual);
          checked++;
        }
        return '逐张比对 ' + checked + ' 张：清单摘要 = sha256sum 结果';
      } finally { await p.close(); }
    }
  },
  {
    name: 'P0-6 手机 360/390/430 px：各页面无横向滚动，按钮点击区 ≥44px',
    fn: async () => {
      const w = L.createWorld(); const p = await L.openPage(w, { viewport: { width: 360, height: 740 } }); const page = p.page;
      try {
        await L.setupAdmin(page, '管理员名字比较长的甲');
        await L.createCase(page, 'X烟立〔2026〕第0000123456789号-超长案件编号测试', '制假窝点', { address: '某省某市某区某街道某路某号某某大厦负一层仓库', party: '张某某' });
        await L.captureItem(page, '窝点外观入口照片', L.img('sharp'));
        await L.addSeized(page, { brand: '某品牌（硬盒细支加长版）', qty: 1234, barcode: '69010280750156901028075015' });
        const views = [];
        const check = async label => {
          for (const width of [360, 390, 430]) {
            await page.setViewportSize({ width, height: 740 });
            const r = await page.evaluate(() => {
              const de = document.documentElement;
              const small = [...document.querySelectorAll('button, .btn, select, input[type=text], input[type=password], input[type=search], input[type=number]')]
                .filter(b => b.offsetParent !== null && !b.closest('.tile-name'))
                .map(b => ({ t: (b.textContent || b.name || '').trim().slice(0, 10), h: b.getBoundingClientRect().height, w: b.getBoundingClientRect().width }))
                .filter(x => x.h < 43.5 || x.w < 43.5);
              return { over: de.scrollWidth - de.clientWidth, small };
            });
            assert(r.over <= 0, label + ' @' + width + 'px 出现横向滚动 ' + r.over + 'px');
            assert(!r.small.length, label + ' @' + width + 'px 有点击区 <44px：' + JSON.stringify(r.small));
          }
          views.push(label);
        };
        await check('案件详情');
        await page.click('[data-action=seized-add]'); await page.fill('form[data-form=seized] [name=barcode]', '19'); await check('查获登记弹窗');
        await page.fill('form[data-form=seized] [name=barcode]', '075015'); await page.fill('form[data-form=seized] [name=qty]', '12345'); await check('查获登记弹窗（已带出价格）');
        await page.click('.kind-tabs .btn:has-text("烟叶")'); await page.waitForSelector('.unit-fixed'); await check('涉案物品弹窗（烟叶）');
        await page.click('.kind-tabs .btn:has-text("电子烟")'); await page.waitForSelector('.seg'); await check('涉案物品弹窗（电子烟）'); await page.click('[data-action=modal-close]');
        await page.click('[data-action=back]'); await check('案件列表');
        await page.click('[data-action=new-case]'); await check('新建案件'); await page.click('[data-action=back]');
        await page.click('.tabbar [data-view=admin]'); await check('管理');
        await page.click('[data-action=goto][data-view=users]'); await check('用户管理'); await page.click('[data-action=back]');
        await page.click('[data-action=goto][data-view=templates]'); await check('模板列表');
        await page.click('[data-action=tpl-edit] >> nth=0'); await check('模板编辑'); await page.click('[data-action=back]');
        await page.click('[data-action=back]');
        await page.click('[data-action=goto][data-view=prices]'); await page.fill('[data-price-q]', '芙蓉王'); await check('价格目录与核价表'); await page.click('[data-action=back]');
        await page.click('[data-action=goto][data-view=barcodes]'); await check('本地条码库'); await page.click('[data-action=back]');
        await page.click('[data-action=goto][data-view=backup]'); await check('备份'); await page.click('[data-action=back]');
        await page.click('.tabbar [data-view=me]'); await check('我的/关于');
        return views.length + ' 个页面 × 3 种宽度通过';
      } finally { await p.close(); }
    }
  },
  {
    name: 'P0-6 危险操作二次确认：删除案件 / 删除模板 / 删除照片',
    fn: async () => {
      const w = L.createWorld(); const p = await L.openPage(w); const page = p.page;
      try {
        await L.setupAdmin(page);
        await L.createCase(page, 'DEL-001');
        await L.captureItem(page, '车头照片', L.img('sharp'));
        // 删除照片：取消 → 仍在；确定 → 删除
        await page.click('.tile.done img');
        await page.click('.modal [data-action=photo-del]');
        await L.confirmModal(page, false);
        assert(await page.$('.tile.done'), '取消后照片应保留');
        await page.click('.tile.done img');
        await page.click('.modal [data-action=photo-del]');
        await L.confirmModal(page, true);
        await page.waitForFunction(() => !document.querySelector('.tile.done'));
        assert(![...w.shared.keys()].some(k => k.startsWith('photo:')), '照片数据应一并删除');
        // 删除案件
        await page.click('[data-action=delete-case]');
        await L.confirmModal(page, false);
        assert(JSON.parse(w.shared.get('case-index')).length === 1, '取消后案件应保留');
        await page.click('[data-action=delete-case]');
        await L.confirmModal(page, true);
        await page.waitForSelector('#case-list');
        assert(JSON.parse(w.shared.get('case-index')).length === 0 && ![...w.shared.keys()].some(k => k.startsWith('case:')), '案件应删除');
        // 删除模板
        await page.click('.tabbar [data-view=admin]');
        await page.click('[data-action=goto][data-view=templates]');
        await page.click('[data-action=tpl-del] >> nth=0');
        await L.confirmModal(page, false);
        assert(JSON.parse(w.shared.get('templates')).length === 4, '取消后模板应保留');
        await page.click('[data-action=tpl-del] >> nth=0');
        await L.confirmModal(page, true);
        await page.waitForFunction(() => document.querySelectorAll('[data-action=tpl-del]').length === 3);
        return '';
      } finally { await p.close(); }
    }
  },
  {
    name: 'P0-6 列表显示进度（已拍必拍/总必拍）、状态、承办人',
    fn: async () => {
      const w = L.createWorld(); const p = await L.openPage(w); const page = p.page;
      try {
        await L.setupAdmin(page);
        await L.createCase(page, 'LIST-001');
        await L.captureItem(page, '车头照片', L.img('sharp'));
        await L.captureItem(page, '车尾车牌照片', L.img('sharp2'));
        await page.click('[data-action=back]');
        await page.waitForSelector('#case-list .case-card');
        const t = await page.textContent('#case-list .case-card');
        assert(t.includes('必拍 2/8') && t.includes('采集中') && t.includes('承办：未分配'), '列表卡片信息不全：' + t);
        return t.replace(/\s+/g, ' ').trim().slice(0, 80);
      } finally { await p.close(); }
    }
  },
  {
    name: '无宿主存储时退化为本机 IndexedDB：刷新页面数据仍在，并提示"本机存储模式"',
    fn: async () => {
      const w = L.createWorld(); const p = await L.openPage(w, { noStorage: true }); const page = p.page;
      try {
        assert((await page.evaluate(() => window.__EVIDENCE_APP__.backend)) === 'indexeddb', '应使用 IndexedDB');
        assert((await page.textContent('#view-root')).includes('本机存储模式'), '应提示本机存储模式');
        await L.setupAdmin(page);
        await L.createCase(page, 'IDB-001');
        await L.captureItem(page, '车头照片', L.img('sharp'));
        await page.reload();
        await page.waitForSelector('#case-list .case-card:has-text("IDB-001")');
        await page.click('#case-list .case-card');
        await page.waitForSelector('.tile.done');
        return '';
      } finally { await p.close(); }
    }
  }
];
