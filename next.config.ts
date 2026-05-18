import { withWorkflow } from "workflow/next";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    /** Vercel Image Optimization CDN cache for job thumbnails (30 days). */
    minimumCacheTTL: 30 * 24 * 60 * 60,
    localPatterns: [
      {
        pathname: "/api/jobs/**/thumbnail",
      },
    ],
  },
};

export default withWorkflow(nextConfig);
