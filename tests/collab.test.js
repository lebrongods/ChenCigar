// 拍完提示下一项；案件信息、笔录的多人修改冲突提示
const L = require('./lib');
const { assert } = L;

async function twoPhones(w, number) {
  const a = await L.openPage(w); await L.setupAdmin(a.page, '王管理', '123456');
  await L.createCase(a.page, number);
  const b = await L.openPage(w); await L.loginOk(b.page, '王管理', '123456');
  await b.page.click('#case-list .case-card:has-text("' + number + '")'); await b.page.waitForSelector('.tiles');
  return { a, b };
}

module.exports = [
  {
    name: '拍完一项自动提示下一个未拍的必拍项，可直接点拍照；可关闭提示；拍齐后提示"必拍项已全部拍完"',
    fn: async () => {
      const w = L.createWorld(); const p = await L.openPage(w); const page = p.page;
      try {
        await L.setupAdmin(page);
        await L.createCase(page, 'N-001');
        const req = await page.$$eval('.tile.missing', els => els.map(e => ({ id: e.dataset.itemId, name: e.querySelector('.tile-name').textContent })));
        assert(!(await page.$('.next-shot')), '还没拍时不提示');
        await L.capture(page, '.tile[data-item-id="' + req[0].id + '"] [data-action=capture][data-src=camera]', L.img('sharp'));
        await page.waitForSelector('.next-shot');
        assert((await page.textContent('.next-shot')).includes(req[1].name.replace(/\s*必拍.*/, '').trim().slice(0, 4)), '应提示第 2 个必拍项：' + await page.textContent('.next-shot'));
        // 连续点"下一项"的拍照，把剩下的拍完
        for (let i = 1; i < req.length; i++) {
          await L.capture(page, '.next-shot [data-action=capture][data-src=camera]', L.img(['sharp', 'sharp2', 'sharp3'][i % 3]));
          await page.waitForFunction(n => document.querySelectorAll('.tile.missing').length === n, req.length - i - 1);
        }
        assert(!(await page.$('.next-shot')), '拍齐后不再提示下一项');
        assert((await L.toastText(page)).includes('必拍项已全部拍完'), '应提示拍齐');
        // 关闭提示后不再出现
        await page.click('.tile.done [data-action=capture][data-src=camera]').catch(() => {});
        return '用"下一项"按钮连续拍完 ' + req.length + ' 个必拍项';
      } finally { await p.close(); }
    }
  },
  {
    name: '"✕"关闭下一项提示后，本案件不再提示',
    fn: async () => {
      const w = L.createWorld(); const p = await L.openPage(w); const page = p.page;
      try {
        await L.setupAdmin(page);
        await L.createCase(page, 'N-002');
        const ids = await page.$$eval('.tile.missing', els => els.map(e => e.dataset.itemId));
        await L.capture(page, '.tile[data-item-id="' + ids[0] + '"] [data-action=capture][data-src=camera]', L.img('sharp'));
        await page.waitForSelector('.next-shot');
        await page.click('[data-action=next-dismiss]');
        await page.waitForSelector('.next-shot', { state: 'detached' });
        await L.capture(page, '.tile[data-item-id="' + ids[1] + '"] [data-action=capture][data-src=camera]', L.img('sharp2'));
        await page.waitForTimeout(300);
        assert(!(await page.$('.next-shot')), '关闭后不应再出现');
        return '';
      } finally { await p.close(); }
    }
  },
  {
    name: '案件信息：两人各改不同字段时自动合并；改同一字段时提示冲突，可选"保留对方的"',
    fn: async () => {
      const w = L.createWorld(); const { a, b } = await twoPhones(w, 'C-001');
      try {
        const caseObj = () => JSON.parse(w.shared.get('case:' + JSON.parse(w.shared.get('case-index'))[0].id));
        // A 打开编辑框（未保存），B 改地址并保存，A 再改当事人并保存
        await a.page.click('[data-action=edit-info]');
        await b.page.click('[data-action=edit-info]');
        await b.page.fill('form[data-form=caseInfo] [name=address]', '乙改的地址');
        await b.page.click('form[data-form=caseInfo] [type=submit]');
        await b.page.waitForSelector('.modal', { state: 'detached' });
        await a.page.fill('form[data-form=caseInfo] [name=party]', '甲填的当事人');
        await a.page.click('form[data-form=caseInfo] [type=submit]');
        await a.page.waitForSelector('.modal', { state: 'detached' });
        let c = caseObj();
        assert(c.address === '乙改的地址' && c.party === '甲填的当事人', '不同字段应自动合并：' + c.address + ' / ' + c.party);
        // 同一字段冲突（B 先刷新拿到最新内容）
        await b.page.click('[data-action=reload-case]');
        await b.page.waitForSelector('.tiles');
        await a.page.click('[data-action=edit-info]');
        await b.page.click('[data-action=edit-info]');
        await b.page.fill('form[data-form=caseInfo] [name=party]', '乙改的当事人');
        await b.page.click('form[data-form=caseInfo] [type=submit]');
        await b.page.waitForSelector('.modal', { state: 'detached' });
        await a.page.fill('form[data-form=caseInfo] [name=party]', '甲又改的当事人');
        await a.page.click('form[data-form=caseInfo] [type=submit]');
        await a.page.waitForSelector('.modal:has-text("案件信息冲突")');
        const t = await a.page.textContent('.modal');
        assert(t.includes('乙改的当事人') && t.includes('甲又改的当事人'), '冲突提示应列出双方的值：' + t);
        await L.confirmModal(a.page, false);
        c = caseObj();
        assert(c.party === '乙改的当事人' && c.address === '乙改的地址', '选择保留对方的：' + c.party);
        return '';
      } finally { await a.close(); await b.close(); }
    }
  },
  {
    name: '笔录：两人同时编辑同一份笔录不再静默覆盖——后保存的一方看到冲突提示，可载入对方版本或覆盖（留痕）',
    fn: async () => {
      const w = L.createWorld(); const { a, b } = await twoPhones(w, 'C-002');
      try {
        await a.page.click('[data-action=rec-new][data-type=scene]');
        await a.page.waitForSelector('[data-rf=place]');
        await a.page.fill('[data-rf=place]', '甲写的地点');
        await a.page.waitForSelector('#save-ind:has-text("已自动保存")');
        const recId = await a.page.evaluate(() => window.__EVIDENCE_APP__.state.recordId);
        const stored = () => JSON.parse(w.shared.get('rec:' + recId));
        await b.page.click('[data-action=reload-case]');
        await b.page.click('[data-action=rec-open]');
        await b.page.waitForSelector('[data-rf=place]');
        await b.page.fill('[data-rf=place]', '乙写的地点');
        await b.page.waitForSelector('#save-ind:has-text("已自动保存")');
        // 甲在旧版本上继续改：应提示冲突，不覆盖乙的
        await a.page.fill('[data-rf=place]', '甲又写的地点');
        await a.page.waitForSelector('#rec-conflict');
        assert(stored().place === '乙写的地点', '冲突时不应覆盖对方：' + stored().place);
        await a.page.click('[data-action=rec-conf-theirs]');
        await a.page.waitForSelector('#rec-conflict', { state: 'detached' });
        assert(await a.page.inputValue('[data-rf=place]') === '乙写的地点', '应载入对方版本');
        // 甲在新版本上改，正常保存
        await a.page.fill('[data-rf=place]', '甲最终的地点');
        await a.page.waitForFunction(() => document.querySelector('#save-ind').textContent.includes('已自动保存'));
        await a.page.waitForTimeout(900);
        assert(stored().place === '甲最终的地点', '载入后再改应能保存：' + stored().place);
        // 乙在旧版本上改 → 冲突 → 选择覆盖
        await b.page.fill('[data-rf=place]', '乙坚持的地点');
        await b.page.waitForSelector('#rec-conflict');
        await b.page.click('[data-action=rec-conf-mine]');
        await L.confirmModal(b.page, true);
        await b.page.waitForSelector('#rec-conflict', { state: 'detached' });
        assert(stored().place === '乙坚持的地点', '选择覆盖后应为乙的内容');
        const c = JSON.parse(w.shared.get('case:' + JSON.parse(w.shared.get('case-index'))[0].id));
        assert(c.log.some(l => l.action.includes('覆盖他人修改')), '覆盖应写入操作日志');
        return '';
      } finally { await a.close(); await b.close(); }
    }
  }
];
