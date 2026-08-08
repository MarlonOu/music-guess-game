import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "音樂猜歌",
  description: "音樂猜歌遊戲",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="zh-Hant">
      <body>{children}</body>
    </html>
  );
}
