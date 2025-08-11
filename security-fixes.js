// セキュアなAPIキー管理システム
class SecureApiKeyManager {
    constructor() {
        this.keyName = 'tts-api-key-secure';
        this.encryptionKey = null;
    }

    // 暗号化キーを生成・取得
    async getEncryptionKey() {
        if (this.encryptionKey) return this.encryptionKey;
        
        try {
            // 既存キーを取得または新規生成
            const keyData = sessionStorage.getItem('tts-crypto-key');
            if (keyData) {
                this.encryptionKey = await crypto.subtle.importKey(
                    'raw',
                    new Uint8Array(JSON.parse(keyData)),
                    'AES-GCM',
                    false,
                    ['encrypt', 'decrypt']
                );
            } else {
                this.encryptionKey = await crypto.subtle.generateKey(
                    { name: 'AES-GCM', length: 256 },
                    true,
                    ['encrypt', 'decrypt']
                );
                
                const keyData = await crypto.subtle.exportKey('raw', this.encryptionKey);
                sessionStorage.setItem('tts-crypto-key', JSON.stringify(Array.from(new Uint8Array(keyData))));
            }
            
            return this.encryptionKey;
        } catch (error) {
            console.error('暗号化キーの生成に失敗:', error);
            throw new Error('セキュリティキーの初期化に失敗しました');
        }
    }

    // APIキーを暗号化して保存
    async saveApiKeySecurely(apiKey) {
        if (!apiKey || typeof apiKey !== 'string') {
            throw new Error('有効なAPIキーを入力してください');
        }

        try {
            const key = await this.getEncryptionKey();
            const iv = crypto.getRandomValues(new Uint8Array(12));
            const encodedData = new TextEncoder().encode(apiKey);
            
            const encryptedData = await crypto.subtle.encrypt(
                { name: 'AES-GCM', iv: iv },
                key,
                encodedData
            );

            const secureData = {
                data: Array.from(new Uint8Array(encryptedData)),
                iv: Array.from(iv),
                timestamp: Date.now()
            };

            sessionStorage.setItem(this.keyName, JSON.stringify(secureData));
            
            // 30分後に自動削除
            setTimeout(() => this.clearApiKey(), 30 * 60 * 1000);
            
            return true;
        } catch (error) {
            console.error('APIキーの暗号化保存に失敗:', error);
            throw new Error('APIキーの保存に失敗しました');
        }
    }

    // 暗号化されたAPIキーを復号化して取得
    async getApiKeySecurely() {
        try {
            const encryptedData = sessionStorage.getItem(this.keyName);
            if (!encryptedData) return null;

            const secureData = JSON.parse(encryptedData);
            
            // 30分経過チェック
            if (Date.now() - secureData.timestamp > 30 * 60 * 1000) {
                this.clearApiKey();
                return null;
            }

            const key = await this.getEncryptionKey();
            const decryptedData = await crypto.subtle.decrypt(
                { 
                    name: 'AES-GCM', 
                    iv: new Uint8Array(secureData.iv) 
                },
                key,
                new Uint8Array(secureData.data)
            );

            return new TextDecoder().decode(decryptedData);
        } catch (error) {
            console.error('APIキーの復号化に失敗:', error);
            this.clearApiKey();
            return null;
        }
    }

    // APIキーを安全に削除
    clearApiKey() {
        sessionStorage.removeItem(this.keyName);
        sessionStorage.removeItem('tts-crypto-key');
        this.encryptionKey = null;
    }

    // APIキーの存在確認
    hasApiKey() {
        return sessionStorage.getItem(this.keyName) !== null;
    }
}

// レート制限機能
class RateLimiter {
    constructor(maxRequests = 10, windowMs = 60000) {
        this.maxRequests = maxRequests;
        this.windowMs = windowMs;
        this.requests = [];
    }

    canMakeRequest() {
        const now = Date.now();
        // 古いリクエストを削除
        this.requests = this.requests.filter(time => now - time < this.windowMs);
        
        if (this.requests.length >= this.maxRequests) {
            return false;
        }
        
        this.requests.push(now);
        return true;
    }

    getTimeUntilReset() {
        if (this.requests.length === 0) return 0;
        const oldestRequest = Math.min(...this.requests);
        const timeUntilReset = this.windowMs - (Date.now() - oldestRequest);
        return Math.max(0, Math.ceil(timeUntilReset / 1000));
    }
}

// 入力値サニタイゼーション
class InputSanitizer {
    static sanitizeText(text) {
        if (typeof text !== 'string') return '';
        
        return text
            .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '') // スクリプトタグ除去
            .replace(/<[^>]*>/g, '') // HTMLタグ除去
            .replace(/javascript:/gi, '') // JavaScriptプロトコル除去
            .replace(/on\w+\s*=\s*["'][^"']*["']/gi, '') // イベントハンドラー除去
            .trim()
            .substring(0, 5000); // 文字数制限
    }

    static validateApiKey(apiKey) {
        if (!apiKey || typeof apiKey !== 'string') {
            return { valid: false, error: 'APIキーが無効です' };
        }

        if (!apiKey.startsWith('AIza')) {
            return { valid: false, error: 'Google Cloud APIキーの形式が正しくありません' };
        }

        if (apiKey.length < 35 || apiKey.length > 45) {
            return { valid: false, error: 'APIキーの長さが正しくありません' };
        }

        // 危険な文字のチェック
        if (!/^[A-Za-z0-9_-]+$/.test(apiKey)) {
            return { valid: false, error: 'APIキーに無効な文字が含まれています' };
        }

        return { valid: true };
    }
}

// CSRF対策
class CSRFProtection {
    constructor() {
        this.token = null;
        this.generateToken();
    }

    generateToken() {
        const array = new Uint8Array(32);
        crypto.getRandomValues(array);
        this.token = Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
        
        // メタタグに設定
        let metaTag = document.querySelector('meta[name="csrf-token"]');
        if (!metaTag) {
            metaTag = document.createElement('meta');
            metaTag.name = 'csrf-token';
            document.head.appendChild(metaTag);
        }
        metaTag.content = this.token;
    }

    getToken() {
        return this.token;
    }

    validateToken(receivedToken) {
        return this.token === receivedToken;
    }
}

// グローバルインスタンス作成
window.secureApiKeyManager = new SecureApiKeyManager();
window.rateLimiter = new RateLimiter();
window.inputSanitizer = InputSanitizer;
window.csrfProtection = new CSRFProtection();