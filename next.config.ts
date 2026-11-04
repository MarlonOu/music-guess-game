import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 內附 ffmpeg 執行檔的套件不能被打包進 server bundle，需維持成執行期 require（無限連勝的伺服器端音訊裁切會用到）
  serverExternalPackages: ['@ffmpeg-installer/ffmpeg'],
  // 隱藏框架版本資訊（x-powered-by: Next.js）
  poweredByHeader: false,
  // 基本安全標頭：不影響頁面內嵌 YouTube／音訊播放，只限制「別人把本站嵌進去」與瀏覽器猜測內容型別。
  // 不設完整 CSP：頁面需要載入 YouTube iframe 與 Next.js 內嵌腳本，嚴格 CSP 容易擋掉正常播放。
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'Content-Security-Policy', value: "frame-ancestors 'self'" },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()' },
        ],
      },
    ];
  },
  /* config options here */
  // Next.js 15.3+ 預設僅允許 localhost 存取開發伺服器的 _next 靜態資源與 HMR WebSocket，
  // 透過區網 IP（例如手機、其他裝置、VM 對外 IP）連線會被回傳 403 並擋掉 HMR。
  // 此清單需列出所有會用來存取開發伺服器的來源；正式環境（next build/start）不受此限制影響。
  allowedDevOrigins: ['192.168.32.129', 'localhost', '127.0.0.1', 'musicguess.local'],
};

export default nextConfig;
