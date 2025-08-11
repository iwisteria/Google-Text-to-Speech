const express = require('express');
const cors = require('cors');
const helmet = require('helmet'); // セキュリティヘッダー
const rateLimit = require('express-rate-limit'); // レート制限
const { body, validationResult } = require('express-validator'); // 入力検証
const textToSpeech = require('@google-cloud/text-to-speech');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || 'development';

// セキュリティミドルウェア
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", "data:", "https:"],
            connectSrc: ["'self'"],
            fontSrc: ["'self'"],
            objectSrc: ["'none'"],
            mediaSrc: ["'self'", "blob:"],
            frameSrc: ["'none'"],
        },
    },
    crossOriginEmbedderPolicy: false,
}));

// HTTPS強制（本番環境）
if (NODE_ENV === 'production') {
    app.use((req, res, next) => {
        if (req.header('x-forwarded-proto') !== 'https') {
            res.redirect(`https://${req.header('host')}${req.url}`);
        } else {
            next();
        }
    });
}

// CORS設定を厳格化
const corsOptions = {
    origin: NODE_ENV === 'production' 
        ? ['https://your-domain.com', 'https://www.your-domain.com'] // 本番環境では特定のドメインのみ
        : ['http://localhost:3000', 'http://127.0.0.1:3000'], // 開発環境
    credentials: true,
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    maxAge: 86400 // 24時間
};
app.use(cors(corsOptions));

// レート制限の設定
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15分
    max: 100, // 最大100リクエスト
    message: {
        error: 'リクエスト制限に達しました。15分後に再試行してください。'
    },
    standardHeaders: true,
    legacyHeaders: false,
});

const synthesizeLimiter = rateLimit({
    windowMs: 60 * 1000, // 1分
    max: 10, // 最大10リクエスト
    message: {
        error: '音声生成のリクエスト制限に達しました。1分後に再試行してください。'
    }
});

// 全APIエンドポイントにレート制限を適用
app.use('/api/', apiLimiter);

// JSON設定（サイズ制限を厳格化）
app.use(express.json({ 
    limit: '1mb',
    type: 'application/json'
}));

// 静的ファイル配信（セキュリティヘッダー付き）
app.use(express.static(path.join(__dirname, '.'), {
    maxAge: NODE_ENV === 'production' ? '1d' : '0',
    etag: true,
    setHeaders: (res, path) => {
        if (path.endsWith('.html')) {
            res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        }
    }
}));

// Google Cloud Text-to-Speech クライアント初期化
const ttsClient = new textToSpeech.TextToSpeechClient();

// 入力サニタイゼーション関数
const sanitizeText = (text) => {
    if (typeof text !== 'string') return '';
    
    // HTMLタグを除去
    const withoutHtml = text.replace(/<[^>]*>/g, '');
    
    // 制御文字を除去
    const withoutControl = withoutHtml.replace(/[\x00-\x1F\x7F-\x9F]/g, '');
    
    // 長さ制限
    return withoutControl.substring(0, 5000).trim();
};

// APIキーの検証関数
const validateApiKey = (apiKey) => {
    if (!apiKey || typeof apiKey !== 'string') {
        return false;
    }
    
    // Google Cloud APIキーの基本的なフォーマットチェック
    const apiKeyPattern = /^AIza[0-9A-Za-z_-]{35}$/;
    return apiKeyPattern.test(apiKey);
};

// 入力検証ルール
const synthesizeValidation = [
    body('text')
        .isString()
        .isLength({ min: 1, max: 5000 })
        .withMessage('テキストは1-5000文字で入力してください'),
    body('voice')
        .optional()
        .isIn([
            'ja-JP-Neural2-B', 'ja-JP-Neural2-C', 'ja-JP-Neural2-D',
            'en-US-Neural2-F', 'en-US-Neural2-D'
        ])
        .withMessage('無効な音声タイプです'),
    body('speed')
        .optional()
        .isFloat({ min: 0.25, max: 4.0 })
        .withMessage('速度は0.25から4.0の範囲で指定してください'),
    body('apiKey')
        .optional()
        .custom((value) => {
            if (value && !validateApiKey(value)) {
                throw new Error('無効なAPIキーフォーマットです');
            }
            return true;
        })
];

// エラーハンドリング関数（改良版）
const handleError = (res, error, message = 'サーバーエラーが発生しました', statusCode = 500) => {
    // セキュリティのため詳細なエラー情報を制限
    const isDevelopment = NODE_ENV === 'development';
    
    console.error(`[${new Date().toISOString()}] Error:`, {
        message: error.message,
        stack: isDevelopment ? error.stack : undefined,
        userMessage: message
    });
    
    const errorResponse = {
        error: message,
        timestamp: new Date().toISOString()
    };
    
    // 開発環境でのみ詳細情報を含める
    if (isDevelopment && error.message) {
        errorResponse.details = error.message;
    }
    
    res.status(statusCode).json(errorResponse);
};

// CSRFトークン生成（セッション実装時に使用）
const generateCSRFToken = () => {
    return crypto.randomBytes(32).toString('hex');
};

// 音声合成APIエンドポイント（改良版）
app.post('/api/synthesize', synthesizeLimiter, synthesizeValidation, async (req, res) => {
    try {
        // バリデーション結果の確認
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                error: '入力データが無効です',
                details: NODE_ENV === 'development' ? errors.array() : undefined
            });
        }

        const { text: rawText, voice = 'ja-JP-Neural2-B', speed = 1.0, apiKey } = req.body;
        
        // テキストのサニタイゼーション
        const text = sanitizeText(rawText);
        if (!text) {
            return res.status(400).json({ error: 'テキストが必要です' });
        }
        
        // 言語コードを音声名から抽出
        const languageCode = voice.substring(0, 5);
        
        // Google Cloud Text-to-Speech APIリクエスト設定
        const request = {
            input: { text: text },
            voice: {
                languageCode: languageCode,
                name: voice
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
        
        // ログ（APIキーはマスク）
        console.log(`[${new Date().toISOString()}] TTS Request:`, {
            textLength: text.length,
            voice: voice,
            speed: speed,
            hasCustomApiKey: !!apiKey,
            clientIP: req.ip || req.connection.remoteAddress
        });
        
        let client = ttsClient;
        
        // カスタムAPIキーが提供された場合
        if (apiKey) {
            if (!validateApiKey(apiKey)) {
                return res.status(400).json({ error: '無効なAPIキーフォーマットです' });
            }
            
            // 注意: 実際の実装では、APIキーを使用したクライアント作成方法を
            // Google Cloud SDKのドキュメントに従って実装してください
            console.warn('カスタムAPIキーの実装が必要です');
        }
        
        // Google Cloud APIを呼び出し
        const [response] = await client.synthesizeSpeech(request);
        
        if (!response.audioContent) {
            throw new Error('音声データの生成に失敗しました');
        }
        
        // セキュリティヘッダーを設定
        res.set({
            'Content-Type': 'audio/mpeg',
            'Content-Length': response.audioContent.length,
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'Pragma': 'no-cache',
            'Expires': '0',
            'X-Content-Type-Options': 'nosniff'
        });
        
        res.send(response.audioContent);
        
    } catch (error) {
        console.error(`[${new Date().toISOString()}] Synthesis Error:`, error);
        
        // Google Cloud固有のエラーハンドリング
        if (error.code === 3) {
            return handleError(res, error, '無効なパラメータです。音声設定を確認してください。', 400);
        } else if (error.code === 7) {
            return handleError(res, error, 'Google Cloud認証エラー。APIキーまたはサービスアカウントを確認してください。', 403);
        } else if (error.code === 8) {
            return handleError(res, error, 'リクエスト制限に達しました。しばらく待ってから再試行してください。', 429);
        }
        
        handleError(res, error, '音声生成に失敗しました');
    }
});

// ヘルスチェックエンドポイント（改良版）
app.get('/api/health', (req, res) => {
    const healthCheck = {
        status: 'OK',
        timestamp: new Date().toISOString(),
        version: require('./package.json').version,
        environment: NODE_ENV,
        uptime: process.uptime()
    };
    
    // 本番環境では詳細情報を制限
    if (NODE_ENV === 'production') {
        delete healthCheck.environment;
        delete healthCheck.uptime;
    }
    
    res.json(healthCheck);
});

// メインページ
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// 404エラーハンドリング
app.use('*', (req, res) => {
    res.status(404).json({
        error: 'ページが見つかりません',
        timestamp: new Date().toISOString()
    });
});

// グローバルエラーハンドリング
app.use((error, req, res, next) => {
    handleError(res, error);
});

// サーバー起動
const server = app.listen(PORT, () => {
    console.log(`🚀 サーバーが起動しました: ${NODE_ENV === 'production' ? 'https' : 'http'}://localhost:${PORT}`);
    console.log(`📝 環境: ${NODE_ENV}`);
    if (NODE_ENV === 'development') {
        console.log('📝 Google Cloud認証の設定が必要です。詳細は setup.md を確認してください。');
    }
});

// グレースフルシャットダウン
const gracefulShutdown = (signal) => {
    console.log(`🛑 ${signal} シグナルを受信しました。サーバーを終了しています...`);
    server.close(() => {
        console.log('🛑 サーバーが正常に終了しました');
        process.exit(0);
    });
};

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

module.exports = app;