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
    const msgStr = JSON.stringify(messageObject);
    const msgBytes = new TextEncoder().encode(msgStr);
    const signature = key.sign(msgBytes);
    
    // Convert from DER format to raw format (r and s concatenated)
    // DER format: 30 [length] 02 [r-length] [r] 02 [s-length] [s]
    // Raw format: [r-padded-to-32] [s-padded-to-32]
    const derHex = signature.toDER('hex');
    const rawSignature = convertDERtoRaw(derHex);
    return rawSignature;
}

function convertDERtoRaw(derHex) {
    // Parse DER format
    let pos = 0;
    
    // Skip the 0x30 byte (SEQUENCE tag)
    if (derHex.substring(pos, pos + 2) !== '30') {
        throw new Error('Invalid DER signature: expected SEQUENCE tag');
    }
    pos += 2;
    
    // Skip the length
    const length = parseInt(derHex.substring(pos, pos + 2), 16);
    pos += 2;
    
    // Parse r (first INTEGER)
    if (derHex.substring(pos, pos + 2) !== '02') {
        throw new Error('Invalid DER signature: expected INTEGER tag for r');
    }
    pos += 2;
    
    const rLength = parseInt(derHex.substring(pos, pos + 2), 16);
    pos += 2;
    
    let r = derHex.substring(pos, pos + rLength * 2);
    pos += rLength * 2;
    
    // Parse s (second INTEGER)
    if (derHex.substring(pos, pos + 2) !== '02') {
        throw new Error('Invalid DER signature: expected INTEGER tag for s');
    }
    pos += 2;
    
    const sLength = parseInt(derHex.substring(pos, pos + 2), 16);
    pos += 2;
    
    let s = derHex.substring(pos, pos + sLength * 2);
    
    // Remove leading zeros and pad to 32 bytes (64 hex chars) each
    r = r.replace(/^00(?=[0-9a-fA-F])/, '');
    s = s.replace(/^00(?=[0-9a-fA-F])/, '');
    
    r = r.padStart(64, '0');
    s = s.padStart(64, '0');
    
    return r + s;
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