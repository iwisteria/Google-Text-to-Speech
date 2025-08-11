# Google Text-to-Speech Webサービス セットアップガイド

## 前提条件
- Node.js 18以上がインストールされていること
- Google Cloudアカウントが作成済みであること

## Google Cloud設定

### 1. プロジェクトの作成
```bash
# Google Cloud CLIがインストールされている場合
gcloud projects create your-tts-project --name="TTS Project"
gcloud config set project your-tts-project
```

または [Google Cloud Console](https://console.cloud.google.com/) で新しいプロジェクトを作成してください。

### 2. Text-to-Speech APIの有効化
```bash
gcloud services enable texttospeech.googleapis.com
```

または Cloud Console の「APIとサービス」から「Text-to-Speech API」を検索して有効化してください。

### 3. サービスアカウントの作成
```bash
# サービスアカウント作成
gcloud iam service-accounts create tts-service-account \
    --display-name="Text-to-Speech Service Account"

# 権限付与
gcloud projects add-iam-policy-binding your-tts-project \
    --member="serviceAccount:tts-service-account@your-tts-project.iam.gserviceaccount.com" \
    --role="roles/cloudtts.user"

# 認証キーファイル作成
gcloud iam service-accounts keys create ./google-cloud-key.json \
    --iam-account=tts-service-account@your-tts-project.iam.gserviceaccount.com
```

### 4. 認証設定

以下のいずれかの方法で認証を設定してください：

#### 方法A: 環境変数での設定（推奨）
```bash
export GOOGLE_APPLICATION_CREDENTIALS="./google-cloud-key.json"
```

#### 方法B: .envファイルでの設定
```bash
# .envファイルを作成
echo "GOOGLE_APPLICATION_CREDENTIALS=./google-cloud-key.json" > .env
```

## ローカルでの実行

### 1. 依存関係のインストール
```bash
npm install
```

### 2. サーバーの起動
```bash
# 本番モード
npm start

# 開発モード（nodemon使用）
npm run dev
```

### 3. ブラウザでアクセス
http://localhost:3000 にアクセスしてください。

## 本番環境での設定

### 環境変数
- `PORT`: サーバーポート（デフォルト: 3000）
- `GOOGLE_APPLICATION_CREDENTIALS`: Google Cloud認証ファイルのパス
- `NODE_ENV`: 環境設定（production/development）

### セキュリティ考慮事項
- 本番環境では HTTPS を使用してください
- API レート制限を設定してください
- 認証ファイルは適切に保護してください

## トラブルシューティング

### よくあるエラー

#### 1. "7 PERMISSION_DENIED" エラー
- Google Cloud APIが有効化されていない
- サービスアカウントの権限が不足している
- 認証ファイルのパスが間違っている

```bash
# APIの確認
gcloud services list --enabled

# 権限の確認
gcloud projects get-iam-policy your-tts-project
```

#### 2. "3 INVALID_ARGUMENT" エラー
- 音声設定が無効（対応していない音声名など）
- テキストが長すぎる

#### 3. "8 RESOURCE_EXHAUSTED" エラー
- API制限に達している
- 請求が有効になっていない

### デバッグ方法
```bash
# 詳細なログを表示
NODE_ENV=development npm start

# Google Cloud CLIでテスト
gcloud auth application-default print-access-token
```

## 料金について

Google Cloud Text-to-Speech APIの料金：
- Standard音声: 1,000,000文字あたり $4.00
- WaveNet音声: 1,000,000文字あたり $16.00
- Neural2音声: 1,000,000文字あたり $16.00

毎月4,000,000文字までは無料です。

詳細: https://cloud.google.com/text-to-speech/pricing

## サポート

問題が発生した場合：
1. このドキュメントのトラブルシューティングセクションを確認
2. サーバーログを確認
3. Google Cloud Console でプロジェクト設定を確認