// main-v1010.js 
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
    while (activityLog.children.length > 20) activityLog.removeChild(activityLog.firstChild);
}

window.onerror = (msg, url, line) => {
    logActivity(`FATAL: ${msg}`, true);
};

async function init() {
    logActivity('V1010: Local Engine Boot...');
    
    try {
        if (activeWorker) activeWorker.terminate();
        
        activeWorker = new Worker('src/workers/worker-v1010.js');
        
        activeWorker.onerror = (e) => {
            logActivity(`Worker Error: ${e.message}`, true);
        };

        activeWorker.onmessage = (e) => {
            const { type, data } = e.data;
            if (type === 'ready') {
                statusEl.textContent = 'Status: Ready';
                logActivity('✓ ENGINE READY');
                startBtn.disabled = false;
            } else if (type === 'status') {
                statusEl.textContent = `Status: ${data}`;
                logActivity(`> ${data}`);
            } else if (type === 'result') {
                placeholderEl.style.display = 'none';
                finalTextEl.textContent += data.text + ' ';
                logActivity(`Rec: ${data.text.substring(0, 15)}...`);
            } else if (type === 'error') {
                logActivity(`!! ${data}`, true);
            }
        };

        activeWorker.postMessage({ type: 'init' });

    } catch (e) {
        logActivity(`Init Failure: ${e.message}`, true);
    }
}

async function startRecording() {
    try {
        audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
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
            if (volume > VAD_THRESHOLD) audioBuffer.push(new Float32Array(inputData));
            if (audioBuffer.length >= CHUNK_SIZE) {
                activeWorker.postMessage({ type: 'audio', data: flattenArray(audioBuffer) });
                audioBuffer = [];
            }
        };
        startBtn.disabled = true; stopBtn.disabled = false;
    } catch (err) { 
        logActivity(`Mic Error: ${err.message}`, true);
    }
}

function flattenArray(chunks) {
    const totalLength = chunks.reduce((acc, c) => acc + c.length, 0);
    const result = new Float32Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
    return result;
}

startBtn.onclick = startRecording;
stopBtn.onclick = () => {
    isRecording = false;
    if (stream) stream.getTracks().forEach(t => t.stop());
    if (audioContext) audioContext.close();
    startBtn.disabled = false; stopBtn.disabled = true;
    logActivity('Stopped.');
};

init();
