window.FXEngine = {
    init() {
        console.log('[INIT] FX Engine ready.');
    },

    // Mathematical formula to simulate analog tape saturation
    makeDistortionCurve(amount = 50) {
        const k = typeof amount === 'number' ? amount : 50;
        const n_samples = 44100;
        const curve = new Float32Array(n_samples);
        const deg = Math.PI / 180;
        const maxVal = ((3 + k) * 20 * deg) / (Math.PI + k);
        for (let i = 0; i < n_samples; ++i) {
            let x = i * 2 / n_samples - 1;
            let val = (3 + k) * x * 20 * deg / (Math.PI + k * Math.abs(x));
            curve[i] = val / maxVal; // Normalize so it peaks back at -1.0 to 1.0
        }
        return curve;
    },

    // Generate an impulse response for Natural Reverb
    createReverbIR(audioCtx, duration, decay) {
        const sampleRate = audioCtx.sampleRate;
        const length = sampleRate * duration;
        const impulse = audioCtx.createBuffer(2, length, sampleRate);
        const left = impulse.getChannelData(0);
        const right = impulse.getChannelData(1);
        
        let lastL = 0, lastR = 0;
        for (let i = 0; i < length; i++) {
            // True exponential decay (T60 target)
            const envelope = Math.exp(-6.91 * (i / length) * decay);
            
            // Apply 1-pole lowpass filter to noise to simulate high-frequency air absorption
            lastL = (lastL + (Math.random() * 2 - 1)) * 0.5;
            lastR = (lastR + (Math.random() * 2 - 1)) * 0.5;
            
            left[i] = lastL * envelope;
            right[i] = lastR * envelope;
        }
        return impulse;
    },

    // Build Native WebAssembly C++ Effect Chains
    buildNativeFxChain(ctx, wasmModule, type, inputNode, outputNode, p1Val, p2Val) {
        let param1 = (v) => {};
        let param2 = (v) => {};
        let nodes = [];
        
        try {
            const fxNode = new AudioWorkletNode(ctx, 'native-fx-processor', {
                processorOptions: { wasmModule: wasmModule }
            });
            
            fxNode.port.postMessage({ type: 'set-type', fxType: type });
            
            inputNode.connect(fxNode);
            fxNode.connect(outputNode);
            
            param1 = (v) => { fxNode.port.postMessage({ type: 'set-param1', value: v }); };
            param2 = (v) => { fxNode.port.postMessage({ type: 'set-param2', value: v }); };
            nodes = [fxNode];
        } catch(e) {
            console.warn('[FX ENGINE] Native FX Processor failed to load, bypassing.', e);
            inputNode.connect(outputNode); 
        }
        
        param1(p1Val);
        param2(p2Val);
        
        return { nodes, param1, param2 };
    },

    // Standard Web Audio API Punch-in FX
    applyPunchInFx(fxNode, type) {
        if (!fxNode) return;
        if (type === 'lowpass') {
            fxNode.type = 'lowpass';
            fxNode.frequency.value = 400;
        } else if (type === 'highpass') {
            fxNode.type = 'highpass';
            fxNode.frequency.value = 3000;
        } else {
            fxNode.type = 'allpass'; // Transparent Reset
        }
    }
};