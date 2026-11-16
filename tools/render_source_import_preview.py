"""Render an approval preview from rehearsed input files. Does not authorize or import."""
import argparse
import csv
import hashlib
import json
from pathlib import Path

import openpyxl
from openpyxl.styles import Alignment, Font, PatternFill


def render(directory: Path):
    rehearsal = json.loads((directory/'rehearsal-results.json').read_text(encoding='utf8'))
    assert rehearsal['reconciledRows'] == 421 and rehearsal['rollbackPassed'] and rehearsal['replayPassed']
    manifest = json.loads((directory/'approval-manifest.json').read_text(encoding='utf8'))
    assert manifest['authorization'] == 'PENDING'
    wb = openpyxl.Workbook()
    summary = wb.active
    summary.title = 'Approval summary'
    summary.append(['Business','Division','Products','Stock lines','Locations','Unspecified units','Review required','Approval fingerprint'])
    csv_rows = []
    for file, business in [('quality-foods.json','Quality Foods'),('legayebi.json','LEGAYEBI')]:
        data = json.loads((directory/file).read_text(encoding='utf8'))
        assert 'approval' not in data and data['preserveSourceRows']
        result = next(r for r in rehearsal['reconciliation'] if r['division'] == data['division'])
        fingerprint = next(p['fingerprint'] for p in manifest['plans'] if p['division'] == data['division'])
        summary.append([business,data['division'],result['products'],result['stockLines'],result['locations'],result['unspecifiedUnits'],result['reviewRequired'],fingerprint])
        ws = wb.create_sheet(business)
        headers = ['Business','Division','Source file','Source SHA256','Count date','Worksheet / location','Name cell','Quantity cell','Original description','Original quantity expression','Quantity (no conversion)','Recorded unit expression','Supported unit','Source-row review required','Selling price','Cost price','Pack conversion','Source issues','Original notes']
        ws.append(headers)
        for item in data['items']:
            raw = item['raw']
            values = [business,data['division'],data['source'],data['sourceSha256'],data['countedOn'],item['location'],raw['cell'],raw['quantityCell'],item['name'],raw['quantityText'],item['quantity'],raw['unitText'],item['unit'],item['requiresStockReview'],None,None,None,'; '.join(raw['issues']),json.dumps(raw.get('notes',[]),ensure_ascii=False)]
            ws.append(values)
            csv_rows.append(dict(zip(headers,values)))
    assert len(csv_rows) == 421
    summary.append([])
    summary.append(['Batch approval fingerprint',rehearsal['batchFingerprint']])
    summary.append(['Authorization','PENDING — this preview is not permission to execute'])
    summary.append(['Product identity','One product per original source entry. Repeated names retain separate SKUs and balances.'])
    summary.append(['Historical counts','10 November (Quality Foods), 11 November (LEGAYEBI). These are not certified present-day counts.'])
    summary.append(['Unspecified','382 absent units plus 1 unconfirmed Pac expression. No PIECE/PACK/BOX assumption.'])
    summary.append(['Sales','Unspecified units and review flags block sales at the API and POS, even if a price is later set.'])
    for ws in wb:
        ws.freeze_panes='A2'
        ws.auto_filter.ref=ws.dimensions
        for cell in ws[1]: cell.font=Font(bold=True,color='FFFFFF');cell.fill=PatternFill('solid',fgColor='233B48')
        for column in ws.columns:
            ws.column_dimensions[column[0].column_letter].width=min(65,max(18,max(len(str(c.value or '')) for c in column[:50])+2))
        for row in ws:
            for cell in row: cell.alignment=Alignment(vertical='top',wrap_text=True)
    wb.save(directory/'FINAL_IMPORT_PREVIEW.xlsx')
    with (directory/'FINAL_IMPORT_PREVIEW.csv').open('w',encoding='utf-8-sig',newline='') as stream:
        writer=csv.DictWriter(stream,fieldnames=list(csv_rows[0]));writer.writeheader();writer.writerows(csv_rows)
    files = {file: hashlib.sha256((directory/file).read_bytes()).hexdigest() for file in ['quality-foods.json','legayebi.json','FINAL_IMPORT_PREVIEW.xlsx','FINAL_IMPORT_PREVIEW.csv']}
    (directory/'artifact-checksums.json').write_text(json.dumps(files,indent=2)+'\n',encoding='utf8')
    print(json.dumps({'previewRows':len(csv_rows),'approval':'PENDING','batchFingerprint':rehearsal['batchFingerprint']}))


if __name__ == '__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('directory',type=Path)
    render(parser.parse_args().directory)
