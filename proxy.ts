import { NextRequest, NextResponse } from 'next/server';

// 保護「管理用」路徑：/admin 頁面本身，以及會修改資料或消耗 YouTube API 配額的 API。
// 純查詢用的 GET /api/songs、GET /api/artists、GET /api/themes 不擋，遊戲本身要能正常讀題庫。
// /api/rooms 系列不在此列——那是線上模式給一般玩家用的房間功能，不是管理功能。
const PROTECTED_PATH_PREFIXES = ['/admin', '/api/youtube-search'];
const PROTECTED_MUTATION_PATHS = ['/api/songs', '/api/artists', '/api/themes'];

function isProtectedPath(pathname: string, method: string): boolean {
  if (PROTECTED_PATH_PREFIXES.some((p) => pathname.startsWith(p))) return true;
  if (PROTECTED_MUTATION_PATHS.some((p) => pathname.startsWith(p)) && method !== 'GET') return true;
  return false;
}

function unauthorized(): NextResponse {
  return new NextResponse('需要管理者密碼', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="music-guess-game admin"' },
  });
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (!isProtectedPath(pathname, request.method)) {
    return NextResponse.next();
  }

  const user = process.env.ADMIN_USER;
  const password = process.env.ADMIN_PASSWORD;

  // 未設定帳密時，出於安全考量預設「整段管理功能直接擋掉」而非「放行」，
  // 避免忘記設定 .env 就上線導致管理頁面對所有人完全開放。
  if (!user || !password) {
    return new NextResponse(
      '伺服器尚未設定 ADMIN_USER / ADMIN_PASSWORD，管理功能已停用。請參考 .env.example 設定後重啟伺服器。',
      { status: 503 }
    );
  }

  const authHeader = request.headers.get('authorization');
  if (!authHeader?.startsWith('Basic ')) {
    return unauthorized();
  }

  // proxy.ts 在 Next.js 16 改為 Node.js Runtime 執行（先前的 middleware.ts 才是 Edge Runtime），
  // atob() 在兩種環境都能用，繼續沿用不用改成 Buffer。
  let decoded: string;
  try {
    decoded = atob(authHeader.slice('Basic '.length));
  } catch {
    return unauthorized();
  }
  const separatorIndex = decoded.indexOf(':');
  const inputUser = separatorIndex >= 0 ? decoded.slice(0, separatorIndex) : decoded;
  const inputPassword = separatorIndex >= 0 ? decoded.slice(separatorIndex + 1) : '';

  // 帳號比對忽略大小寫、並且都先 trim 去除頭尾空白：
  // - iOS Safari 的 HTTP Basic Auth 帳號輸入框有個已知老問題，會自動把第一個字母變大寫，
  //   使用者常常沒注意到，導致明明打對密碼卻一直被打回去重新輸入。帳號本來就不是機密資訊
  //   （真正的機密是密碼），放寬大小寫比對不影響安全性。
  // - trim 是為了避免 .env 檔案編輯時不小心夾帶的頭尾空白字元造成比對失敗，這種情況很難用肉眼發現
  //   （只 trim .env 讀出來的值，不 trim 使用者實際輸入的內容，避免掩蓋使用者自己打錯的空白）。
  // 密碼比對維持大小寫敏感。
  const userMatches = inputUser.trim().toLowerCase() === user.trim().toLowerCase();
  const passwordMatches = inputPassword === password.trim();

  if (!userMatches || !passwordMatches) {
    return unauthorized();
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/admin/:path*',
    '/api/youtube-search/:path*',
    '/api/songs/:path*',
    '/api/artists/:path*',
    '/api/themes/:path*',
  ],
};
