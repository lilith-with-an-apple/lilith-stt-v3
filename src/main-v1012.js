// main-v1012.js - Reliable Web Speech API Version
const statusEl = document.getElementById('status');
const startBtn = document.getElementById('start-btn');
const stopBtn = document.getElementById('stop-btn');
const finalTextEl = document.getElementById('final-text');
const activityLog = document.getElementById('activity-log');

let recognition;
let isRecording = false;

function logActivity(msg, isError = false) {
    const line = document.createElement('div');
    line.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
    if (isError) line.style.color = '#ef4444';
    activityLog.appendChild(line);
    activityLog.scrollTop = activityLog.scrollHeight;
}

function init() {
    logActivity('V1012: Initializing Web Speech API...');
    
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
        logActivity('!! Web Speech API not supported', true);
        statusEl.textContent = 'Error: Not Supported';
        return;
    }

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    recognition = new SpeechRecognition();
    recognition.lang = 'ja-JP';
    recognition.continuous = true;
    recognition.interimResults = true;

    recognition.onstart = () => {
        logActivity('✓ Recognition Started');
        statusEl.textContent = 'Status: Listening...';
    };

    recognition.onerror = (e) => {
        logActivity(`!! Error: ${e.error}`, true);
        if (e.error === 'not-allowed') logActivity('Please allow microphone access.');
    };

    recognition.onend = () => {
        logActivity('Recognition Ended');
        if (isRecording) {
            logActivity('Restarting...');
            try { recognition.start(); } catch(e) {}
        }
    };

    recognition.onresult = (e) => {
        let interimText = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
            if (e.results[i].isFinal) {
                finalTextEl.textContent += e.results[i][0].transcript + ' ';
            } else {
                interimText += e.results[i][0].transcript;
            }
        }
        statusEl.textContent = `Listening: ${interimText}`;
    };

    statusEl.textContent = 'Status: READY';
    logActivity('✓ READY');
    startBtn.disabled = false;
}

startBtn.onclick = () => {
    isRecording = true;
    recognition.start();
    startBtn.disabled = true; stopBtn.disabled = false;
};

stopBtn.onclick = () => {
    isRecording = false;
    recognition.stop();
    startBtn.disabled = false; stopBtn.disabled = true;
    statusEl.textContent = 'Status: READY';
};

init();
