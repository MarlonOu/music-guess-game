import { StatusScreen, HomeLink } from '../components/layout/StatusScreen';

export default function NotFound() {
  return (
    <StatusScreen label="404" title="找不到這一軌" message="網址可能打錯了，或這個頁面已經不存在。">
      <HomeLink primary />
    </StatusScreen>
  );
}
