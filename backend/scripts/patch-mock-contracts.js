/**
 * One-shot helper: ensure mock-server.js loads Contract Master routes.
 * Run: node scripts/patch-mock-contracts.js
 */
const fs = require('fs');
const path = require('path');

const target = path.join(__dirname, '../mock-server.js');
let text = fs.readFileSync(target, 'utf8');
let changed = false;

if (!text.includes("'/api/v1/contracts'")) {
  text = text.replace(
    "'/api/v1/cache',",
    "'/api/v1/cache',\n  '/api/v1/contracts',",
  );
  changed = true;
  console.log('Added /api/v1/contracts to requireMockAuth paths');
}

if (!text.includes('mock-contract-routes')) {
  const marker = '// ── DEV: Mock introspection endpoints';
  const insert =
    "// Contract Master mock routes\n" +
    "try {\n" +
    "  require('./mock-contract-routes')(app, { mockNurses });\n" +
    "  console.log('[MOCK] Contract Master routes registered');\n" +
    "} catch (e) {\n" +
    "  console.warn('[MOCK] Contract routes not loaded:', e.message);\n" +
    "}\n\n";
  if (!text.includes(marker)) {
    console.error('Marker not found — insert require manually before catch-all');
    process.exit(1);
  }
  text = text.replace(marker, insert + marker);
  changed = true;
  console.log('Registered require(./mock-contract-routes)');
}

if (!changed) {
  console.log('mock-server.js already wired for contracts');
} else {
  fs.writeFileSync(target, text);
  console.log('Wrote', target);
}
