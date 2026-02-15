// worker-v1010.js - LOCAL ENGINE LOADING
let isReady = false;
let recognizer = null;
let stream = null;

function logToMain(type, data) {
    self.postMessage({ type, data });
}

// --- Emscripten Helpers ---
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
    const len = transducer.len + 12 * 4; 
    const ptr = Module._malloc(len);
    let offset = 0;
    Module._CopyHeap(transducer.ptr, transducer.len, ptr + offset);
    offset = transducer.len;
    
    const tokensLen = Module.lengthBytesUTF8(config.tokens || '') + 1;
    const buffer = Module._malloc(tokensLen);
    Module.stringToUTF8(config.tokens, buffer, tokensLen);
    
    Module.setValue(ptr + offset, buffer, 'i8*'); 
    offset += 4;
    Module.setValue(ptr + offset, config.numThreads || 1, 'i32');
    offset += 4;
    Module.setValue(ptr + offset, 1, 'i32'); 
    
    return { buffer, ptr, len, transducer };
}

function initSherpaOnnxOnlineRecognizerConfig(config, Module) {
    const model = initSherpaOnnxOnlineModelConfig(config.modelConfig, Module);
    const len = model.len + 20 * 4;
    const ptr = Module._malloc(len);
    Module._CopyHeap(model.ptr, model.len, ptr);
    return { ptr, len, model };
}

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

async function getPersistentFile(url, name) {
    logToMain('status', `Checking ${name}...`);
    try {
        const root = await navigator.storage.getDirectory();
        const handle = await root.getFileHandle(name, { create: true });
        const file = await handle.getFile();
        if (file.size > 0) {
            logToMain('status', `Cache HIT: ${name}`);
            return await file.arrayBuffer();
        }

        logToMain('status', `Downloading ${name}...`);
        const res = await fetch(url);
        if (!res.ok) throw new Error(`Fetch ${name} fail: ${res.status}`);
        const buffer = await res.arrayBuffer();

        const writable = await handle.createWritable();
        await writable.write(buffer);
        await writable.close();
        logToMain('status', `Saved to Cache: ${name}`);
        return buffer;
    } catch (e) {
        logToMain('error', `OPFS Error (${name}): ${e.message}`);
        const res = await fetch(url);
        return await res.arrayBuffer();
    }
}

async function init() {
    try {
        logToMain('status', 'Loading Engine WASM...');
        // USE LOCAL PATH FOR ENGINE WASM
        const wasmUrl = '../lib/sherpa-onnx-asr.wasm';
        const wasmBinary = await getPersistentFile(wasmUrl, 'sherpa-onnx-asr.wasm');
        
        return new Promise((resolve, reject) => {
            self.Module = {
                wasmBinary: wasmBinary,
                locateFile: (p) => p,
                onRuntimeInitialized: async () => {
                    try {
                        logToMain('status', 'ASR Runtime Ready. Loading Models...');
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

                        logToMain('status', 'Initializing Recognizer...');
                        recognizer = new OnlineRecognizer({
                            modelConfig: {
                                transducer: { encoder: '/encoder.onnx', decoder: '/decoder.onnx', joiner: '/joiner.onnx' },
                                tokens: '/tokens.txt',
                                numThreads: 1
                            }
                        }, self.Module);
                        
                        stream = recognizer.createStream();
                        isReady = true;
                        logToMain('ready', 'READY');
                        resolve();
                    } catch (e) {
                        logToMain('error', `Init sub-error: ${e.message}`);
                        reject(e);
                    }
                }
            };

            importScripts('../lib/sherpa-onnx-asr.js');
        });
    } catch (err) {
        logToMain('error', `Global Init Error: ${err.message}`);
    }
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
