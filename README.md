# AI議事録アプリ（ローカル版）

音声ファイルをローカルで処理してAI議事録を自動生成するデスクトップアプリです。  
**すべての処理が端末内で完結**するため、機密性の高い会議にも安心して使用できます。

## 技術スタック

| レイヤー | 技術 |
|---|---|
| デスクトップフレームワーク | [Tauri v2](https://tauri.app/) |
| フロントエンド | React + TypeScript + Tailwind CSS v4 |
| バックエンド | Rust + SQLite（rusqlite） |
| 文字起こし | [faster-whisper](https://github.com/SYSTRAN/faster-whisper)（Python） |
| 議事録生成 | [Ollama](https://ollama.ai/)（ローカルLLM） |

## 事前準備

### 1. Rustのインストール

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

### 2. faster-whisperのインストール

```bash
pip install faster-whisper
```

### 3. Ollamaのインストールとモデルのダウンロード

```bash
# macOS
brew install ollama

# または https://ollama.ai からダウンロード

# モデルのダウンロード（いずれか1つ）
ollama pull llama3.2          # 軽量・推奨（RAM 8GB以上）
ollama pull qwen2.5:7b        # 日本語特化（RAM 8GB以上）
ollama pull llama3.1:8b       # 高精度（RAM 16GB以上）
```

### 4. セットアップスクリプトの実行（任意）

```bash
# macOS / Linux
bash scripts/setup.sh

# Windows
scripts\setup.bat
```

## 開発環境のセットアップ

```bash
# 依存関係のインストール
pnpm install

# 開発サーバー起動（Ollamaを事前に起動しておくこと）
ollama serve &
pnpm tauri dev
```

## ビルド

```bash
# 本番ビルド（インストーラー生成）
pnpm tauri build
```

ビルド成果物は `src-tauri/target/release/bundle/` に生成されます。

## 使い方

1. **音声の取り込み**：音声ファイル（wav/mp3/m4a）を取り込むか、アプリ内で直接録音
2. **文字起こし**：faster-whisperでローカル処理（初回はモデルダウンロードが発生）
3. **テキスト編集**：文字起こし結果を確認・修正
4. **議事録生成**：Ollamaで議事録を自動生成（Markdown形式）
5. **音声管理**：議事録生成後、音声ファイルを削除または保持

## データの保存場所

| OS | パス |
|---|---|
| macOS | `~/Library/Application Support/minutes-app-local/` |
| Windows | `%APPDATA%\minutes-app-local\` |
| Linux | `~/.local/share/minutes-app-local/` |

## プライバシー

- 音声データ・文字起こし・議事録はすべてローカルに保存
- 外部サーバーへのデータ送信は一切行いません
- 議事録生成後は音声ファイルを削除することを推奨

## ライセンス

MIT
