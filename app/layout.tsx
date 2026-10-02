import type { Metadata } from "next";
import { Space_Grotesk, Inter, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

/*
  先前版本的 globals.css 其實只是「寫了」Space Grotesk／Inter／IBM Plex Mono 這幾個
  字型名稱在 font-family 字串裡，從來沒有真正透過任何管道載入這些字型檔——整個網站
  一直以來顯示的都是各裝置的系統預設字體，CSS 裡那幾個名字形同虛設。這裡改用
  next/font/google 真正載入，並且用 CSS variable 的方式暴露給 globals.css 使用，
  這是 Next.js 官方建議的做法（建置時自動下載、自我託管、注入 <style>，不會有額外的
  外部請求、也不會有換字型時的畫面閃爍）。

  中文（繁體）字型刻意不在這裡一併自架——Noto Sans TC 這類 CJK 字型即使只拿「繁體中文」
  這個子集，檔案大小仍遠超拉丁字型（常見到幾百 KB 甚至更大，中文字數量級的關係），
  對這個已經在手機網路環境下吃足苦頭的專案來說，這個成本不值得——改用系統內建的
  中文字型（iOS/Mac 的 PingFang TC、Windows 的微軟正黑體、Android/Linux 的 Noto Sans
  CJK）本身品質就已經很好，globals.css 的 font-family 字串裡會把這些系統字型列在
  拉丁字型之後，兩者分工：真正帶有識別度的拉丁字體這裡確實載入，中文沿用使用者
  裝置原生字型。
*/
const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-space-grotesk",
  display: "swap",
});
const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-inter",
  display: "swap",
});
const ibmPlexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-ibm-plex-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "音樂猜歌",
  description: "音樂猜歌遊戲",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="zh-Hant"
      className={`${spaceGrotesk.variable} ${inter.variable} ${ibmPlexMono.variable}`}
    >
      <head>
        {/*
          YouTube 自 2025 年下半年起加嚴嵌入來源身份驗證，明確要求 Referer 標頭。
          多數瀏覽器預設值其實已經是這個政策，但明確宣告以排除任何被其他設定覆蓋的可能。
          參考：https://developers.google.com/youtube/iframe_api_reference
        */}
        <meta name="referrer" content="strict-origin-when-cross-origin" />
        {/*
          提前建立與 YouTube 網域的連線（DNS／TLS 交握），縮短 AudioController.preload() 暖機
          （載入 IFrame API script、建立播放器）所需的時間——這在行動網路上尤其重要，是解決
          「手機第一首歌常常載入失敗」問題的一部分：暖機能不能在使用者手勢過期前完成，取決於
          這幾個網域的連線建立速度。
        */}
        <link rel="preconnect" href="https://www.youtube.com" />
        <link rel="preconnect" href="https://i.ytimg.com" />
        <link rel="dns-prefetch" href="https://www.youtube.com" />
      </head>
      <body>{children}</body>
    </html>
  );
}
