const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cors = require('cors');
const textToSpeech = require('@google-cloud/text-to-speech');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// セキュリティミドルウェア
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", "data:", "https:"],
            fontSrc: ["'self'"],
            objectSrc: ["'none'"],
            mediaSrc: ["'self'"],
            frameSrc: ["'none'"],
        },
    },
    crossOriginEmbedderPolicy: false
}));

// CORS設定（本番環境では厳格に設定）
const corsOptions = {
    origin: process.env.NODE_ENV === 'production' 
        ? ['https://yourdomain.com'] // 本番ドメインに変更
        : ['http://localhost:3000', 'http://127.0.0.1:3000'],
    credentials: true,
    optionsSuccessStatus: 200
};
app.use(cors(corsOptions));

// レート制限（より厳格）
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15分
    max: 20, // 最大20リクエスト
    message: {
        error: 'リクエストが多すぎます。15分後に再試行してください。'
    },
    standardHeaders: true,
    legacyHeaders: false,
});

const generalLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1分
    max: 100, // 最大100リクエスト
    message: {
        error: 'リクエストが多すぎます。しばらく待ってから再試行してください。'
    }
});

app.use(generalLimiter);
app.use('/api/', apiLimiter);

// JSONパース設定
app.use(express.json({ 
    limit: '10mb',
    type: ['application/json', 'text/plain']
}));

// 静的ファイル配信
app.use(express.static(path.join(__dirname, '.'), {
    maxAge: process.env.NODE_ENV === 'production' ? '1d' : 0,
    etag: true,
    lastModified: true
}));

// Google Cloud Text-to-Speech クライアント初期化
const ttsClient = new textToSpeech.TextToSpeechClient();

// 入力値検証ユーティリティ
const validateInput = {
    text: (text) => {
        if (!text || typeof text !== 'string') {
            return { valid: false, error: 'テキストが必要です' };
        }
        
        const sanitized = text
            .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
            .replace(/<[^>]*>/g, '')
            .trim();
        
        if (sanitized.length === 0) {
            return { valid: false, error: '有効なテキストを入力してください' };
        }
        
        if (sanitized.length > 5000) {
            return { valid: false, error: 'テキストが長すぎます（5000文字以内）' };
        }
        
        return { valid: true, sanitized };
    },
    
    voice: (voice) => {
        const allowedVoices = [
            'ja-JP-Neural2-B', 'ja-JP-Neural2-C', 'ja-JP-Neural2-D',
            'en-US-Neural2-F', 'en-US-Neural2-D'
        ];
        
        if (!allowedVoices.includes(voice)) {
            return { valid: false, error: '無効な音声タイプです' };
        }
        
        return { valid: true };
    },
    
    speed: (speed) => {
        const numSpeed = parseFloat(speed);
        if (isNaN(numSpeed) || numSpeed < 0.25 || numSpeed > 4.0) {
            return { valid: false, error: '速度は0.25から4.0の範囲で指定してください' };
        }
        
        return { valid: true };
    },
    
    apiKey: (apiKey) => {
        if (!apiKey) return { valid: true }; // 任意
        
        if (typeof apiKey !== 'string') {
            return { valid: false, error: 'APIキーが無効です' };
        }
        
        if (!apiKey.startsWith('AIza')) {
            return { valid: false, error: 'Google Cloud APIキーの形式が正しくありません' };
        }
        
        if (apiKey.length < 35 || apiKey.length > 45) {
            return { valid: false, error: 'APIキーの長さが正しくありません' };
        }
        
        if (!/^[A-Za-z0-9_-]+$/.test(apiKey)) {
            return { valid: false, error: 'APIキーに無効な文字が含まれています' };
        }
        
        return { valid: true };
    }
};

// CSRF対策（簡易版）
const csrfTokens = new Set();
const generateCSRFToken = () => {
    const token = require('crypto').randomBytes(32).toString('hex');
    csrfTokens.add(token);
    // 1時間後にトークンを削除
    setTimeout(() => csrfTokens.delete(token), 60 * 60 * 1000);
    return token;
};

// CSRFトークン発行
app.get('/api/csrf-token', (req, res) => {
    const token = generateCSRFToken();
    res.json({ csrfToken: token });
});

// エラーハンドリング関数
const handleError = (res, error, message = 'サーバーエラーが発生しました', statusCode = 500) => {
    console.error('Error:', error);
    
    // 本番環境では詳細なエラー情報を隠す
    const response = {
        error: message,
        timestamp: new Date().toISOString()
    };
    
    if (process.env.NODE_ENV === 'development') {
        response.details = error.message;
        response.stack = error.stack;
    }
    
    res.status(statusCode).json(response);
};

// 音声合成APIエンドポイント（セキュリティ強化版）
app.post('/api/synthesize', async (req, res) => {
    try {
        const { text, voice = 'ja-JP-Neural2-B', speed = 1.0, apiKey, csrfToken } = req.body;
        
        // CSRF対策（簡易版）
        const receivedToken = req.headers['x-csrf-token'] || csrfToken;
        if (!receivedToken || !csrfTokens.has(receivedToken)) {
            return res.status(403).json({ error: 'CSRF検証に失敗しました' });
        }
        
        // 使用済みトークンを削除
        csrfTokens.delete(receivedToken);
        
        // 入力値検証
        const textValidation = validateInput.text(text);
        if (!textValidation.valid) {
            return res.status(400).json({ error: textValidation.error });
        }
        
        const voiceValidation = validateInput.voice(voice);
        if (!voiceValidation.valid) {
            return res.status(400).json({ error: voiceValidation.error });
        }
        
        const speedValidation = validateInput.speed(speed);
        if (!speedValidation.valid) {
            return res.status(400).json({ error: speedValidation.error });
        }
        
        const apiKeyValidation = validateInput.apiKey(apiKey);
        if (!apiKeyValidation.valid) {
            return res.status(400).json({ error: apiKeyValidation.error });
        }
        
        // 言語コードを音声名から抽出
        const languageCode = voice.substring(0, 5);
        
        // Google Cloud Text-to-Speech APIリクエスト設定
        const request = {
            input: { text: textValidation.sanitized },
            voice: {
                languageCode: languageCode,
                name: voice
            },
            audioConfig: {
                audioEncoding: 'MP3',
                speakingRate: parseFloat(speed),
                pitch: 0,
                volumeGainDb: 0,
                sampleRateHertz: 24000,
                effectsProfileId: ['large-home-entertainment-class-device']
            }
        };
        
        // ログ記録（セキュリティ配慮）
        console.log('TTS Request:', {
            timestamp: new Date().toISOString(),
            textLength: textValidation.sanitized.length,
            voice: voice,
            speed: speed,
            hasCustomApiKey: !!apiKey,
            clientIP: req.ip || req.connection.remoteAddress
        });
        
        let client = ttsClient;
        
        // APIキーが提供された場合の処理は一旦無効化（セキュリティ上の理由）
        // 本番環境では適切な認証システムを実装してください
        
        // Google Cloud APIを呼び出し
        const [response] = await client.synthesizeSpeech(request);
        
        if (!response.audioContent) {
            throw new Error('音声データの生成に失敗しました');
        }
        
        // 成功ログ
        console.log('TTS Success:', {
            timestamp: new Date().toISOString(),
            audioSize: response.audioContent.length,
            clientIP: req.ip || req.connection.remoteAddress
        });
        
        // セキュリティヘッダー追加
        res.set({
            'Content-Type': 'audio/mpeg',
            'Content-Length': response.audioContent.length,
            'Cache-Control': 'private, no-cache, no-store, must-revalidate',
            'X-Content-Type-Options': 'nosniff',
            'X-Frame-Options': 'DENY',
            'X-XSS-Protection': '1; mode=block'
        });
        
        res.send(response.audioContent);
        
    } catch (error) {
        console.error('Synthesis Error:', {
            error: error.message,
            timestamp: new Date().toISOString(),
            clientIP: req.ip || req.connection.remoteAddress
        });
        
        // Google Cloud固有のエラーハンドリング
        if (error.code === 3) {
            return handleError(res, error, '無効なパラメータです。音声設定を確認してください。', 400);
        } else if (error.code === 7) {
            return handleError(res, error, 'Google Cloud認証エラー。管理者に連絡してください。', 403);
        } else if (error.code === 8) {
            return handleError(res, error, 'サービスが一時的に利用できません。しばらく待ってから再試行してください。', 429);
        }
        
        handleError(res, error, '音声生成に失敗しました');
    }
});

// ヘルスチェックエンドポイント
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'OK',
        timestamp: new Date().toISOString(),
        version: require('./package.json').version,
        environment: process.env.NODE_ENV || 'development'
    });
});

// メインページ
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// 404ハンドラー
app.use('*', (req, res) => {
    res.status(404).json({
        error: 'エンドポイントが見つかりません',
        timestamp: new Date().toISOString()
    });
});

// グローバルエラーハンドラー
app.use((error, req, res, next) => {
    console.error('Unhandled Error:', {
        error: error.message,
        stack: error.stack,
        timestamp: new Date().toISOString(),
        url: req.url,
        method: req.method,
        clientIP: req.ip || req.connection.remoteAddress
    });
    
    handleError(res, error, '予期しないエラーが発生しました');
});

// サーバー起動
const server = app.listen(PORT, () => {
    console.log(`🚀 セキュアサーバーが起動しました: http://localhost:${PORT}`);
    console.log(`📊 環境: ${process.env.NODE_ENV || 'development'}`);
    console.log('🔒 セキュリティ機能が有効です');
    console.log('📝 Google Cloud認証の設定が必要です。詳細は setup.md を確認してください。');
});

// グレースフルシャットダウン
const gracefulShutdown = (signal) => {
    console.log(`🛑 ${signal} シグナルを受信。サーバーを終了しています...`);
    
    server.close(() => {
        console.log('✅ サーバーが正常に終了しました');
        process.exit(0);
    });
    
    // 強制終了タイマー
    setTimeout(() => {
        console.error('❌ 強制終了します');
        process.exit(1);
    }, 10000);
};

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

module.exports = app;