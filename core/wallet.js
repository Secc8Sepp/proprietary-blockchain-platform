const crypto = require('crypto');

class Wallet {
    static generateKeyPair() {
        // Generate standard Web3 cryptographic keypair natively
        const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { 
            namedCurve: 'secp256k1' 
        });

        // Export public key as standard SPKI DER hex mapping
        const publicKeyHex = publicKey.export({ type: 'spki', format: 'der' }).toString('hex');
        
        // Export private key natively using a clean SEC1 key representation layout
        const privateKeyHex = privateKey.export({ type: 'sec1', format: 'der' }).toString('hex');

        return {
            privateKey: privateKeyHex,
            publicKey: publicKeyHex,
            address: publicKeyHex 
        };
    }

    static getPrivateKeyObj(privateKeyHex) {
        // Clean the incoming hex string
        const cleanHex = privateKeyHex.trim().replace(/^0x/i, '');
        
        // Ensure the private scalar string is correctly padded to exactly 32 bytes (64 hex characters)
        const paddedHex = cleanHex.padStart(64, '0');
        const rawKeyBuffer = Buffer.from(paddedHex, 'hex');

        // Pass the raw mathematical parameters directly to Node's constructor.
        // This stops Node from searching for missing JWK coordinate keys or legacy file layouts.
        return crypto.createPrivateKey({
            key: {
                kty: 'EC',
                crv: 'secp256k1',
                d: rawKeyBuffer.toString('base64url')
            },
            format: 'jwk'
        });
    }

    static getPublicKeyFromPrivate(privateKeyHex) {
        try {
            const cleanHex = privateKeyHex.trim().replace(/^0x/i, '').substring(0, 64);
            const paddedHex = cleanHex.padStart(64, '0');
            const privateKeyBuffer = Buffer.from(paddedHex, 'hex');

            // Use native ECDH coordinate mapping to handle raw 32-byte password strings perfectly
            const ecdh = crypto.createECDH('secp256k1');
            ecdh.setPrivateKey(privateKeyBuffer);
            const rawPublicKey = ecdh.getPublicKey();

            return crypto.createPublicKey({
                key: rawPublicKey,
                format: 'der',
                type: 'pkcs1'
            }).export({ type: 'spki', format: 'der' }).toString('hex');
        } catch (error) {
            // High-compatibility configuration fallback gateway execution path
            const privateKeyObj = this.getPrivateKeyObj(privateKeyHex);
            return crypto.createPublicKey(privateKeyObj).export({ type: 'spki', format: 'der' }).toString('hex');
        }
    }

    static signData(privateKeyHex, dataString) {
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

    static verifySignature(publicKeyHex, dataString, signature) {
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