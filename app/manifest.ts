import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: '音樂猜歌',
    short_name: '音樂猜歌',
    description: '聽見旋律，喊出歌名',
    start_url: '/',
    display: 'standalone',
    background_color: '#0e0f12',
    theme_color: '#0e0f12',
    lang: 'zh-Hant',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
  };
}
