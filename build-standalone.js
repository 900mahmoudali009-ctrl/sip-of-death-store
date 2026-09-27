'use strict';

/* Builds standalone.html: index.html with CSS + JS inlined.
   Run:  node build-standalone.js   (or via npm run build) */

const fs = require('fs');
const path = require('path');

const root = __dirname;
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

let html = read('index.html');

/* inline stylesheet */
html = html.replace(
  /<link rel="stylesheet" href="styles.css">/,
  () => `<style>\n${read('styles.css')}\n</style>`
);

/* inline scripts in order */
html = html.replace(
  /<script src="([^"]+)"><\/script>/g,
  (_, src) => `<script>\n${read(src)}\n</script>`
);

fs.writeFileSync(path.join(root, 'standalone.html'), html);
console.log(`standalone.html written (${(html.length / 1024).toFixed(1)} KB)`);
