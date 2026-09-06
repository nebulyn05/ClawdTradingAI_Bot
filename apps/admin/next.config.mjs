/** @type {import('next').NextConfig} */
const nextConfig = {
  // pino/pino-pretty/thread-stream: thread-stream's worker thread locates its
  // worker.js relative to its own package dir; webpack-bundling it into the
  // server chunk breaks that path (MODULE_NOT_FOUND, worker thread exits on
  // every request in dev, where pino's pretty-print transport is active).
  // viem/ox: `viem/chains` has no per-chain export subpath, so importing any
  // chain pulls in the whole barrel including `tempo`, which drags in ox's
  // virtualMasterPool.js (an expression-based dynamic require webpack can't
  // analyze) — leaving it external avoids the bundler ever seeing it.
  serverExternalPackages: [
    "@prisma/client",
    "pino",
    "pino-pretty",
    "thread-stream",
    "viem",
    "ox",
  ],
};

export default nextConfig;
