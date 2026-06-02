const crypto = require('crypto');

class Wallet {
    static generateKeyPair() {
        // Generate standard Web3 cryptographic keypair natively
        const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { 
            namedCurve: 'secp256k1' 
        });

        // Export public key as standard SPKI DER hex mapping
        const publicKeyHex = publicKey.export({ type: 'spki', format: 'der' }).toString('hex');
        
        // Export private key natively to extract the raw 32-byte scalar hex
        const jwk = privateKey.export({ format: 'jwk' });
        const d_base64 = jwk.d.replace(/-/g, '+').replace(/_/g, '/');
        const privateKeyHex = Buffer.from(d_base64, 'base64').toString('hex');

        return {
            privateKey: privateKeyHex,
            publicKey: publicKeyHex,
            address: publicKeyHex 
        };
    }

    static getPrivateKeyObj(privateKeyHex) {
        // Clean the incoming hex key string strings
        const cleanHex = privateKeyHex.trim().replace(/^0x/i, '');
        const rawKeyBuffer = Buffer.from(cleanHex, 'hex');

        // Wrapping the raw 32-byte hash sequence inside a native PKCS#8 structural key object wrapper.
        // This ensures Node's core OpenSSL layer executes key bindings without checking for manual JWK fields.
        return crypto.createPrivateKey({
            key: crypto.createPrivateKey({
                key: rawKeyBuffer,
                format: 'der',
                type: 'sec1',
                derOptions: { namedCurve: 'secp256k1' }
            }).export({ type: 'pkcs8', format: 'der' }),
            format: 'der',
            type: 'pkcs8'
        });
    }

    static getPublicKeyFromPrivate(privateKeyHex) {
        try {
            const cleanHex = privateKeyHex.trim().replace(/^0x/i, '');
            const privateKeyBuffer = Buffer.from(cleanHex, 'hex');

            // Use native ECDH mechanics to resolve keys straight from raw password strings safely
            const ecdh = crypto.createECDH('secp256k1');
            ecdh.setPrivateKey(privateKeyBuffer);
            const rawPublicKey = ecdh.getPublicKey();

            // Export standard SPKI DER formats straight to the asset registration handlers
            return crypto.createPublicKey({
                key: rawPublicKey,
                format: 'der',
                type: 'pkcs1'
            }).export({ type: 'spki', format: 'der' }).toString('hex');
        } catch (error) {
            // Secure fallback path running direct mathematical derivation structures
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
            if (signature.length === 128 || signature.length < 140) {
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