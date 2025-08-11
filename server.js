const express = require('express');
const cors = require('cors');
const textToSpeech = require('@google-cloud/text-to-speech');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Google Cloud Text-to-Speech クライアント初期化
const ttsClient = new textToSpeech.TextToSpeechClient();

// ミドルウェア設定
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, '.')));

// エラーハンドリング関数
const handleError = (res, error, message = 'サーバーエラーが発生しました') => {
    console.error('Error:', error);
    res.status(500).json({ 
        error: message,
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
};

// 音声合成APIエンドポイント
app.post('/api/synthesize', async (req, res) => {
    try {
        const { text, voice = 'ja-JP-Neural2-B', speed = 1.0, apiKey } = req.body;
        
        // バリデーション
        if (!text || typeof text !== 'string') {
            return res.status(400).json({ error: 'テキストが必要です' });
        }
        
        if (text.length > 5000) {
            return res.status(400).json({ error: 'テキストが長すぎます（5000文字以内）' });
        }
        
        if (speed < 0.25 || speed > 4.0) {
            return res.status(400).json({ error: '速度は0.25から4.0の範囲で指定してください' });
        }
        
        // 言語コードを音声名から抽出
        const languageCode = voice.substring(0, 5); // 例: "ja-JP"
        
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
        
        console.log('TTS Request:', {
            textLength: text.length,
            voice: voice,
            speed: speed,
            usingCustomApiKey: !!apiKey
        });
        
        let client = ttsClient;
        
        // APIキーが提供された場合は専用クライアントを作成
        if (apiKey) {
            client = new textToSpeech.TextToSpeechClient({
                credentials: {
                    client_email: 'dummy@example.com',
                    private_key: 'dummy'
                },
                keyFilename: undefined // APIキーを直接使用
            });
            
            // APIキーを使用してリクエストヘッダーに追加
            request.auth = {
                scopes: ['https://www.googleapis.com/auth/cloud-platform'],
                apiKey: apiKey
            };
        }
        
        // Google Cloud APIを呼び出し
        const [response] = await client.synthesizeSpeech(request);
        
        if (!response.audioContent) {
            throw new Error('音声データの生成に失敗しました');
        }
        
        // MP3データを返却
        res.set({
            'Content-Type': 'audio/mpeg',
            'Content-Length': response.audioContent.length,
            'Cache-Control': 'no-cache'
        });
        
        res.send(response.audioContent);
        
    } catch (error) {
        console.error('Synthesis Error:', error);
        
        // Google Cloud固有のエラーハンドリング
        if (error.code === 3) {
            return res.status(400).json({ 
                error: '無効なパラメータです。音声設定を確認してください。' 
            });
        } else if (error.code === 7) {
            return res.status(403).json({ 
                error: 'Google Cloud認証エラー。APIキーまたはサービスアカウントを確認してください。' 
            });
        } else if (error.code === 8) {
            return res.status(429).json({ 
                error: 'リクエスト制限に達しました。しばらく待ってから再試行してください。' 
            });
        }
        
        handleError(res, error, '音声生成に失敗しました');
    }
});

// 利用可能な音声リストを取得するエンドポイント
app.get('/api/voices', async (req, res) => {
    try {
        const [response] = await ttsClient.listVoices({});
        
        // 日本語と英語の音声のみをフィルタ
        const supportedVoices = response.voices
            .filter(voice => 
                voice.languageCodes.some(code => 
                    code.startsWith('ja-JP') || code.startsWith('en-US')
                )
            )
            .map(voice => ({
                name: voice.name,
                languageCodes: voice.languageCodes,
                ssmlGender: voice.ssmlGender,
                naturalSampleRateHertz: voice.naturalSampleRateHertz
            }))
            .sort((a, b) => a.name.localeCompare(b.name));
        
        res.json({ voices: supportedVoices });
        
    } catch (error) {
        handleError(res, error, '音声リストの取得に失敗しました');
    }
});

// ヘルスチェックエンドポイント
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'OK',
        timestamp: new Date().toISOString(),
        version: require('./package.json').version
    });
});

// メインページ
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// サーバー起動
app.listen(PORT, () => {
    console.log(`🚀 サーバーが起動しました: http://localhost:${PORT}`);
    console.log('📝 Google Cloud認証の設定が必要です。詳細は setup.md を確認してください。');
});

// グレースフルシャットダウン
process.on('SIGINT', () => {
    console.log('🛑 サーバーを終了しています...');
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('🛑 サーバーを終了しています...');
    process.exit(0);
});