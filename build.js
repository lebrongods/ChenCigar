// 构建：把 JSZip、条码识别库（vendor/zxing-lite.min.js）、证件文字识别（Tesseract.js + 简体中文模型）和价格目录
// （data/price-catalog.json）内联进单文件 HTML，输出 证据采集系统.html
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
// 证件 OCR：放在 type="text/plain" 的块里，打开页面时不执行，用到时才加载
const nm = p => fs.readFileSync(require.resolve(p));
const ocrLib = nm('tesseract.js/dist/tesseract.min.js').toString('utf8');
let ocrWorker = nm('tesseract.js/dist/worker.min.js').toString('utf8');
// tesseract.js 5.1.1 的缺陷：直接传入语言数据时，初始化用了 data 而不是 code 作为语言名。这里修正为 code
const bug = 'return"string"==typeof t?t:t.data})).join("+")';
if (ocrWorker.split(bug).length !== 2) throw new Error('tesseract.js worker 补丁位置未找到，请检查版本');
ocrWorker = ocrWorker.replace(bug, 'return"string"==typeof t?t:t.code})).join("+")');
// 识别核心（含 wasm，需浏览器支持 WebAssembly SIMD）与 worker 合成一个脚本，避免 worker 内再加载外部文件
const ocrCore = nm('tesseract.js-core/tesseract-core-simd-lstm.wasm.js').toString('utf8');
const ocrLang = nm('@tesseract.js-data/chi_sim/4.0.0_best_int/chi_sim.traineddata.gz').toString('base64');
const noClose = t => t.replace(/<\/script/gi, '<\\/script');
const ocrMarkers = { '/*__OCR_LIB__*/': noClose(ocrLib), '/*__OCR_WORKER__*/': noClose(ocrCore + '\n;\n' + ocrWorker), '/*__OCR_LANG__*/': ocrLang };
let out = src.replace(marker, () => jszip).replace(zxingMarker, () => zxing).replace(catalogMarker, () => catalog);
for (const [m, v] of Object.entries(ocrMarkers)) { if (!out.includes(m)) throw new Error('找不到占位符 ' + m); out = out.replace(m, () => v); }
const target = path.join(__dirname, '证据采集系统.html');
fs.writeFileSync(target, out);
console.log('已生成', path.basename(target), (Buffer.byteLength(out) / 1024).toFixed(1) + ' KB');
