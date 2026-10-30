import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The MemWal SDK and the Mysten packages are ESM with dynamic imports; keep them
  // external on the server so Next does not try to bundle their optional peers.
  serverExternalPackages: [
    "@grpc/grpc-js",
    "@protobuf-ts/grpc-transport",
    "@mysten-incubation/memwal",
    "@mysten/sui",
    "@mysten/seal",
    "@mysten/walrus",
  ],
};

export default nextConfig;
