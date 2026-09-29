const L = require('./lib');
const Z = require('./zip');
const { assert } = L;

module.exports = [
  {
    name: '首次使用：设置管理员后进入案件列表',
    fn: async () => {
      const w = L.createWorld(); const p = await L.openPage(w);
      try {
        await L.setupAdmin(p.page);
        const users = JSON.parse(w.shared.get('users'));
        assert(users.length === 1 && users[0].role === 'admin', '应创建 1 个管理员');
        assert(p.personal.has('current-session'), 'current-session 应写入 personal 区');
        assert(!w.shared.has('current-session'), 'current-session 不得写入 shared 区');
        assert(JSON.parse(w.shared.get('templates')).length === 4, '应有 4 个默认模板');
        return '4 个默认模板；会话存 personal 区';
      } finally { await p.close(); }
    }
  },
  {
    name: '主流程：新建→缺项拦截→补齐→无查获拦截→登记→生成 ZIP→解压核对',
    fn: async () => {
      const w = L.createWorld(); const p = await L.openPage(w); const page = p.page;
      try {
        await L.setupAdmin(page);
        await L.createCase(page, 'X烟立〔2026〕001号', '无证运输', { address: '某路 1 号', party: '张某' });
        const c = JSON.parse(w.shared.get('case-index'))[0];
        assert(c.assignedTo === null, '新建案件 assignedTo 应为 null');
        // 缺项拦截
        await page.click('[data-action=package]');
        await page.waitForSelector('#pack-result.alert-danger');
        const t1 = await page.textContent('#pack-result');
        assert(t1.includes('缺 8 项'), '应列出 8 个必拍缺项，实际：' + t1);
        assert(t1.includes('车头照片') && t1.includes('外包装及生产批号特写'), '缺项清单应含具体项目');
        assert(!t1.includes('查获数量清点照片'), '选拍项不应出现在缺项中');
        // 点击缺项跳转
        await page.click('#pack-result a >> nth=0');
        // 补齐
        const n = await L.captureAllRequired(page);
        assert(n === 8, '应补拍 8 项');
        // 无查获拦截
        await page.click('[data-action=package]');
        await page.waitForSelector('#pack-result.alert-danger');
        assert((await page.textContent('#pack-result')).includes('未登记查获卷烟'), '应拦截：未登记查获卷烟');
        // 登记并拍选拍项
        await L.addSeized(page, { brand: '某品牌（硬）', qty: 20, unit: '条', barcode: '6901028075015' });
        await L.captureItem(page, '查获数量清点照片', L.img('sharp2'));
        const { zip, suggested } = await L.packageCase(page);
        assert(/^X烟立〔2026〕001号_证据包_\d{12}\.zip$/.test(suggested), '证据包文件名不符：' + suggested);
        const u = Z.unzip(zip);
        const expect = ['X烟立〔2026〕001号_车辆信息_车头照片.jpg', 'X烟立〔2026〕001号_人员证件_当事人身份证.jpg', 'X烟立〔2026〕001号_物证与现场_查获数量清点照片.jpg', '证据清单说明.txt', 'SHA256SUMS.txt'];
        expect.forEach(f => assert(u.files.includes(f), '证据包缺少文件：' + f));
        assert(u.files.filter(f => f.endsWith('.jpg')).length === 9, '应有 9 张照片，实际 ' + u.files.length);
        const m = u.manifest;
        ['案件编号：X烟立〔2026〕001号', '案件类型：无证运输', '采集人（案件创建人）：管理员甲', '承办人：未分配', '证据包生成时间', 'SHA-256：', '品规：某品牌（硬）　数量：20 条　条码：6901028075015', '合计：20 条', '系统：涉烟案件现场证据采集系统 v'].forEach(s => assert(m.includes(s), '清单缺少：' + s));
        assert(!m.includes('防篡改措施。') || m.includes('不是防篡改措施'), '清单不得声明防篡改');
        const check = Z.sha256check(u.dir);
        assert((check.match(/: OK/g) || []).length === 9, 'sha256sum -c 应 9 项 OK：' + check);
        const st = JSON.parse(w.shared.get('case-index'))[0];
        assert(st.status === 'complete' && st.lastPackagedAt, '打包后状态应为已齐全且记录打包时间');
        return '9 张照片 + 清单 + SHA256SUMS；sha256sum -c 9/9 OK';
      } finally { await p.close(); }
    }
  },
  {
    name: '照片压缩：长边 ≤1280px，单张 ≤300KB',
    fn: async () => {
      const w = L.createWorld(); const p = await L.openPage(w); const page = p.page;
      try {
        await L.setupAdmin(page);
        await L.createCase(page, 'PHOTO-1');
        await L.captureItem(page, '车头照片', L.img('sharp'));
        const pk = [...w.shared.keys()].find(k => k.startsWith('photo:'));
        const url = JSON.parse(w.shared.get(pk));
        const dim = await page.evaluate(u => new Promise(r => { const i = new Image(); i.onload = () => r([i.naturalWidth, i.naturalHeight]); i.src = u; }), url);
        const kb = Math.round(Buffer.from(url.split(',')[1], 'base64').length / 1024);
        assert(Math.max(...dim) <= 1280, '长边应 ≤1280，实际 ' + dim);
        assert(kb <= 300, '单张应 ≤300KB，实际 ' + kb + 'KB');
        return '1600×1200 测试图 → ' + dim.join('×') + '，' + kb + ' KB';
      } finally { await p.close(); }
    }
  },
  {
    name: '一个案件 20 张照片：拍摄与打包不卡顿',
    fn: async (ctx) => {
      const w = L.createWorld(); const p = await L.openPage(w); const page = p.page;
      try {
        await L.setupAdmin(page);
        await L.createCase(page, 'PERF-20', '无证经营');
        const req = await L.captureAllRequired(page);
        const extras = 20 - req;
        const t0 = Date.now();
        for (let i = 0; i < extras; i++) {
          const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.click('.section-title [data-action=capture][data-kind=extra][data-src=camera]')]);
          await fc.setFiles(L.img(['sharp', 'sharp2', 'sharp3'][i % 3]));
          await page.waitForSelector('form[data-form=prompt]');
          await page.fill('form[data-form=prompt] [name=value]', '补充' + (i + 1));
          await page.click('form[data-form=prompt] [type=submit]');
          await page.waitForFunction(n => document.querySelectorAll('[data-kind=extra][data-action=view-photo]').length === n, i + 1);
        }
        const perPhoto = Math.round((Date.now() - t0) / extras);
        await L.addSeized(page, { brand: '某品牌', qty: 5 });
        const photos = req + extras;
        const t1 = Date.now();
        const { zip } = await L.packageCase(page);
        const packMs = Date.now() - t1;
        const u = require('./zip').unzip(zip);
        const n = u.files.filter(f => f.endsWith('.jpg')).length;
        assert(n === photos && n >= 20, '应有 ≥20 张照片，实际 ' + n);
        assert(packMs < 10000, '打包耗时过长：' + packMs);
        ctx.note('**性能（无头 Chromium，桌面 CPU）**：单张照片处理并保存平均 ' + perPhoto + ' ms；' + n + ' 张照片打包 ' + packMs + ' ms。手机上会更慢，需真机复测。');
        return n + ' 张；单张平均 ' + perPhoto + 'ms；打包 ' + packMs + 'ms';
      } finally { await p.close(); }
    }
  }
];
