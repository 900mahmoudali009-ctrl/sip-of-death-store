'use strict';

/* ============================================================
   SIP OF DEATH — Vercel serverless entry
   Wraps the same Express app from server.js. Static files and
   the SPA are served by Vercel itself (see vercel.json); this
   function only handles /api/* routes.
   ============================================================ */

const server = require('./server');

let ready = false;

async function handler(req, res) {
  if (!ready) {
    await server.ensureReady();
    ready = true;
  }
  return server.app(req, res);
}

module.exports = handler;
module.exports.default = handler;
