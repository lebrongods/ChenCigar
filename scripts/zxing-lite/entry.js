// 构建 vendor/zxing-lite.min.js：只打包 ZXing 的 EAN-13/EAN-8/UPC-A/UPC-E 识别部分（约 60 KB），
// 供不支持 BarcodeDetector 的浏览器（iPhone、微信内置浏览器等）识别卷烟条码。运行：npm run build:zxing
import MultiFormatUPCEANReader from '@zxing/library/esm/core/oned/MultiFormatUPCEANReader';
import BinaryBitmap from '@zxing/library/esm/core/BinaryBitmap';
import HybridBinarizer from '@zxing/library/esm/core/common/HybridBinarizer';
import GlobalHistogramBinarizer from '@zxing/library/esm/core/common/GlobalHistogramBinarizer';
import RGBLuminanceSource from '@zxing/library/esm/core/RGBLuminanceSource';
import DecodeHintType from '@zxing/library/esm/core/DecodeHintType';
import BarcodeFormat from '@zxing/library/esm/core/BarcodeFormat';

const FMT = { [BarcodeFormat.EAN_13]: 'ean_13', [BarcodeFormat.EAN_8]: 'ean_8', [BarcodeFormat.UPC_A]: 'upc_a', [BarcodeFormat.UPC_E]: 'upc_e' };
function makeHints(tryHarder) {
  const h = new Map();
  h.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.UPC_A, BarcodeFormat.UPC_E]);
  if (tryHarder) h.set(DecodeHintType.TRY_HARDER, true);
  return h;
}
const HINTS = [makeHints(false), makeHints(true)];
// gray: Uint8ClampedArray 灰度（每像素 1 字节）
function decode(gray, w, h, tryHarder) {
  const hints = HINTS[tryHarder ? 1 : 0];
  const reader = new MultiFormatUPCEANReader(hints);
  const src = new RGBLuminanceSource(gray, w, h);
  for (const B of [GlobalHistogramBinarizer, HybridBinarizer]) {
    try {
      const r = reader.decode(new BinaryBitmap(new B(src)), hints);
      if (r) return { text: r.getText(), format: FMT[r.getBarcodeFormat()] || 'ean_13' };
    } catch (e) { /* 未找到 */ }
  }
  return null;
}
window.ZXingLite = { decode };
