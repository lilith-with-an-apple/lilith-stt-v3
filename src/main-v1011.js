// main-v1011.js
const statusEl = document.getElementById('status');
const startBtn = document.getElementById('start-btn');
const stopBtn = document.getElementById('stop-btn');
const finalTextEl = document.getElementById('final-text');
const volumeBar = document.getElementById('volume-bar');
const activityLog = document.getElementById('activity-log');

let activeWorker;
let audioContext;
let stream;
let processor;
let audioBuffer = [];
let isRecording = false;

function logActivity(msg, isError = false) {
    const line = document.createElement('div');
    line.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
    if (isError) line.style.color = '#ef4444';
    activityLog.appendChild(line);
    activityLog.scrollTop = activityLog.scrollHeight;
}

async function init() {
    logActivity('V1011: Start');
    try {
        // Clear previous Service Workers and Caches for testing
        const regs = await navigator.serviceWorker.getRegistrations();
        for(let r of regs) await r.unregister();
        
        activeWorker = new Worker('/lilith-stt-v3/src/workers/worker-v1011.js');
        activeWorker.onmessage = (e) => {
            const { type, data } = e.data;
            if (type === 'ready') {
                statusEl.textContent = 'Status: READY';
                logActivity('✓ READY');
                startBtn.disabled = false;
            } else if (type === 'status') {
                statusEl.textContent = `Status: ${data}`;
                logActivity(`> ${data}`);
            } else if (type === 'result') {
                finalTextEl.textContent += data.text + ' ';
            } else if (type === 'error') {
                logActivity(`!! ${data}`, true);
            }
        };
        activeWorker.postMessage({ type: 'init' });
    } catch (e) {
        logActivity(`Init Err: ${e.message}`, true);
    }
}

async function start() {
    audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const source = audioContext.createMediaStreamSource(stream);
    processor = audioContext.createScriptProcessor(4096, 1, 1);
    source.connect(processor);
    processor.connect(audioContext.destination);
    isRecording = true;
    processor.onaudioprocess = (e) => {
        const inputData = e.inputBuffer.getChannelData(0);
        const volume = Math.max(...inputData.map(Math.abs));
        volumeBar.style.width = (volume * 100) + '%';
        if (volume > 0.015) audioBuffer.push(new Float32Array(inputData));
        if (audioBuffer.length >= 30) {
            const result = new Float32Array(audioBuffer.length * 4096);
            let offset = 0;
            for (let b of audioBuffer) { result.set(b, offset); offset += b.length; }
            activeWorker.postMessage({ type: 'audio', data: result });
            audioBuffer = [];
        }
    };
    startBtn.disabled = true; stopBtn.disabled = false;
}

startBtn.onclick = start;
stopBtn.onclick = () => {
    isRecording = false;
    if (stream) stream.getTracks().forEach(t => t.stop());
    if (audioContext) audioContext.close();
    startBtn.disabled = false; stopBtn.disabled = true;
};

init();
