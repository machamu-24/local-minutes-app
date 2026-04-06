/**
 * App.tsx
 * アプリケーションのルーティング設定。
 * React Router を使用して画面遷移を管理する。
 */

import { useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate, useLocation, useNavigate } from "react-router-dom";
import RecordingList from "./pages/RecordingList";
import RecordingDetail from "./pages/RecordingDetail";
import RuntimeSetup from "./pages/RuntimeSetup";
import { getRuntimeStatus, isTauriRuntime } from "./lib/tauriRuntimeSetup";

function AppRoutes() {
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    if (!isTauriRuntime() || location.pathname === "/setup") {
      return;
    }

    let active = true;
    getRuntimeStatus()
      .then((status) => {
        if (!active) return;
        if (status.managedRuntimeEnabled && !status.runtimeReady) {
          navigate("/setup", { replace: true });
        }
      })
      .catch(() => {
        // runtime status が取れない場合は既存画面に残し、各画面側のエラーハンドリングへ任せる
      });

    return () => {
      active = false;
    };
  }, [location.pathname, navigate]);

  return (
    <Routes>
      {/* 録音一覧画面（ホーム） */}
      <Route path="/" element={<RecordingList />} />

      {/* 録音詳細画面 */}
      <Route path="/recordings/:id" element={<RecordingDetail />} />

      {/* 初回セットアップ画面 */}
      <Route path="/setup" element={<RuntimeSetup />} />

      {/* 未知のパスはホームにリダイレクト */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function App() {
  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  );
}

export default App;
