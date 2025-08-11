class TextToSpeechApp {
    constructor() {
        this.initializeElements();
        this.bindEvents();
        this.currentAudioBlob = null;
        this.apiKey = 'YOUR_API_KEY_HERE'; // 後で実際のAPIキーに置き換える
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
        
        // ページ読み込み時にAPIキーを復元
        this.loadApiKeyFromStorage();
        
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
    
    // APIキーを取得（入力されている場合は優先）
    getCurrentApiKey() {
        const inputApiKey = this.apiKeyInput.value.trim();
        return inputApiKey || this.apiKey;
    }
    
    // 入力値のサニタイゼーション
    sanitizeText(text) {
        if (typeof text !== 'string') return '';
        
        return text
            .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '') // スクリプトタグ除去
            .replace(/<[^>]*>/g, '') // HTMLタグ除去
            .replace(/javascript:/gi, '') // JavaScriptプロトコル除去
            .replace(/on\w+\s*=\s*["'][^"']*["']/gi, '') // イベントハンドラー除去
            .trim()
            .substring(0, 5000); // 文字数制限
    }
    
    // APIキーの検証
    validateApiKey(apiKey) {
        if (!apiKey || typeof apiKey !== 'string') {
            return { valid: false, error: 'APIキーが必要です' };
        }

        if (apiKey === 'YOUR_API_KEY_HERE') {
            return { valid: false, error: '実際のAPIキーを入力してください' };
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
    
    async generateSpeech() {
        const rawText = this.textInput.value.trim();
        if (!rawText) {
            this.showError('テキストを入力してください。');
            return;
        }
        
        // APIキーの検証
        const currentApiKey = this.getCurrentApiKey();
        const apiKeyValidation = this.validateApiKey(currentApiKey);
        if (!apiKeyValidation.valid) {
            this.showError(apiKeyValidation.error);
            return;
        }
        
        // 入力値をサニタイズ
        const text = this.sanitizeText(rawText);
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
            // Google Cloud Text-to-Speech APIリクエスト
            const response = await this.callGoogleTTSAPI(processedText, currentApiKey);
            
            if (response.audioContent) {
                // Base64をBlobに変換
                const audioBlob = this.base64ToBlob(response.audioContent, 'audio/mpeg');
                this.showResult(audioBlob);
            } else {
                throw new Error('音声データが生成されませんでした');
            }
            
        } catch (error) {
            console.error('音声生成エラー:', error);
            
            // エラーメッセージを日本語化
            let errorMessage = '音声生成に失敗しました';
            
            if (error.message.includes('API key not valid')) {
                errorMessage = 'APIキーが無効です。正しいAPIキーを入力してください。';
            } else if (error.message.includes('quota')) {
                errorMessage = 'API使用量制限に達しています。しばらく待ってから再試行してください。';
            } else if (error.message.includes('string did not match the expected pattern')) {
                errorMessage = 'APIキーの形式が正しくありません。Google Cloud コンソールで生成されたAPIキーを使用してください。';
            } else if (error.message.includes('SERVICE_DISABLED')) {
                errorMessage = 'Text-to-Speech APIが有効化されていません。Google Cloudコンソールで有効化してください。';
            } else if (error.message.includes('PERMISSION_DENIED')) {
                errorMessage = 'APIキーの権限が不足しています。Text-to-Speech APIへのアクセス権限を確認してください。';
            } else if (error.message.includes('blocked')) {
                errorMessage = 'CORSエラー：ブラウザから直接APIを呼び出せません。サーバー経由での実装を検討してください。';
            }
            
            this.showError(`${errorMessage}: ${error.message}`);
        }
    }
    
    // Google Cloud Text-to-Speech API呼び出し
    async callGoogleTTSAPI(text, apiKey) {
        const voice = this.voiceSelect.value;
        const speed = parseFloat(this.speedRange.value);
        const languageCode = voice.substring(0, 5); // 例: "ja-JP"
        
        const requestBody = {
            input: {
                text: text
            },
            voice: {
                languageCode: languageCode,
                name: voice,
                ssmlGender: voice.includes('B') || voice.includes('F') ? 'FEMALE' : 'MALE'
            },
            audioConfig: {
                audioEncoding: 'MP3',
                speakingRate: speed,
                pitch: 0,
                volumeGainDb: 0,
                sampleRateHertz: 24000,
                effectsProfileId: ['large-home-entertainment-class-device']
            }
        };
        
        console.log('TTS API Request:', {
            textLength: text.length,
            voice: voice,
            speed: speed,
            languageCode: languageCode
        });
        
        // Google Cloud Text-to-Speech API エンドポイント
        const apiUrl = `https://texttospeech.googleapis.com/v1/text:synthesize?key=${apiKey}`;
        
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(requestBody)
        });
        
        if (!response.ok) {
            const errorData = await response.json();
            console.error('API Error Response:', errorData);
            
            let errorMessage = 'APIエラー';
            if (errorData.error) {
                errorMessage = errorData.error.message || errorData.error.code || 'Unknown API error';
            }
            
            throw new Error(errorMessage);
        }
        
        const data = await response.json();
        console.log('TTS API Success:', {
            hasAudioContent: !!data.audioContent,
            audioContentLength: data.audioContent ? data.audioContent.length : 0
        });
        
        return data;
    }
    
    // Base64をBlobに変換
    base64ToBlob(base64, mimeType) {
        const byteCharacters = atob(base64);
        const byteNumbers = new Array(byteCharacters.length);
        
        for (let i = 0; i < byteCharacters.length; i++) {
            byteNumbers[i] = byteCharacters.charCodeAt(i);
        }
        
        const byteArray = new Uint8Array(byteNumbers);
        return new Blob([byteArray], { type: mimeType });
    }
    
    downloadAudio() {
        if (!this.currentAudioBlob) return;
        
        const url = URL.createObjectURL(this.currentAudioBlob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `japanese-tts-audio-${Date.now()}.mp3`;
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
    
    // APIキー管理メソッド（セキュリティ機能なしの簡易版）
    loadApiKeyFromStorage() {
        try {
            const savedApiKey = localStorage.getItem('tts-api-key');
            if (savedApiKey && savedApiKey !== 'YOUR_API_KEY_HERE') {
                this.apiKeyInput.value = savedApiKey;
                this.showSaveStatus('✅ 保存済み', 'success');
            }
        } catch (error) {
            console.error('APIキーの読み込みに失敗:', error);
            this.showSaveStatus('❌ 読み込みエラー', 'error');
        }
    }
    
    saveApiKeyToStorage() {
        const apiKey = this.apiKeyInput.value.trim();
        
        // 入力値検証
        const validation = this.validateApiKey(apiKey);
        if (!validation.valid) {
            this.showSaveStatus(`❌ ${validation.error}`, 'error');
            return;
        }
        
        try {
            localStorage.setItem('tts-api-key', apiKey);
            this.showSaveStatus('✅ 保存完了', 'success');
        } catch (error) {
            console.error('APIキーの保存に失敗:', error);
            this.showSaveStatus('❌ 保存に失敗しました', 'error');
        }
    }
    
    clearApiKeyFromStorage() {
        try {
            localStorage.removeItem('tts-api-key');
            this.apiKeyInput.value = '';
            this.showSaveStatus('🗑 削除完了', 'success');
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