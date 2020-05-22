const path = require("path");

module.exports = {
  entry: {
    content: "./src/content.ts",
    mainpanel: "./src/mainpanel.ts",
    background: "./src/background.ts",
  },
  output: {
    filename: "[name].js",
    path: path.resolve(__dirname, "dist/scripts"),
  },

  mode: "development",

  // Enable sourcemaps for debugging webpack's output.
  devtool: "cheap-module-source-map",

  resolve: {
    extensions: [".ts", ".js"],
  },

  module: {
    rules: [
      {
        test: /\.ts(x?)$/i,
        exclude: /node_modules/,
        use: [
          {
            loader: "awesome-typescript-loader",
          },
        ],
      },
      // All output '.js' files will have any sourcemaps re-processed by 'source-map-loader'.
      {
        enforce: "pre",
        test: /\.js$/,
        loader: "source-map-loader",
      },
    ],
  },
};
