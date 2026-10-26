// 证件辅助录入：身份证、驾驶证离线识别 → 人工核对确认 → 笔录中直接选用
const L = require('./lib');
const Z = require('./zip');
const S = require('./synth');
const { assert } = L;
const ID = '430000198503061232'; // 示例号码（校验位正确，地区码不真实）

async function newCase(w, number, required) {
  const p = await L.openPage(w); const page = p.page;
  await L.setupAdmin(page); await L.createCase(page, number);
  if (required) await L.captureAllRequired(page);
  return p;
}
async function ocr(page, file, doc, src = 'camera') {
  const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.click('[data-action=person-ocr][data-doc=' + doc + '][data-src=' + src + ']')]);
  await fc.setFiles(file);
  await page.waitForSelector('form[data-form=person]', { timeout: 60000 });
}
const val = (page, n) => page.inputValue('form[data-form=person] [name=' + n + ']');

module.exports = [
  {
    name: '身份证识别（本机离线）：带出姓名、性别、民族、出生、住址、号码并校验；不勾选"已核对"不能保存；确认后保存、自动填入案件当事人、写入日志和证据清单',
    fn: async () => {
      const w = L.createWorld();
      const file = await S.cardPhoto('idcard-1', { kind: 'idcard', tilt: 2 });
      const p = await newCase(w, 'O-001', true); const page = p.page;
      try {
        const t0 = Date.now();
        await ocr(page, file, 'idcard');
        const ms = Date.now() - t0;
        const got = { name: await val(page, 'name'), idNo: await val(page, 'idNo'), gender: await val(page, 'gender'), ethnic: await val(page, 'ethnic'), birth: await val(page, 'birth'), address: await val(page, 'address') };
        assert(got.idNo === ID, '号码：' + JSON.stringify(got));
        assert(got.name === '张示例' && got.gender === '男' && got.birth === '1985-03-06', '姓名/性别/出生：' + JSON.stringify(got));
        assert(got.address.includes('湖南省郴州市桂阳县') && got.address.includes('12号'), '住址：' + got.address);
        assert((await page.textContent('#person-checks')).includes('校验通过'), '应显示号码校验通过');
        assert((await page.textContent('.modal')).includes('可能有错字'), '应提示必须人工核对');
        await page.click('form[data-form=person] [type=submit]');
        assert((await page.textContent('#person-msg')).includes('核对'), '未勾选"已核对"不能保存');
        await page.check('form[data-form=person] [name=confirmed]');
        await page.click('form[data-form=person] [type=submit]');
        await page.waitForSelector('form[data-form=person]', { state: 'detached' });
        const sec = await page.textContent('#sec-persons + .card');
        assert(sec.includes('张示例') && sec.includes(ID) && sec.includes('核对确认'), '人员信息区：' + sec);
        const c = JSON.parse(w.shared.get('case:' + JSON.parse(w.shared.get('case-index'))[0].id));
        assert(c.party === '张示例' && c.persons[0].source === 'ocr' && c.persons[0].confirmedByName, '应保存并填入当事人');
        assert(c.log.some(l => l.action === '确认人员信息' && l.detail.includes('身份证识别，人工核对')), '日志');
        await L.addSeized(page, { barcode: '075015', qty: 1 });
        const { zip } = await L.packageCase(page);
        assert(Z.unzip(zip).manifest.includes('人员信息（当事人）：张示例，身份证号码 ' + ID), '证据清单应列出人员信息');
        return '从选照片到出结果约 ' + ms + ' ms（含首次加载识别引擎）；合成证件照片，真实证件效果需现场验证';
      } finally { await p.close(); }
    }
  },
  {
    name: '驾驶证识别：带出证号、姓名、准驾车型、初次领证日期、有效期；横着拍（旋转 90°）也能自动转正识别',
    fn: async () => {
      const w = L.createWorld();
      const file = await S.cardPhoto('driver-rot', { kind: 'driver', rot: 90 });
      const p = await newCase(w, 'O-002'); const page = p.page;
      try {
        await ocr(page, file, 'driver', 'album');
        const got = { idNo: await val(page, 'idNo'), name: await val(page, 'name'), cls: await val(page, 'licenseClass'), first: await val(page, 'firstIssue'), from: await val(page, 'validFrom'), to: await val(page, 'validTo') };
        assert(got.idNo === ID && got.name === '张示例', '证号/姓名：' + JSON.stringify(got));
        assert(got.cls === 'C1' && got.first === '2010-05-20' && got.from === '2016-05-20' && got.to === '2026-05-20', '驾驶证字段：' + JSON.stringify(got));
        assert(await page.isChecked('form[data-form=person] input[name=role][value=驾驶人]'), '驾驶证默认身份为驾驶人');
        await page.check('form[data-form=person] [name=confirmed]');
        await page.click('form[data-form=person] [type=submit]');
        await page.waitForSelector('form[data-form=person]', { state: 'detached' });
        assert((await page.textContent('#sec-persons + .card')).includes('准驾 C1'), '列表显示准驾车型');
        return '';
      } finally { await p.close(); }
    }
  },
  {
    name: '笔录中"从人员信息填入"：询问笔录被询问人、现场笔录当事人/见证人一键带出已核对的信息',
    fn: async () => {
      const w = L.createWorld();
      const p = await newCase(w, 'O-003'); const page = p.page;
      try {
        await page.click('[data-action=person-add]');
        await page.fill('form[data-form=person] [name=name]', '李示例');
        await page.fill('form[data-form=person] [name=idNo]', ID);
        await page.fill('form[data-form=person] [name=address]', '示例县示例路 3 号');
        await page.fill('form[data-form=person] [name=phone]', '138xxxx0000');
        await page.check('form[data-form=person] input[name=role][value=证人]');
        await page.waitForSelector('#person-checks:has-text("校验通过")');
        await page.check('form[data-form=person] [name=confirmed]');
        await page.click('form[data-form=person] [type=submit]');
        await page.waitForSelector('form[data-form=person]', { state: 'detached' });
        await page.click('[data-action=rec-new][data-type=inquiry]');
        await page.waitForSelector('[data-action=rec-pick-person][data-prefix=subject]');
        await page.click('[data-action=rec-pick-person][data-prefix=subject]');
        assert(await page.inputValue('[data-rf="subject.name"]') === '李示例' && await page.inputValue('[data-rf="subject.idNo"]') === ID, '应填入被询问人');
        assert(await page.inputValue('[data-rf="subject.birth"]') === '1985-03-06' && await page.inputValue('[data-rf="subject.address"]') === '示例县示例路 3 号', '出生、住址也应带出');
        assert(await page.$('[data-action=rf-chip][data-rf="subject.role"][data-v=证人].active'), '身份应为证人');
        await page.click('[data-action=back]');
        await page.waitForSelector('.tiles');
        await page.click('[data-action=rec-new][data-type=scene]');
        await page.click('[data-action=rec-pick-person][data-prefix=witness]');
        assert(await page.inputValue('[data-rf="witness.name"]') === '李示例', '应填入见证人');
        return '';
      } finally { await p.close(); }
    }
  },
  {
    name: '手工添加时号码校验不通过需再次确认；浏览器不支持离线识别时提示并改为手工填写',
    fn: async () => {
      const w = L.createWorld();
      const p = await L.openPage(w, { initScript: () => { WebAssembly.validate = () => false; } }); const page = p.page;
      try {
        await L.setupAdmin(page); await L.createCase(page, 'O-004');
        const file = await S.cardPhoto('idcard-2', { kind: 'idcard' });
        await ocr(page, file, 'idcard');
        assert((await L.toastText(page)).includes('不能离线识别'), '应提示不支持');
        assert(await val(page, 'name') === '', '改为手工填写');
        await page.fill('form[data-form=person] [name=name]', '王示例');
        await page.fill('form[data-form=person] [name=idNo]', '430000198503061233');
        await page.waitForSelector('#person-checks:has-text("校验不通过")');
        await page.check('form[data-form=person] [name=confirmed]');
        await page.click('form[data-form=person] [type=submit]');
        await page.waitForSelector('.modal:has-text("号码校验不通过")');
        await L.confirmModal(page, true);
        await page.waitForSelector('#sec-persons + .card:has-text("王示例")');
        return '';
      } finally { await p.close(); }
    }
  }
];
