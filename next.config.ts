import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // imapflow/nodemailer sind reine Server-Pakete — nicht ins Client-Bundle ziehen.
  serverExternalPackages: ["imapflow", "nodemailer", "mailparser", "pg"],
};

export default nextConfig;
