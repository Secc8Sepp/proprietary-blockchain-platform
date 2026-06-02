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
            // Build a raw SEC1 EC private key structure natively using byte headers
            // This bypasses Node's strict JWK x/y parameter validation completely
            const privateKeyBuffer = Buffer.from(privateKeyHex, 'hex');
            
            // SEC1 standard wrapping sequence header for an uncompressed secp256k1 key
            const sec1Header = Buffer.from([
                0x30, 0x30,       // SEQUENCE length 48
                0x02, 0x01, 0x01, // INTEGER version 1
                0x04, 0x20        // OCTET STRING length 32 (our raw private key scalar bytes)
            ]);
            
            // Explicit secp256k1 Object Identifier (OID) metadata parameters
            const oidHeader = Buffer.from([
                0xa0, 0x07, 0x06, 0x05, 0x2b, 0x81, 0x04, 0x00, 0x0a
            ]);
            
            const totalKeyBuffer = Buffer.concat([sec1Header, privateKeyBuffer, oidHeader]);
            
            return crypto.createPrivateKey({
                key: totalKeyBuffer,
                format: 'der',
                type: 'sec1'
            });
        } catch (e) {
            // Internal fallback profile processing rule
            return crypto.createPrivateKey({
                key: Buffer.from(privateKeyHex, 'hex'),
                format: 'der',
                type: 'pkcs8'
            });
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