const crypto = require('crypto');

class AuthController {
    generateKeyPair(req, res) {
        try {
            // Generate standard RSA asymmetric keys
            const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
                modulusLength: 2048,
            });

            // Export to JWK (JSON Web Key) format for seamless browser-to-server interoperability
            const pubJwk = publicKey.export({ format: 'jwk' });
            const privJwk = privateKey.export({ format: 'jwk' });

            // Explicitly assign properties required by the WebCrypto API specification
            pubJwk.key_ops = ['verify'];
            pubJwk.alg = 'RS256';
            privJwk.key_ops = ['sign'];
            privJwk.alg = 'RS256';

            return res.status(200).json({
                publicKey: JSON.stringify(pubJwk),
                privateKey: JSON.stringify(privJwk)
            });
        } catch (error) {
            return res.status(500).json({ error: error.message });
        }
    }
}

module.exports = new AuthController();