'use strict';

const registerPlugin = require('./lib/plugin');

if (typeof hexo !== 'undefined') {
  registerPlugin(hexo);
}

module.exports = registerPlugin;
