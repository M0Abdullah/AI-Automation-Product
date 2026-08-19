import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The backend base URL is read at build/run time from the environment.
  // NEXT_PUBLIC_* is the only prefix exposed to the browser — and it must
  // NEVER hold the LLM key. See frontend/.env.local.example.
  env: {
    NEXT_PUBLIC_API_BASE_URL: process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000/api',
  },
};

export default nextConfig;
