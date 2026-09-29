// 构建：把 JSZip 内联进单文件 HTML，输出 证据采集系统.html
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, 'src/app.html'), 'utf8');
const jszip = fs.readFileSync(require.resolve('jszip/dist/jszip.min.js'), 'utf8').replace(/<\/script/gi, '<\\/script');
const marker = '/*__JSZIP_INLINE__*/';
if (!src.includes(marker)) throw new Error('找不到 JSZip 内联占位符');
const out = src.replace(marker, () => jszip);
const target = path.join(__dirname, '证据采集系统.html');
fs.writeFileSync(target, out);
console.log('已生成', path.basename(target), (Buffer.byteLength(out) / 1024).toFixed(1) + ' KB');
