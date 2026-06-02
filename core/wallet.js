const crypto = require('crypto');

class Wallet {
    static generateKeyPair() {
        return new Promise((resolve, reject) => {
            crypto.generateKeyPair('ec', { 
                namedCurve: 'secp256k1' 
            }, (err, publicKey, privateKey) => {
                if (err) return reject(err);
                
                const publicKeyHex = publicKey.export({ type: 'spki', format: 'der' }).toString('hex');
                const privateKeyHex = privateKey.export({ type: 'sec1', format: 'der' }).toString('hex');

                resolve({
                    privateKey: privateKeyHex,
                    publicKey: publicKeyHex,
                    address: publicKeyHex 
                });
            });
        });
    }

    static getPrivateKeyObj(privateKeyHex) {
        // Clean the incoming hex string
        const cleanHex = privateKeyHex.trim().replace(/^0x/i, '');
        
        // If the key is already a DER encoded sequence, parse it natively
        if (cleanHex.length > 64) {
            return crypto.createPrivateKey({
                key: Buffer.from(cleanHex, 'hex'),
                format: 'der',
                type: 'sec1'
            });
        }
        
        // Ensure the private scalar string is correctly padded to exactly 32 bytes (64 hex characters)
        const paddedHex = cleanHex.padStart(64, '0');
        const rawKeyBuffer = Buffer.from(paddedHex, 'hex');

        // Use ECDH to securely derive the matching public key
        const ecdh = crypto.createECDH('secp256k1');
        ecdh.setPrivateKey(rawKeyBuffer);
        const rawPublicKeyHex = ecdh.getPublicKey('hex');

        // Construct standard SEC1 DER format natively compatible with Node crypto
        const sec1Prefix = '30740201010420';
        const sec1Middle = 'a00706052b8104000aa144034200';
        const fullDerHex = sec1Prefix + paddedHex + sec1Middle + rawPublicKeyHex;

        return crypto.createPrivateKey({
            key: Buffer.from(fullDerHex, 'hex'),
            format: 'der',
            type: 'sec1'
        });
    }

    static async getPublicKeyFromPrivate(privateKeyHex) {
        const privateKeyObj = this.getPrivateKeyObj(privateKeyHex);
        return crypto.createPublicKey(privateKeyObj).export({ type: 'spki', format: 'der' }).toString('hex');
    }

    static async signData(privateKeyHex, dataString) {
        const privateKeyObj = this.getPrivateKeyObj(privateKeyHex);
        return crypto.createSign('SHA256').update(dataString).sign(privateKeyObj, 'hex');
    }

    static convertRawToDER(rawSignatureHex) {
        if (rawSignatureHex.length < 128) {
            rawSignatureHex = rawSignatureHex.padStart(128, '0');
        }
        
        let rHex = rawSignatureHex.substring(0, 64);
        let sHex = rawSignatureHex.substring(64, 128);
        
        rHex = rHex.replace(/^0+/, '') || '0';
        sHex = sHex.replace(/^0+/, '') || '0';
        
        if (rHex.length % 2) rHex = '0' + rHex;
        if (sHex.length % 2) sHex = '0' + sHex;
        
        if (parseInt(rHex[0], 16) >= 8) rHex = '00' + rHex;
        if (parseInt(sHex[0], 16) >= 8) sHex = '00' + sHex;
        
        const rLength = rHex.length / 2;
        const sLength = sHex.length / 2;
        
        const rEncoded = '02' + (rLength).toString(16).padStart(2, '0') + rHex;
        const sEncoded = '02' + (sLength).toString(16).padStart(2, '0') + sHex;
        const combined = rEncoded + sEncoded;
        const totalLength = combined.length / 2;
        
        return '30' + (totalLength).toString(16).padStart(2, '0') + combined;
    }

    static async verifySignature(publicKeyHex, dataString, signature) {
        try {
            const normalizedKey = publicKeyHex.trim().replace(/^0x/i, '').toLowerCase();
            
            let signatureToVerify = signature;
            // FIX: Only apply the DER conversion for raw 128-char signatures
            if (signature.length === 128) {
                signatureToVerify = this.convertRawToDER(signature);
            }
            
            const publicKey = crypto.createPublicKey({
                key: Buffer.from(normalizedKey, 'hex'),
                format: 'der',
                type: 'spki'
            });
            
            return crypto.createVerify('SHA256').update(dataString).verify(publicKey, signatureToVerify, 'hex');
        } catch (e) {
            console.error('[Wallet.verifySignature] Verification error:', e.message);
            return false;
        }
    }
}

module.exports = Wallet;