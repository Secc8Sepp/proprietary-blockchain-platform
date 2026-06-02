const crypto = require('crypto');

class Wallet {
    static generateKeyPair() {
        // Generate standard Web3 cryptographic keypair natively
        const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { 
            namedCurve: 'secp256k1' 
        });

        // Export public key as SPKI DER
        const publicKeyHex = publicKey.export({ type: 'spki', format: 'der' }).toString('hex');
        
        // Export private key natively to extract the raw 32-byte scalar hex
        const jwk = privateKey.export({ format: 'jwk' });
        const d_base64 = jwk.d.replace(/-/g, '+').replace(/_/g, '/');
        const privateKeyHex = Buffer.from(d_base64, 'base64').toString('hex');

        return {
            privateKey: privateKeyHex,
            publicKey: publicKeyHex,
            // In our platform, the raw public key hex serves as the wallet address
            address: publicKeyHex 
        };
    }

    static getPrivateKeyObj(privateKeyHex) {
        try {
            // Ensure the raw private key hex string is clean
            const cleanHex = privateKeyHex.trim().replace(/^0x/i, '');
            const rawKeyBuffer = Buffer.from(cleanHex, 'hex');

            // Pass the raw 32-byte scalar straight to the native parser.
            // Node handles the internal ASN.1 sequence length constraints natively.
            return crypto.createPrivateKey({
                key: rawKeyBuffer,
                format: 'der',
                type: 'sec1',
                derOptions: {
                    namedCurve: 'secp256k1'
                }
            });
        } catch (e) {
            // Fallback 1: Try PKCS#8 structural handling if environment variables differ
            try {
                return crypto.createPrivateKey({
                    key: Buffer.from(privateKeyHex, 'hex'),
                    format: 'der',
                    type: 'pkcs8'
                });
            } catch (innerError) {
                // Fallback 2: Construct a standard, uncompressed JWK if DER falls through
                const d_base64url = Buffer.from(privateKeyHex, 'hex')
                    .toString('base64')
                    .replace(/\+/g, '-')
                    .replace(/\//g, '_')
                    .replace(/=/g, '');
                
                return crypto.createPrivateKey({
                    key: {
                        kty: 'EC',
                        crv: 'secp256k1',
                        d: d_base64url
                    },
                    format: 'jwk'
                });
            }
        }
    }

    static getPublicKeyFromPrivate(privateKeyHex) {
        const privateKeyObj = this.getPrivateKeyObj(privateKeyHex);
        return crypto.createPublicKey(privateKeyObj).export({ type: 'spki', format: 'der' }).toString('hex');
    }

    static signData(privateKeyHex, dataString) {
        const privateKey = this.getPrivateKeyObj(privateKeyHex);
        return crypto.createSign('SHA256').update(dataString).sign(privateKey, 'hex');
    }

    static convertRawToDER(rawSignatureHex) {
        // Convert raw ECDSA signature (r || s) to standard DER format
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
            
            // Normalize incoming signatures if passed in raw 64-byte format
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