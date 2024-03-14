const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const { CleanWebpackPlugin } = require('clean-webpack-plugin');
const CopyWebpackPlugin = require('copy-webpack-plugin');
const fs = require('fs');

// App directory
const appDirectory = fs.realpathSync(process.cwd());
const foldersToCopy = ['assets', 'textures']; // Add any additional folders here

const getCopyWebpackPluginInstance = (from, to) => {
  return new CopyWebpackPlugin({
    patterns: [
      {
        from,
        to,
        globOptions: {
          dot: true,
          ignore: ['**/.gitkeep'],
        },
      },
    ],
  });
};

const copyWebpackPlugins = foldersToCopy
  .filter(folder => fs.existsSync(path.resolve(__dirname, folder)))
  .map(folder => getCopyWebpackPluginInstance(folder, folder));

module.exports = {
  resolve: {
    extensions: ['.ts', '.js'],
  },
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'js/babylonBundle.js',
  },
  module: {
    rules: [
      {
        test: /\.(js|mjs|jsx|ts|tsx)$/,
        loader: 'source-map-loader',
        enforce: 'pre',
      },
      {
        test: /\.tsx?$/,
        loader: 'ts-loader',
        exclude: /node_modules/,
      },
      {
        test: /\.(png|jpg|gif|env|glb|stl)$/i,
        include: foldersToCopy.map(folder => path.resolve(__dirname, folder)),
        use: [
          {
            loader: 'url-loader',
            options: {
              limit: 19192,
              name: '[path][name].[ext]',
              publicPath: '',
            },
          },
        ],
      },
    ],
  },
  plugins: [
    new CleanWebpackPlugin(),
    new HtmlWebpackPlugin({
      inject: true,
      template: path.resolve(appDirectory, 'index.html'),
    }),
    ...copyWebpackPlugins,
  ],
};