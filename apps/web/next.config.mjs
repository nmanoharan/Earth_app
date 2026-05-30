/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false,
  transpilePackages: ["@forest/shared"],
  eslint: {
    ignoreDuringBuilds: true
  }
};

export default nextConfig;
