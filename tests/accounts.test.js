const L = require('./lib');
const { assert } = L;

async function visibleNumbers(page) {
  if (!(await page.$('#case-list'))) await page.click('.tabbar [data-view=cases]');
  const before = await page.getAttribute('#refresh-info', 'data-ts');
  await page.click('[data-action=refresh]');
  await page.waitForFunction(b => document.querySelector('#refresh-info').dataset.ts !== b, before);
  return page.$$eval('#case-list .case-no', els => els.map(e => e.textContent));
}

module.exports = [
  {
    name: '角色与分配：稽查员只见自己的；未分配仅创建者可见；管理员分配/重新分配（二次确认）',
    fn: async () => {
      const w = L.createWorld();
      const admin = await L.openPage(w);
      const phoneA = await L.openPage(w);
      const phoneB = await L.openPage(w);
      try {
        await L.setupAdmin(admin.page);
        await L.addUser(admin.page, '稽查员A', 'inspector', '1111');
        await L.addUser(admin.page, '稽查员B', 'inspector', '2222');
        await phoneA.page.reload(); await L.loginOk(phoneA.page, '稽查员A', '1111');
        await phoneB.page.reload(); await L.loginOk(phoneB.page, '稽查员B', '2222');
        await L.createCase(phoneA.page, 'A-001');
        await phoneA.page.click('[data-action=back]');
        assert((await visibleNumbers(phoneA.page)).includes('A-001'), 'A 应看到自己创建的未分配案件');
        assert(!(await visibleNumbers(phoneB.page)).includes('A-001'), 'B 不应看到 A 的未分配案件');
        // 管理员不 reload，点刷新即可看到
        assert((await visibleNumbers(admin.page)).includes('A-001'), '管理员刷新后应看到新案件');
        // 首次分配给 B（无需二次确认）
        await admin.page.click('#case-list .case-card:has-text("A-001") [data-action=assign-case]');
        const bId = JSON.parse(w.shared.get('users')).find(u => u.name === '稽查员B').id;
        await admin.page.selectOption('form[data-form=assign] [name=user]', bId);
        await admin.page.click('form[data-form=assign] [type=submit]');
        await admin.page.waitForSelector('#case-list .case-card:has-text("承办：稽查员B")');
        assert(!(await visibleNumbers(phoneA.page)).includes('A-001'), '分配给 B 后，A 不应再看到');
        assert((await visibleNumbers(phoneB.page)).includes('A-001'), '分配给 B 后，B 应看到');
        // 重新分配给 A：需二次确认；先取消
        const aId = JSON.parse(w.shared.get('users')).find(u => u.name === '稽查员A').id;
        await admin.page.click('#case-list .case-card:has-text("A-001") [data-action=assign-case]');
        await admin.page.selectOption('form[data-form=assign] [name=user]', aId);
        await admin.page.click('form[data-form=assign] [type=submit]');
        const txt = await admin.page.textContent('.modal');
        assert(txt.includes('重新分配') && txt.includes('稽查员B'), '重新分配应弹出二次确认');
        await L.confirmModal(admin.page, false);
        assert(JSON.parse(w.shared.get('case-index'))[0].assignedTo === bId, '取消后承办人不应改变');
        await admin.page.click('#case-list .case-card:has-text("A-001") [data-action=assign-case]');
        await admin.page.selectOption('form[data-form=assign] [name=user]', aId);
        await admin.page.click('form[data-form=assign] [type=submit]');
        await L.confirmModal(admin.page, true);
        await admin.page.waitForSelector('#case-list .case-card:has-text("承办：稽查员A")');
        assert((await visibleNumbers(phoneA.page)).includes('A-001') && !(await visibleNumbers(phoneB.page)).includes('A-001'), '重新分配后可见性应随之变化');
        // 日志
        const c = JSON.parse(w.shared.get('case:' + JSON.parse(w.shared.get('case-index'))[0].id));
        assert(c.log.filter(l => l.action === '分配承办人').length === 2, '应记录 2 次分配日志');
        return '分配 / 重新分配 / 可见性均符合；管理员点"刷新"即见新案件，无需重载页面';
      } finally { await admin.close(); await phoneA.close(); await phoneB.close(); }
    }
  },
  {
    name: '稽查员权限：无"管理"入口、不能分配、不能改模板',
    fn: async () => {
      const w = L.createWorld(); const p = await L.openPage(w); const page = p.page;
      try {
        await L.setupAdmin(page);
        await L.addUser(page, '稽查员A', 'inspector', '1111');
        await L.logout(page);
        await L.loginOk(page, '稽查员A', '1111');
        assert(!(await page.$('.tabbar [data-view=admin]')), '稽查员不应有管理入口');
        await L.createCase(page, 'A-002');
        assert(!(await page.$('[data-action=assign-case]')), '稽查员不应有分配按钮');
        // 即便绕过界面直接调用，也不能进入管理页
        await page.evaluate(() => history.pushState({ view: 'admin' }, ''));
        await page.goBack(); await page.goForward();
        assert(!(await page.$('[data-action=tpl-edit]')), '稽查员不应看到模板编辑');
        return '';
      } finally { await p.close(); }
    }
  },
  {
    name: '不能删除/降级最后一个管理员；不能删除自己；删除用户需二次确认',
    fn: async () => {
      const w = L.createWorld(); const p = await L.openPage(w); const page = p.page;
      try {
        await L.setupAdmin(page, '管理员甲');
        await page.click('.tabbar [data-view=admin]');
        await page.click('[data-action=goto][data-view=users]');
        await page.click('.list-item:has-text("管理员甲") [data-action=user-role]');
        await page.waitForSelector('.toast:has-text("不能取消最后一个管理员")');
        await page.click('.list-item:has-text("管理员甲") [data-action=user-del]');
        await page.waitForSelector('.toast:has-text("不能删除当前登录的账号")');
        await page.click('[data-action=back]');
        await L.addUser(page, '管理员乙', 'admin', '2222');
        await L.logout(page);
        await L.loginOk(page, '管理员乙', '2222');
        await page.click('.tabbar [data-view=admin]');
        await page.click('[data-action=goto][data-view=users]');
        await page.click('.list-item:has-text("管理员甲") [data-action=user-del]');
        await L.confirmModal(page, false);
        assert(JSON.parse(w.shared.get('users')).length === 2, '取消后不应删除');
        await page.click('.list-item:has-text("管理员甲") [data-action=user-del]');
        await L.confirmModal(page, true);
        await page.waitForFunction(() => !document.body.textContent.includes('管理员甲'));
        const users = JSON.parse(w.shared.get('users'));
        assert(users.length === 1 && users[0].name === '管理员乙', '应只剩管理员乙');
        await page.click('.list-item:has-text("管理员乙") [data-action=user-role]');
        await page.waitForSelector('.toast:has-text("不能取消最后一个管理员")');
        return '';
      } finally { await p.close(); }
    }
  },
  {
    name: 'P0-3 PIN：新账号用 PBKDF2+随机盐，无 plain: 明文',
    fn: async () => {
      const w = L.createWorld(); const p = await L.openPage(w); const page = p.page;
      try {
        await L.setupAdmin(page);
        await L.addUser(page, '稽查员A', 'inspector', '1111');
        await L.addUser(page, '稽查员B', 'inspector', '1111');
        const users = JSON.parse(w.shared.get('users'));
        users.forEach(u => assert(/^pbkdf2:sha256:(\d+):[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/.test(u.pinHash), '格式不符：' + u.pinHash));
        const iters = users.map(u => +u.pinHash.split(':')[2]);
        assert(iters.every(i => i >= 10000), '迭代次数应 ≥10000');
        assert(users[1].pinHash !== users[2].pinHash, '相同 PIN 因盐不同，摘要应不同');
        assert(![...w.shared.values()].some(v => v.includes('plain:')), '存储中不得出现 plain:');
        return 'PBKDF2-SHA256，' + iters[0] + ' 次迭代，16 字节随机盐';
      } finally { await p.close(); }
    }
  },
  {
    name: 'P0-3 PIN：旧 sha256:/plain: 格式可登录并自动升级为 PBKDF2',
    fn: async () => {
      const w = L.createWorld();
      const crypto = require('crypto');
      w.shared.set('users', JSON.stringify([
        { id: 'u1', name: '旧管理员', role: 'admin', pinHash: 'sha256:' + crypto.createHash('sha256').update('4321').digest('hex'), createdAt: 1 },
        { id: 'u2', name: '旧稽查员', role: 'inspector', pinHash: 'plain:8888', createdAt: 1 }
      ]));
      const p = await L.openPage(w); const page = p.page;
      try {
        await L.loginOk(page, '旧管理员', '4321');
        await L.logout(page);
        await L.loginOk(page, '旧稽查员', '8888');
        const users = JSON.parse(w.shared.get('users'));
        assert(users.every(u => u.pinHash.startsWith('pbkdf2:')), '登录后应升级为 pbkdf2：' + users.map(u => u.pinHash.slice(0, 10)));
        assert(![...w.shared.values()].some(v => v.includes('plain:')), '升级后不得残留 plain:');
        await L.logout(page);
        await L.loginOk(page, '旧管理员', '4321');
        return '升级后用原 PIN 仍可登录';
      } finally { await p.close(); }
    }
  },
  {
    name: 'P0-3 PIN：连续输错 5 次锁定 30 秒（锁定期间正确 PIN 也拒绝）',
    fn: async () => {
      const w = L.createWorld(); const p = await L.openPage(w); const page = p.page;
      try {
        await L.setupAdmin(page, '管理员甲', '123456');
        await L.logout(page);
        await page.clock.install();
        for (let i = 1; i <= 5; i++) {
          await L.login(page, '管理员甲', '000000');
          await page.waitForFunction(n => document.querySelector('#login-msg').textContent.includes(n === 5 ? '已锁定' : '还可尝试 ' + (5 - n)), i);
        }
        await L.login(page, '管理员甲', '123456');
        await page.waitForFunction(() => document.querySelector('#login-msg').textContent.includes('秒后再试'));
        assert(!(await page.$('#case-list')), '锁定期间不应登录成功');
        await page.clock.fastForward(31000);
        await L.loginOk(page, '管理员甲', '123456');
        return '第 5 次后锁定；30 秒后可登录（计数仅在页面内存，刷新页面会清零——体验层限制）';
      } finally { await p.close(); }
    }
  },
  {
    name: 'P0-3 无 Web Crypto 时拒绝创建账号并提示',
    fn: async () => {
      const w = L.createWorld();
      const p = await L.openPage(w, { initScript: () => { try { Object.defineProperty(window.crypto, 'subtle', { value: undefined, configurable: true }); } catch (e) { /* */ } } });
      try {
        await p.page.waitForSelector('form[data-form=setup]');
        const txt = await p.page.textContent('#view-root');
        assert(txt.includes('不支持安全加密接口'), '应提示不支持 Web Crypto');
        assert(await p.page.$eval('form[data-form=setup] [type=submit]', b => b.disabled), '创建按钮应禁用');
        assert(!w.shared.has('users'), '不应创建任何账号');
        return '';
      } finally { await p.close(); }
    }
  }
];
