import type { NextConfig } from "next";

// FloraScope is a fully client-side app: every computation (detection,
// allometry, Monte Carlo uncertainty) runs in the browser. A static export
// lets it be hosted anywhere — e.g. dragged onto Netlify Drop.
const nextConfig: NextConfig = {
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
