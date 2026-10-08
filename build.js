// 构建：把 JSZip、条码识别库（vendor/zxing-lite.min.js）和价格目录（data/price-catalog.json）内联进单文件 HTML，输出 证据采集系统.html
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, 'src/app.html'), 'utf8');
const jszip = fs.readFileSync(require.resolve('jszip/dist/jszip.min.js'), 'utf8').replace(/<\/script/gi, '<\\/script');
const marker = '/*__JSZIP_INLINE__*/';
if (!src.includes(marker)) throw new Error('找不到 JSZip 内联占位符');
const zxing = fs.readFileSync(path.join(__dirname, 'vendor/zxing-lite.min.js'), 'utf8').replace(/<\/script/gi, '<\\/script');
const zxingMarker = '/*__ZXING_INLINE__*/';
if (!src.includes(zxingMarker)) throw new Error('找不到条码识别库内联占位符');
const catalogMarker = '/*__PRICE_CATALOG__*/null';
if (!src.includes(catalogMarker)) throw new Error('找不到价格目录占位符');
const catalog = fs.readFileSync(path.join(__dirname, 'data/price-catalog.json'), 'utf8').trim().replace(/<\/script/gi, '<\\/script');
JSON.parse(catalog);
const out = src.replace(marker, () => jszip).replace(zxingMarker, () => zxing).replace(catalogMarker, () => catalog);
const target = path.join(__dirname, '证据采集系统.html');
fs.writeFileSync(target, out);
console.log('已生成', path.basename(target), (Buffer.byteLength(out) / 1024).toFixed(1) + ' KB');
