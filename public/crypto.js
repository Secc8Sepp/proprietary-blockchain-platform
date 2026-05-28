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
    const hashBuffer = await window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(msgStr));
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const signature = key.sign(hashArray);
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

async function sendSignedTransaction(type, receiver, data) {
    if (!userKeys.publicKey || !userKeys.privateKey) throw new Error("Identity locked.");
    const msgToSign = { sender: userKeys.publicKey, receiver: receiver || "0x00", type: type, data: data, timestamp: Date.now() };
    const signature = await generateClientSignature(userKeys.privateKey, msgToSign);
    const tx = { ...msgToSign, signature };
    const res = await fetch('/api/feed/interact', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(tx) });
    if (!res.ok) { const text = await res.text(); let errStr = "Ledger rejected transaction."; try { errStr = JSON.parse(text).error || errStr; } catch(e) { errStr = `Server Error: ${text.substring(0, 80)}...`; } throw new Error(errStr); }
    
    if (typeof broadcastToMesh === 'function') broadcastToMesh('P2P_BLOCK', tx);
    return tx;
}