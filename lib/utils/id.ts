/**
 * 產生一組近似 UUID 的識別碼。
 * crypto.randomUUID() 只在「安全內容」（HTTPS 或 localhost）下才存在，
 * 透過區網 IP 或非 https 的自訂網域（例如 musicguess.local，只有 http 沒有 https）存取時，
 * 瀏覽器會直接不提供這個方法，呼叫會噴「crypto.randomUUID is not a function」。
 * 這裡在不可用時退回 Math.random() 拼湊的版本，格式不是嚴格合法的 UUID v4，
 * 但用途只是本地端識別碼、不需要密碼學等級的隨機性，堪用即可。
 */
export function generateId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  const rand = () => Math.random().toString(16).slice(2).padEnd(8, '0').slice(0, 8);
  return `${rand()}-${rand().slice(0, 4)}-${rand().slice(0, 4)}-${rand().slice(0, 4)}-${rand()}${rand().slice(0, 4)}`;
}
