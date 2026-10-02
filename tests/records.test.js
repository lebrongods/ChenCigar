// 现场笔录 / 询问笔录
const fs = require('fs');
const path = require('path');
const JSZip = require('jszip');
const L = require('./lib');
const Z = require('./zip');
const { assert } = L;

// 生成一个校验位正确的 18 位身份证号（测试用，非真实号码）
function idWithCheck(b17) {
  const w = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
  let s = 0; for (let i = 0; i < 17; i++) s += Number(b17[i]) * w[i];
  return b17 + '10X98765432'[s % 11];
}
async function newRecord(page, type) {
  await page.click('[data-action=rec-new][data-type=' + type + ']');
  await page.waitForSelector('.rec-editor');
  await page.waitForFunction(() => window.__EVIDENCE_APP__.idle);
}
function qaList(page) {
  return page.$$eval('.qa-card', cs => cs.map(c => ({
    q: c.querySelector('.qa-qtext') ? c.querySelector('.qa-qtext').textContent : c.querySelector('textarea[data-qf=q]').value,
    a: c.querySelector('textarea[data-qf=a]').value
  })));
}
async function waitSaved(page) {
  await page.waitForFunction(() => window.__EVIDENCE_APP__.idle && /已自动保存/.test(document.getElementById('save-ind').textContent));
}
async function genDocx(page) {
  const dl = page.waitForEvent('download', { timeout: 15000 });
  await page.click('.actionbar [data-action=rec-docx]');
  const confirm = await page.waitForSelector('.modal [data-action=modal-ok]', { timeout: 1500 }).then(() => true).catch(() => false);
  if (confirm) await page.click('.modal [data-action=modal-ok]');
  const d = await dl;
  const file = path.join(L.TMP, 'rec-' + Date.now() + '-' + Math.random().toString(36).slice(2) + '.docx');
  await d.saveAs(file);
  return { name: d.suggestedFilename(), buf: fs.readFileSync(file) };
}
// 读取 docx 的段落文字与页脚
async function docxText(buf) {
  const zip = await JSZip.loadAsync(buf);
  for (const part of ['[Content_Types].xml', 'word/document.xml', 'word/styles.xml', 'word/settings.xml', 'word/footer1.xml', 'word/_rels/document.xml.rels']) assert(zip.file(part), 'docx 缺少 ' + part);
  const unesc = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
  const paras = xml => [...xml.matchAll(/<w:p>([\s\S]*?)<\/w:p>/g)].map(m => [...m[1].matchAll(/<w:t[^>]*>([^<]*)<\/w:t>|<w:br\/>/g)].map(t => t[1] == null ? '\n' : unesc(t[1])).join(''));
  const doc = await zip.file('word/document.xml').async('string');
  const footer = await zip.file('word/footer1.xml').async('string');
  return { paras: paras(doc), footerText: paras(footer).join('|'), footer, doc };
}
async function caseWithItems(page, number, type, extra) {
  await L.createCase(page, number, type || '无证运输', Object.assign({ address: '桂阳县某某路口', party: '张某' }, extra || {}));
  await L.addSeized(page, { barcode: '075015', qty: 20 });
}

module.exports = [
  {
    name: '询问笔录：按案件类型生成问题提纲，自动带入单位、执法人员、案由、日期、地点；点选执法人员后告知语随之更新',
    fn: async () => {
      const w = L.createWorld(); const p = await L.openPage(w); const page = p.page;
      try {
        await L.setupAdmin(page);
        await L.addUser(page, '稽查员A', 'inspector', '1111');
        await page.click('.tabbar [data-view=cases]');
        await caseWithItems(page, 'REC-001');
        await newRecord(page, 'inquiry');
        let qa = await qaList(page);
        assert(qa.length === 16, '无证运输应生成 1+2+11+2=16 个问题，实际 ' + qa.length);
        assert(qa[0].q.includes('桂阳县烟草专卖局的执法人员管理员甲') && qa[0].q.includes('现依法就涉嫌无烟草专卖品准运证运输烟草专卖品一案'), '告知语应带入单位、执法人员、案由：' + qa[0].q);
        assert(/^\d{4}年\d+月\d+日执法人员在桂阳县某某路口检查的车辆是谁的/.test(qa[3].q), '应带入日期和地点：' + qa[3].q);
        assert(qa.some(x => x.q.includes('烟草专卖品准运证')), '应含准运证问题');
        assert(await page.$('.rec-editor .warn-text:has-text("不少于 2 人")'), '只有 1 名执法人员时应提示');
        await page.click('[data-action=rec-officer]:has-text("稽查员A")');
        qa = await qaList(page);
        assert(qa[0].q.includes('执法人员管理员甲、稽查员A'), '点选执法人员后告知语应更新：' + qa[0].q.slice(0, 40));
        assert(!(await page.$('.rec-editor .warn-text:has-text("不少于 2 人")')), '2 人后不再提示');
        await page.click('[data-action=back]');
        await page.click('[data-action=back]');
        await L.createCase(page, 'REC-002', '无证经营');
        await newRecord(page, 'inquiry');
        const qa2 = await qaList(page);
        assert(qa2.some(x => x.q.includes('烟草专卖零售许可证')) && !qa2.some(x => x.q.includes('准运证')), '无证经营的提纲应与无证运输不同');
        return '无证运输 ' + qa.length + ' 问；无证经营 ' + qa2.length + ' 问';
      } finally { await p.close(); }
    }
  },
  {
    name: '询问笔录：身份证号自动识别性别和出生日期；常用回答、一键填入物品清单和本人信息；改、移、删、加问题；自动保存（刷新后仍在）',
    fn: async () => {
      const w = L.createWorld(); const p = await L.openPage(w); const page = p.page;
      try {
        await L.setupAdmin(page);
        await caseWithItems(page, 'REC-003');
        await newRecord(page, 'inquiry');
        await page.fill('[data-rf="subject.idNo"]', '431021198503061230');
        await page.waitForSelector('#idmsg-subject:has-text("校验不通过")');
        const id = idWithCheck('43102119850306123');
        await page.fill('[data-rf="subject.idNo"]', id);
        await page.waitForSelector('#idmsg-subject:has-text("校验通过")');
        assert(await page.inputValue('[data-rf="subject.birth"]') === '1985-03-06', '应识别出生日期');
        assert(await page.$('[data-rf="subject.gender"].active:has-text("男")'), '应识别性别为男');
        await page.fill('[data-rf="subject.phone"]', '13800000000');
        await page.fill('[data-rf="subject.address"]', '桂阳县某某村');
        const card = i => page.locator('.qa-card').nth(i);
        await card(0).locator('[data-action=qa-hint]').click();
        await card(1).locator('[data-action=qa-hint]').click();
        await card(2).locator('[data-action=qa-hint]').click();
        await card(6).locator('[data-action=qa-hint]').click();
        let qa = await qaList(page);
        assert(qa[0].a === '听清楚了' && qa[1].a === '不申请', '常用回答应填入');
        assert(qa[2].a.startsWith('我叫张某，男，1985年3月6日出生') && qa[2].a.includes('身份证号码' + id) && qa[2].a.includes('联系电话13800000000'), '本人信息：' + qa[2].a);
        assert(qa[6].a.includes('中华（硬）20条'), '物品清单：' + qa[6].a);
        await card(4).locator('textarea[data-qf=a]').fill('从郴州出发，准备开往桂阳县城。');
        await card(4).locator('[data-action=qa-edit]').click();
        await page.fill('.qa-card >> nth=4 >> textarea[data-qf=q]', '你这次从哪里出发？准备开往哪里？途经哪些地方？');
        await page.click('.qa-card >> nth=4 >> [data-action=qa-edit]');
        await page.click('.qa-card >> nth=4 >> [data-action=qa-up]');
        qa = await qaList(page);
        assert(qa[3].q.includes('途经哪些地方') && qa[3].a.startsWith('从郴州出发'), '修改并上移后应在第 4 位');
        const before = qa.length;
        await page.click('.qa-card >> nth=9 >> [data-action=qa-del]');
        await page.click('.qa-card >> nth=0 >> [data-action=qa-del]');
        await L.confirmModal(page, false);
        qa = await qaList(page);
        assert(qa.length === before - 1 && qa[0].a === '听清楚了', '未回答的直接删除；已回答的需确认，取消后保留');
        await page.click('[data-action=qa-add]');
        await page.waitForSelector('form[data-form=qaCustom]');
        assert((await page.$$('[data-action=qa-add-pick]')).length >= 1, '删除的提纲问题应可重新加入');
        await page.fill('form[data-form=qaCustom] [name=q]', '车上的卷烟有没有你自己吸用的？');
        await page.click('form[data-form=qaCustom] [type=submit]');
        await page.waitForSelector('.modal-mask', { state: 'detached' });
        qa = await qaList(page);
        const ci = qa.findIndex(x => x.q === '车上的卷烟有没有你自己吸用的？');
        assert(ci === qa.length - 3, '自定义问题应插在结尾通用问题之前：' + ci + '/' + qa.length);
        await waitSaved(page);
        await page.reload();
        await page.waitForSelector('#case-list .case-card');
        await page.click('#case-list .case-card');
        await page.waitForSelector('#records-card');
        await page.click('[data-action=rec-open]');
        await page.waitForSelector('.rec-editor');
        assert(JSON.stringify(await qaList(page)) === JSON.stringify(qa), '刷新后问答应保持一致');
        assert(await page.inputValue('[data-rf="subject.idNo"]') === id, '刷新后被询问人信息应保持');
        await page.click('[data-action=back]');
        const answered = qa.filter(x => x.a.trim()).length;
        await page.waitForSelector('#records-card:has-text("已答 ' + answered + '/' + qa.length + ' 问")');
        return '已答 ' + answered + '/' + qa.length + '，刷新后一致';
      } finally { await p.close(); }
    }
  },
  {
    name: '询问笔录生成 Word：标题与基本信息、问答顺序、未回答问题不写入、每页页脚签名栏和页码',
    fn: async () => {
      const w = L.createWorld(); const p = await L.openPage(w); const page = p.page;
      try {
        await L.setupAdmin(page);
        await L.addUser(page, '稽查员A', 'inspector', '1111', '43000002');
        await page.click('.tabbar [data-view=me]');
        await page.fill('form[data-form=myCert] [name=certNo]', '43000001');
        await page.click('form[data-form=myCert] [type=submit]');
        await page.waitForSelector('.toast:has-text("已保存执法证号")');
        await page.click('.tabbar [data-view=cases]');
        await caseWithItems(page, 'REC-004');
        await newRecord(page, 'inquiry');
        await page.click('[data-action=rec-officer]:has-text("稽查员A")');
        await page.fill('[data-rf="recorder"]', '稽查员A');
        await page.fill('[data-rf="subject.idNo"]', idWithCheck('43102119850306123'));
        await page.fill('[data-rf="subject.ethnic"]', '汉');
        await page.fill('[data-rf="subject.address"]', '桂阳县某某村');
        await page.fill('[data-rf="place"]', '桂阳县烟草专卖局询问室');
        const card = i => page.locator('.qa-card').nth(i);
        await card(0).locator('[data-action=qa-hint]').click();
        await card(1).locator('[data-action=qa-hint]').click();
        await card(5).locator('[data-action=qa-hint] >> nth=0').click();
        await card(6).locator('[data-action=qa-hint]').click();
        await card(9).locator('textarea[data-qf=a]').fill('没有。\n我不知道要办准运证。');
        await card(8).locator('textarea[data-qf=a]').fill('报酬<500>元 & "路费"另算');
        await page.click('[data-action=rec-now]');
        const qa = await qaList(page);
        const answered = qa.filter(x => x.a.trim());
        const { name, buf } = await genDocx(page);
        assert(name === 'REC-004_询问笔录_张某（草稿）.docx', '文件名：' + name);
        const d = await docxText(buf);
        assert(d.paras[0] === '询 问 笔 录' && d.paras[1] === '第 1 次询问', '标题：' + d.paras.slice(0, 2));
        assert(/^询问时间：\d{4}年\d+月\d+日\d+时\d{2}分至\d+时\d{2}分$/.test(d.paras[2]), '询问时间：' + d.paras[2]);
        assert(d.paras.includes('询问地点：桂阳县烟草专卖局询问室'), '询问地点');
        assert(d.paras.includes('询问人：管理员甲、稽查员A　执法证号：43000001、43000002'), '询问人与执法证号：' + d.paras.find(x => x.startsWith('询问人')));
        assert(d.paras.includes('记录人：稽查员A'), '记录人');
        assert(d.paras.some(x => x.startsWith('被询问人：张某　性别：男　出生日期：1985年3月6日（')), '被询问人行：' + d.paras.find(x => x.startsWith('被询问人：')));
        assert(d.paras.some(x => x.startsWith('民族：汉　身份证号码：431021198503061')), '民族、身份证号');
        const qaParas = d.paras.filter(x => /^[问答]：/.test(x));
        assert(qaParas.length === answered.length * 2, '只写入已回答的问题：' + qaParas.length + ' vs ' + answered.length * 2);
        answered.forEach((x, i) => {
          assert(qaParas[i * 2] === '问：' + x.q, '第 ' + (i + 1) + ' 问不符：' + qaParas[i * 2].slice(0, 30));
          assert(qaParas[i * 2 + 1] === '答：' + x.a, '第 ' + (i + 1) + ' 答不符：' + qaParas[i * 2 + 1]);
        });
        assert(qaParas.includes('答：没有。\n我不知道要办准运证。'), '多行回答应保留换行');
        assert(qaParas.includes('答：报酬<500>元 & "路费"另算'), '特殊字符应正确转义写入');
        assert(d.paras.some(x => x.startsWith('被询问人（签名并捺印）：')) && d.paras.some(x => x.startsWith('询问人（签名）：')), '结尾签名栏');
        assert(d.footerText.includes('被询问人签名：') && d.footer.includes('w:instr=" PAGE "') && d.footer.includes('w:instr=" NUMPAGES "'), '页脚应有签名栏与页码：' + d.footerText);
        return answered.length + ' 问写入 Word；页脚含签名栏与"第 X 页 共 Y 页"';
      } finally { await p.close(); }
    }
  },
  {
    name: '现场笔录：点选检查要素后自动生成现场情况草稿（执法人员与证号、车辆、存放位置、准运证、物品清单、照片数、先行登记保存）；当事人不在场时提示见证人；生成 Word',
    fn: async () => {
      const w = L.createWorld(); const p = await L.openPage(w); const page = p.page;
      try {
        await L.setupAdmin(page);
        await L.addUser(page, '稽查员A', 'inspector', '1111', 'A002');
        await page.click('.tabbar [data-view=me]');
        await page.fill('form[data-form=myCert] [name=certNo]', 'A001');
        await page.click('form[data-form=myCert] [type=submit]');
        await page.waitForSelector('.toast:has-text("已保存执法证号")');
        await page.click('.tabbar [data-view=cases]');
        await L.createCase(page, 'REC-005', '无证运输', { address: '桂阳县某某路口', party: '张某' });
        await L.captureItem(page, '车头照片', L.img('sharp'));
        await L.captureItem(page, '车尾车牌照片', L.img('sharp2'));
        await L.addSeized(page, { barcode: '075015', qty: 20 });
        await L.addSeized(page, { barcode: '118187', qty: 10 });
        await newRecord(page, 'scene');
        await page.click('[data-action=rec-officer]:has-text("稽查员A")');
        const chip = (rf, v) => page.click('[data-action=rf-chip][data-rf="' + rf + '"][data-v="' + v + '"]');
        await chip('facts.vehicleType', '货车');
        await page.fill('[data-rf="facts.plate"]', '湘L12345');
        await page.fill('[data-rf="facts.driver"]', '张某');
        await chip('facts.location', '后备箱');
        await chip('facts.location', '货厢');
        await chip('facts.permit', '未能出示烟草专卖品准运证');
        await chip('facts.docs', '无随车单据');
        await page.fill('[data-rf="measureDocNo"]', '测试第1号');
        await page.click('[data-action=scene-draft]');
        let body = await page.inputValue('[data-rf="body"]');
        [/^\d{4}年\d+月\d+日\d+时\d{2}分，桂阳县烟草专卖局执法人员管理员甲（执法证号：A001）、稽查员A（执法证号：A002）在桂阳县某某路口依法进行检查。执法人员向当事人张某出示了执法证件，表明身份，说明来意。/,
          /经检查，货车（车牌号：湘L12345）由张某驾驶，在该车后备箱、货厢内发现涉案物品。当事人未能出示烟草专卖品准运证。车上无相关随车单据。/,
          /经现场清点，查获卷烟2个品规（中华（硬）20条、利群（新版）10条），共计30条。/,
          /共拍摄照片2张。/,
          /执法人员依法对上述涉案物品予以先行登记保存，并制作《证据先行登记保存通知书》（编号：测试第1号）。/
        ].forEach(re => assert(re.test(body), '草稿缺少：' + re + '\n实际：' + body));
        await chip('party.present', '不在场');
        await page.waitForSelector('.badge:has-text("当事人不在场时应有见证人")');
        await page.fill('[data-rf="witness.name"]', '赵某');
        await page.click('[data-action=scene-draft]');
        await L.confirmModal(page, true);
        body = await page.inputValue('[data-rf="body"]');
        assert(body.includes('执法人员向现场有关人员出示了执法证件') && body.includes('检查时当事人不在场，执法人员邀请赵某作为见证人到场见证。'), '当事人不在场时的草稿：' + body);
        await page.fill('[data-rf="body"]', body + '\n现场另发现空烟箱若干。');
        await page.click('[data-action=rec-set-text][data-v="以上情况属实"]');
        await page.click('[data-action=rec-now]');
        const { name, buf } = await genDocx(page);
        assert(name === 'REC-005_现场笔录（草稿）.docx', '文件名：' + name);
        const d = await docxText(buf);
        assert(d.paras[0] === '现 场 笔 录', '标题');
        assert(d.paras.includes('执法人员：管理员甲（执法证号：A001）、稽查员A（执法证号：A002）'), '执法人员行');
        assert(d.paras.includes('当事人是否在场：不在场') && d.paras.some(x => x.startsWith('见证人：赵某')), '在场情况与见证人');
        const hi = d.paras.indexOf('现场情况：');
        assert(hi > 0 && d.paras[hi + 1] === body.split('\n')[0] && d.paras.includes('现场另发现空烟箱若干。'), '现场情况正文应逐段写入');
        assert(d.paras.includes('当事人意见：以上情况属实'), '当事人意见');
        assert(d.paras.some(x => x.startsWith('见证人（签名）：')), '见证人签名栏');
        assert(d.footerText.includes('当事人签名：'), '页脚签名栏');
        return '草稿 ' + body.split('\n').length + ' 段，Word 正确';
      } finally { await p.close(); }
    }
  },
  {
    name: '定稿后内容锁定、可解除并留痕；证据包包含笔录 Word（计入 SHA256SUMS 和清单，草稿文件名标注）',
    fn: async () => {
      const w = L.createWorld(); const p = await L.openPage(w); const page = p.page;
      try {
        await L.setupAdmin(page);
        await caseWithItems(page, 'REC-006');
        await L.captureAllRequired(page);
        await newRecord(page, 'inquiry');
        await page.locator('.qa-card').nth(0).locator('[data-action=qa-hint]').click();
        await page.click('[data-action=rec-final]');
        assert((await page.textContent('.modal')).includes('询问人不足 2 人'), '定稿前应列出未完善内容');
        await L.confirmModal(page, true);
        await page.waitForSelector('.rec-editor.locked');
        assert(await page.$eval('.qa-card textarea[data-qf=a]', e => e.disabled), '定稿后不可编辑');
        assert(!(await page.$('[data-action=qa-hint]')), '定稿后不显示编辑工具');
        await page.click('[data-action=rec-unfinal]');
        await L.confirmModal(page, true);
        await page.waitForSelector('.rec-editor:not(.locked)');
        assert(!(await page.$eval('.qa-card textarea[data-qf=a]', e => e.disabled)), '解除后可编辑');
        await page.click('[data-action=rec-final]');
        await L.confirmModal(page, true);
        await page.waitForSelector('.rec-editor.locked');
        await page.click('[data-action=back]');
        await newRecord(page, 'scene');
        await page.click('[data-action=scene-draft]');
        await page.click('[data-action=back]');
        await page.waitForSelector('#records-card .badge:has-text("已定稿")');
        const { zip } = await L.packageCase(page);
        const u = Z.unzip(zip);
        assert(u.files.includes('REC-006_询问笔录_张某.docx') && u.files.includes('REC-006_现场笔录（草稿）.docx'), '证据包应含两份笔录：' + u.files.filter(f => f.endsWith('.docx')));
        const check = Z.sha256check(u.dir);
        assert(check.includes('REC-006_询问笔录_张某.docx: OK') && check.includes('REC-006_现场笔录（草稿）.docx: OK'), '笔录应计入 SHA256SUMS');
        const m = u.manifest;
        assert(m.includes('三、笔录（2 份）') && /询问笔录（张某）　已定稿（/.test(m) && m.includes('现场笔录（张某）　草稿（未定稿）'), '清单应列出笔录及状态');
        assert(m.includes('管理员甲　新建询问笔录') && m.includes('管理员甲　定稿询问笔录') && m.includes('管理员甲　解除定稿询问笔录'), '操作日志应记录新建、定稿、解除定稿');
        assert((await page.textContent('#pack-result')).includes('有 1 份笔录尚未定稿'), '应提示未定稿笔录');
        return '证据包含 2 份笔录，SHA-256 核对通过';
      } finally { await p.close(); }
    }
  },
  {
    name: '笔录模板：管理员修改告知语和某类案件提纲后，新建询问笔录按新模板生成；可恢复默认',
    fn: async () => {
      const w = L.createWorld(); const p = await L.openPage(w); const page = p.page;
      try {
        await L.setupAdmin(page);
        await page.click('.tabbar [data-view=admin]');
        await page.click('[data-action=goto][data-view=recordTpl]');
        await page.fill('form[data-form=recordTpl] [name=notice]', '我们是{单位}执法人员{执法人员}，现就{案由}一案向你了解情况，听清楚了吗？｜听清楚了');
        await page.fill('form[data-form=recordTpl] [name=open]', '');
        await page.fill('form[data-form=recordTpl] [name="q_t-transport"]', '你叫什么名字？\n车上装的是什么？｜@物品清单');
        await page.click('form[data-form=recordTpl] [type=submit]');
        await page.waitForSelector('.toast:has-text("已保存笔录模板")');
        await page.click('[data-action=back]');
        await page.click('.tabbar [data-view=cases]');
        await caseWithItems(page, 'REC-007');
        await newRecord(page, 'inquiry');
        const qa = await qaList(page);
        assert(qa.length === 5, '告知语 1 + 通用 0 + 提纲 2 + 结尾 2 = 5，实际 ' + qa.length);
        assert(qa[0].q === '我们是桂阳县烟草专卖局执法人员管理员甲，现就涉嫌无烟草专卖品准运证运输烟草专卖品一案向你了解情况，听清楚了吗？', '告知语：' + qa[0].q);
        assert(qa[2].q === '车上装的是什么？' && await page.$('.qa-card >> nth=2 >> [data-action=qa-hint]:has-text("填入物品清单")'), '提纲与常用回答');
        await page.click('[data-action=back]');
        await page.click('[data-action=back]');
        await page.click('.tabbar [data-view=admin]');
        await page.click('[data-action=goto][data-view=recordTpl]');
        await page.click('[data-action=rectpl-reset]');
        await L.confirmModal(page, true);
        await page.waitForSelector('.toast:has-text("已恢复默认")');
        assert((await page.inputValue('form[data-form=recordTpl] [name=notice]')).startsWith('我们是{单位}的执法人员{执法人员}，这是我们的执法证件'), '应恢复默认告知语');
        assert((await page.inputValue('form[data-form=recordTpl] [name="q_t-transport"]')).split('\n').length === 11, '应恢复默认提纲');
        return '';
      } finally { await p.close(); }
    }
  },
  {
    name: '执法证号：管理员在用户管理中设置、本人在"我的"中设置，制作笔录时自动带入',
    fn: async () => {
      const w = L.createWorld(); const p = await L.openPage(w); const page = p.page;
      try {
        await L.setupAdmin(page);
        await L.addUser(page, '稽查员A', 'inspector', '1111', '43000002');
        await L.addUser(page, '稽查员B', 'inspector', '2222');
        await page.click('[data-action=goto][data-view=users]');
        assert((await page.textContent('.list-item:has-text("稽查员B")')).includes('未填'), '未填执法证号应提示');
        await page.click('.list-item:has-text("稽查员B") [data-action=user-cert]');
        await page.fill('form[data-form=prompt] [name=value]', '43000003');
        await page.click('form[data-form=prompt] [type=submit]');
        await page.waitForSelector('.list-item:has-text("稽查员B"):has-text("43000003")');
        await page.click('[data-action=back]');
        await page.click('.tabbar [data-view=me]');
        await page.fill('form[data-form=myCert] [name=certNo]', '43000001');
        await page.click('form[data-form=myCert] [type=submit]');
        await page.waitForSelector('.toast:has-text("已保存执法证号")');
        const users = JSON.parse(w.shared.get('users'));
        assert(users.map(u => u.certNo).join(',') === '43000001,43000002,43000003', '执法证号应保存：' + users.map(u => u.certNo));
        await page.click('.tabbar [data-view=cases]');
        await caseWithItems(page, 'REC-008');
        await newRecord(page, 'scene');
        await page.click('[data-action=rec-officer]:has-text("稽查员B")');
        assert(await page.inputValue('[data-rf="officers.0.certNo"]') === '43000001' && await page.inputValue('[data-rf="officers.1.certNo"]') === '43000003', '笔录应带入执法证号');
        return '';
      } finally { await p.close(); }
    }
  },
  {
    name: '备份导出与还原包含笔录；删除案件时笔录一并删除',
    fn: async () => {
      const w1 = L.createWorld(); const p1 = await L.openPage(w1); const page = p1.page;
      const w2 = L.createWorld(); let p2 = null;
      try {
        await L.setupAdmin(page, '管理员甲', '123456');
        await caseWithItems(page, 'REC-009');
        await newRecord(page, 'inquiry');
        await page.locator('.qa-card').nth(0).locator('[data-action=qa-hint]').click();
        await page.click('[data-action=back]');
        await newRecord(page, 'scene');
        await page.click('[data-action=scene-draft]');
        await page.click('[data-action=back]');
        const recKeys = [...w1.shared.keys()].filter(k => k.startsWith('rec:'));
        assert(recKeys.length === 2, '应有 2 份笔录数据');
        await page.click('[data-action=back]');
        await page.click('.tabbar [data-view=admin]');
        await page.click('[data-action=goto][data-view=backup]');
        const dl = page.waitForEvent('download');
        await page.click('[data-action=export]');
        await L.confirmModal(page, true);
        const file = path.join(L.TMP, 'backup-rec-' + Date.now() + '.json');
        await (await dl).saveAs(file);
        const data = JSON.parse(fs.readFileSync(file, 'utf8'));
        assert(Object.keys(data.records || {}).length === 2, '备份应包含 2 份笔录');
        p2 = await L.openPage(w2);
        await p2.page.waitForSelector('form[data-form=setup]');
        const [fc] = await Promise.all([p2.page.waitForEvent('filechooser'), p2.page.click('[data-action=import]')]);
        await fc.setFiles(file);
        assert((await p2.page.textContent('.modal')).includes('2 份笔录'), '还原确认应显示笔录数');
        await L.confirmModal(p2.page, true);
        await L.loginOk(p2.page, '管理员甲', '123456');
        recKeys.forEach(k => assert(w1.shared.get(k) === w2.shared.get(k), '还原后笔录内容应一致：' + k));
        await p2.page.click('#case-list .case-card');
        await p2.page.waitForSelector('#records-card .rec-item >> nth=1');
        await page.click('[data-action=back]');
        await page.click('.tabbar [data-view=cases]');
        await page.click('#case-list .case-card');
        await page.waitForSelector('#records-card');
        await page.click('[data-action=delete-case]');
        assert((await page.textContent('.modal')).includes('2 份笔录'), '删除确认应提示笔录');
        await L.confirmModal(page, true);
        await page.waitForSelector('#case-list');
        assert(![...w1.shared.keys()].some(k => k.startsWith('rec:')), '删除案件后笔录数据应一并删除');
        return '';
      } finally { await p1.close(); if (p2) await p2.close(); }
    }
  },
  {
    name: '笔录页面在 360/390/430 px 宽度下无横向滚动，按钮点击区 ≥44px',
    fn: async () => {
      const w = L.createWorld(); const p = await L.openPage(w, { viewport: { width: 360, height: 740 } }); const page = p.page;
      try {
        await L.setupAdmin(page, '管理员名字比较长的甲');
        await L.addUser(page, '稽查员名字也很长的乙', 'inspector', '1111', '430000000000000002');
        await page.click('.tabbar [data-view=cases]');
        await caseWithItems(page, 'X烟立〔2026〕第0000123456789号-超长案件编号测试', '制假窝点');
        const check = async label => {
          for (const width of [360, 390, 430]) {
            await page.setViewportSize({ width, height: 740 });
            const r = await page.evaluate(() => {
              const de = document.documentElement;
              const small = [...document.querySelectorAll('button, .btn, select, input[type=text], input[type=tel], input[type=date], input[type=datetime-local], input[type=number]')]
                .filter(b => b.offsetParent !== null)
                .map(b => ({ t: (b.textContent || b.dataset.rf || '').trim().slice(0, 10), h: b.getBoundingClientRect().height, w: b.getBoundingClientRect().width }))
                .filter(x => x.h < 43.5 || x.w < 43.5);
              return { over: de.scrollWidth - de.clientWidth, small };
            });
            assert(r.over <= 0, label + ' @' + width + 'px 出现横向滚动 ' + r.over + 'px');
            assert(!r.small.length, label + ' @' + width + 'px 有点击区 <44px：' + JSON.stringify(r.small));
          }
        };
        await check('案件页（含笔录区）');
        await newRecord(page, 'inquiry');
        await page.click('[data-action=rec-officer]:has-text("稽查员名字也很长的乙")');
        await page.click('.qa-card >> nth=1 >> [data-action=qa-edit]');
        await check('询问笔录编辑');
        await page.click('[data-action=rec-preview]');
        await page.waitForSelector('.doc-page');
        await check('笔录预览');
        await page.click('.modal [data-action=modal-close]');
        await page.click('[data-action=back]');
        await newRecord(page, 'scene');
        await page.click('[data-action=rf-chip][data-rf="facts.equipment"][data-v="其他"]');
        await page.click('[data-action=scene-draft]');
        await check('现场笔录编辑');
        await page.click('[data-action=back]');
        await page.click('[data-action=back]');
        await page.click('.tabbar [data-view=admin]');
        await page.click('[data-action=goto][data-view=recordTpl]');
        await check('笔录模板');
        return '5 个页面 × 3 种宽度通过';
      } finally { await p.close(); }
    }
  }
];
