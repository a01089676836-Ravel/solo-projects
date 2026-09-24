"""Convert selected Tennessee Eastman XLSX files to reproducible JSONL.

The converter uses only Python's standard library so the Node project does not
gain a runtime dependency on pandas or openpyxl.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET


CELL_REF = re.compile(r"([A-Z]+)([0-9]+)$")
NS = {"main": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}


def column_index(reference: str) -> int:
    match = CELL_REF.match(reference)
    if not match:
        raise ValueError(f"Invalid cell reference: {reference}")
    result = 0
    for char in match.group(1):
        result = result * 26 + ord(char) - ord("A") + 1
    return result - 1


def shared_strings(book: zipfile.ZipFile) -> list[str]:
    try:
        raw = book.read("xl/sharedStrings.xml")
    except KeyError:
        return []
    root = ET.fromstring(raw)
    values = []
    for item in root.findall("main:si", NS):
        values.append("".join(text.text or "" for text in item.findall(".//main:t", NS)))
    return values


def cell_value(cell: ET.Element, strings: list[str]):
    cell_type = cell.attrib.get("t")
    if cell_type == "inlineStr":
        return "".join(text.text or "" for text in cell.findall(".//main:t", NS))
    value = cell.find("main:v", NS)
    if value is None or value.text is None:
        return None
    if cell_type == "s":
        return strings[int(value.text)]
    try:
        number = float(value.text)
        return int(number) if number.is_integer() else number
    except ValueError:
        return value.text


def read_rows(path: Path) -> list[list[object]]:
    with zipfile.ZipFile(path) as book:
        strings = shared_strings(book)
        root = ET.fromstring(book.read("xl/worksheets/sheet1.xml"))
        rows = []
        for row in root.findall(".//main:sheetData/main:row", NS):
            cells = {}
            for cell in row.findall("main:c", NS):
                cells[column_index(cell.attrib["r"])] = cell_value(cell, strings)
            if cells:
                width = max(cells) + 1
                rows.append([cells.get(index) for index in range(width)])
        return rows


def convert(input_path: Path, output_path: Path, mode: str) -> dict[str, object]:
    rows = read_rows(input_path)
    if not rows or rows[0][0] != "Time":
        raise ValueError(f"Unexpected TEP header in {input_path}")
    headers = [str(value) for value in rows[0]]
    run_id = f"tep-{mode.lower()}-normal-50h"
    output_path.parent.mkdir(parents=True, exist_ok=True)
    count = 0
    with output_path.open("w", encoding="utf-8", newline="\n") as stream:
        for row in rows[1:]:
            if not row or not isinstance(row[0], (int, float)):
                continue
            channels = {}
            for header, value in zip(headers[1:], row[1:]):
                if isinstance(value, (int, float)) and math.isfinite(value):
                    channels[header] = value
            record = {
                "schemaVersion": 1,
                "source": "tennessee-eastman-dataset",
                "sourceFile": input_path.name,
                "processModeId": mode,
                "scenarioType": "normal",
                "runId": run_id,
                "timeSeconds": row[0],
                "channels": channels,
            }
            stream.write(json.dumps(record, ensure_ascii=False, separators=(",", ":")) + "\n")
            count += 1
    digest = hashlib.sha256(output_path.read_bytes()).hexdigest()
    return {"mode": mode, "rows": count, "output": output_path.name, "sha256": digest}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--raw", type=Path, default=Path("data/raw/tep"))
    parser.add_argument("--output", type=Path, default=Path("data/normalized/tep"))
    args = parser.parse_args()
    inputs = [("MODE_1", "mode1_normal_50.xlsx"), ("MODE_3", "mode3_normal_50.xlsx"), ("MODE_4", "mode4_normal_50.xlsx")]
    results = []
    for mode, filename in inputs:
        results.append(convert(args.raw / filename, args.output / f"{mode.lower()}_normal.jsonl", mode))
    (args.output / "manifest.json").write_text(json.dumps({"files": results}, indent=2), encoding="utf-8")
    print(json.dumps({"files": results}, indent=2))


if __name__ == "__main__":
    main()
