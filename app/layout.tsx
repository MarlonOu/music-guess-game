import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "音樂猜歌",
  description: "音樂猜歌遊戲",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="zh-Hant">
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
