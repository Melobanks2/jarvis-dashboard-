/** @type {import('next').NextConfig} */
const path = require('path');

const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['three', '@react-three/fiber', '@react-three/drei', '@splinetool/react-spline', '@splinetool/runtime'],
  webpack: (config) => {
    // @splinetool/react-spline v4 is ESM-only (no "require" condition in exports).
    // Alias it directly to the dist file to bypass webpack's exports-map resolution.
    config.resolve.alias['@splinetool/react-spline'] = path.resolve(
      __dirname,
      'node_modules/@splinetool/react-spline/dist/react-spline.js'
    );
    return config;
  },
};

module.exports = nextConfig;
