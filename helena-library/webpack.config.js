const CircularDependencyPlugin = require('circular-dependency-plugin');
const CopyPlugin = require('copy-webpack-plugin');
const path = require('path');
const webpack = require('webpack');

module.exports = {
  entry: {
    "content/main": "./src/code/content/main.ts",
    "mainpanel/main": "./src/code/mainpanel/main.ts",
    "background/main": "./src/code/background/main.ts"
  },
  output: {
    filename: '[name].js',
    path: path.resolve(__dirname, 'dist'),
  },

  mode: "development",

  // Enable sourcemaps for debugging webpack's output.
  devtool: "cheap-module-source-map",

  resolve: {
    extensions: [".ts", ".js"]
  },

  module: {
    rules: [
      {
        test: /\.ts(x?)$/i,
        exclude: /node_modules/,
        use: [
          {
            loader: "awesome-typescript-loader"
          }
        ]
      },
      // All output '.js' files will have any sourcemaps re-processed by 'source-map-loader'.
      {
        enforce: "pre",
        test: /\.js$/,
        loader: "source-map-loader"
      }
    ]
  },

  plugins: [
    new CircularDependencyPlugin({
      exclude: /node_modules/,
      include: /src/,
      failOnError: true,
      cwd: process.cwd()
    }),
    new CopyPlugin([
      {
        context: './src',
        from: '**/*.js'
      },
      {
        context: './src',
        from: '**/*.css'
      },
      {
        context: './src',
        from: '**/*.html'
      },
      {
        from: './src/manifest.json'
      },
      {
        context: './src',
        from: '**/*.png'
      },
      {
        context: './src',
        from: '**/*.gif'
      },
    ]),
    // to fix problem with `later` node module loading
    new webpack.DefinePlugin({
      'process.env': { LATER_COV: false }
    }),
  ],

  // When importing a module whose path matches one of the following, just
  // assume a corresponding global variable exists and use that instead.
  // This is important because it allows us to avoid bundling all of our
  // dependencies, which allows browsers to cache those libraries between builds.
  externals: {
    // "react": "React",
    // "react-dom": "ReactDOM"
  }
};
