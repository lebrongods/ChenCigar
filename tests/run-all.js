// 运行全部自动化测试，结果写入 tests/测试结果.md
const fs = require('fs');
const path = require('path');
const L = require('./lib');

const suites = ['core', 'accounts', 'seized', 'p0', 'p1'].map(n => ({ name: n, tests: require('./' + n + '.test.js') }));
const only = process.argv[2];

(async () => {
  await L.makeImages();
  const results = [];
  const notes = [];
  const ctx = { note: s => notes.push(s) };
  for (const s of suites) {
    for (const t of s.tests) {
      if (only && !t.name.includes(only) && s.name !== only) continue;
      const t0 = Date.now();
      let ok = true, msg = '';
      try { msg = (await t.fn(ctx)) || ''; } catch (e) { ok = false; msg = (e && e.message || String(e)).split('\n')[0]; if (process.env.DEBUG) console.error(e); }
      const ms = Date.now() - t0;
      results.push({ suite: s.name, name: t.name, ok, msg, ms });
      console.log((ok ? '✔' : '✘') + ' [' + s.name + '] ' + t.name + ' (' + ms + 'ms)' + (msg ? ' — ' + msg : ''));
    }
  }
  await L.closeBrowser();
  const pass = results.filter(r => r.ok).length;
  const esc = s => String(s).replace(/\|/g, '\\|');
  const pkg = require('../package.json');
  const md = [
    '# 自动化测试结果',
    '',
    '- 运行时间：' + new Date().toLocaleString('zh-CN', { hour12: false }),
    '- 被测文件：`证据采集系统.html`（v' + pkg.version + '）',
    '- 环境：Playwright ' + require('playwright/package.json').version + ' + Chromium（无头），手机视口 390×844；`window.storage` 用测试桩模拟（shared/personal 分区）',
    '- 运行方式：`npm test`（先构建再测试）',
    '- 结果：**' + pass + ' / ' + results.length + ' 通过**',
    '',
    '| # | 分组 | 用例 | 结果 | 备注 |',
    '|---|---|---|---|---|',
    ...results.map((r, i) => '| ' + (i + 1) + ' | ' + r.suite + ' | ' + esc(r.name) + ' | ' + (r.ok ? '通过' : '**失败**') + ' | ' + esc(r.msg) + ' |'),
    '',
    notes.length ? '## 实测记录\n\n' + notes.join('\n\n') + '\n' : '',
    '## 说明',
    '',
    '- 以上结果均为本次真实运行输出，由 `tests/run-all.js` 自动生成。',
    '- 测试环境的 Chromium 不支持 `BarcodeDetector`，"扫码成功"场景用测试桩模拟检测结果，只验证系统对识别结果的处理；真机识别率未测。',
    '- 拍照质量检测使用程序生成的测试图，阈值需在真实现场照片上继续校准（见"实测记录"）。',
    ''
  ].join('\n');
  if (!only) fs.writeFileSync(path.join(__dirname, '测试结果.md'), md);
  console.log('\n' + pass + '/' + results.length + ' 通过');
  process.exit(pass === results.length ? 0 : 1);
})().catch(async e => { console.error(e); await L.closeBrowser(); process.exit(2); });
