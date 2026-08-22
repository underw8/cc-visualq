'use strict';

// Option text is model-generated and reaches the browser, so everything
// interpolated into HTML or SVG passes through here. Its own module because
// both render.js and charts.js need it and neither may require the other.
const esc = (s) =>
  String(s).replaceAll(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

module.exports = { esc };
