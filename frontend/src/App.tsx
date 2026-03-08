/**
 * App.tsx
 * アプリケーションのルーティング設定。
 * React Router を使用して画面遷移を管理する。
 */

import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import RecordingList from "./pages/RecordingList";
import RecordingDetail from "./pages/RecordingDetail";

function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* 録音一覧画面（ホーム） */}
        <Route path="/" element={<RecordingList />} />

        {/* 録音詳細画面 */}
        <Route path="/recordings/:id" element={<RecordingDetail />} />

        {/* 未知のパスはホームにリダイレクト */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
