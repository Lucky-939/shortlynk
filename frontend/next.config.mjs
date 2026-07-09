/** @type {import('next').NextConfig} */
const nextConfig = {
  /**
   * Static export — produces an `out/` directory deployable to Cloudflare Pages.
   * See: https://nextjs.org/docs/app/building-your-application/deploying/static-exports
   */
  output: "export",

  /**
   * Disable the built-in image optimisation API (not available in static exports).
   * Use next/image with `unoptimized: true` or a custom loader if needed.
   */
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
