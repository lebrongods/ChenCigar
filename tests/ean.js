// 测试辅助：生成 EAN-13 条码的模块序列（1 = 黑条，0 = 空），用于在画布上绘制合成条码
const L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
const G = ['0100111', '0110011', '0011011', '0100001', '0011101', '0111001', '0000101', '0010001', '0001001', '0010111'];
const R = ['1110010', '1100110', '1101100', '1000010', '1011100', '1001110', '1010000', '1000100', '1001000', '1110100'];
const PARITY = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];
function checkDigit(d12) {
  let s = 0;
  for (let i = 0; i < 12; i++) s += Number(d12[i]) * (i % 2 ? 3 : 1);
  return String((10 - (s % 10)) % 10);
}
function ean13Modules(code) {
  if (code.length === 12) code += checkDigit(code);
  if (!/^\d{13}$/.test(code) || checkDigit(code.slice(0, 12)) !== code[12]) throw new Error('bad EAN-13: ' + code);
  const p = PARITY[Number(code[0])];
  let bits = '101';
  for (let i = 1; i <= 6; i++) bits += (p[i - 1] === 'L' ? L : G)[Number(code[i])];
  bits += '01010';
  for (let i = 7; i <= 12; i++) bits += R[Number(code[i])];
  bits += '101';
  return bits;
}
module.exports = { ean13Modules, checkDigit };
