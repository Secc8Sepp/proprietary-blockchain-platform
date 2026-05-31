// ==========================================
// CRYPTO & BLOCKCHAIN TRANSACTION ENGINE
// ==========================================

async function ensureCryptoEngine() {
    if (typeof window.elliptic !== 'undefined') return;
    return new Promise((resolve, reject) => {
        console.log("[SYSTEM] Dynamically injecting Elliptic Curve engine...");
        const script = document.createElement('script');
        script.src = "https://cdnjs.cloudflare.com/ajax/libs/elliptic/6.5.4/elliptic.min.js";
        script.onload = resolve;
        script.onerror = () => reject(new Error("Failed to load cryptography engine. Check your connection or ad-blocker."));
        document.head.appendChild(script);
    });
}

async function generateClientSignature(privateKeyHex, messageObject) {
    await ensureCryptoEngine();
    const EC = window.elliptic.ec;
    const ec = new EC('secp256k1');
    const key = ec.keyFromPrivate(privateKeyHex);

    // The message to be signed MUST be hashed first (SHA-256). The elliptic library expects a hash digest.
    const msgBytes = new TextEncoder().encode(messageObject);
    const msgHash = await window.crypto.subtle.digest('SHA-256', msgBytes);
    
    // The signature is created from the hash.
    const signature = key.sign(new Uint8Array(msgHash)); // sign() expects a byte array

    // Convert from DER format to raw format (r and s concatenated)
    // Return the signature in standard DER format as a hex string.
    // This is more interoperable than a custom raw format.
    return signature.toDER('hex');
}

async function uploadMediaAssetFile(fileObject) {
    if (!fileObject) return null;
    const formData = new FormData();
    formData.append('mediaAsset', fileObject);
    
    const response = await fetch('/api/feed/upload-file', { method: 'POST', body: formData });
    const text = await response.text();
    let result;
    try { result = JSON.parse(text); } catch (e) { throw new Error(`Server returned invalid response. Response: ${text.substring(0, 80)}...`); }
    if (!response.ok) throw new Error(result.error || "Upload failed.");
    return result.fileHash;
}