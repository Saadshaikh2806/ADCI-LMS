import type { NextConfig } from "next";

const contentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'self'",
  "form-action 'self' https://api.razorpay.com https://*.razorpay.com",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://checkout.razorpay.com https://source.zoom.us https://zoom.us https://*.zoom.us",
  "style-src 'self' 'unsafe-inline' https://source.zoom.us https://zoom.us https://*.zoom.us",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data: https://source.zoom.us https://zoom.us https://*.zoom.us",
  "media-src 'self' blob: https:",
  "worker-src 'self' blob:",
  "frame-src 'self' https://api.razorpay.com https://*.razorpay.com https://zoom.us https://*.zoom.us",
  // The Zoom Web Meeting SDK calls the apex host (https://zoom.us/api/v1/wc/*) as
  // well as its subdomains, and streams source maps from its CloudFront bucket.
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.r2.cloudflarestorage.com https://api.razorpay.com https://*.razorpay.com https://zoom.us https://*.zoom.us wss://zoom.us wss://*.zoom.us https://d1cdksi819e9z7.cloudfront.net https://*.agora.io wss://*.agora.io https://*.agoralab.co wss://*.agoralab.co",
  "manifest-src 'self'",
  "block-all-mixed-content"
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-DNS-Prefetch-Control", value: "off" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(self), microphone=(self), geolocation=(), browsing-topics=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" }
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  allowedDevOrigins: ["127.0.0.1"],
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
