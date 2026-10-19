// Build-scan compatibility shim.
// apply-v4.4.57-selected-upgrades.js contains target apiRouter source snippets with
// require('./services/edgeTts'). The pre-build case-sensitive import scanner reads
// patch-script string literals as imports relative to scripts/, so keep this tiny
// forwarding module to make that generated target path resolvable during scanning.
module.exports = require('../../electron/services/edgeTts');
