const { merge } = require('webpack-merge');
const path = require('path');
const fs = require('fs');
const common = require('./webpack.common.js');

const appDirectory = fs.realpathSync(process.cwd());

module.exports = merge(common, {
  mode: 'development',
  devtool: 'inline-source-map',
  devServer: {
    static: {
      directory: path.resolve(appDirectory, 'dist'),
    },
    compress: true,
    hot: true,
    open: true,
    host: '0.0.0.0', // Allow connections from other devices on the network
    https: true // enable when HTTPS is needed (like in WebXR)
  },
});
