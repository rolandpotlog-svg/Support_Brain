import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // imapflow/nodemailer sind reine Server-Pakete — nicht ins Client-Bundle ziehen.
  serverExternalPackages: ["imapflow", "nodemailer", "mailparser", "pg", "xlsx"],
  experimental: {
    // Anhang-Upload in Antworten (max. 5 × 8 MB) — Standardlimit wäre 1 MB.
    serverActions: { bodySizeLimit: "45mb" },
  },
};

export default nextConfig;
