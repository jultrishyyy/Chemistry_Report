#!/usr/bin/env bash
# Convert all .xls files in samples/originals/ to .xlsx in samples/converted/
# Requires LibreOffice (soffice) installed

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
INPUT_DIR="$ROOT_DIR/samples/originals"
OUTPUT_DIR="$ROOT_DIR/samples/converted"

mkdir -p "$OUTPUT_DIR"

echo "Converting .xls files to .xlsx..."

for f in "$INPUT_DIR"/*.xls; do
  [ -f "$f" ] || continue
  echo "  Converting: $(basename "$f")"
  soffice --headless --convert-to xlsx --outdir "$OUTPUT_DIR" "$f" 2>/dev/null
done

# Also copy .xlsx files directly
for f in "$INPUT_DIR"/*.xlsx; do
  [ -f "$f" ] || continue
  echo "  Copying .xlsx: $(basename "$f")"
  cp "$f" "$OUTPUT_DIR/"
done

echo "Done. Files in $OUTPUT_DIR:"
ls "$OUTPUT_DIR"
