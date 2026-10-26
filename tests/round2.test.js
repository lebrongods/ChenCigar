// 第二轮独立测试报告（v2.4.2）问题的回归测试
const L = require('./lib');
const S = require('./synth');
const { assert } = L;

// 李稽查建案（停留在案件页），管理员把案件改派给赵稽查
async function reassigned(w, number, afterCreate) {
  const admin = await L.openPage(w); const li = await L.openPage(w);
  await L.setupAdmin(admin.page);
  await L.addUser(admin.page, '李稽查', 'inspector', '1111');
  await L.addUser(admin.page, '赵稽查', 'inspector', '2222');
  await li.page.reload(); await L.loginOk(li.page, '李稽查', '1111');
  await L.createCase(li.page, number);
  if (afterCreate) await afterCreate(li.page);
  await admin.page.click('.tabbar [data-view=cases]').catch(() => {});
  await admin.page.click('[data-action=refresh]');
  await admin.page.click('#case-list .case-card:has-text("' + number + '") [data-action=assign-case]');
  const zId = JSON.parse(w.shared.get('users')).find(u => u.name === '赵稽查').id;
  await admin.page.selectOption('form[data-form=assign] [name=user]', zId);
  await admin.page.click('form[data-form=assign] [type=submit]');
  await admin.page.waitForSelector('#case-list .case-card:has-text("承办：赵稽查")');
  const caseId = JSON.parse(w.shared.get('case-index'))[0].id;
  return { admin, li, caseId };
}
const keys = (w, pre) => [...w.shared.keys()].filter(k => k.startsWith(pre)).length;

module.exports = [
  {
    name: 'V242-01 改派后旧页面不能删除案件（案件、照片、索引都保留）',
    fn: async () => {
      const w = L.createWorld();
      const { admin, li, caseId } = await reassigned(w, 'R2-001', page => L.captureItem(page, '车头照片', L.img('sharp')));
      try {
        assert(await li.page.$('[data-action=delete-case]'), '前提：旧页面仍显示删除按钮');
        await li.page.click('[data-action=delete-case]');
        await li.page.waitForSelector('#case-list');
        assert(w.shared.has('case:' + caseId) && keys(w, 'photo:') === 1 && JSON.parse(w.shared.get('case-index')).length === 1, '案件、照片、索引都应保留');
        assert((await L.toastText(li.page)).includes('改派'), '应提示已改派');
        return '';
      } finally { await admin.close(); await li.close(); }
    }
  },
  {
    name: 'V242-01 改派后旧页面不能删除笔录、不能新建笔录（不留孤儿笔录）',
    fn: async () => {
      const w = L.createWorld();
      const { admin, li, caseId } = await reassigned(w, 'R2-002', async page => {
        await page.click('[data-action=rec-new][data-type=inquiry]');
        await page.waitForSelector('#save-ind');
      });
      try {
        assert(keys(w, 'rec:') === 1, '前提：已有 1 份笔录');
        await li.page.click('[data-action=rec-del]');
        await li.page.waitForSelector('#case-list');
        const c = JSON.parse(w.shared.get('case:' + caseId));
        assert(keys(w, 'rec:') === 1 && c.records.length === 1, '笔录正文和摘要都应保留');
        // 新建笔录：用一个仍停留在案件页的旧页面
        const li2 = await L.openPage(w);
        try {
          await L.loginOk(li2.page, '李稽查', '1111');
          // 让旧页面停在改派前的案件页：重新把案件分配回李，打开后再改派给赵
          const liId = JSON.parse(w.shared.get('users')).find(u => u.name === '李稽查').id;
          const zId = JSON.parse(w.shared.get('users')).find(u => u.name === '赵稽查').id;
          const setAssignee = uid => { const cc = JSON.parse(w.shared.get('case:' + caseId)); cc.assignedTo = uid; w.shared.set('case:' + caseId, JSON.stringify(cc)); const idx = JSON.parse(w.shared.get('case-index')); idx[0].assignedTo = uid; w.shared.set('case-index', JSON.stringify(idx)); };
          setAssignee(liId);
          await li2.page.click('[data-action=refresh]');
          await li2.page.click('#case-list .case-card:has-text("R2-002")');
          await li2.page.waitForSelector('[data-action=rec-new]');
          setAssignee(zId);
          await li2.page.click('[data-action=rec-new][data-type=scene]');
          await li2.page.waitForSelector('#case-list');
          assert(keys(w, 'rec:') === 1, '不应生成孤儿笔录：' + keys(w, 'rec:'));
        } finally { await li2.close(); }
        return '';
      } finally { await admin.close(); await li.close(); }
    }
  },
  {
    name: 'V242-02 图片计数绑定单位：数出 16 条后改为"件"按 0.32 件折算，不会变成 16 件；编辑已保存记录只改单位也折算',
    fn: async () => {
      const w = L.createWorld();
      const pile = await S.pilePhoto('r2-pile', { other: [1, 5, 7, 12] });
      const p = await L.openPage(w); const page = p.page;
      try {
        await L.setupAdmin(page); await L.createCase(page, 'R2-003');
        await page.click('[data-action=seized-add]');
        await page.fill('form[data-form=seized] [name=barcode]', '075015');
        await page.waitForSelector('#barcode-msg:has-text("中华（硬）")');
        const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.click('[data-action=count-photo][data-src=album]')]);
        await fc.setFiles(pile.file);
        await page.waitForSelector('.counter canvas.boxing');
        const b = pile.boxes[0];
        const r = await page.$eval('.counter canvas', c => { const x = c.getBoundingClientRect(); return { left: x.left, top: x.top, width: x.width, height: x.height }; });
        const pt = q => [r.left + q.x / pile.W * r.width, r.top + q.y / pile.H * r.height];
        await page.mouse.move(...pt({ x: b.x + 3, y: b.y + 3 })); await page.mouse.down(); await page.mouse.move(...pt({ x: b.x + b.w - 3, y: b.y + b.h - 3 }), { steps: 5 }); await page.mouse.up();
        await page.waitForSelector('.cnt-n');
        await page.click('.counter [data-ct=done]');
        await page.waitForFunction(() => document.querySelector('form[data-form=seized] [name=qty]').value === '16');
        await page.selectOption('form[data-form=seized] [name=unit]', '件');
        await page.waitForFunction(() => document.querySelector('form[data-form=seized] [name=qty]').value === '0.32');
        assert((await page.textContent('.count-box')).includes('16 条') && (await page.textContent('.count-box')).includes('折合 0.32 件'), '计数结果保留计数时的单位：' + await page.textContent('.count-box'));
        await page.click('form[data-form=seized] [type=submit]');
        await page.waitForSelector('form[data-form=seized]', { state: 'detached' });
        let list = await page.textContent('#seized-list');
        assert(list.includes('0.32 件') && list.includes('7,200') && !list.includes('360,000'), '金额应为 7,200 元：' + list);
        assert(list.includes('图片计数 16 条') && !list.includes('图片计数 16 件'), '数量依据保留 16 条：' + list);
        // 编辑：只把单位改回"条"，应折算为 16 条
        await page.click('[data-action=seized-edit]');
        await page.selectOption('form[data-form=seized] [name=unit]', '条');
        await page.waitForFunction(() => document.querySelector('form[data-form=seized] [name=qty]').value === '16');
        await page.click('form[data-form=seized] [type=submit]');
        await page.waitForSelector('form[data-form=seized]', { state: 'detached' });
        list = await page.textContent('#seized-list');
        assert(list.includes('16 条') && !list.includes('不一致'), '改回条应为 16 条：' + list);
        // 只改数量不重新计数：注明不一致
        await page.click('[data-action=seized-edit]');
        await page.fill('form[data-form=seized] [name=qty]', '15');
        await page.click('form[data-form=seized] [type=submit]');
        await page.waitForSelector('form[data-form=seized]', { state: 'detached' });
        assert((await page.textContent('#seized-list')).includes('与图片计数结果不一致'), '手工改数量应注明');
        return '';
      } finally { await p.close(); }
    }
  },
  {
    name: 'V242-05 笔录保存失败时点返回会提醒，可选择留在本页，修改不丢失',
    fn: async () => {
      const w = L.createWorld(); const p = await L.openPage(w); const page = p.page;
      try {
        await L.setupAdmin(page); await L.createCase(page, 'R2-004');
        await page.click('[data-action=rec-new][data-type=scene]');
        await page.waitForSelector('[data-rf=place]');
        w.failKeys = new Set([...w.shared.keys()].filter(k => k.startsWith('rec:')));
        await page.fill('[data-rf=place]', '保存会失败的地点');
        await page.waitForSelector('#save-ind:has-text("保存失败")');
        await page.click('#save-banner-close');
        await page.click('[data-action=back]');
        await page.waitForSelector('.modal:has-text("笔录未保存")');
        await L.confirmModal(page, false);
        assert(await page.inputValue('[data-rf=place]') === '保存会失败的地点', '应留在笔录页，内容仍在');
        await page.waitForTimeout(900); // 留在本页后会自动重试保存（存储仍故障，横幅会再次出现）
        w.failKeys = null;
        if (await page.isVisible('#save-banner')) await page.click('#save-banner-close');
        await page.click('[data-action=back]');
        await page.waitForSelector('.tiles');
        const rec = JSON.parse(w.shared.get([...w.shared.keys()].find(k => k.startsWith('rec:'))));
        assert(rec.place === '保存会失败的地点', '存储恢复后离开时应保存成功：' + rec.place);
        return '';
      } finally { await p.close(); }
    }
  }
];
