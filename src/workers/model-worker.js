// model-worker.js - REVERT TO EXACT ROOT LOGIC
import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2';

env.allowLocalModels = false;

let transcriber = null;

async function init() {
    try {
        self.postMessage({ type: 'status', data: 'AI Engine Initializing...' });
        transcriber = await pipeline('automatic-speech-recognition', 'Xenova/whisper-tiny', {
            device: 'webgpu'
        }).catch(() => pipeline('automatic-speech-recognition', 'Xenova/whisper-tiny'));

        self.postMessage({ type: 'ready', data: { device: 'Ready' } });
    } catch (err) {
        self.postMessage({ type: 'error', data: err.message });
    }
}

async function processAudio(audioData) {
    try {
        const result = await transcriber(audioData, {
            language: 'japanese',
            task: 'transcribe',
            return_timestamps: false,
        });

        let text = result.text.trim();
        // Remove common hallucinations from previous version
        text = text.replace(/(\(笑\)|笑|ありがとうございます|ご視聴ありがとうございました|チャンネル登録|字幕:)/g, '');

        if (text.length > 2) {
            self.postMessage({ type: 'result', data: { text: text, isFinal: true } });
        }
    } catch (err) {
        console.error('Transcription error:', err);
    }
}

self.onmessage = async (e) => {
    const { type, data } = e.data;
    if (type === 'audio') {
        await processAudio(data);
    }
};

init();
