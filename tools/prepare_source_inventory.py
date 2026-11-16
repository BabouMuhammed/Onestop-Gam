"""Prepare a lossless, unapproved source-row import. No database access or source writes."""
import argparse
import hashlib
import json
import re
from decimal import Decimal
from pathlib import Path

import openpyxl


def prepare(review_directory: Path, source_directory: Path, output: Path):
    preview = json.loads((review_directory / 'preview.json').read_text(encoding='utf8'))
    assert preview['previewOnly'] and not preview['approvedForImport']
    output.mkdir(parents=True, exist_ok=True)
    summaries = []
    for book in preview['books']:
        path = source_directory / book['file']
        sha = hashlib.sha256(path.read_bytes()).hexdigest()
        if sha != book['sha256']:
            raise ValueError('Source workbook differs from the reviewed original')
        workbook = openpyxl.load_workbook(path, data_only=True)
        rows = [r for r in preview['rows'] if r['division'] == book['division']]
        items = []
        for row in rows:
            sheet = workbook[row['sheet']]
            name = sheet[row['nameCell']].value
            quantity = sheet[row['quantityCell']].value
            if name != row['sourceName'] or quantity != row['sourceQuantity']:
                raise ValueError('Source cells differ from the reviewed analysis')
            # Parse only the count, never multiply by packaging or product dimensions.
            text = str(quantity)
            match = re.fullmatch(r'\s*\(?\s*(\d+(?:\.\d+)?)(?:\s+(\d+)/(\d+))?\s*\(?\s*(?:[A-Za-z].*|\)\s*)?', text)
            parsed = Decimal(match.group(1)) + (Decimal(match.group(2))/Decimal(match.group(3)) if match and match.group(2) else Decimal(0)) if match else None
            if parsed != Decimal(row['quantity']):
                raise ValueError(f'Unreconciled numeric count: {book["division"]}/{row["sheet"]}/{row["quantityCell"]}')
            unit_text = re.search(r'[A-Za-z].*', text)
            flags = row['issues']
            unit = row['unit'] or 'UNSPECIFIED'
            review = unit == 'UNSPECIFIED' or any(flag not in {'LEGACY_NAME_CHANGED', 'PRICE_CANDIDATE_UNAPPROVED', 'SOURCE_NOTE'} for flag in flags)
            items.append({
                'name': name, 'location': row['sheet'], 'locationType': 'OTHER',
                'quantity': row['quantity'], 'unit': unit, 'sellingPrice': None,
                'packSize': None, 'tracksExpiry': False, 'requiresStockReview': review,
                'remark': 'Original source count; not a reconciled current balance. ' + ('Business confirmation required. ' if review else '') + '; '.join(flags),
                'raw': {'sheet': row['sheet'], 'cell': row['nameCell'], 'quantityCell': row['quantityCell'],
                        'description': name, 'quantityText': text, 'unitText': unit_text.group(0) if unit_text else None, 'issues': flags, 'notes': row['notes']},
            })
        workbook.close()
        expected = 139 if book['division'] == 'QUALITY_FOODS' else 282
        assert len(items) == expected and len({(i['raw']['sheet'], i['raw']['cell']) for i in items}) == expected
        data = {'division': book['division'], 'countedOn': book['countedOn'], 'source': book['file'],
                'sourceSha256': sha, 'preserveSourceRows': True, 'items': items}
        filename = 'quality-foods.json' if book['division'] == 'QUALITY_FOODS' else 'legayebi.json'
        (output / filename).write_text(json.dumps(data, ensure_ascii=False, indent=2)+'\n', encoding='utf8')
        summaries.append({'division': book['division'], 'products': len(items), 'stockLines': len(items),
                          'locations': len({i['location'] for i in items}), 'unspecifiedUnits': sum(i['unit'] == 'UNSPECIFIED' for i in items),
                          'reviewRequired': sum(i['requiresStockReview'] for i in items), 'file': filename})
    assert sum(s['stockLines'] for s in summaries) == 421 and sum(s['locations'] for s in summaries) == 14
    (output / 'source-summary.txt').write_text(json.dumps(summaries, indent=2)+'\n', encoding='utf8')
    print(json.dumps({'approval': 'PENDING', 'databaseAccessed': False, 'divisions': summaries}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--review', type=Path, required=True)
    parser.add_argument('--sources', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True)
    arguments = parser.parse_args()
    prepare(arguments.review, arguments.sources, arguments.out)
