import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** @type {import('next').NextConfig} */
const nextConfig = {
  // External packages for server components
  serverExternalPackages: ['@fixdescriptorkit/ts-sdk'],

  // Turbopack configuration
  turbopack: {
    resolveAlias: {
      '@': path.resolve(__dirname),
    },
  },

  // Webpack configuration (fallback for production builds)
  webpack: (config) => {
    // Handle local packages
    config.resolve.symlinks = false;

    // Add path alias for @ to point to the apps/web directory
    config.resolve.alias = {
      ...config.resolve.alias,
      '@': path.resolve(__dirname),
    };

    // Ensure proper module resolution
    config.resolve.fallback = {
      ...config.resolve.fallback,
      fs: false,
      net: false,
      tls: false,
    };

    return config;
  },
};

export default nextConfig;
