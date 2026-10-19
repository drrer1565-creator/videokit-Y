// Build-scan compatibility shim for the generated v4.4.57 Edge TTS API routes.
// The pre-build checker scans patch-script source literals as if they were imports
// relative to scripts/, so this forwarding module keeps that generated location
// resolvable without changing the runtime electron/apiRouter target.
module.exports = require('../../electron/services/edgeTts');
