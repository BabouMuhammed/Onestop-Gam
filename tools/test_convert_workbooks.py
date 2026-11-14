#!/usr/bin/env python3
"""Checks the import rules in convert_workbooks.py against a small made-up workbook.

Run: python3 tools/test_convert_workbooks.py
"""
import os
import sys
import tempfile
import unittest

import openpyxl

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from convert_workbooks import convert, parse_quantity  # noqa: E402

SHEETS = {
    "SHELVE 1": [
        ("EXAMPLE STOCK AS AT 1 JANUARY 2026",),
        ("ITEAM", "QUANTITY"),
        ("TAP (D350)", 30),
        ("TAP (D450)", 20),
        ("SINK TAP (900)", 16),
        ("BASIN(D3,500)", 3),
        ("BIG TOILET (D30,000)", 1),
        ("WALL PLUG 10MM (50Pcs each)", 14),
        ("WHITE TAP (100 Pcs)", 1097, None, "ASKED SOMEONE"),
        ("PEX UNION (1 FAN)", 90),
        ("RAIN COAT", 4),
    ],
    "FRIDGE": [("ITEAM", None, "QUANTITY"), ("CHICKEN", None, "  58(Pcs)"), ("RAIN COAT", None, 1)],
}


def build():
    wb = openpyxl.Workbook()
    wb.remove(wb.active)
    for title, rows in SHEETS.items():
        ws = wb.create_sheet(title)
        for row in rows:
            ws.append(list(row))
    path = os.path.join(tempfile.mkdtemp(), "example.xlsx")
    wb.save(path)
    return path


class ConvertTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        data, cls.problems = convert(build(), "LE_GAYE_BI", "2026-01-01")
        cls.items = {(i["name"], i["location"]): i for i in data["items"]}

    def item(self, name, location="Shelf 1"):
        return self.items[(name, location)]

    def test_quantities(self):
        self.assertEqual(parse_quantity("6 (BAGS)"), ("6", "BAG"))
        self.assertEqual(parse_quantity("2(BOX)"), ("2", "BOX"))
        self.assertEqual(parse_quantity("2CYCLINDER"), ("2", "CYLINDER"))
        self.assertEqual(parse_quantity("4 1/2 Bag"), ("4.5", "BAG"))
        self.assertEqual(parse_quantity("  42 SACHETS"), ("42", "SACHET"))
        self.assertEqual(parse_quantity(233), ("233", "PIECE"))

    def test_price_is_taken_out_of_a_unique_name(self):
        self.assertEqual(self.item("SINK TAP")["sellingPrice"], "900.00")

    def test_prices_with_thousands_separators(self):
        self.assertEqual(self.item("BASIN")["sellingPrice"], "3500.00")
        self.assertEqual(self.item("BIG TOILET")["sellingPrice"], "30000.00")

    def test_same_name_at_two_prices_stays_two_items(self):
        self.assertEqual(self.item("TAP (D350)")["sellingPrice"], "350.00")
        self.assertEqual(self.item("TAP (D450)")["sellingPrice"], "450.00")

    def test_pack_size(self):
        plug = self.item("WALL PLUG 10MM (50Pcs each)")
        self.assertEqual((plug["packSize"], plug["unit"], plug["sellingPrice"]), (50, "PACK", None))

    def test_other_brackets_are_left_alone(self):
        tap = self.item("WHITE TAP (100 Pcs)")
        self.assertEqual((tap["sellingPrice"], tap["packSize"], tap["remark"]), (None, None, "ASKED SOMEONE"))
        self.assertIsNone(self.item("PEX UNION (1 FAN)")["sellingPrice"])

    def test_locations_and_quantity_in_column_c(self):
        chicken = self.item("CHICKEN", "Fridge")
        self.assertEqual((chicken["quantity"], chicken["locationType"]), ("58", "COLD_STORAGE"))
        self.assertIn(("RAIN COAT", "Fridge"), self.items)
        self.assertIn(("RAIN COAT", "Shelf 1"), self.items)
        self.assertEqual(self.problems, [])


if __name__ == "__main__":
    unittest.main()
