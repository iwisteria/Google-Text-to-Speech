// APIキー暗号化ユーティリティ
class SecureApiKeyManager {
    constructor() {
        // ブラウザ環境でのシンプルな暗号化
        this.storageKey = 'tts-encrypted-api-key';
        this.saltKey = 'tts-key-salt';
    }

    // シンプルなXOR暗号化（デモ用）
    // 実際の本番環境ではWebCrypto APIを使用することを推奨
    async encryptApiKey(apiKey) {
        try {
            // より安全な実装: WebCrypto APIを使用
            const encoder = new TextEncoder();
            const data = encoder.encode(apiKey);
            
            // キーの生成（実際にはより複雑なキー導出関数を使用）
            const key = await crypto.subtle.generateKey(
                { name: 'AES-GCM', length: 256 },
                false,
                ['encrypt', 'decrypt']
            );
            
            // 暗号化
            const iv = crypto.getRandomValues(new Uint8Array(12));
            const encrypted = await crypto.subtle.encrypt(
                { name: 'AES-GCM', iv: iv },
                key,
                data
            );
            
            // キーをIndexedDBに安全に保存（セッション限定）
            await this.storeEncryptionKey(key);
            
            return {
                encrypted: Array.from(new Uint8Array(encrypted)),
                iv: Array.from(iv)
            };
        } catch (error) {
            console.error('暗号化エラー:', error);
            throw new Error('APIキーの暗号化に失敗しました');
        }
    }

    async decryptApiKey(encryptedData) {
        try {
            const key = await this.retrieveEncryptionKey();
            if (!key) {
                throw new Error('暗号化キーが見つかりません');
            }

            const encrypted = new Uint8Array(encryptedData.encrypted);
            const iv = new Uint8Array(encryptedData.iv);

            const decrypted = await crypto.subtle.decrypt(
                { name: 'AES-GCM', iv: iv },
                key,
                encrypted
            );

            const decoder = new TextDecoder();
            return decoder.decode(decrypted);
        } catch (error) {
            console.error('復号化エラー:', error);
            throw new Error('APIキーの復号化に失敗しました');
        }
    }

    // IndexedDBを使用した暗号化キーの保存（セッション限定）
    async storeEncryptionKey(key) {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open('TTSSecureStorage', 1);
            
            request.onerror = () => reject(request.error);
            
            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains('keys')) {
                    db.createObjectStore('keys', { keyPath: 'id' });
                }
            };
            
            request.onsuccess = (event) => {
                const db = event.target.result;
                const transaction = db.transaction(['keys'], 'readwrite');
                const store = transaction.objectStore('keys');
                
                store.put({ id: 'encryption-key', key: key });
                
                transaction.oncomplete = () => resolve();
                transaction.onerror = () => reject(transaction.error);
            };
        });
    }

    async retrieveEncryptionKey() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open('TTSSecureStorage', 1);
            
            request.onerror = () => reject(request.error);
            
            request.onsuccess = (event) => {
                const db = event.target.result;
                const transaction = db.transaction(['keys'], 'readonly');
                const store = transaction.objectStore('keys');
                const getRequest = store.get('encryption-key');
                
                getRequest.onsuccess = () => {
                    const result = getRequest.result;
                    resolve(result ? result.key : null);
                };
                
                getRequest.onerror = () => reject(getRequest.error);
            };
        });
    }

    // セッション終了時にキーを削除
    async clearEncryptionKey() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open('TTSSecureStorage', 1);
            
            request.onsuccess = (event) => {
                const db = event.target.result;
                const transaction = db.transaction(['keys'], 'readwrite');
                const store = transaction.objectStore('keys');
                
                store.delete('encryption-key');
                
                transaction.oncomplete = () => resolve();
                transaction.onerror = () => reject(transaction.error);
            };
        });
    }

    // APIキーの安全な保存
    async saveApiKeySecurely(apiKey) {
        try {
            const encryptedData = await this.encryptApiKey(apiKey);
            sessionStorage.setItem(this.storageKey, JSON.stringify(encryptedData));
            return true;
        } catch (error) {
            console.error('APIキーの安全な保存に失敗:', error);
            return false;
        }
    }

    // APIキーの安全な取得
    async loadApiKeySecurely() {
        try {
            const encryptedDataStr = sessionStorage.getItem(this.storageKey);
            if (!encryptedDataStr) {
                return null;
            }

            const encryptedData = JSON.parse(encryptedDataStr);
            return await this.decryptApiKey(encryptedData);
        } catch (error) {
            console.error('APIキーの安全な取得に失敗:', error);
            // 破損したデータを削除
            sessionStorage.removeItem(this.storageKey);
            return null;
        }
    }

    // APIキーの削除
    async clearApiKeySecurely() {
        try {
            sessionStorage.removeItem(this.storageKey);
            await this.clearEncryptionKey();
            return true;
        } catch (error) {
            console.error('APIキーの削除に失敗:', error);
            return false;
        }
    }
}

// 使用例
const secureKeyManager = new SecureApiKeyManager();

// ページ終了時にキーを自動削除
window.addEventListener('beforeunload', async () => {
    await secureKeyManager.clearEncryptionKey();
});