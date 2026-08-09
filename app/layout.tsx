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
      </head>
      <body>{children}</body>
    </html>
  );
}
