#!/usr/bin/env bash
# Install local Typst packages by symlinking to Typst's local package directory
# Run once after cloning the repo

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
SOURCE_DIR="$ROOT_DIR/typst-packages/local"

# Typst local packages directory (macOS/Linux)
if [ "$(uname)" = "Darwin" ]; then
  TYPST_PKG_DIR="$HOME/Library/Application Support/typst/packages/local"
else
  TYPST_PKG_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/typst/packages/local"
fi

echo "Installing Typst local packages..."
echo "  Source: $SOURCE_DIR"
echo "  Target: $TYPST_PKG_DIR"

mkdir -p "$TYPST_PKG_DIR"

# Symlink each package
for pkg_dir in "$SOURCE_DIR"/*/; do
  pkg_name=$(basename "$pkg_dir")
  target="$TYPST_PKG_DIR/$pkg_name"
  if [ -L "$target" ] || [ -d "$target" ]; then
    rm -rf "$target"
  fi
  ln -s "$pkg_dir" "$target"
  echo "  Linked: $pkg_name"
done

echo "Done. Verifying..."
typst compile --help > /dev/null 2>&1 && echo "Typst available." || echo "WARNING: typst not found in PATH"
echo "Packages installed:"
ls "$TYPST_PKG_DIR"/
