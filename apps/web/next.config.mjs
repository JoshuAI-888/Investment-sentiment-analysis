/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // F01 §4.1 — the app is built from apps/web; the workspace root is two levels up.
  outputFileTracingRoot: new URL('../../', import.meta.url).pathname,
  eslint: {
    // Linting is its own CI step (05-TEST-STRATEGY.md §8). Running it again inside
    // `next build` would report a lint failure as a build failure.
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
