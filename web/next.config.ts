import path from "path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Repo root also has an orphaned, unused package-lock.json (no real
  // monorepo tooling) - without this, Next.js's workspace-root inference
  // picks that up and warns on every build/dev run.
  turbopack: {
    root: path.join(__dirname),
  },
};

export default nextConfig;
