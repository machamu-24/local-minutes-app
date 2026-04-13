# ローカル AI 議事録作成アプリ

医療現場など個人情報保護が厳しい環境向けに、**完全ローカルで動作する**議事録作成アプリです。
すべての処理が `localhost` 内で完結し、外部サーバーへの通信は一切行いません。

## 機能概要

| 機能 | 説明 |
|------|------|
| 音声取り込み | wav / mp3 / m4a / webm / ogg / mp4 の取り込みと、その場録音に対応 |
| 文字起こし | faster-whisper（CPU / int8量子化）でローカル実行 |
| テキスト編集 | 文字起こし結果をブラウザ上で修正・保存 |
| 議事録生成 | Ollama（llama3 / mistral）で分割要約 → 統合要約の2段階処理 |
| テンプレート選択 | 汎用 / 決定事項重視 / アクション重視の議事録テンプレートを選択可能 |
| カスタム指示 | 要約前に今回だけの追加指示を入力可能、使用した指示文面は議事録に保存 |
| Markdown 出力 | 議事録のコピー・.md ファイルダウンロード |
| 音声削除管理 | 個人情報保護のための音声ファイル削除フロー |

## アーキテクチャ

```
React UI（Tauri でラップ）
    ↓ HTTP（localhost のみ）
FastAPI（localhost:8000）
    ↓
SQLite（~/.local-minutes/minutes.db）/ ローカルファイルシステム
    ↓
faster-whisper / Ollama（localhost:11434）
```

## Windows 配布方針

Windows で**他の PC に配布して使わせる**用途では、当面は `Tauri + NSIS` のインストーラ配布よりも、
**バックエンド EXE + ブラウザ UI の portable ZIP 配布**を推奨します。

理由:

- Tauri / NSIS インストーラ
- sidecar 起動
- `llama-server` 同梱
- Visual C++ ランタイム

の失敗要因が重なるため、他 PC での初回起動失敗率が高くなりやすいためです。

portable 配布では、Windows 標準ブラウザを UI として使い、`http://127.0.0.1:8000` を開きます。
これにより **インストーラ依存と Tauri 起動失敗をいったん切り離せます**。

## 必要な環境

- **macOS** 12 以上（GPU なし対応）
- **Python** 3.9 以上（3.11+ 推奨）
- **Node.js** 18 以上（pnpm 推奨）
- **ffmpeg**（音声変換）
- **Ollama**（ローカル LLM）
- **Rust**（Tauri ビルド時のみ）

---

## セットアップ手順（macOS）

### 1. Homebrew のインストール（未インストールの場合）

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

### 2. ffmpeg のインストール

```bash
brew install ffmpeg
```

インストール確認:

```bash
ffmpeg -version
```

### 3. Ollama のインストール

```bash
brew install ollama
```

または [https://ollama.com](https://ollama.com) からダウンロード。

### 4. Ollama モデルのダウンロード

```bash
# llama3（推奨）
ollama pull llama3

# または mistral
ollama pull mistral
```

> **注意**: モデルのダウンロードには数GB のディスク容量と時間が必要です。

### 5. リポジトリのクローン

```bash
git clone <repository-url>
cd local-minutes-app
```

### 6. バックエンド依存関係のインストール

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cd ..
```

> **注意**: `faster-whisper` の初回起動時に Whisper モデル（約1.5GB）がダウンロードされます。

### 7. フロントエンド依存関係のインストール

```bash
cd frontend
pnpm install
cd ..
```

---

## 起動方法

### 方法 A: バックエンドのみ起動

```bash
./start.sh
```

Ollama と FastAPI バックエンドを起動します。ブラウザ開発なら別ターミナルで `cd frontend && pnpm dev`、Tauri 開発なら別ターミナルで `pnpm tauri dev` を実行してください。

### 方法 B: Tauri デスクトップアプリを一括起動（推奨）

```bash
./start-tauri.sh
```

または:

```bash
pnpm desktop:dev
```

この方法では、必要なら Ollama とバックエンドを自動で起動したうえで、Tauri 開発アプリまでまとめて立ち上げます。

### 方法 C: 手動起動

**ターミナル 1: Ollama を起動**

```bash
ollama serve
```

**ターミナル 2: バックエンドを起動**

```bash
cd local-minutes-app
source backend/.venv/bin/activate
python3 -m uvicorn backend.main:app --host 127.0.0.1 --port 8000 --reload
```

**ターミナル 3: フロントエンドを起動（開発モード）**

```bash
cd frontend
pnpm dev
```

ブラウザで `http://localhost:1420` を開く。

### 方法 D: バックエンド起動済みの状態で Tauri を起動

```bash
# Rust のインストール（未インストールの場合）
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Tauri CLI のインストール
pnpm add -D @tauri-apps/cli

# 開発モードで起動
pnpm tauri dev

# プロダクションビルド
pnpm tauri build
```

### 方法 E: Windows 向け portable ZIP を作る

前提:

- Windows で `scripts/build_backend.py` により backend EXE を作成済み
- `frontend/dist` をビルド済み
- 配布先 PC では Ollama を別途インストールして使う

portable パッケージ作成:

```bash
python scripts/package_portable.py \
  --backend-path src-tauri/binaries/local-minutes-backend-x86_64-pc-windows-msvc.exe \
  --frontend-dist frontend/dist \
  --output-dir dist/portable-windows \
  --archive \
  --force
```

生成物:

- `dist/portable-windows/`
- `dist/portable-windows.zip`

配布先 PC では `start-local-minutes.bat` を実行してください。
ブラウザで `http://127.0.0.1:18000` が開きます。

配布先 PC の Ollama モデルは、16GB クラスのメモリならまず `qwen3:4b` を推奨します。
余裕がある PC では `qwen3:8b` も候補です。

portable 版はローカル既存サービスとの衝突を避けるため、`8000` ではなく `18000` を使います。

GitHub Actions を使う場合は `.github/workflows/windows-portable-build.yml` を実行すると、
portable ZIP の artifact を作成できます。

---

## API ドキュメント

バックエンド起動後、以下の URL で Swagger UI を確認できます:

- **Swagger UI**: http://127.0.0.1:8000/docs
- **ReDoc**: http://127.0.0.1:8000/redoc

---

## データ保存場所

| データ | パス |
|--------|------|
| データベース | `~/.local-minutes/minutes.db` |
| 音声ファイル | `~/.local-minutes/audio/` |

---

## 使い方

### 1. 音声ファイルの取り込み / その場録音

1. 画面右上の「新規取り込み」ボタンをクリック
2. 音声ファイル（wav / mp3 / m4a / webm / ogg / mp4）を選択
3. 会議名と会議日を入力して「取り込む」

または:

1. 画面右上の「その場で録音」ボタンをクリック
2. マイクアクセスを許可して録音を開始
3. 録音停止後に会議名と会議日を確認して保存

### 2. 文字起こし

1. 録音一覧から対象をクリック
2. 「文字起こしを開始する」ボタンをクリック
3. 処理完了まで待機（10〜15分の音声で数分〜10分程度）

### 3. テキスト編集（任意）

- 文字起こし結果をテキストエリアで修正
- 「保存」ボタンで保存（修正済みテキストが要約に使用されます）

### 4. 議事録生成

1. 要約前画面で議事録テンプレートを選択
2. 必要に応じて今回だけの追加指示を入力
3. 「議事録を生成する」ボタンをクリック
4. Ollama による処理完了まで待機

### 5. 議事録の確認・保存

- **プレビュー**: Markdown レンダリングで確認
- **コピー**: クリップボードにコピー
- **.md 保存**: Markdown ファイルとしてダウンロード

### 6. 音声ファイルの管理

議事録生成完了後、音声ファイルの取り扱いを選択:

- **削除する**（推奨）: 個人情報保護のため即時削除
- **残す**: 保持を記録
- **後で決める**: 後から「音声管理」タブで決定

---

## トラブルシューティング

### 他PC配布版で起動はするが機能が動かない（バックエンド接続エラー）

Windows 配布時は、`Actions` の artifact を展開したあと **`bundle/nsis` 配下のインストーラー `.exe` を実行してインストール** してください。  
`app.exe` を zip 展開先から直接起動すると、環境によって sidecar（バックエンド / llama-server）が正しく解決されない場合があります。

初回起動で `Runtime Setup` 画面が表示された場合は、そのままセットアップを完了してください（特に GGUF モデル配置）。  
sidecar が同梱されていても、モデル未配置の状態では実処理を開始できません。

### バックエンドに接続できない

```bash
# バックエンドが起動しているか確認
curl http://127.0.0.1:8000/api/health
```

### Ollama に接続できない

```bash
# Ollama の起動確認
curl http://localhost:11434/api/tags

# Ollama を起動
ollama serve
```

### 文字起こしが遅い

- CPU のみの処理のため、10〜15分の音声で5〜15分程度かかります
- `medium` モデル + `int8` 量子化で最適化済みです

### ffmpeg が見つからない

```bash
brew install ffmpeg
```

### その場録音でマイクが使えない

- macOS の「システム設定 > プライバシーとセキュリティ > マイク」でターミナルまたはアプリの許可状態を確認してください
- Tauri ビルド版では初回起動時にマイク利用の許可ダイアログが表示されます

---

## ディレクトリ構成

```
local-minutes-app/
├── backend/
│   ├── main.py              # FastAPI エントリーポイント
│   ├── database.py          # SQLAlchemy セットアップ
│   ├── models.py            # ORM モデル定義
│   ├── schemas.py           # Pydantic スキーマ
│   ├── routers/
│   │   ├── recordings.py    # 録音関連エンドポイント
│   │   ├── transcripts.py   # 文字起こし関連エンドポイント
│   │   ├── summaries.py     # 要約関連エンドポイント
│   │   └── jobs.py          # ジョブ状態ポーリング
│   ├── services/
│   │   ├── audio.py         # ffmpeg 前処理
│   │   ├── transcription.py # faster-whisper ラッパー
│   │   └── summarization.py # Ollama ラッパー（分割要約 → 統合要約）
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── App.tsx
│   │   ├── pages/
│   │   │   ├── RecordingList.tsx    # 録音一覧画面
│   │   │   └── RecordingDetail.tsx  # 詳細画面
│   │   ├── components/
│   │   │   ├── TranscriptEditor.tsx
│   │   │   ├── SummaryViewer.tsx
│   │   │   └── AudioDeleteDialog.tsx
│   │   └── api/
│   │       └── client.ts    # axios ラッパー
│   └── package.json
├── src-tauri/
│   └── tauri.conf.json      # Tauri 設定
├── start.sh                 # 起動スクリプト
└── README.md
```

---

## セキュリティ

- FastAPI は `127.0.0.1` のみでリッスン（外部アクセス不可）
- すべての処理がローカルで完結（外部 API 通信なし）
- 音声ファイルはアプリ専用ディレクトリ（`~/.local-minutes/`）に隔離

---

## 将来の拡張予定（MVP 未実装）

- 話者分離（pyannote.audio）
- 医療用語辞書による文字起こし補正
- 議事録の全文検索
- 追加テンプレート（カンファレンス、申し送り等）
- 院内 LAN でのオンプレ共有
- 権限管理・監査ログ

---

## ライセンス

MIT License
