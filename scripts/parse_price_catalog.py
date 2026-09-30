"""把省局《卷烟品牌价格目录》PDF 转成系统内置价格目录 data/price-catalog.json

用法：python3 scripts/parse_price_catalog.py <价格目录.pdf> [版本名称]
依赖：pip install pdfplumber
每半年目录更新后重新运行本脚本，再 npm run build 即可。
"""
import json
import re
import sys

import pdfplumber

SECTIONS = [
    (r'国产卷烟品牌价格目录', '国产卷烟'),
    (r'国产雪茄烟品牌价格目录', '国产雪茄烟'),
    (r'进口卷烟品牌价格目录', '进口卷烟'),
    (r'进口雪茄烟品牌价格目录', '进口雪茄烟'),
]


def num(s):
    s = (s or '').replace(',', '').strip()
    try:
        v = float(s)
        return int(v) if v == int(v) else v
    except ValueError:
        return None


def main(pdf_path, version=None):
    items = {}
    title = None
    issued = None
    cat = None
    exit_mode = False
    with pdfplumber.open(pdf_path) as pdf:
        for page in pdf.pages:
            text = page.extract_text() or ''
            m = re.search(r'(\d{4}\s*年[上下]半年)湖南省', text.replace(' ', ''))
            if m and not version:
                version = m.group(1)
            for pat, name in SECTIONS:
                if re.search(pat, text.replace(' ', '')):
                    if not re.search(r'退出' + '.*' + pat, text.replace(' ', '')):
                        cat = name
                        exit_mode = False
            if re.search(r'附件\s*5|退出.*价格目录', text.replace(' ', '')) and '退出' in text.split('\n')[0] + text.split('\n')[1]:
                exit_mode = True
            m = re.search(r'(湖南省烟草专卖局办公室)\s*(\d{4}\s*年\s*\d+\s*月\s*\d+\s*日)\s*印发', text)
            if m:
                issued = m.group(1) + ' ' + re.sub(r'\s+', '', m.group(2)) + '印发'
            for table in page.extract_tables():
                header = None
                last_no = 0
                for row in table:
                    row = [(c or '').replace('\n', '').strip() for c in row]
                    if row and row[0] == '序号':
                        header = row
                        continue
                    if not header or not row or not row[0].isdigit():
                        continue
                    no = int(row[0])
                    if no < last_no:  # 序号重新从 1 开始：同页后半部分是"退出"品规
                        exit_mode = True
                    last_no = no
                    rec = dict(zip(header, row))
                    code = rec.get('条包条形码', '')
                    if not re.fullmatch(r'\d{8,14}', code):
                        print('跳过：条码格式不符', row, file=sys.stderr)
                        continue
                    unit = rec.get('单位', '')
                    item = {
                        'code': code,
                        'name': rec.get('规格名称', ''),
                        'maker': rec.get('工业公司名称', ''),
                        'cat': cat,
                        'cls': rec.get('价类') or rec.get('类别') or '',
                        'retail': num(rec.get('建议零售价')),
                        'unit': '支' if '支' in unit else '条',
                    }
                    if exit_mode:
                        item['exit'] = True
                    if item['retail'] is None:
                        print('跳过：无建议零售价', row, file=sys.stderr)
                        continue
                    prev = items.get(code)
                    if prev and not exit_mode:
                        print('重复条码（保留先出现者）：', code, prev['name'], '/', item['name'], file=sys.stderr)
                        continue
                    if prev and exit_mode:
                        prev['exit'] = True
                        continue
                    items[code] = item
    out = {
        'title': (version or '') + '湖南省卷烟、雪茄烟品牌价格目录',
        'version': version or '',
        'issued': issued or '',
        'items': list(items.values()),
    }
    with open('data/price-catalog.json', 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, separators=(',', ':'))
    by = {}
    for it in out['items']:
        key = it['cat'] + ('（退出目录）' if it.get('exit') else '')
        by[key] = by.get(key, 0) + 1
    print('版本：', out['version'], '｜', out['issued'])
    print('共', len(out['items']), '个品规：', by)


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else None)
