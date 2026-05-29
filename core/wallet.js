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

    static verifySignature(publicKeyHex, dataString, signature) {
        try {
            const normalizedKey = publicKeyHex.trim().replace(/^0x/i, '').toLowerCase();
            // Reconstruct the Public Key object directly from the sender's address
            const publicKey = crypto.createPublicKey({
                key: Buffer.from(normalizedKey, 'hex'),
                format: 'der',
                type: 'spki'
            });
            
            return crypto.createVerify('SHA256').update(dataString).verify(publicKey, signature, 'hex');
        } catch (e) {
            // If the key is malformed or signature fails, instantly reject
            return false;
        }
    }
}

module.exports = Wallet;