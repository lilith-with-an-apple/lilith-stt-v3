// main.js - Final verified implementation (V1006)
const statusEl = document.getElementById('status');
const storageInfoEl = document.getElementById('storage-info');
const startBtn = document.getElementById('start-btn');
const stopBtn = document.getElementById('stop-btn');
const exportBtn = document.getElementById('export-btn');
const copyLogBtn = document.getElementById('copy-log-btn');
const downloadLogBtn = document.getElementById('download-log-btn');
const finalTextEl = document.getElementById('final-text');
const volumeBar = document.getElementById('volume-bar');
const placeholderEl = document.getElementById('placeholder');
const activityLog = document.getElementById('activity-log');

let activeWorker;
let storageWorker;
let audioContext;
let stream;
let processor;
let audioBuffer = [];
let isRecording = false;
let fullLogs = [];

const VAD_THRESHOLD = 0.015; 
const CHUNK_SIZE = 30; 

function logActivity(msg, isError = false) {
    const time = new Date().toLocaleTimeString();
    const logLine = `[${time}] ${msg}`;
    fullLogs.push(logLine);
    const line = document.createElement('div');
    line.textContent = logLine;
    if (isError) line.style.color = '#ef4444';
    activityLog.appendChild(line);
    while (activityLog.children.length > 10) activityLog.removeChild(activityLog.firstChild);
    console.log(logLine);
}

// Global error catcher for debugging
window.onerror = (msg, url, line) => {
    logActivity(`Fatal Error: ${msg} (${url}:${line})`, true);
    statusEl.textContent = 'Status: Crashed';
};

async function init() {
    logActivity('V1006: System Startup...');
    
    try {
        // Clear previous state
        if (activeWorker) activeWorker.terminate();
        
        activeWorker = new Worker(`src/workers/sherpa-worker.js?v=${new Date().getTime()}`);
        
        activeWorker.onerror = (e) => {
            logActivity(`Worker Crash: ${e.message}`, true);
            statusEl.textContent = 'Status: Worker Error';
        };

        activeWorker.onmessage = (e) => {
            const { type, data } = e.data;
            if (type === 'ready') {
                statusEl.textContent = 'Status: Ready';
                logActivity('Engine Loaded: Ready');
                startBtn.disabled = false;
            } else if (type === 'storage_info') {
                storageInfoEl.textContent = `Cache: ${data}`;
                if (data.includes('Cached')) storageInfoEl.classList.add('active');
            } else if (type === 'status') {
                statusEl.textContent = `Status: ${data}`;
                logActivity(`Status: ${data}`);
            } else if (type === 'result') {
                placeholderEl.style.display = 'none';
                finalTextEl.textContent += data.text + ' ';
                logActivity(`Recog: ${data.text.substring(0, 15)}...`);
                storageWorker.postMessage({ type: 'save_history', data: data.text });
            } else if (type === 'error') {
                statusEl.textContent = `Error: ${data}`;
                logActivity(`Engine Error: ${data}`, true);
            }
        };

        activeWorker.postMessage({ type: 'init' });

        storageWorker = new Worker('src/workers/storage-worker.js');
        storageWorker.postMessage({ type: 'init' });
    } catch (e) {
        logActivity(`Init Failure: ${e.message}`, true);
    }
    
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('sw.js').catch(err => console.error(err));
    }
}

async function startRecording() {
    try {
        logActivity('Accessing Microphone...');
        audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
        stream = await navigator.mediaDevices.getUserMedia({ 
            audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } 
        });
        const source = audioContext.createMediaStreamSource(stream);
        processor = audioContext.createScriptProcessor(4096, 1, 1);
        
        source.connect(processor);
        processor.connect(audioContext.destination);

        isRecording = true;
        logActivity('Listening...');

        processor.onaudioprocess = (e) => {
            const inputData = e.inputBuffer.getChannelData(0);
            const volume = Math.max(...inputData.map(Math.abs));
            volumeBar.style.width = (volume * 100) + '%';
            if (volume > VAD_THRESHOLD) {
                audioBuffer.push(new Float32Array(inputData));
            }
            if (audioBuffer.length >= CHUNK_SIZE) {
                const fullBuffer = flattenArray(audioBuffer);
                audioBuffer = [];
                activeWorker.postMessage({ type: 'audio', data: fullBuffer });
                statusEl.textContent = 'Status: Analyzing...';
            }
        };
        startBtn.disabled = true; stopBtn.disabled = false;
        statusEl.textContent = 'Status: Recording...';
    } catch (err) { 
        logActivity(`Mic Error: ${err.message}`, true);
        statusEl.textContent = `Error: ${err.message}`;
    }
}

function flattenArray(chunks) {
    const totalLength = chunks.reduce((acc, c) => acc + c.length, 0);
    const result = new Float32Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.length;
    }
    return result;
}

function stopRecording() {
    isRecording = false;
    logActivity('Stopped.');
    if (stream) stream.getTracks().forEach(t => t.stop());
    if (audioContext) audioContext.close();
    audioBuffer = [];
    startBtn.disabled = false; stopBtn.disabled = true;
    statusEl.textContent = 'Status: Ready';
    volumeBar.style.width = '0%';
}

function copyLogs() {
    const text = fullLogs.join('\n');
    navigator.clipboard.writeText(text).then(() => {
        const originalText = copyLogBtn.textContent;
        copyLogBtn.textContent = 'コピー完了！';
        setTimeout(() => copyLogBtn.textContent = originalText, 2000);
    });
}

function downloadLogs() {
    const text = fullLogs.join('\n');
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `stt_log_${new Date().getTime()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
}

startBtn.onclick = startRecording;
stopBtn.onclick = stopRecording;
exportBtn.onclick = () => storageWorker.postMessage({ type: 'export_history' });
copyLogBtn.onclick = copyLogs;
downloadLogBtn.onclick = downloadLogs;

init();
