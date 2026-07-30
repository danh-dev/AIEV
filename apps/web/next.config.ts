import type { NextConfig } from "next";

const SERVER_PORT = process.env.SERVER_PORT || "6869";

const nextConfig: NextConfig = {
  experimental: {
    // Proxy rewrite mặc định timeout 30s — video lớn (media/stream) cần lâu hơn.
    // Upload file lớn đã đi thẳng backend (serverOrigin trong lib/api.ts), đây là lớp dự phòng.
    proxyTimeout: 10 * 60 * 1000,
  },
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `http://localhost:${SERVER_PORT}/api/:path*`,
      },
      {
        source: "/media/:path*",
        destination: `http://localhost:${SERVER_PORT}/media/:path*`,
      },
    ];
  },
};

export default nextConfig;
