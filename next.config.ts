import type { NextConfig } from 'next';
const nextConfig: NextConfig = {
  images: {
    // The optimizer is off deliberately. Firebase Hosting's framework
    // integration deploys only a server bundle - no next.config reaches the
    // function - so /_next/image runs with default settings at runtime and
    // rejects every remote URL with "url parameter is not allowed", however
    // remotePatterns is configured here. It works locally and fails only once
    // deployed, which is the worst way to find out.
    //
    // With unoptimized the decision is made at build time: next/image emits a
    // plain img pointing at the source, so nothing depends on runtime config.
    // Menu photographs are therefore sized at upload instead.
    unoptimized: true,
    remotePatterns: [
      {protocol: 'https', hostname: 'storage.googleapis.com', pathname: '/**'},
      {protocol: 'https', hostname: 'firebasestorage.googleapis.com', pathname: '/**'},
      {protocol: 'https', hostname: 'images.unsplash.com', pathname: '/**'},
    ],
  },
};
export default nextConfig;
