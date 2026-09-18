// Compatibility command for formula-editor UI regression.
// The floating settings panel has been retired. Its replacement suite checks
// inline editing, completion, Done, browsing, zoom and legacy dynamic formulas.
// TSX_TSCONFIG_PATH=client/tsconfig.app.json node --import tsx scripts/test-formula-panel.cjs
require('./test-excel-formula-bar.cjs');
