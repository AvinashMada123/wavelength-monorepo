import type { NextConfig } from "next";
import * as path from "path";
import * as dotenv from "dotenv";

// Load env from monorepo root as fallback (won't override vars already set)
dotenv.config({ path: path.resolve(__dirname, "../.env") });

const nextConfig: NextConfig = {
  /* config options here */
};

export default nextConfig;
