// model-manager.js - Shared logic for persistent model storage in OPFS
export async function getModelFile(name, url, onProgress) {
    const root = await navigator.storage.getDirectory();
    
    // Check if file exists in OPFS
    try {
        const fileHandle = await root.getFileHandle(name);
        const file = await fileHandle.getFile();
        if (file.size > 0) {
            console.log(`[ModelManager] Found ${name} in OPFS (${file.size} bytes)`);
            return await file.arrayBuffer();
        }
    } catch (e) {
        console.log(`[ModelManager] ${name} not found in OPFS. Downloading...`);
    }

    // Download if not found
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Failed to download ${name}`);
    
    // Track progress if a stream is available (optional, but good for UX)
    const reader = response.body.getReader();
    const contentLength = +response.headers.get('Content-Length');
    let receivedLength = 0;
    const chunks = [];

    while(true) {
        const {done, value} = await reader.read();
        if (done) break;
        chunks.push(value);
        receivedLength += value.length;
        if (onProgress) onProgress(receivedLength / contentLength);
    }

    const blob = new Blob(chunks);
    const arrayBuffer = await blob.arrayBuffer();

    // Save to OPFS for next time
    try {
        const fileHandle = await root.getFileHandle(name, { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(arrayBuffer);
        await writable.close();
        console.log(`[ModelManager] Saved ${name} to OPFS`);
    } catch (e) {
        console.error(`[ModelManager] Failed to save to OPFS:`, e);
    }

    return arrayBuffer;
}
