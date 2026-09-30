// 解压并读取证据包（跨平台：解压用 JSZip，摘要优先用系统 sha256sum，没有时用 Node 内置 crypto）
const { execFileSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

let hasSha256sum = null;
function systemSha256sum() {
  if (hasSha256sum === null) {
    try { execFileSync('sha256sum', ['--version'], { stdio: 'ignore' }); hasSha256sum = true; } catch (e) { hasSha256sum = false; }
  }
  return hasSha256sum;
}

// JSZip 只有异步接口，这里用子进程同步执行，保持调用方写法简单
function unzip(zipPath) {
  const dir = zipPath.replace(/\.zip$/, '');
  fs.mkdirSync(dir, { recursive: true });
  const script = `
    const JSZip = require(${JSON.stringify(require.resolve('jszip'))});
    const fs = require('fs'), path = require('path');
    const [zipPath, dir] = process.argv.slice(1);
    JSZip.loadAsync(fs.readFileSync(zipPath)).then(async zip => {
      for (const name of Object.keys(zip.files)) {
        const f = zip.files[name];
        if (f.dir) continue;
        fs.writeFileSync(path.join(dir, name), await f.async('nodebuffer'));
      }
    }).catch(e => { console.error(e); process.exit(1); });`;
  execFileSync(process.execPath, ['-e', script, zipPath, dir]);
  const files = fs.readdirSync(dir).sort();
  const manifest = fs.readFileSync(path.join(dir, '证据清单说明.txt'), 'utf8');
  return { dir, files, manifest };
}

function sha256sum(dir, name) {
  if (systemSha256sum()) return execFileSync('sha256sum', [name], { cwd: dir }).toString().split(/\s+/)[0];
  return crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, name))).digest('hex');
}

// 等价于 sha256sum -c SHA256SUMS.txt，输出格式相同（"文件名: OK"）
function sha256check(dir) {
  if (systemSha256sum()) return execFileSync('sha256sum', ['-c', 'SHA256SUMS.txt'], { cwd: dir }).toString();
  const lines = fs.readFileSync(path.join(dir, 'SHA256SUMS.txt'), 'utf8').split('\n').filter(Boolean);
  const out = lines.map(l => {
    const m = l.match(/^([0-9a-f]{64}) {2}(.+)$/);
    if (!m) throw new Error('SHA256SUMS.txt 格式错误：' + l);
    return m[2] + ': ' + (sha256sum(dir, m[2]) === m[1] ? 'OK' : 'FAILED');
  });
  if (out.some(l => l.endsWith('FAILED'))) throw new Error('摘要核对失败：\n' + out.join('\n'));
  return out.join('\n') + '\n';
}

module.exports = { unzip, sha256sum, sha256check };
