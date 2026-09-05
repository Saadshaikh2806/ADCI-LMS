import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(self), microphone=(self), geolocation=(), browsing-topics=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" }
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  webpack(config, { webpack }) {
    // Zoom 6.2 embeds a React 18 renderer; the LMS continues using React 19.
    config.plugins.push(new webpack.NormalModuleReplacementPlugin(/^react$/, (resource: { context: string; request: string }) => {
      if (/[\\/]@zoom[\\/]meetingsdk[\\/]/.test(resource.context)) {
        resource.request = require.resolve("react-zoom");
      }
    }));
    return config;
  },
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  }
};

export default nextConfig;
