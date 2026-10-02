const fs = require('fs');
const L = require('./lib');
const Z = require('./zip');
const { assert } = L;

async function evidenceOf(w, itemName) {
  const id = JSON.parse(w.shared.get('case-index'))[0].id;
  const c = JSON.parse(w.shared.get('case:' + id));
  let itemId = null;
  c.template.categories.forEach(cat => cat.items.forEach(it => { if (it.name === itemName) itemId = it.id; }));
  return c.evidence[itemId];
}

module.exports = [
  {
    name: 'P1-1 拍照质量提示：偏暗/过曝/模糊提示"建议重拍"，只提示不拦截；实测阈值',
    fn: async (ctx) => {
      const w = L.createWorld(); const p = await L.openPage(w); const page = p.page;
      try {
        // 1) 对全部测试图计算指标
        const names = ['sharp', 'sharp2', 'sharp3', 'dark_0.6', 'dark_0.75', 'dark_0.85', 'bright_0.6', 'bright_0.75', 'bright_0.85', 'blur_1', 'blur_2', 'blur_4', 'blur_8', 'flat', 'screenshot'];
        const rows = [];
        for (const n of names) {
          const b64 = fs.readFileSync(L.img(n)).toString('base64');
          const r = await page.evaluate(async src => {
            const im = new Image(); im.src = src; await im.decode();
            const k = Math.min(1, 480 / Math.max(im.naturalWidth, im.naturalHeight));
            const c = document.createElement('canvas'); c.width = Math.round(im.naturalWidth * k); c.height = Math.round(im.naturalHeight * k);
            const x = c.getContext('2d'); x.drawImage(im, 0, 0, c.width, c.height);
            return window.__EVIDENCE_APP__.analyzeImageData(x.getImageData(0, 0, c.width, c.height).data, c.width, c.height);
          }, 'data:image/jpeg;base64,' + b64);
          rows.push({ n, ...r });
        }
        const get = n => rows.find(r => r.n === n);
        ['sharp', 'sharp2', 'sharp3', 'blur_1'].forEach(n => assert(!get(n).issues.length, n + ' 不应提示：' + get(n).issues));
        ['dark_0.75', 'dark_0.85'].forEach(n => assert(get(n).issues.includes('画面偏暗'), n + ' 应提示偏暗'));
        ['bright_0.75', 'bright_0.85'].forEach(n => assert(get(n).issues.includes('画面过曝'), n + ' 应提示过曝'));
        ['blur_4', 'blur_8'].forEach(n => assert(get(n).issues.includes('画面可能模糊'), n + ' 应提示模糊'));
        const desc = { sharp: '清晰场景 1', sharp2: '清晰场景 2', sharp3: '清晰场景 3', 'dark_0.6': '场景 + 60% 黑色遮罩', 'dark_0.75': '场景 + 75% 黑色遮罩', 'dark_0.85': '场景 + 85% 黑色遮罩', 'bright_0.6': '场景 + 60% 白色遮罩', 'bright_0.75': '场景 + 75% 白色遮罩', 'bright_0.85': '场景 + 85% 白色遮罩', blur_1: '高斯模糊 1px', blur_2: '高斯模糊 2px', blur_4: '高斯模糊 4px', blur_8: '高斯模糊 8px', flat: '无纹理浅色平面（如白墙）', screenshot: '聊天截图样式（浅色背景）' };
        ctx.note('**P1-1 拍照质量检测实测**（测试图 1600×1200，缩到长边 480 后计算；阈值：平均亮度 <' + 60 + ' 或 暗部占比 >0.6 → 偏暗；平均亮度 >205 或 高光占比 >0.4 → 过曝；拉普拉斯方差 <60 且无曝光问题 → 可能模糊）\n\n' +
          '| 测试图 | 平均亮度 | 暗部占比 | 高光占比 | 拉普拉斯方差 | 提示 |\n|---|---|---|---|---|---|\n' +
          rows.map(r => '| ' + desc[r.n] + ' | ' + r.mean + ' | ' + r.darkClip + ' | ' + r.brightClip + ' | ' + r.lapVar + ' | ' + (r.issues.join('、') || '无') + ' |').join('\n') +
          '\n\n本次运行结果：' + (() => {
            const flagged = rows.filter(r => r.issues.length).map(r => desc[r.n] + '→' + r.issues.join('、'));
            const quiet = rows.filter(r => !r.issues.length).map(r => desc[r.n]);
            return '触发提示的：' + (flagged.join('；') || '无') + '。未触发的：' + (quiet.join('；') || '无') + '。';
          })() +
          '\n\n说明：无纹理平面（如白墙）会被误报为"可能模糊"、浅色聊天截图会被误报为"过曝"，所以系统对"相册导入"的照片不做质量检测，且所有提示只提示、不拦截。测试图为程序生成，阈值需用真实现场照片再校准。');
        // 2) 界面：拍暗图 → 提示但照片照常保存
        await L.setupAdmin(page);
        await L.createCase(page, 'Q-001');
        await L.captureItem(page, '车头照片', L.img('dark_0.85'));
        await page.waitForSelector('.toast:has-text("建议重拍")');
        await page.waitForSelector('.tile.done:has-text("画面偏暗")');
        const ev = await evidenceOf(w, '车头照片');
        assert(ev && ev.photoId && ev.quality.issues.includes('画面偏暗'), '偏暗照片应照常保存并记录提示');
        await L.captureItem(page, '车尾车牌照片', L.img('sharp'));
        assert(!(await evidenceOf(w, '车尾车牌照片')).quality.issues.length, '清晰照片不应提示');
        await L.captureItem(page, '货厢后备箱照片', L.img('flat'), 'album');
        assert((await evidenceOf(w, '货厢后备箱照片')).quality === null, '相册导入不做质量检测');
        return '提示不拦截；实测数据见下方"实测记录"';
      } finally { await p.close(); }
    }
  },
  {
    name: 'P1-2 案件搜索/筛选：编号、类型、状态、承办人',
    fn: async () => {
      const w = L.createWorld(); const p = await L.openPage(w); const page = p.page;
      try {
        await L.setupAdmin(page);
        await L.addUser(page, '稽查员A', 'inspector', '1111');
        await L.createCase(page, 'F-运输-01', '无证运输', { party: '李某' }); await page.click('[data-action=back]');
        await L.createCase(page, 'F-假烟-02', '假烟销售'); await page.click('[data-action=assign-case]');
        const aId = JSON.parse(w.shared.get('users')).find(u => u.name === '稽查员A').id;
        await page.selectOption('form[data-form=assign] [name=user]', aId);
        await page.click('form[data-form=assign] [type=submit]');
        await page.waitForSelector('.kv:has-text("稽查员A")');
        await page.click('[data-action=back]');
        await L.createCase(page, 'F-窝点-03', '制假窝点'); await page.click('[data-action=back]');
        const shown = () => page.$$eval('#case-list .case-no', e => e.map(x => x.textContent));
        await page.fill('[data-filter=q]', '假烟-02'); assert(JSON.stringify(await shown()) === '["F-假烟-02"]', '按编号搜索');
        await page.fill('[data-filter=q]', '李某'); assert(JSON.stringify(await shown()) === '["F-运输-01"]', '按当事人搜索');
        await page.fill('[data-filter=q]', '');
        await page.selectOption('[data-filter=type]', 't-factory'); assert(JSON.stringify(await shown()) === '["F-窝点-03"]', '按类型筛选');
        await page.selectOption('[data-filter=type]', '');
        await page.selectOption('[data-filter=assignee]', aId); assert(JSON.stringify(await shown()) === '["F-假烟-02"]', '按承办人筛选');
        await page.selectOption('[data-filter=assignee]', '__none'); assert((await shown()).length === 2, '筛选未分配');
        await page.selectOption('[data-filter=assignee]', '');
        await page.selectOption('[data-filter=status]', 'packaged'); assert((await shown()).length === 0, '按状态筛选');
        await page.selectOption('[data-filter=status]', 'draft'); assert((await shown()).length === 3, '按状态筛选：采集中');
        return '';
      } finally { await p.close(); }
    }
  },
  {
    name: 'P1-3 重拍/替换：确认前保留旧图；"保留原照片"不变，"使用新照片"替换并记日志',
    fn: async () => {
      const w = L.createWorld(); const p = await L.openPage(w); const page = p.page;
      try {
        await L.setupAdmin(page);
        await L.createCase(page, 'R-001');
        await L.captureItem(page, '车头照片', L.img('sharp'));
        const h1 = (await evidenceOf(w, '车头照片')).sha256;
        await L.captureItem(page, '车头照片', L.img('sharp2'));
        await page.waitForSelector('.modal .compare');
        assert((await evidenceOf(w, '车头照片')).sha256 === h1, '确认前不应替换');
        await L.confirmModal(page, false);
        await page.waitForFunction(() => window.__EVIDENCE_APP__.idle);
        assert((await evidenceOf(w, '车头照片')).sha256 === h1, '保留原照片后不应变化');
        await L.captureItem(page, '车头照片', L.img('sharp2'));
        await L.confirmModal(page, true);
        await page.waitForFunction(() => window.__EVIDENCE_APP__.idle);
        const ev = await evidenceOf(w, '车头照片');
        assert(ev.sha256 !== h1, '使用新照片后应替换');
        assert([...w.shared.keys()].filter(k => k.startsWith('photo:')).length === 1, '旧照片数据应清理');
        const c = JSON.parse(w.shared.get('case:' + JSON.parse(w.shared.get('case-index'))[0].id));
        assert(c.log.some(l => l.action === '替换照片' && l.detail.includes(h1.slice(0, 12))), '日志应记录替换及原照片摘要');
        return '';
      } finally { await p.close(); }
    }
  },
  {
    name: 'P1-4 定位：授权后记录经纬度并写入清单；未授权不影响拍照',
    fn: async () => {
      const w = L.createWorld();
      const p = await L.openPage(w, { permissions: ['geolocation'], geolocation: { latitude: 26.074508, longitude: 119.296494, accuracy: 15 } });
      const w2 = L.createWorld(); const p2 = await L.openPage(w2);
      try {
        await L.setupAdmin(p.page);
        await L.createCase(p.page, 'GEO-001');
        await L.captureAllRequired(p.page);
        await L.addSeized(p.page, { brand: 'x', qty: 1 });
        const ev = await evidenceOf(w, '车头照片');
        assert(ev.geo && Math.abs(ev.geo.lat - 26.074508) < 1e-6 && ev.geo.acc === 15, '应记录经纬度：' + JSON.stringify(ev.geo));
        const { zip } = await L.packageCase(p.page);
        assert(Z.unzip(zip).manifest.includes('位置：26.074508, 119.296494（±15 米），WGS-84'), '清单应含位置');
        // 未授权
        await L.setupAdmin(p2.page);
        await L.createCase(p2.page, 'GEO-002');
        const t0 = Date.now();
        await L.captureItem(p2.page, '车头照片', L.img('sharp'));
        const ev2 = await evidenceOf(w2, '车头照片');
        assert(ev2 && ev2.photoId && !ev2.geo, '未授权时应照常保存、位置为空');
        return '未授权时拍照耗时 ' + (Date.now() - t0) + 'ms（不等待定位超时）';
      } finally { await p.close(); await p2.close(); }
    }
  },
  {
    name: 'P1-5 操作日志：创建、分配、拍照、登记、打包写入 log[] 并输出到清单',
    fn: async () => {
      const w = L.createWorld(); const p = await L.openPage(w); const page = p.page;
      try {
        await L.setupAdmin(page);
        await L.addUser(page, '稽查员A', 'inspector', '1111');
        await L.createCase(page, 'LOG-001');
        await page.click('[data-action=assign-case]');
        await page.selectOption('form[data-form=assign] [name=user]', JSON.parse(w.shared.get('users')).find(u => u.name === '稽查员A').id);
        await page.click('form[data-form=assign] [type=submit]');
        await page.waitForSelector('.kv:has-text("稽查员A")');
        await L.captureAllRequired(page);
        await L.addSeized(page, { brand: 'x', qty: 1 });
        const { zip } = await L.packageCase(page);
        const m = Z.unzip(zip).manifest;
        ['管理员甲　创建案件', '管理员甲　分配承办人：未分配 → 稽查员A', '管理员甲　拍摄照片：车辆信息 / 车头照片', '管理员甲　登记涉案物品', '管理员甲　生成证据包'].forEach(s => assert(m.includes(s), '清单日志缺少：' + s));
        const c = JSON.parse(w.shared.get('case:' + JSON.parse(w.shared.get('case-index'))[0].id));
        assert(c.log.every(l => l.at && l.byName && l.action), '日志条目应含时间、操作人、动作');
        return c.log.length + ' 条日志';
      } finally { await p.close(); }
    }
  },
  {
    name: 'P1-6 列表每 30 秒自动刷新：管理员不操作也能看到他人新建的案件',
    fn: async () => {
      const w = L.createWorld();
      const admin = await L.openPage(w, { clock: true });
      const phone = await L.openPage(w);
      try {
        await L.setupAdmin(admin.page);
        await L.addUser(admin.page, '稽查员A', 'inspector', '1111');
        await admin.page.click('.tabbar [data-view=cases]');
        await phone.page.reload(); await L.loginOk(phone.page, '稽查员A', '1111');
        await L.createCase(phone.page, 'AUTO-001');
        assert(!(await admin.page.$('#case-list .case-card')), '刷新前管理员端还看不到');
        await admin.page.clock.fastForward(31000);
        await admin.page.waitForSelector('#case-list .case-card:has-text("AUTO-001")', { timeout: 5000 });
        return '';
      } finally { await admin.close(); await phone.close(); }
    }
  },
  {
    name: '模板维护：管理员新增拍摄项目后，新案件使用新清单，已建案件保持原清单',
    fn: async () => {
      const w = L.createWorld(); const p = await L.openPage(w); const page = p.page;
      try {
        await L.setupAdmin(page);
        await L.createCase(page, 'T-OLD'); await page.click('[data-action=back]');
        await page.click('.tabbar [data-view=admin]');
        await page.click('[data-action=goto][data-view=templates]');
        await page.click('.list-item:has-text("无证运输") [data-action=tpl-edit]');
        await page.click('[data-action=tpl-add-item] >> nth=0');
        await page.fill('.tpl-cat >> nth=0 >> .tpl-item >> nth=-1 >> input[type=text]', '驾驶室内部照片');
        await page.click('[data-action=tpl-save]');
        await page.waitForSelector('[data-action=tpl-new]');
        await page.click('[data-action=back]');
        await page.click('.tabbar [data-view=cases]');
        await L.createCase(page, 'T-NEW');
        assert(await page.$('.tile-name:has-text("驾驶室内部照片")'), '新案件应含新增项目');
        await page.click('[data-action=back]');
        await page.click('#case-list .case-card:has-text("T-OLD")');
        await page.waitForSelector('.tiles');
        assert(!(await page.$('.tile-name:has-text("驾驶室内部照片")')), '已建案件不应变化');
        return '';
      } finally { await p.close(); }
    }
  },
  {
    name: '全流程控制台无错误（除已知沙箱 CDN 403 外）',
    fn: async () => {
      const w = L.createWorld(); const p = await L.openPage(w); const page = p.page;
      try {
        await L.setupAdmin(page);
        await L.createCase(page, 'CON-001', '假烟销售');
        await L.captureAllRequired(page);
        await L.captureItem(page, '转账支付记录截图', L.img('screenshot'), 'album');
        await L.addSeized(page, { brand: 'x', qty: 2 });
        await L.packageCase(page);
        await page.click('[data-action=back]');
        await page.click('.tabbar [data-view=me]');
        await page.click('.tabbar [data-view=admin]');
        const errs = p.errors.filter(e => !/cdnjs|403/.test(e));
        assert(!errs.length, '控制台错误：' + errs.join(' ; '));
        return '0 条错误';
      } finally { await p.close(); }
    }
  }
];
