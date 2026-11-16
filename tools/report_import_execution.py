"""Render a private business attention register from read-only database verification."""
import argparse
import csv
import json
from pathlib import Path

import openpyxl
from openpyxl.styles import Alignment, Font, PatternFill


def render(execution: Path):
    report = json.loads((execution/'database-verification.json').read_text(encoding='utf8'))
    assert report['verification'] == 'PASSED' and report['totalSourceRows'] == 421
    wb = openpyxl.Workbook()
    summary = wb.active
    summary.title = 'Attention summary'
    summary.append(['Business','Products','Locations','Unconfirmed units','Source review','Selling prices needed','Historical count date'])
    records = report['attention']
    for business in report['reconciliation']:
        summary.append([business['business'],business['products'],business['locations'],business['unspecifiedUnits'],business['reviewRequired'],business['products'],business['countDate']])
        ws = wb.create_sheet(business['business'])
        ws.append(['SKU','Original description','Location','Imported quantity','Supported unit','Unit confirmation needed','Source review needed','Price needed','Historical reconciliation needed','Source file','Worksheet','Name cell','Quantity cell','Original quantity expression','Original unit expression','Source issues','Original notes','Business decision / evidence','Reviewer','Review date'])
        for row in records:
            if row['division'] != business['division']:
                continue
            ws.append([row['sku'],row['name'],row['location'],row['quantity'],row['unit'],row['needsUnitConfirmation'],row['requiresStockReview'],True,True,row['sourceFile'],row['sourceSheet'],row['nameCell'],row['quantityCell'],row['originalQuantity'],row['originalUnit'],'; '.join(row['issues']),json.dumps(row.get('notes',[]),ensure_ascii=False),'','',''])
    summary.append([])
    summary.append(['Source records are preserved','Do not merge similar names, multiply packs, infer prices or relabel historical counts as current counts.'])
    summary.append(['383 unconfirmed units','382 absent stocking units and CAP NAIL with unconfirmed Pac expression.'])
    summary.append(['392 flagged source records','Unit/packaging/description/variant/alias/ownership review. This overlaps the unconfirmed-unit group.'])
    summary.append(['All 421 products','Selling prices remain blank and original counts need reconciliation to an agreed current cutoff.'])
    summary.append(['Historical opening counts','Quality Foods 10 November 2026; LEGAYEBI 11 November 2026.'])
    summary.append(['Quantity conversions','None performed. Keep galvanized/non-galvanized, size, brand, colour and material distinctions.'])
    for ws in wb:
        ws.freeze_panes='A2'
        ws.auto_filter.ref=ws.dimensions
        for cell in ws[1]:
            cell.font=Font(bold=True,color='FFFFFF')
            cell.fill=PatternFill('solid',fgColor='233B48')
        for col in ws.columns:
            ws.column_dimensions[col[0].column_letter].width=min(65,max(18,max(len(str(c.value or '')) for c in col[:50])+2))
        for row in ws:
            for cell in row:
                cell.alignment=Alignment(vertical='top',wrap_text=True)
    wb.save(execution/'INVENTORY_ATTENTION.xlsx')
    with (execution/'INVENTORY_ATTENTION.csv').open('w',encoding='utf-8-sig',newline='') as stream:
        writer=csv.DictWriter(stream,fieldnames=list(records[0]))
        writer.writeheader()
        for row in records:
            writer.writerow({k:json.dumps(v,ensure_ascii=False) if isinstance(v,(list,dict)) else v for k,v in row.items()})
    print(json.dumps({'rows':len(records),'unitConfirmation':sum(r['needsUnitConfirmation'] for r in records),'sourceReview':sum(r['requiresStockReview'] for r in records),'pricesNeeded':421,'originalStockModified':False}))


if __name__ == '__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('execution',type=Path)
    render(parser.parse_args().execution)
