const crypto = require('crypto');

class Wallet {
    static generateKeyPair() {
        const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { 
            namedCurve: 'secp256k1' 
        });

        const publicKeyHex = publicKey.export({ type: 'spki', format: 'der' }).toString('hex');
        
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
        // Clean the string inputs seamlessly
        const cleanHex = privateKeyHex.trim().replace(/^0x/i, '');
        
        // Ensure the private scalar string is exactly 64 characters (32 bytes) long
        const paddedHex = cleanHex.padStart(64, '0');
        
        // Convert straight to safe base64url padding layout
        const dBase64Url = Buffer.from(paddedHex, 'hex')
            .toString('base64')
            .replace(/\+/g, '-')
            .replace(/\//g, '_')
            .replace(/=/g, '');

        // Use standard JWK mapping format. This satisfies both password hash lines 
        // and asymmetric ledger validations without tripping ASN.1 sequence parsers.
        return crypto.createPrivateKey({
            key: {
                kty: 'EC',
                crv: 'secp256k1',
                d: dBase64Url
            },
            format: 'jwk'
        });
    }

    static getPublicKeyFromPrivate(privateKeyHex) {
        try {
            const cleanHex = privateKeyHex.trim().replace(/^0x/i, '');
            const paddedHex = cleanHex.padStart(64, '0');
            const privateKeyBuffer = Buffer.from(paddedHex, 'hex');

            // Handle the raw password key bytes directly using native ECDH structures
            const ecdh = crypto.createECDH('secp256k1');
            ecdh.setPrivateKey(privateKeyBuffer);
            const rawPublicKey = ecdh.getPublicKey();

            return crypto.createPublicKey({
                key: rawPublicKey,
                format: 'der',
                type: 'pkcs1'
            }).export({ type: 'spki', format: 'der' }).toString('hex');
        } catch (error) {
            // High-compatibility safe extraction backup gate
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