import type { NextConfig } from 'next';
const nextConfig: NextConfig = {
  images: {
    // Menu photographs are served from our own public Storage bucket.
    remotePatterns: [
      {protocol: 'https', hostname: 'storage.googleapis.com', pathname: '/**'},
      {protocol: 'https', hostname: 'firebasestorage.googleapis.com', pathname: '/**'},
    ],
  },
};
export default nextConfig;
