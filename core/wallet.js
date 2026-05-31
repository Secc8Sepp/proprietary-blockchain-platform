const crypto = require('crypto');

class Wallet {
    static generateKeyPair() {
        // Generate standard Web3 cryptographic keypair
        const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { 
            namedCurve: 'secp256k1' 
        });

        // Export public key as SPKI DER
        const publicKeyHex = publicKey.export({ type: 'spki', format: 'der' }).toString('hex');
        
        // Export private key as JWK to easily extract the raw 32-byte scalar
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

    static signData(privateKeyHex, dataString) {
        // Reconstruct the Private Key object from the raw Hex string via JWK
        const d_base64url = Buffer.from(privateKeyHex, 'hex').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
        const privateKey = crypto.createPrivateKey({
            key: {
                kty: 'EC',
                crv: 'secp256k1',
                d: d_base64url
            },
            format: 'jwk'
        });
        
        return crypto.createSign('SHA256').update(dataString).sign(privateKey, 'hex');
    }

    static convertRawToDER(rawSignatureHex) {
        // Convert raw ECDSA signature (r || s) to DER format
        // Raw format: 64 bytes (128 hex chars) - first 32 bytes are r, next 32 bytes are s
        if (rawSignatureHex.length < 128) {
            // Pad with zeros if needed
            rawSignatureHex = rawSignatureHex.padStart(128, '0');
        }
        
        let rHex = rawSignatureHex.substring(0, 64);
        let sHex = rawSignatureHex.substring(64, 128);
        
        // Remove leading zeros but keep at least one digit, and ensure even length
        rHex = rHex.replace(/^0+/, '') || '0';
        sHex = sHex.replace(/^0+/, '') || '0';
        
        if (rHex.length % 2) rHex = '0' + rHex;
        if (sHex.length % 2) sHex = '0' + sHex;
        
        // Add 0x00 padding if high bit is set (to indicate positive number)
        if (parseInt(rHex[0], 16) >= 8) rHex = '00' + rHex;
        if (parseInt(sHex[0], 16) >= 8) sHex = '00' + sHex;
        
        const rLength = rHex.length / 2;
        const sLength = sHex.length / 2;
        
        // Build DER structure: SEQUENCE { INTEGER r, INTEGER s }
        const rEncoded = '02' + (rLength).toString(16).padStart(2, '0') + rHex;
        const sEncoded = '02' + (sLength).toString(16).padStart(2, '0') + sHex;
        const combined = rEncoded + sEncoded;
        const totalLength = combined.length / 2;
        
        return '30' + (totalLength).toString(16).padStart(2, '0') + combined;
    }

    static verifySignature(publicKeyHex, dataString, signature) {
        try {
            const normalizedKey = publicKeyHex.trim().replace(/^0x/i, '').toLowerCase();
            
            // Detect if signature is raw format (128 hex chars) or DER format
            let signatureToVerify = signature;
            if (signature.length === 128 || signature.length < 140) {
                // Likely raw format, convert to DER
                signatureToVerify = this.convertRawToDER(signature);
            }
            
            // Reconstruct the Public Key object directly from the sender's address
            const publicKey = crypto.createPublicKey({
                key: Buffer.from(normalizedKey, 'hex'),
                format: 'der',
                type: 'spki'
            });
            
            return crypto.createVerify('SHA256').update(dataString).verify(publicKey, signatureToVerify, 'hex');
        } catch (e) {
            // If the key is malformed or signature fails, instantly reject
            console.error('[Wallet.verifySignature] Verification error:', e.message);
            return false;
        }
    }
}

module.exports = Wallet;