const crypto = require('crypto');
const validator = require('validator');
const DOMPurify = require('isomorphic-dompurify');

// セキュリティユーティリティクラス
class SecurityUtils {
    constructor() {
        this.csrfTokens = new Map(); // 本番環境ではRedisを使用
        this.tokenExpiry = 60 * 60 * 1000; // 1時間
    }

    // XSS防御: HTMLエスケープ
    escapeHtml(text) {
        if (typeof text !== 'string') return text;
        
        const map = {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#039;'
        };
        
        return text.replace(/[&<>"']/g, (m) => map[m]);
    }

    // XSS防御: HTMLサニタイゼーション（DOMPurify使用）
    sanitizeHtml(html) {
        return DOMPurify.sanitize(html, {
            ALLOWED_TAGS: [], // HTMLタグを全て除去
            ALLOWED_ATTR: [],
            KEEP_CONTENT: true
        });
    }

    // 入力値の包括的なサニタイゼーション
    sanitizeInput(input, type = 'text') {
        if (input === null || input === undefined) return '';
        
        let sanitized = String(input).trim();
        
        switch (type) {
            case 'text':
                sanitized = this.sanitizeHtml(sanitized);
                // 制御文字を除去
                sanitized = sanitized.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
                break;
                
            case 'email':
                sanitized = validator.normalizeEmail(sanitized) || '';
                break;
                
            case 'url':
                if (!validator.isURL(sanitized, { protocols: ['http', 'https'] })) {
                    sanitized = '';
                }
                break;
                
            case 'number':
                sanitized = validator.isNumeric(sanitized) ? sanitized : '';
                break;
                
            case 'alphanumeric':
                sanitized = validator.isAlphanumeric(sanitized) ? sanitized : '';
                break;
        }
        
        return sanitized;
    }

    // CSRF トークンの生成
    generateCSRFToken(sessionId) {
        const token = crypto.randomBytes(32).toString('hex');
        const expiry = Date.now() + this.tokenExpiry;
        
        this.csrfTokens.set(token, {
            sessionId,
            expiry,
            used: false
        });
        
        // 期限切れトークンのクリーンアップ
        this.cleanupExpiredTokens();
        
        return token;
    }

    // CSRF トークンの検証
    validateCSRFToken(token, sessionId) {
        const tokenData = this.csrfTokens.get(token);
        
        if (!tokenData) {
            throw new Error('無効なCSRFトークンです');
        }
        
        if (tokenData.used) {
            this.csrfTokens.delete(token);
            throw new Error('CSRFトークンは既に使用されています');
        }
        
        if (Date.now() > tokenData.expiry) {
            this.csrfTokens.delete(token);
            throw new Error('CSRFトークンが期限切れです');
        }
        
        if (tokenData.sessionId !== sessionId) {
            throw new Error('CSRFトークンのセッションが一致しません');
        }
        
        // ワンタイムトークンとしてマーク
        tokenData.used = true;
        this.csrfTokens.set(token, tokenData);
        
        return true;
    }

    // 期限切れトークンのクリーンアップ
    cleanupExpiredTokens() {
        const now = Date.now();
        for (const [token, data] of this.csrfTokens.entries()) {
            if (now > data.expiry || data.used) {
                this.csrfTokens.delete(token);
            }
        }
    }

    // SQL インジェクション対策のパラメータサニタイゼーション
    sanitizeForDatabase(input) {
        if (typeof input !== 'string') return input;
        
        // SQLインジェクション攻撃でよく使用される文字をエスケープ
        return input
            .replace(/'/g, "''")
            .replace(/;/g, '\\;')
            .replace(/--/g, '\\--')
            .replace(/\/\*/g, '\\/\\*')
            .replace(/\*\//g, '\\*\\/');
    }

    // パスワード強度チェック
    checkPasswordStrength(password) {
        const result = {
            isStrong: false,
            score: 0,
            feedback: []
        };
        
        if (password.length < 8) {
            result.feedback.push('8文字以上である必要があります');
        } else {
            result.score += 1;
        }
        
        if (!/[a-z]/.test(password)) {
            result.feedback.push('小文字を含む必要があります');
        } else {
            result.score += 1;
        }
        
        if (!/[A-Z]/.test(password)) {
            result.feedback.push('大文字を含む必要があります');
        } else {
            result.score += 1;
        }
        
        if (!/[0-9]/.test(password)) {
            result.feedback.push('数字を含む必要があります');
        } else {
            result.score += 1;
        }
        
        if (!/[^a-zA-Z0-9]/.test(password)) {
            result.feedback.push('特殊文字を含む必要があります');
        } else {
            result.score += 1;
        }
        
        result.isStrong = result.score >= 4;
        
        return result;
    }

    // セキュアなハッシュ生成
    generateSecureHash(data, algorithm = 'sha256') {
        return crypto.createHash(algorithm).update(data).digest('hex');
    }

    // ランダムな安全な文字列生成
    generateSecureRandomString(length = 32) {
        return crypto.randomBytes(Math.ceil(length / 2)).toString('hex').slice(0, length);
    }

    // IPアドレスのホワイトリスト/ブラックリストチェック
    checkIPAccess(clientIP, whitelist = [], blacklist = []) {
        // ブラックリストチェック
        if (blacklist.length > 0 && blacklist.includes(clientIP)) {
            return { allowed: false, reason: 'IP is blacklisted' };
        }
        
        // ホワイトリストチェック
        if (whitelist.length > 0 && !whitelist.includes(clientIP)) {
            return { allowed: false, reason: 'IP not in whitelist' };
        }
        
        return { allowed: true };
    }

    // レスポンスのセキュリティヘッダー設定
    setSecurityHeaders(res) {
        res.set({
            'X-Content-Type-Options': 'nosniff',
            'X-Frame-Options': 'DENY',
            'X-XSS-Protection': '1; mode=block',
            'Referrer-Policy': 'strict-origin-when-cross-origin',
            'Permissions-Policy': 'geolocation=(), microphone=(), camera=()',
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'Pragma': 'no-cache',
            'Expires': '0'
        });
        
        return res;
    }
}

// セキュリティミドルウェア
class SecurityMiddleware {
    constructor(securityUtils) {
        this.securityUtils = securityUtils || new SecurityUtils();
    }

    // XSS防御ミドルウェア
    xssProtection() {
        return (req, res, next) => {
            if (req.body) {
                req.body = this.sanitizeObject(req.body);
            }
            
            if (req.query) {
                req.query = this.sanitizeObject(req.query);
            }
            
            if (req.params) {
                req.params = this.sanitizeObject(req.params);
            }
            
            next();
        };
    }

    // オブジェクトの再帰的サニタイゼーション
    sanitizeObject(obj) {
        if (typeof obj === 'string') {
            return this.securityUtils.sanitizeInput(obj);
        }
        
        if (Array.isArray(obj)) {
            return obj.map(item => this.sanitizeObject(item));
        }
        
        if (typeof obj === 'object' && obj !== null) {
            const sanitized = {};
            for (const [key, value] of Object.entries(obj)) {
                const sanitizedKey = this.securityUtils.sanitizeInput(key);
                sanitized[sanitizedKey] = this.sanitizeObject(value);
            }
            return sanitized;
        }
        
        return obj;
    }

    // CSRF保護ミドルウェア
    csrfProtection() {
        return (req, res, next) => {
            if (req.method === 'GET') {
                // GETリクエストの場合はCSRFトークンを生成して返す
                const sessionId = req.sessionID || req.headers['x-session-id'];
                if (sessionId) {
                    const csrfToken = this.securityUtils.generateCSRFToken(sessionId);
                    res.set('X-CSRF-Token', csrfToken);
                }
                return next();
            }
            
            // POST, PUT, DELETE等の場合はトークンを検証
            const token = req.headers['x-csrf-token'] || req.body._csrfToken;
            const sessionId = req.sessionID || req.headers['x-session-id'];
            
            if (!token || !sessionId) {
                return res.status(403).json({
                    error: 'CSRFトークンが必要です',
                    code: 'MISSING_CSRF_TOKEN'
                });
            }
            
            try {
                this.securityUtils.validateCSRFToken(token, sessionId);
                next();
            } catch (error) {
                return res.status(403).json({
                    error: error.message,
                    code: 'INVALID_CSRF_TOKEN'
                });
            }
        };
    }

    // セキュリティヘッダー設定ミドルウェア
    securityHeaders() {
        return (req, res, next) => {
            this.securityUtils.setSecurityHeaders(res);
            next();
        };
    }

    // IPアクセス制御ミドルウェア
    ipAccessControl(options = {}) {
        const { whitelist = [], blacklist = [] } = options;
        
        return (req, res, next) => {
            const clientIP = req.ip || 
                           req.connection.remoteAddress || 
                           req.headers['x-forwarded-for']?.split(',')[0].trim();
            
            const accessCheck = this.securityUtils.checkIPAccess(clientIP, whitelist, blacklist);
            
            if (!accessCheck.allowed) {
                return res.status(403).json({
                    error: 'アクセスが拒否されました',
                    code: 'ACCESS_DENIED',
                    reason: accessCheck.reason
                });
            }
            
            next();
        };
    }

    // 入力値検証ミドルウェア
    validateInput(schema) {
        return (req, res, next) => {
            const errors = [];
            
            for (const [field, rules] of Object.entries(schema)) {
                const value = req.body[field];
                
                // 必須チェック
                if (rules.required && (value === undefined || value === null || value === '')) {
                    errors.push(`${field}は必須です`);
                    continue;
                }
                
                if (value === undefined || value === null) continue;
                
                // 型チェック
                if (rules.type && typeof value !== rules.type) {
                    errors.push(`${field}は${rules.type}型である必要があります`);
                    continue;
                }
                
                // 長さチェック
                if (rules.minLength && value.length < rules.minLength) {
                    errors.push(`${field}は${rules.minLength}文字以上である必要があります`);
                }
                
                if (rules.maxLength && value.length > rules.maxLength) {
                    errors.push(`${field}は${rules.maxLength}文字以下である必要があります`);
                }
                
                // パターンチェック
                if (rules.pattern && !rules.pattern.test(value)) {
                    errors.push(`${field}の形式が正しくありません`);
                }
                
                // カスタムバリデーション
                if (rules.validate && !rules.validate(value)) {
                    errors.push(`${field}が無効です`);
                }
            }
            
            if (errors.length > 0) {
                return res.status(400).json({
                    error: '入力値が無効です',
                    code: 'VALIDATION_ERROR',
                    details: errors
                });
            }
            
            next();
        };
    }
}

module.exports = { SecurityUtils, SecurityMiddleware };