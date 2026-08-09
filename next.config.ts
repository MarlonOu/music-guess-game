import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  // Next.js 15.3+ 預設僅允許 localhost 存取開發伺服器的 _next 靜態資源與 HMR WebSocket，
  // 透過區網 IP（例如手機、其他裝置、VM 對外 IP）連線會被回傳 403 並擋掉 HMR。
  // 此清單需列出所有會用來存取開發伺服器的來源；正式環境（next build/start）不受此限制影響。
  allowedDevOrigins: ['192.168.32.129', 'localhost', '127.0.0.1', 'musicguess.local'],
};

export default nextConfig;
