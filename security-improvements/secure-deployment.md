# セキュアなデプロイメントガイド

## 環境変数設定

### 本番環境用 .env ファイル
```bash
# Node.js環境設定
NODE_ENV=production
PORT=3000

# セキュリティ設定
JWT_SECRET=your-very-strong-jwt-secret-key-here-64-characters-minimum
SESSION_SECRET=your-session-secret-key-here
CSRF_SECRET=your-csrf-secret-key-here

# Google Cloud設定
GOOGLE_APPLICATION_CREDENTIALS=/path/to/secure/service-account-key.json
GOOGLE_CLOUD_PROJECT_ID=your-project-id

# データベース設定（Redis）
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=your-redis-password
REDIS_TLS_ENABLED=true

# レート制限設定
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100

# ログ設定
LOG_LEVEL=error
LOG_FILE=/var/log/tts-app/app.log

# SSL/TLS設定
SSL_CERT_PATH=/path/to/ssl/cert.pem
SSL_KEY_PATH=/path/to/ssl/private-key.pem

# CORS設定
ALLOWED_ORIGINS=https://yourdomain.com,https://www.yourdomain.com

# IP制限設定
IP_WHITELIST=192.168.1.0/24,10.0.0.0/8
IP_BLACKLIST=

# モニタリング設定
HEALTH_CHECK_TOKEN=your-health-check-token
METRICS_ENABLED=true
```

## Dockerセキュリティ設定

### Dockerfile（セキュリティ強化版）
```dockerfile
# セキュアなベースイメージを使用
FROM node:18-alpine3.18

# セキュリティ更新の適用
RUN apk update && apk upgrade && apk add --no-cache dumb-init

# 非特権ユーザーの作成
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nextjs -u 1001 -G nodejs

# アプリケーションディレクトリの作成
WORKDIR /app

# パッケージファイルのコピーと依存関係のインストール
COPY package*.json ./
RUN npm ci --only=production && npm cache clean --force

# アプリケーションファイルのコピー
COPY --chown=nextjs:nodejs . .

# 機密ファイルの除去
RUN rm -rf .git .env.example *.md docs/

# ファイル権限の設定
RUN chmod -R 755 /app && \
    chmod -R 644 /app/*.js && \
    chmod +x /app/server.js

# 非特権ユーザーに切り替え
USER nextjs

# セキュリティヘッダーの設定
EXPOSE 3000

# ヘルスチェックの設定
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3000/api/health || exit 1

# dumb-initを使用してプロセス管理
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "server.js"]
```

### docker-compose.yml（セキュリティ設定付き）
```yaml
version: '3.8'

services:
  tts-app:
    build: .
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
    env_file:
      - .env
    volumes:
      - ./logs:/app/logs:rw
      - /etc/ssl/certs:/etc/ssl/certs:ro
    networks:
      - tts-network
    restart: unless-stopped
    security_opt:
      - no-new-privileges:true
    cap_drop:
      - ALL
    cap_add:
      - CHOWN
      - SETUID
      - SETGID
    read_only: true
    tmpfs:
      - /tmp
      - /app/logs
    ulimits:
      nproc: 65535
      nofile:
        soft: 20000
        hard: 40000

  redis:
    image: redis:7-alpine
    command: redis-server --requirepass ${REDIS_PASSWORD}
    volumes:
      - redis-data:/data
    networks:
      - tts-network
    restart: unless-stopped
    security_opt:
      - no-new-privileges:true

  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf:ro
      - /etc/letsencrypt:/etc/letsencrypt:ro
    networks:
      - tts-network
    restart: unless-stopped
    depends_on:
      - tts-app

volumes:
  redis-data:

networks:
  tts-network:
    driver: bridge
```

## Nginx設定（リバースプロキシ）

### nginx.conf（セキュリティ強化版）
```nginx
events {
    worker_connections 1024;
}

http {
    # セキュリティヘッダー
    add_header X-Frame-Options DENY always;
    add_header X-Content-Type-Options nosniff always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header Content-Security-Policy "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self'; font-src 'self'; object-src 'none'; media-src 'self' blob:; worker-src 'self' blob:; child-src 'none'; frame-src 'none'; form-action 'self'; upgrade-insecure-requests;" always;
    
    # セキュリティ設定
    server_tokens off;
    client_max_body_size 10M;
    client_body_timeout 30s;
    client_header_timeout 30s;
    keepalive_timeout 30s;
    send_timeout 30s;
    
    # レート制限
    limit_req_zone $binary_remote_addr zone=api:10m rate=10r/m;
    limit_req_zone $binary_remote_addr zone=general:10m rate=30r/m;
    
    # ログ設定
    access_log /var/log/nginx/access.log;
    error_log /var/log/nginx/error.log warn;
    
    # HTTP -> HTTPS リダイレクト
    server {
        listen 80;
        server_name yourdomain.com www.yourdomain.com;
        return 301 https://$server_name$request_uri;
    }
    
    # HTTPS設定
    server {
        listen 443 ssl http2;
        server_name yourdomain.com www.yourdomain.com;
        
        # SSL証明書
        ssl_certificate /etc/letsencrypt/live/yourdomain.com/fullchain.pem;
        ssl_certificate_key /etc/letsencrypt/live/yourdomain.com/privkey.pem;
        
        # SSL設定
        ssl_protocols TLSv1.2 TLSv1.3;
        ssl_ciphers ECDHE-RSA-AES256-GCM-SHA512:DHE-RSA-AES256-GCM-SHA512:ECDHE-RSA-AES256-GCM-SHA384:DHE-RSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-SHA384;
        ssl_prefer_server_ciphers off;
        ssl_session_cache shared:SSL:10m;
        ssl_session_timeout 10m;
        ssl_stapling on;
        ssl_stapling_verify on;
        
        # HSTSヘッダー
        add_header Strict-Transport-Security "max-age=31536000; includeSubDomains; preload" always;
        
        # 静的ファイル
        location ~* \.(css|js|png|jpg|jpeg|gif|ico|svg)$ {
            expires 1y;
            add_header Cache-Control "public, immutable";
        }
        
        # API エンドポイント
        location /api/ {
            limit_req zone=api burst=5 nodelay;
            proxy_pass http://tts-app:3000;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
            proxy_connect_timeout 30s;
            proxy_send_timeout 30s;
            proxy_read_timeout 30s;
        }
        
        # メインアプリケーション
        location / {
            limit_req zone=general burst=10 nodelay;
            proxy_pass http://tts-app:3000;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
        }
        
        # 管理エンドポイントの制限
        location /admin {
            allow 192.168.1.0/24;
            deny all;
            proxy_pass http://tts-app:3000;
        }
        
        # セキュリティ関連ファイルの直接アクセス拒否
        location ~ /\.(env|git|svn) {
            deny all;
            return 404;
        }
    }
}
```

## SSL/TLS証明書の自動更新

### Let's Encrypt設定
```bash
#!/bin/bash
# ssl-renew.sh

# 証明書の更新
certbot renew --quiet --no-self-upgrade

# Nginxの再起動
if [ $? -eq 0 ]; then
    docker-compose exec nginx nginx -s reload
    echo "SSL certificate renewed successfully"
else
    echo "SSL certificate renewal failed"
    exit 1
fi
```

### Crontabエントリ
```bash
# SSL証明書の自動更新（毎月1日午前3時）
0 3 1 * * /path/to/ssl-renew.sh >> /var/log/ssl-renewal.log 2>&1
```

## モニタリングとログ設定

### ログ設定
```javascript
// logger.js
const winston = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file');

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: 'tts-app' },
  transports: [
    new DailyRotateFile({
      filename: 'logs/app-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      maxSize: '20m',
      maxFiles: '14d'
    }),
    new DailyRotateFile({
      filename: 'logs/error-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      level: 'error',
      maxSize: '20m',
      maxFiles: '30d'
    })
  ]
});

if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    format: winston.format.simple()
  }));
}

module.exports = logger;
```

## セキュリティチェックリスト

### デプロイ前チェック
- [ ] すべての環境変数が適切に設定されている
- [ ] セキュリティ監査 (`npm audit`) が完了している
- [ ] SSL/TLS証明書が有効である
- [ ] ファイアウォール設定が適切である
- [ ] バックアップ戦略が実装されている
- [ ] ログ監視が設定されている
- [ ] レート制限が適切に設定されている
- [ ] CORS設定が本番環境に適している
- [ ] セキュリティヘッダーが設定されている
- [ ] 機密情報がコードに含まれていない

### 定期メンテナンス
- [ ] 依存関係の更新
- [ ] セキュリティパッチの適用
- [ ] ログの監視と分析
- [ ] バックアップの検証
- [ ] SSL証明書の有効期限確認
- [ ] パフォーマンス監視
- [ ] 侵入検知システムの確認

### インシデント対応準備
- [ ] セキュリティインシデント対応計画の策定
- [ ] 緊急連絡先リストの作成
- [ ] バックアップからの復旧手順の文書化
- [ ] ログ分析ツールの準備
- [ ] フォレンジック調査の準備