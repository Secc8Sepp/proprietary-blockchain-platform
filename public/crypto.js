// ==========================================
// CRYPTO & BLOCKCHAIN TRANSACTION ENGINE
// ==========================================

async function generateClientSignature(privateKeyHex, messageObject) {
    const response = await fetch('/api/auth/sign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ privateKeyHex, dataString: messageObject })
    });
    
    const contentType = response.headers.get("content-type");
    if (!contentType || !contentType.includes("application/json")) {
        throw new Error("Server returned HTML instead of JSON for signature endpoint.");
    }
    
    const result = await response.json();
    if (!response.ok) {
        throw new Error(result.error || "Failed to generate signature via native engine.");
    }
    
    return result.signature;
}

async function uploadMediaAssetFile(fileObject) {
    if (!fileObject) return null;
    const formData = new FormData();
    formData.append('asset', fileObject);
    
    const response = await fetch('/api/upload', { method: 'POST', body: formData });
    const text = await response.text();
    let result;
    try { result = JSON.parse(text); } catch (e) { throw new Error(`Server returned invalid response. Response: ${text.substring(0, 80)}...`); }
    if (!response.ok) throw new Error(result.error || "Upload failed.");
    return result.fileHash;
}