// 读取 xlsx（测试用）
const JSZip = require('jszip');

// 读取 xlsx 第一个工作表：返回 {cells: {A1: 值}, formulas: {E5: 'C5*D5'}, merges: [...], workbook}
async function readXlsx(buf) {
  const zip = await JSZip.loadAsync(buf);
  const xml = await zip.file('xl/worksheets/sheet1.xml').async('string');
  const workbook = await zip.file('xl/workbook.xml').async('string');
  const cells = {}, formulas = {};
  const unesc = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
  for (const m of xml.matchAll(/<c r="([A-Z]+\d+)"[^>]*?(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    const body = m[2] || '';
    const t = body.match(/<t[^>]*>([\s\S]*?)<\/t>/);
    const v = body.match(/<v>([\s\S]*?)<\/v>/);
    const f = body.match(/<f>([\s\S]*?)<\/f>/);
    if (t) cells[m[1]] = unesc(t[1]); else if (v) cells[m[1]] = Number(v[1]);
    if (f) formulas[m[1]] = f[1];
  }
  const merges = [...xml.matchAll(/<mergeCell ref="([^"]+)"/g)].map(m => m[1]);
  return { cells, formulas, merges, workbook };
}
module.exports = { readXlsx };
