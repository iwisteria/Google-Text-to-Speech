const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const bcrypt = require('bcrypt');

// 認証・認可ミドルウェア
class AuthMiddleware {
    constructor(options = {}) {
        this.jwtSecret = options.jwtSecret || process.env.JWT_SECRET || crypto.randomBytes(64).toString('hex');
        this.sessionTimeout = options.sessionTimeout || 24 * 60 * 60 * 1000; // 24時間
        this.maxLoginAttempts = options.maxLoginAttempts || 5;
        this.lockoutTime = options.lockoutTime || 15 * 60 * 1000; // 15分
        
        // インメモリストレージ（本番環境ではRedisを使用）
        this.loginAttempts = new Map();
        this.activeSessions = new Map();
    }

    // JWTトークンの生成
    generateToken(payload) {
        return jwt.sign(payload, this.jwtSecret, {
            expiresIn: '24h',
            issuer: 'tts-app',
            audience: 'tts-client'
        });
    }

    // JWTトークンの検証
    verifyToken(token) {
        try {
            return jwt.verify(token, this.jwtSecret, {
                issuer: 'tts-app',
                audience: 'tts-client'
            });
        } catch (error) {
            throw new Error('無効なトークンです');
        }
    }

    // ログイン試行回数の管理
    checkLoginAttempts(identifier) {
        const attempts = this.loginAttempts.get(identifier);
        if (!attempts) return true;

        if (attempts.count >= this.maxLoginAttempts) {
            const lockoutExpiry = attempts.lastAttempt + this.lockoutTime;
            if (Date.now() < lockoutExpiry) {
                const remainingTime = Math.ceil((lockoutExpiry - Date.now()) / 1000 / 60);
                throw new Error(`アカウントがロックされています。${remainingTime}分後に再試行してください。`);
            } else {
                // ロックアウト期間終了
                this.loginAttempts.delete(identifier);
                return true;
            }
        }
        return true;
    }

    // ログイン失敗の記録
    recordFailedLogin(identifier) {
        const attempts = this.loginAttempts.get(identifier) || { count: 0, lastAttempt: 0 };
        attempts.count += 1;
        attempts.lastAttempt = Date.now();
        this.loginAttempts.set(identifier, attempts);
    }

    // ログイン成功の記録
    recordSuccessfulLogin(identifier) {
        this.loginAttempts.delete(identifier);
    }

    // セッション管理
    createSession(userId, metadata = {}) {
        const sessionId = crypto.randomBytes(32).toString('hex');
        const session = {
            userId,
            sessionId,
            createdAt: Date.now(),
            lastActivity: Date.now(),
            metadata,
            isActive: true
        };
        
        this.activeSessions.set(sessionId, session);
        return sessionId;
    }

    // セッション検証
    validateSession(sessionId) {
        const session = this.activeSessions.get(sessionId);
        if (!session || !session.isActive) {
            throw new Error('セッションが無効です');
        }

        // セッションタイムアウトチェック
        if (Date.now() - session.lastActivity > this.sessionTimeout) {
            this.revokeSession(sessionId);
            throw new Error('セッションが期限切れです');
        }

        // 最終活動時間を更新
        session.lastActivity = Date.now();
        this.activeSessions.set(sessionId, session);
        
        return session;
    }

    // セッション無効化
    revokeSession(sessionId) {
        this.activeSessions.delete(sessionId);
    }

    // 認証ミドルウェア（JWT）
    authenticateToken() {
        return (req, res, next) => {
            const authHeader = req.headers['authorization'];
            const token = authHeader && authHeader.split(' ')[1];

            if (!token) {
                return res.status(401).json({ 
                    error: 'アクセストークンが必要です',
                    code: 'MISSING_TOKEN'
                });
            }

            try {
                const decoded = this.verifyToken(token);
                req.user = decoded;
                next();
            } catch (error) {
                return res.status(403).json({ 
                    error: '無効なアクセストークンです',
                    code: 'INVALID_TOKEN'
                });
            }
        };
    }

    // セッション認証ミドルウェア
    authenticateSession() {
        return (req, res, next) => {
            const sessionId = req.headers['x-session-id'] || req.cookies?.sessionId;

            if (!sessionId) {
                return res.status(401).json({ 
                    error: 'セッションIDが必要です',
                    code: 'MISSING_SESSION'
                });
            }

            try {
                const session = this.validateSession(sessionId);
                req.session = session;
                req.user = { userId: session.userId };
                next();
            } catch (error) {
                return res.status(403).json({ 
                    error: error.message,
                    code: 'INVALID_SESSION'
                });
            }
        };
    }

    // 管理者権限チェック
    requireAdmin() {
        return (req, res, next) => {
            if (!req.user || !req.user.isAdmin) {
                return res.status(403).json({ 
                    error: '管理者権限が必要です',
                    code: 'INSUFFICIENT_PRIVILEGES'
                });
            }
            next();
        };
    }

    // APIキー認証（シンプルな実装）
    authenticateApiKey() {
        return (req, res, next) => {
            const apiKey = req.headers['x-api-key'];
            const validApiKeys = process.env.VALID_API_KEYS?.split(',') || [];

            if (!apiKey || !validApiKeys.includes(apiKey)) {
                return res.status(401).json({ 
                    error: '無効なAPIキーです',
                    code: 'INVALID_API_KEY'
                });
            }

            req.apiKeyAuth = true;
            next();
        };
    }
}

// 使用量追跡とクォータ管理
class UsageTracker {
    constructor() {
        this.usage = new Map(); // 本番環境ではRedisまたはデータベースを使用
        this.quotas = {
            free: { requestsPerHour: 100, charactersPerDay: 10000 },
            premium: { requestsPerHour: 1000, charactersPerDay: 100000 }
        };
    }

    // 使用量の記録
    recordUsage(userId, characters = 0) {
        const now = Date.now();
        const hourKey = Math.floor(now / (60 * 60 * 1000));
        const dayKey = Math.floor(now / (24 * 60 * 60 * 1000));
        
        if (!this.usage.has(userId)) {
            this.usage.set(userId, {
                requests: new Map(),
                characters: new Map()
            });
        }
        
        const userUsage = this.usage.get(userId);
        
        // リクエスト数の記録
        userUsage.requests.set(hourKey, (userUsage.requests.get(hourKey) || 0) + 1);
        
        // 文字数の記録
        userUsage.characters.set(dayKey, (userUsage.characters.get(dayKey) || 0) + characters);
        
        // 古いデータの削除
        this.cleanupOldUsage(userUsage);
    }

    // クォータチェック
    checkQuota(userId, userTier = 'free', characters = 0) {
        const quota = this.quotas[userTier] || this.quotas.free;
        const now = Date.now();
        const hourKey = Math.floor(now / (60 * 60 * 1000));
        const dayKey = Math.floor(now / (24 * 60 * 60 * 1000));
        
        if (!this.usage.has(userId)) {
            return { allowed: true };
        }
        
        const userUsage = this.usage.get(userId);
        const hourlyRequests = userUsage.requests.get(hourKey) || 0;
        const dailyCharacters = userUsage.characters.get(dayKey) || 0;
        
        if (hourlyRequests >= quota.requestsPerHour) {
            return {
                allowed: false,
                reason: 'hourly_request_limit',
                message: '1時間あたりのリクエスト制限に達しました'
            };
        }
        
        if (dailyCharacters + characters > quota.charactersPerDay) {
            return {
                allowed: false,
                reason: 'daily_character_limit',
                message: '1日あたりの文字数制限に達しました'
            };
        }
        
        return { allowed: true };
    }

    // 古い使用量データの削除
    cleanupOldUsage(userUsage) {
        const now = Date.now();
        const cutoffHour = Math.floor(now / (60 * 60 * 1000)) - 24; // 24時間前
        const cutoffDay = Math.floor(now / (24 * 60 * 60 * 1000)) - 30; // 30日前
        
        // 古いリクエストデータを削除
        for (const [hourKey] of userUsage.requests) {
            if (hourKey < cutoffHour) {
                userUsage.requests.delete(hourKey);
            }
        }
        
        // 古い文字数データを削除
        for (const [dayKey] of userUsage.characters) {
            if (dayKey < cutoffDay) {
                userUsage.characters.delete(dayKey);
            }
        }
    }

    // 使用量追跡ミドルウェア
    trackUsage() {
        return (req, res, next) => {
            const originalSend = res.send;
            const self = this;
            
            res.send = function(body) {
                // レスポンス成功時に使用量を記録
                if (res.statusCode < 400 && req.user) {
                    const characters = req.body?.text?.length || 0;
                    self.recordUsage(req.user.userId, characters);
                }
                
                return originalSend.call(this, body);
            };
            
            next();
        };
    }

    // クォータチェックミドルウェア
    checkQuotaMiddleware(tierResolver) {
        return (req, res, next) => {
            if (!req.user) {
                return next(); // 認証されていない場合はスキップ
            }
            
            const userTier = tierResolver ? tierResolver(req.user) : 'free';
            const characters = req.body?.text?.length || 0;
            const quotaCheck = this.checkQuota(req.user.userId, userTier, characters);
            
            if (!quotaCheck.allowed) {
                return res.status(429).json({
                    error: quotaCheck.message,
                    code: quotaCheck.reason
                });
            }
            
            next();
        };
    }
}

module.exports = { AuthMiddleware, UsageTracker };