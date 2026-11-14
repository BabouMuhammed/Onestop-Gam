#!/usr/bin/env python3
"""Convert a stock-count workbook (one sheet per location, columns: item, quantity)
into the JSON format read by `npm run import:opening-stock`.

Usage:
  python3 tools/convert_workbooks.py <workbook.xlsx> <DIVISION_CODE> <counted-on YYYY-MM-DD> <out.json>

Requires: pip install openpyxl
"""
import json
import re
import sys

import openpyxl

LOCATION_TYPES = [
    (r"FRIDGE|FREEZER|COLD", "COLD_STORAGE"),
    (r"GROUND|FLOOR", "FLOOR"),
    (r"TABLE", "TABLE"),
    (r"SHEL", "SHELF"),
]
UNITS = [
    (r"\bPCS?\b|\bPIECES?\b", "PIECE"),
    (r"\bBAGS?\b", "BAG"),
    (r"\bPACK?S?\b", "PACK"),
    (r"\bSACHETS?\b", "SACHET"),
    (r"\bBOX(ES)?\b", "BOX"),
    (r"\bCY\w*LINDERS?\b", "CYLINDER"),
    (r"\bROLLS?\b", "ROLL"),
]
# "(400)", "(D350)", "(D3,500)", "(D30,000)" at the end of a name.
PRICE_IN_NAME = re.compile(r"\s*\(\s*D?\s*(\d{1,3}(?:,\d{3})+|\d{3,6})\s*\)\s*$", re.I)
# "(50Pcs each)": the item is counted in packs of that many pieces.
PACK_IN_NAME = re.compile(r"\(\s*(\d+)\s*PCS?\s+EACH\s*\)", re.I)


def location_name(sheet_title: str) -> str:
    t = re.sub(r"\s+", " ", sheet_title.strip()).upper()
    t = t.replace("SHELVE", "SHELF").replace("ITEAM ON THE GROUND", "ITEMS ON THE GROUND")
    return t.capitalize()


def location_type(sheet_title: str) -> str:
    for pattern, kind in LOCATION_TYPES:
        if re.search(pattern, sheet_title, re.I):
            return kind
    return "OTHER"


def parse_quantity(raw):
    """Return (quantity as string, unit). Text such as '58(Pcs)' or '2 BOX' is split."""
    if isinstance(raw, (int, float)):
        return (str(int(raw)) if float(raw).is_integer() else str(raw)), "PIECE"
    text = str(raw).strip().upper()
    number = re.search(r"\d+(?:\.\d+)?", text)
    if not number:
        return None, "PIECE"
    mixed = re.match(r"\s*(\d+)\s+(\d+)\s*/\s*(\d+)", text)  # "4 1/2 Bag" -> 4.5
    amount = str(int(mixed.group(1)) + int(mixed.group(2)) / int(mixed.group(3))) if mixed else number.group(0)
    spaced = re.sub(r"(\d)([A-Z])", r"\1 \2", text)
    for pattern, unit in UNITS:
        if re.search(pattern, spaced):
            return amount, unit
    return amount, "PIECE"


def convert(path, division, counted_on):
    wb = openpyxl.load_workbook(path, data_only=True)
    rows, problems = [], []
    for ws in wb.worksheets:
        seen_header = False
        for row in ws.iter_rows():
            cells = [c for c in row if c.value is not None and str(c.value).strip() != ""]
            if not cells:
                continue
            first = str(cells[0].value).strip()
            if not seen_header:
                if re.match(r"ITE?A?M", first, re.I) and len(cells) > 1:
                    seen_header = True
                continue
            if cells[0].column != 1 or len(cells) < 2:
                problems.append(f"{ws.title}!{cells[0].coordinate}: skipped ({first!r})")
                continue
            name = re.sub(r"\s+", " ", first)
            quantity, unit = parse_quantity(cells[1].value)
            if quantity is None:
                problems.append(f"{ws.title}!{cells[1].coordinate}: no number in quantity {cells[1].value!r}")
                continue
            remark = " ".join(str(c.value).strip() for c in cells[2:]) or None
            rows.append({
                "name": name, "location": location_name(ws.title), "locationType": location_type(ws.title),
                "quantity": quantity, "unit": unit, "packSize": None, "sellingPrice": None, "remark": remark,
                "raw": {"sheet": ws.title, "cell": cells[0].coordinate, "name": first, "quantity": str(cells[1].value).strip()},
            })

    # A trailing "(400)" or "(D350)" is a selling price in dalasi. The number is taken
    # out of the name only when that leaves the name unique within the division.
    for r in rows:
        pack = PACK_IN_NAME.search(r["name"])
        if pack and int(pack.group(1)) > 1:
            r["packSize"] = int(pack.group(1))
            if r["unit"] == "PIECE":
                r["unit"] = "PACK"

    stripped = {}
    for r in rows:
        stripped.setdefault(PRICE_IN_NAME.sub("", r["name"]).upper(), set()).add(r["name"].upper())
    for r in rows:
        m = PRICE_IN_NAME.search(r["name"])
        if m:
            r["sellingPrice"] = f"{int(m.group(1).replace(',', ''))}.00"
            bare = PRICE_IN_NAME.sub("", r["name"])
            if len(stripped[bare.upper()]) == 1:
                r["name"] = bare
    return {"division": division, "countedOn": counted_on, "source": path.split("/")[-1], "items": rows}, problems


if __name__ == "__main__":
    if len(sys.argv) != 5:
        sys.exit(__doc__)
    data, problems = convert(sys.argv[1], sys.argv[2], sys.argv[3])
    with open(sys.argv[4], "w", encoding="utf-8") as fh:
        json.dump(data, fh, indent=1, ensure_ascii=False)
    names = {i["name"].upper() for i in data["items"]}
    print(f"{sys.argv[4]}: {len(data['items'])} rows, {len(names)} products, "
          f"{len({i['location'] for i in data['items']})} locations, "
          f"{sum(1 for i in data['items'] if i['sellingPrice'])} with a price")
    for p in problems:
        print("  note:", p)
