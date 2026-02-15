// audio-worker.js - V11 Sensitive & Natural
import { InferenceSession, Tensor } from 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.19.0/dist/ort.mjs';

let session;
let sr = 16000;
let h = new Float32Array(2 * 1 * 64).fill(0);
let c = new Float32Array(2 * 1 * 64).fill(0);

async function init() {
    try {
        const modelUrl = 'https://cdn.jsdelivr.net/npm/@ricky0123/vad-web@0.0.7/dist/silero_vad.onnx';
        session = await InferenceSession.create(modelUrl);
        self.postMessage({ type: 'status', data: 'VAD: Ready' });
    } catch (err) {
        self.postMessage({ type: 'error', data: `VAD Error: ${err.message}` });
    }
}

async function processAudio(audioData) {
    if (!session) return;

    // Normalizing audio locally before VAD
    let input = new Float32Array(audioData);
    let maxVal = 0;
    for (let i = 0; i < input.length; i++) {
        const abs = Math.abs(input[i]);
        if (abs > maxVal) maxVal = abs;
    }
    if (maxVal > 0) {
        for (let i = 0; i < input.length; i++) input[i] /= maxVal;
    }

    const tensor = new Tensor('float32', input, [1, input.length]);
    const inputs = {
        input: tensor,
        sr: new Tensor('int64', BigInt64Array.from([BigInt(sr)]), []),
        h: new Tensor('float32', h, [2, 1, 64]),
        c: new Tensor('float32', c, [2, 1, 64])
    };

    const out = await session.run(inputs);
    h = out.hn.data;
    c = out.cn.data;

    const prob = out.output.data[0];
    
    // Very sensitive VAD (0.1) - Just to filter out dead silence
    if (prob > 0.1) {
        self.postMessage({ type: 'audio', data: audioData });
    } else {
        self.postMessage({ type: 'silence', prob: prob.toFixed(3) });
    }
}

self.onmessage = async (e) => {
    const { type, data } = e.data;
    if (type === 'init') await init();
    else if (type === 'audio') await processAudio(data);
};
