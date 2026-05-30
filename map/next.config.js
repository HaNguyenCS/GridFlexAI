/** @type {import('next').NextConfig} */
const webpack = require('webpack');

const nextConfig = {
  reactStrictMode: false,
  transpilePackages: [
    '@kepler.gl/actions',
    '@kepler.gl/components',
    '@kepler.gl/constants',
    '@kepler.gl/processors',
    '@kepler.gl/reducers',
    '@kepler.gl/schemas',
    '@kepler.gl/styles',
    '@kepler.gl/utils',
    '@kepler.gl/types',
    '@kepler.gl/layers',
    '@kepler.gl/table',
    '@kepler.gl/localization',
    '@kepler.gl/cloud-providers',
    '@kepler.gl/effects',
    'react-palm'
  ],
  webpack: (config, { isServer }) => {
    config.resolve.fallback = {
      ...config.resolve.fallback,
      fs: false,
      path: false,
      crypto: false
    };
    config.plugins.push(
      new webpack.ProvidePlugin({
        process: 'process/browser',
        Buffer: ['buffer', 'Buffer']
      })
    );
    return config;
  }
};

module.exports = nextConfig;
