// sherpa-worker.js - FULL ASR IMPLEMENTATION (V1011)
let isReady = false;
let recognizer = null;
let stream = null;

// --- Emscripten Helpers (Extracted from official HF Space) ---
function freeConfig(config, Module) {
    if ('buffer' in config) Module._free(config.buffer);
    if ('config' in config) freeConfig(config.config, Module);
    if ('transducer' in config) freeConfig(config.transducer, Module);
    if ('feat' in config) freeConfig(config.feat, Module);
    if ('model' in config) freeConfig(config.model, Module);
    Module._free(config.ptr);
}

function initSherpaOnnxOnlineTransducerModelConfig(config, Module) {
    const encoderLen = Module.lengthBytesUTF8(config.encoder || '') + 1;
    const decoderLen = Module.lengthBytesUTF8(config.decoder || '') + 1;
    const joinerLen = Module.lengthBytesUTF8(config.joiner || '') + 1;
    const n = encoderLen + decoderLen + joinerLen;
    const buffer = Module._malloc(n);
    const len = 3 * 4;
    const ptr = Module._malloc(len);
    let offset = 0;
    Module.stringToUTF8(config.encoder || '', buffer + offset, encoderLen);
    offset += encoderLen;
    Module.stringToUTF8(config.decoder || '', buffer + offset, decoderLen);
    offset += decoderLen;
    Module.stringToUTF8(config.joiner || '', buffer + offset, joinerLen);
    offset = 0;
    Module.setValue(ptr, buffer + offset, 'i8*');
    offset += encoderLen;
    Module.setValue(ptr + 4, buffer + offset, 'i8*');
    offset += decoderLen;
    Module.setValue(ptr + 8, buffer + offset, 'i8*');
    return { buffer, ptr, len };
}

function initSherpaOnnxOnlineModelConfig(config, Module) {
    const transducer = initSherpaOnnxOnlineTransducerModelConfig(config.transducer, Module);
    const len = transducer.len + 12 * 4; // Simplified padding
    const ptr = Module._malloc(len);
    let offset = 0;
    Module._CopyHeap(transducer.ptr, transducer.len, ptr + offset);
    offset = transducer.len;
    
    const tokensLen = Module.lengthBytesUTF8(config.tokens || '') + 1;
    const buffer = Module._malloc(tokensLen);
    Module.stringToUTF8(config.tokens, buffer, tokensLen);
    
    Module.setValue(ptr + offset, buffer, 'i8*'); // tokens
    offset += 4;
    Module.setValue(ptr + offset, config.numThreads || 1, 'i32');
    offset += 4;
    Module.setValue(ptr + offset, 1, 'i32'); // debug
    
    return { buffer, ptr, len, transducer };
}

function initSherpaOnnxOnlineRecognizerConfig(config, Module) {
    const model = initSherpaOnnxOnlineModelConfig(config.modelConfig, Module);
    const len = model.len + 20 * 4;
    const ptr = Module._malloc(len);
    Module._CopyHeap(model.ptr, model.len, ptr);
    return { ptr, len, model };
}

// --- High Level API ---
class OnlineStream {
    constructor(handle, Module) {
        this.handle = handle;
        this.Module = Module;
    }
    acceptWaveform(sampleRate, samples) {
        const ptr = this.Module._malloc(samples.length * 4);
        this.Module.HEAPF32.set(samples, ptr / 4);
        this.Module._SherpaOnnxOnlineStreamAcceptWaveform(this.handle, sampleRate, ptr, samples.length);
        this.Module._free(ptr);
    }
}

class OnlineRecognizer {
    constructor(configObj, Module) {
        const config = initSherpaOnnxOnlineRecognizerConfig(configObj, Module);
        this.handle = Module._SherpaOnnxCreateOnlineRecognizer(config.ptr);
        this.Module = Module;
    }
    createStream() {
        const handle = this.Module._SherpaOnnxCreateOnlineStream(this.handle);
        return new OnlineStream(handle, this.Module);
    }
    decode(stream) {
        this.Module._SherpaOnnxDecodeOnlineStream(this.handle, stream.handle);
    }
    getResult(stream) {
        const r = this.Module._SherpaOnnxGetOnlineStreamResultAsJson(this.handle, stream.handle);
        const text = this.Module.UTF8ToString(r);
        this.Module._SherpaOnnxDestroyOnlineStreamResultJson(r);
        return JSON.parse(text);
    }
}

// --- Lifecycle ---
async function getPersistentFile(url, name) {
    try {
        const root = await navigator.storage.getDirectory();
        const handle = await root.getFileHandle(name, { create: true });
        
        // Try to read from existing file
        const file = await handle.getFile();
        if (file.size > 0) {
            const sizeMB = (file.size / (1024 * 1024)).toFixed(1);
            self.postMessage({ type: 'status', data: `Loading ${name} from cache (${sizeMB}MB)...` });
            self.postMessage({ type: 'storage_info', data: `Using Cache (${sizeMB}MB Loaded)` });
            return await file.arrayBuffer();
        }

        // If not found or empty, download
        self.postMessage({ type: 'status', data: `Downloading ${name} (One-time)...` });
        self.postMessage({ type: 'storage_info', data: 'Downloading Model (One-time cost)' });
        const res = await fetch(url);
        if (!res.ok) throw new Error(`Fetch ${name} fail`);
        const buffer = await res.arrayBuffer();

        // Save to OPFS
        const writable = await handle.createWritable();
        await writable.write(buffer);
        await writable.close();
        
        return buffer;
    } catch (e) {
        console.warn(`OPFS failed for ${name}, falling back to network:`, e);
        const res = await fetch(url);
        return await res.arrayBuffer();
    }
}

async function init() {
    try {
        const wasmUrl = 'https://huggingface.co/spaces/k2-fsa/automatic-speech-recognition/resolve/main/wasm/sherpa-onnx-asr.wasm';
        const wasmBinary = await getPersistentFile(wasmUrl, 'sherpa-onnx-asr.wasm');
        
        return new Promise((resolve, reject) => {
            self.Module = {
                wasmBinary: wasmBinary,
                locateFile: (p) => p,
                onRuntimeInitialized: async () => {
                    try {
                        logToMain('WASM Runtime Ready');
                        const baseUrl = 'https://huggingface.co/reazon-research/reazonspeech-k2-v2/resolve/main/';
                        const files = [
                            { name: 'encoder.onnx', url: baseUrl + 'encoder-epoch-99-avg-1.int8.onnx' },
                            { name: 'decoder.onnx', url: baseUrl + 'decoder-epoch-99-avg-1.int8.onnx' },
                            { name: 'joiner.onnx', url: baseUrl + 'joiner-epoch-99-avg-1.int8.onnx' },
                            { name: 'tokens.txt', url: baseUrl + 'tokens.txt' }
                        ];

                        for (const file of files) {
                            const data = await getPersistentFile(file.url, file.name);
                            self.Module.FS_createDataFile('/', file.name, new Uint8Array(data), true, false, false);
                        }

                        recognizer = new OnlineRecognizer({
                            modelConfig: {
                                transducer: { encoder: '/encoder.onnx', decoder: '/decoder.onnx', joiner: '/joiner.onnx' },
                                tokens: '/tokens.txt',
                                numThreads: 1
                            }
                        }, self.Module);
                        
                        stream = recognizer.createStream();
                        isReady = true;
                        self.postMessage({ type: 'ready' });
                        resolve();
                    } catch (e) {
                        self.postMessage({ type: 'error', data: e.message });
                        reject(e);
                    }
                }
            };

            importScripts('../lib/sherpa-onnx-asr.js');
        });
    } catch (err) {
        self.postMessage({ type: 'error', data: err.message });
    }
}

function logToMain(msg) {
    self.postMessage({ type: 'status', data: msg });
}

self.onmessage = async (e) => {
    if (e.data.type === 'init') await init();
    else if (e.data.type === 'audio' && isReady) {
        stream.acceptWaveform(16000, e.data.data);
        while (recognizer.Module._SherpaOnnxIsOnlineStreamReady(recognizer.handle, stream.handle)) {
            recognizer.decode(stream);
        }
        const result = recognizer.getResult(stream);
        if (result.text) {
            self.postMessage({ type: 'result', data: { text: result.text, isFinal: true } });
        }
    }
};
