## ⚠️ 重要：開發環境存取網址（YouTube 播放前必讀）

**不要用 IP 位址（例如 `http://192.168.x.x:3000`）存取本專案來測試遊戲音訊播放。**

YouTube IFrame Player 的嵌入播放驗證機制不接受純 IP 位址作為來源網域（`localhost` 是唯一的例外），用 IP 存取時，`AudioController` 會持續回報「錯誤碼 150：影片擁有者關閉了外部網站的嵌入播放權限」，即使實際上該影片完全沒有嵌入限制（可用 `curl "https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=<videoId>&format=json"` 驗證）。這個症狀會讓人誤以為是程式碼或個別影片的問題，實際上只是網址存取方式不對。

**正確做法**：在要瀏覽此網站的電腦上編輯 hosts 檔案，把 VM 的 IP 對應到一個自訂網域名稱，並用該網域存取：

```
# Windows: C:\Windows\System32\drivers\etc\hosts（需以系統管理員身分編輯）
# macOS/Linux: /etc/hosts（需 sudo 編輯）
192.168.x.x    musicguess.local
```

存檔後執行 `ipconfig /flushdns`（Windows）或 `sudo dscacheutil -flushcache`（macOS），改用 `http://musicguess.local:3000` 存取。若 IP 或網域名稱有異動，記得同步更新 `next.config.ts` 的 `allowedDevOrigins` 清單。

---

This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
