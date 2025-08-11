class TextToSpeechApp {
    constructor() {
        this.initializeElements();
        this.bindEvents();
        this.currentAudioBlob = null;
    }
    
    initializeElements() {
        this.apiKeyInput = document.getElementById('apiKeyInput');
        this.toggleApiKey = document.getElementById('toggleApiKey');
        this.saveApiKey = document.getElementById('saveApiKey');
        this.clearApiKey = document.getElementById('clearApiKey');
        this.saveStatus = document.getElementById('saveStatus');
        this.textInput = document.getElementById('textInput');
        this.charCount = document.getElementById('charCount');
        this.voiceSelect = document.getElementById('voiceSelect');
        this.speedRange = document.getElementById('speedRange');
        this.speedValue = document.getElementById('speedValue');
        this.previewToggle = document.getElementById('previewToggle');
        this.generateBtn = document.getElementById('generateBtn');
        this.loadingDiv = document.getElementById('loadingDiv');
        this.resultDiv = document.getElementById('resultDiv');
        this.errorDiv = document.getElementById('errorDiv');
        this.audioPlayer = document.getElementById('audioPlayer');
        this.downloadBtn = document.getElementById('downloadBtn');
        this.copyLinkBtn = document.getElementById('copyLinkBtn');
    }
    
    bindEvents() {
        // APIキー表示切り替え
        this.toggleApiKey.addEventListener('click', () => {
            const isPassword = this.apiKeyInput.type === 'password';
            this.apiKeyInput.type = isPassword ? 'text' : 'password';
            this.toggleApiKey.textContent = isPassword ? '🙈' : '👁';
        });
        
        // APIキー保存ボタン
        this.saveApiKey.addEventListener('click', () => {
            this.saveApiKeyToStorage();
        });
        
        // APIキー削除ボタン
        this.clearApiKey.addEventListener('click', () => {
            this.clearApiKeyFromStorage();
        });
        
        // ページ読み込み時にAPIキーを復元（非同期）
        this.loadApiKeyFromStorage().catch(console.error);
        
        // 文字カウンター
        this.textInput.addEventListener('input', () => {
            const count = this.textInput.value.length;
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
        
        this.speedRange.addEventListener('input', () => {
            this.speedValue.textContent = `${this.speedRange.value}x`;
        });
        
        this.generateBtn.addEventListener('click', () => {
            this.generateSpeech();
        });
        
        this.downloadBtn.addEventListener('click', () => {
            this.downloadAudio();
        });
        
        this.copyLinkBtn.addEventListener('click', () => {
            this.copyAudioLink();
        });
        
        // エンターキー + Ctrlで生成
        this.textInput.addEventListener('keydown', (e) => {
            if (e.ctrlKey && e.key === 'Enter') {
                this.generateSpeech();
            }
        });
    }
    
    hideAllSections() {
        this.loadingDiv.style.display = 'none';
        this.resultDiv.style.display = 'none';
        this.errorDiv.style.display = 'none';
    }
    
    showError(message) {
        this.hideAllSections();
        this.errorDiv.textContent = message;
        this.errorDiv.style.display = 'block';
        this.generateBtn.disabled = false;
    }
    
    showLoading() {
        this.hideAllSections();
        this.loadingDiv.style.display = 'block';
        this.generateBtn.disabled = true;
    }
    
    showResult(audioBlob) {
        this.hideAllSections();
        this.currentAudioBlob = audioBlob;
        
        const audioUrl = URL.createObjectURL(audioBlob);
        this.audioPlayer.src = audioUrl;
        this.resultDiv.style.display = 'block';
        this.generateBtn.disabled = false;
    }
    
    async generateSpeech() {
        // レート制限チェック
        if (!window.rateLimiter.canMakeRequest()) {
            const resetTime = window.rateLimiter.getTimeUntilReset();
            this.showError(`リクエスト制限に達しています。${resetTime}秒後に再試行してください。`);
            return;
        }

        const rawText = this.textInput.value.trim();
        if (!rawText) {
            this.showError('テキストを入力してください。');
            return;
        }
        
        // 入力値をサニタイズ
        const text = window.inputSanitizer.sanitizeText(rawText);
        if (!text) {
            this.showError('有効なテキストを入力してください。');
            return;
        }
        
        let processedText = text;
        const isPreviewMode = this.previewToggle.value === 'preview';
        
        // プレビューモードの場合、先頭500文字のみを使用
        if (isPreviewMode) {
            processedText = text.substring(0, 500);
            if (text.length > 500) {
                processedText += '...（プレビューモードです。全文を音声化するには「全文」を選択してください）';
            }
        }
        
        if (processedText.length > 5000) {
            this.showError('テキストが長すぎます。5000文字以内で入力してください。');
            return;
        }
        
        this.showLoading();
        
        try {
            const requestBody = {
                text: processedText,
                voice: this.voiceSelect.value,
                speed: parseFloat(this.speedRange.value),
                isPreview: isPreviewMode,
                csrfToken: window.csrfProtection.getToken()
            };
            
            // セキュアにAPIキーを取得
            try {
                const apiKey = await window.secureApiKeyManager.getApiKeySecurely();
                if (apiKey) {
                    requestBody.apiKey = apiKey;
                }
            } catch (error) {
                console.warn('APIキーの取得に失敗:', error);
            }
            
            const response = await fetch('/api/synthesize', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRF-Token': window.csrfProtection.getToken()
                },
                body: JSON.stringify(requestBody)
            });
            
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'サーバーエラーが発生しました。');
            }
            
            const audioBlob = await response.blob();
            this.showResult(audioBlob);
            
        } catch (error) {
            console.error('音声生成エラー:', error);
            this.showError(`音声生成に失敗しました: ${error.message}`);
        }
    }
    
    downloadAudio() {
        if (!this.currentAudioBlob) return;
        
        const url = URL.createObjectURL(this.currentAudioBlob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `substack-audio-${Date.now()}.mp3`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }
    
    async copyAudioLink() {
        if (!this.currentAudioBlob) return;
        
        try {
            const url = URL.createObjectURL(this.currentAudioBlob);
            await navigator.clipboard.writeText(url);
            
            const originalText = this.copyLinkBtn.textContent;
            this.copyLinkBtn.textContent = 'コピーしました！';
            this.copyLinkBtn.style.background = '#28a745';
            
            setTimeout(() => {
                this.copyLinkBtn.textContent = originalText;
                this.copyLinkBtn.style.background = '#6c757d';
            }, 2000);
            
        } catch (error) {
            console.error('リンクのコピーに失敗:', error);
            this.showError('リンクのコピーに失敗しました。');
        }
    }
    
    // セキュアなAPIキー管理メソッド
    async loadApiKeyFromStorage() {
        try {
            if (window.secureApiKeyManager.hasApiKey()) {
                const apiKey = await window.secureApiKeyManager.getApiKeySecurely();
                if (apiKey) {
                    this.apiKeyInput.value = apiKey;
                    this.showSaveStatus('✅ セキュア保存済み', 'success');
                }
            }
        } catch (error) {
            console.error('APIキーの読み込みに失敗:', error);
            this.showSaveStatus('❌ 読み込みエラー', 'error');
        }
    }
    
    async saveApiKeyToStorage() {
        const apiKey = window.inputSanitizer.sanitizeText(this.apiKeyInput.value);
        
        // 入力値検証
        const validation = window.inputSanitizer.validateApiKey(apiKey);
        if (!validation.valid) {
            this.showSaveStatus(`❌ ${validation.error}`, 'error');
            return;
        }
        
        try {
            await window.secureApiKeyManager.saveApiKeySecurely(apiKey);
            this.showSaveStatus('✅ セキュア保存完了', 'success');
        } catch (error) {
            console.error('APIキーの保存に失敗:', error);
            this.showSaveStatus('❌ 保存に失敗しました', 'error');
        }
    }
    
    clearApiKeyFromStorage() {
        try {
            window.secureApiKeyManager.clearApiKey();
            this.apiKeyInput.value = '';
            this.showSaveStatus('🗑 セキュア削除完了', 'success');
        } catch (error) {
            console.error('APIキーの削除に失敗:', error);
            this.showSaveStatus('❌ 削除に失敗しました', 'error');
        }
    }
    
    showSaveStatus(message, type) {
        this.saveStatus.textContent = message;
        this.saveStatus.className = `save-status ${type}`;
        
        // 3秒後にメッセージを消去
        setTimeout(() => {
            this.saveStatus.textContent = '';
            this.saveStatus.className = 'save-status';
        }, 3000);
    }
}

// アプリケーション初期化
document.addEventListener('DOMContentLoaded', () => {
    new TextToSpeechApp();
});