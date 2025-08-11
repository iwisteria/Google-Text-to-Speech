// セキュアなText-to-Speechアプリケーション（フロントエンド改良版）
class SecureTextToSpeechApp {
    constructor() {
        this.secureApiKeyManager = new SecureApiKeyManager();
        this.csrfToken = null;
        this.sessionId = null;
        this.currentAudioBlob = null;
        this.rateLimitTracker = new RateLimitTracker();
        
        this.initializeElements();
        this.initializeSecurity();
        this.bindEvents();
    }
    
    // セキュリティ初期化
    async initializeSecurity() {
        try {
            // CSRFトークンを取得
            await this.fetchCSRFToken();
            
            // セッションIDを生成
            this.sessionId = this.generateSessionId();
            
            // セキュリティイベントリスナーを設定
            this.setupSecurityEventListeners();
            
            // APIキーを安全に復元
            await this.loadApiKeySecurely();
            
        } catch (error) {
            console.error('セキュリティ初期化エラー:', error);
            this.showError('セキュリティの初期化に失敗しました');
        }
    }
    
    // セッションID生成
    generateSessionId() {
        const array = new Uint8Array(16);
        crypto.getRandomValues(array);
        return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
    }
    
    // CSRFトークンを取得
    async fetchCSRFToken() {
        try {
            const response = await fetch('/api/csrf-token', {
                method: 'GET',
                credentials: 'include',
                headers: {
                    'X-Requested-With': 'XMLHttpRequest'
                }
            });
            
            if (response.ok) {
                this.csrfToken = response.headers.get('X-CSRF-Token');
            }
        } catch (error) {
            console.warn('CSRFトークンの取得に失敗:', error);
        }
    }
    
    // セキュリティイベントリスナーの設定
    setupSecurityEventListeners() {
        // ページ離脱時のクリーンアップ
        window.addEventListener('beforeunload', async () => {
            await this.secureApiKeyManager.clearEncryptionKey();
            this.clearSensitiveData();
        });
        
        // ページ非表示時のクリーンアップ
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                this.clearSensitiveData();
            }
        });
        
        // 右クリック無効化（開発者ツール対策の一部）
        document.addEventListener('contextmenu', (e) => {
            if (e.target.closest('.api-input')) {
                e.preventDefault();
            }
        });
        
        // キーボードショートカット制限
        document.addEventListener('keydown', (e) => {
            // F12、Ctrl+Shift+I、Ctrl+U などの開発者ツール系を制限
            if (e.key === 'F12' || 
                (e.ctrlKey && e.shiftKey && e.key === 'I') ||
                (e.ctrlKey && e.key === 'u')) {
                e.preventDefault();
                console.warn('この操作は制限されています');
            }
        });
    }
    
    // 入力値のサニタイゼーション
    sanitizeInput(input, type = 'text') {
        if (typeof input !== 'string') return '';
        
        let sanitized = input.trim();
        
        switch (type) {
            case 'text':
                // HTMLタグを除去
                sanitized = sanitized.replace(/<[^>]*>/g, '');
                // 制御文字を除去
                sanitized = sanitized.replace(/[\x00-\x1F\x7F-\x9F]/g, '');
                // 連続する空白を単一の空白に
                sanitized = sanitized.replace(/\s+/g, ' ');
                break;
                
            case 'apikey':
                // APIキー用のサニタイゼーション
                sanitized = sanitized.replace(/[^A-Za-z0-9_-]/g, '');
                break;
        }
        
        return sanitized;
    }
    
    // HTMLエスケープ
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
    
    // 安全なHTTPリクエスト
    async secureRequest(url, options = {}) {
        // レート制限チェック
        if (!this.rateLimitTracker.canMakeRequest()) {
            throw new Error('リクエスト制限に達しました。しばらく待ってから再試行してください。');
        }
        
        const defaultOptions = {
            headers: {
                'Content-Type': 'application/json',
                'X-Requested-With': 'XMLHttpRequest'
            },
            credentials: 'include'
        };
        
        // CSRFトークンの追加
        if (this.csrfToken && options.method !== 'GET') {
            defaultOptions.headers['X-CSRF-Token'] = this.csrfToken;
        }
        
        // セッションIDの追加
        if (this.sessionId) {
            defaultOptions.headers['X-Session-ID'] = this.sessionId;
        }
        
        const mergedOptions = {
            ...defaultOptions,
            ...options,
            headers: { ...defaultOptions.headers, ...options.headers }
        };
        
        try {
            this.rateLimitTracker.recordRequest();
            const response = await fetch(url, mergedOptions);
            
            // CSRFトークンを更新
            const newCsrfToken = response.headers.get('X-CSRF-Token');
            if (newCsrfToken) {
                this.csrfToken = newCsrfToken;
            }
            
            return response;
        } catch (error) {
            console.error('リクエストエラー:', error);
            throw error;
        }
    }
    
    // APIキーの安全な保存
    async saveApiKeySecurely() {
        const apiKey = this.sanitizeInput(this.apiKeyInput.value, 'apikey');
        
        if (!apiKey) {
            this.showSaveStatus('❌ APIキーを入力してください', 'error');
            return;
        }
        
        // APIキーの形式検証を強化
        if (!this.validateApiKeyFormat(apiKey)) {
            this.showSaveStatus('❌ 無効なAPIキー形式です', 'error');
            return;
        }
        
        try {
            const success = await this.secureApiKeyManager.saveApiKeySecurely(apiKey);
            if (success) {
                this.showSaveStatus('✅ 保存しました', 'success');
                // 入力欄をクリア（セキュリティ強化）
                this.apiKeyInput.value = '';
                this.apiKeyInput.type = 'password';
            } else {
                this.showSaveStatus('❌ 保存に失敗しました', 'error');
            }
        } catch (error) {
            console.error('APIキーの保存に失敗:', error);
            this.showSaveStatus('❌ 保存に失敗しました', 'error');
        }
    }
    
    // APIキーの安全な読み込み
    async loadApiKeySecurely() {
        try {
            const apiKey = await this.secureApiKeyManager.loadApiKeySecurely();
            if (apiKey) {
                // セキュリティのため、APIキーの最初と最後の数文字のみ表示
                const maskedKey = this.maskApiKey(apiKey);
                this.apiKeyInput.placeholder = `保存済み: ${maskedKey}`;
                this.showSaveStatus('✅ 保存済み', 'success');
            }
        } catch (error) {
            console.error('APIキーの読み込みに失敗:', error);
        }
    }
    
    // APIキーのマスキング
    maskApiKey(apiKey) {
        if (apiKey.length < 8) return '*'.repeat(apiKey.length);
        return apiKey.substring(0, 4) + '*'.repeat(apiKey.length - 8) + apiKey.substring(apiKey.length - 4);
    }
    
    // APIキーの形式検証強化
    validateApiKeyFormat(apiKey) {
        // Google Cloud APIキーの詳細な検証
        if (!apiKey || typeof apiKey !== 'string') return false;
        
        // 基本的なパターンチェック
        const basicPattern = /^AIza[0-9A-Za-z_-]{35}$/;
        if (!basicPattern.test(apiKey)) return false;
        
        // 追加のセキュリティチェック
        if (apiKey.includes('..') || apiKey.includes('--')) return false;
        if (apiKey.length !== 39) return false;
        
        return true;
    }
    
    // 音声生成（セキュリティ強化版）
    async generateSpeech() {
        const rawText = this.textInput.value;
        const sanitizedText = this.sanitizeInput(rawText, 'text');
        
        if (!sanitizedText) {
            this.showError('有効なテキストを入力してください。');
            return;
        }
        
        if (sanitizedText.length > 5000) {
            this.showError('テキストが長すぎます。5000文字以内で入力してください。');
            return;
        }
        
        // 悪意のあるコンテンツのチェック
        if (this.containsMaliciousContent(sanitizedText)) {
            this.showError('不適切なコンテンツが検出されました。');
            return;
        }
        
        let processedText = sanitizedText;
        const isPreviewMode = this.previewToggle.value === 'preview';
        
        if (isPreviewMode) {
            processedText = sanitizedText.substring(0, 500);
            if (sanitizedText.length > 500) {
                processedText += '...（プレビューモードです。全文を音声化するには「全文」を選択してください）';
            }
        }
        
        this.showLoading();
        
        try {
            const requestBody = {
                text: processedText,
                voice: this.voiceSelect.value,
                speed: parseFloat(this.speedRange.value),
                isPreview: isPreviewMode
            };
            
            // APIキーが設定されている場合は取得
            const apiKey = await this.secureApiKeyManager.loadApiKeySecurely();
            if (apiKey && this.validateApiKeyFormat(apiKey)) {
                requestBody.apiKey = apiKey;
            }
            
            const response = await this.secureRequest('/api/synthesize', {
                method: 'POST',
                body: JSON.stringify(requestBody)
            });
            
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'サーバーエラーが発生しました。');
            }
            
            const audioBlob = await response.blob();
            
            // MIMEタイプの検証
            if (!audioBlob.type.startsWith('audio/')) {
                throw new Error('無効な音声データを受信しました。');
            }
            
            this.showResult(audioBlob);
            
        } catch (error) {
            console.error('音声生成エラー:', error);
            this.showError(`音声生成に失敗しました: ${this.escapeHtml(error.message)}`);
        }
    }
    
    // 悪意のあるコンテンツのチェック
    containsMaliciousContent(text) {
        const maliciousPatterns = [
            /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
            /javascript:/gi,
            /data:text\/html/gi,
            /vbscript:/gi,
            /on\w+\s*=/gi
        ];
        
        return maliciousPatterns.some(pattern => pattern.test(text));
    }
    
    // 機密データのクリア
    clearSensitiveData() {
        // APIキー入力欄をクリア
        if (this.apiKeyInput) {
            this.apiKeyInput.value = '';
            this.apiKeyInput.type = 'password';
        }
        
        // CSRFトークンをクリア
        this.csrfToken = null;
        
        // オーディオblobをクリア
        if (this.currentAudioBlob) {
            URL.revokeObjectURL(this.audioPlayer.src);
            this.currentAudioBlob = null;
        }
    }
    
    // その他のメソッド（省略されている部分）
    initializeElements() {
        // 既存のコードと同じ
    }
    
    bindEvents() {
        // 既存のイベントバインディング + セキュリティ強化
        
        // APIキー保存ボタン
        this.saveApiKey.addEventListener('click', () => {
            this.saveApiKeySecurely();
        });
        
        // APIキー削除ボタン
        this.clearApiKey.addEventListener('click', async () => {
            try {
                await this.secureApiKeyManager.clearApiKeySecurely();
                this.apiKeyInput.value = '';
                this.apiKeyInput.placeholder = 'AIzaSyC...（任意：未入力の場合はサーバー設定を使用）';
                this.showSaveStatus('🗑 削除しました', 'success');
            } catch (error) {
                console.error('APIキーの削除に失敗:', error);
                this.showSaveStatus('❌ 削除に失敗しました', 'error');
            }
        });
        
        // テキスト入力のリアルタイム検証
        this.textInput.addEventListener('input', () => {
            const sanitized = this.sanitizeInput(this.textInput.value, 'text');
            if (sanitized !== this.textInput.value) {
                this.textInput.value = sanitized;
            }
            
            const count = sanitized.length;
            this.charCount.textContent = count;
            
            // 文字数制限の色分け
            if (count > 4500) {
                this.charCount.style.color = '#dc3545';
            } else if (count > 4000) {
                this.charCount.style.color = '#ffc107';
            } else {
                this.charCount.style.color = '#6c757d';
            }
        });
        
        // その他のイベントハンドラー...
    }
    
    // 表示関連のメソッド（既存と同じ）
    hideAllSections() { /* 既存のコード */ }
    showError(message) { /* 既存のコード */ }
    showLoading() { /* 既存のコード */ }
    showResult(audioBlob) { /* 既存のコード */ }
    showSaveStatus(message, type) { /* 既存のコード */ }
}

// レート制限トラッカー
class RateLimitTracker {
    constructor() {
        this.requests = [];
        this.maxRequests = 10; // 1分間に10リクエスト
        this.timeWindow = 60 * 1000; // 1分
    }
    
    canMakeRequest() {
        const now = Date.now();
        // 古いリクエストを削除
        this.requests = this.requests.filter(time => now - time < this.timeWindow);
        
        return this.requests.length < this.maxRequests;
    }
    
    recordRequest() {
        this.requests.push(Date.now());
    }
}

// アプリケーション初期化
document.addEventListener('DOMContentLoaded', () => {
    new SecureTextToSpeechApp();
});