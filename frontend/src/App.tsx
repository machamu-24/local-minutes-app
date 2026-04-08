/**
 * App.tsx
 * アプリケーションのルーティング設定。
 * React Router を使用して画面遷移を管理する。
 */

import { useEffect, useState } from "react";
import { BrowserRouter, Routes, Route, Navigate, useLocation, useNavigate } from "react-router-dom";
import RecordingList from "./pages/RecordingList";
import RecordingDetail from "./pages/RecordingDetail";
import RuntimeSetup from "./pages/RuntimeSetup";
import { getRuntimeStatus, isTauriRuntime } from "./lib/tauriRuntimeSetup";
import { healthCheck } from "./api/client";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function AppRoutes() {
  const location = useLocation();
  const navigate = useNavigate();
  const [bootstrapping, setBootstrapping] = useState(isTauriRuntime());

  useEffect(() => {
    if (!isTauriRuntime() || location.pathname === "/setup") {
      setBootstrapping(false);
      return;
    }

    let active = true;
    (async () => {
      try {
        const status = await getRuntimeStatus();
        if (!active) return;

        if (status.managedRuntimeEnabled && !status.runtimeReady) {
          navigate("/setup", { replace: true });
          return;
        }

        if (status.managedRuntimeEnabled) {
          let backendReady = false;
          for (let attempt = 0; attempt < 45; attempt += 1) {
            try {
              await healthCheck();
              backendReady = true;
              break;
            } catch {
              await wait(1000);
            }
          }

          // If sidecar startup failed on another machine, force the user into
          // runtime setup instead of showing repeated backend connection errors.
          if (!backendReady) {
            navigate("/setup", { replace: true });
            return;
          }
        }
      } catch {
        // runtime status が取れない場合は既存画面に残し、各画面側のエラーハンドリングへ任せる
      } finally {
        if (active) {
          setBootstrapping(false);
        }
      }
    })()
      .catch(() => {
        if (active) {
          setBootstrapping(false);
        }
      });

    return () => {
      active = false;
    };
  }, [location.pathname, navigate]);

  if (bootstrapping) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center px-6">
        <div className="max-w-md text-center">
          <div className="w-10 h-10 mx-auto rounded-full border-4 border-gray-200 border-t-primary-600 animate-spin" />
          <h1 className="mt-6 text-lg font-semibold text-gray-900">起動準備中</h1>
          <p className="mt-2 text-sm text-gray-600 leading-6">
            バックエンドとローカル AI ランタイムの起動を待っています。初回起動時は Windows の
            セキュリティスキャンで少し時間がかかることがあります。
          </p>
        </div>
      </div>
    );
  }

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
