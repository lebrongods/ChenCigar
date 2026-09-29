// 解压并读取证据包
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
function unzip(zipPath) {
  const dir = zipPath.replace(/\.zip$/, '');
  fs.mkdirSync(dir, { recursive: true });
  // 用 Python zipfile 解压，避免 unzip 受系统语言环境影响把中文文件名转义
  execFileSync('python3', ['-c', 'import sys,zipfile; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])', zipPath, dir]);
  const files = fs.readdirSync(dir).sort();
  const manifest = fs.readFileSync(path.join(dir, '证据清单说明.txt'), 'utf8');
  return { dir, files, manifest };
}
function sha256sum(dir, name) {
  return execFileSync('sha256sum', [name], { cwd: dir }).toString().split(/\s+/)[0];
}
function sha256check(dir) {
  return execFileSync('sha256sum', ['-c', 'SHA256SUMS.txt'], { cwd: dir }).toString();
}
module.exports = { unzip, sha256sum, sha256check };
