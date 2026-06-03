class AutoTuneProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this.bufferSize = 4096;
        this.ringBuffer = new Float32Array(this.bufferSize);
        this.writePtr = 0;
        
        this.readPtr1 = 0;
        this.readPtr2 = this.bufferSize / 2;
        this.ratio = 1.0;
        
        this.frameCount = 0;
        this.currentPitch = 0;

        this.rootNote = 0; // Default C
        this.scale = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]; // Default Chromatic
        this.speed = 1.0;
        this.amount = 1.0;
        
        this.port.onmessage = (event) => {
            if (event.data.type === 'set-params' || event.data.type === 'set-scale') {
                if (event.data.rootNote !== undefined) this.rootNote = event.data.rootNote;
                if (event.data.scale !== undefined) this.scale = event.data.scale;
                if (event.data.speed !== undefined) this.speed = event.data.speed;
                if (event.data.amount !== undefined) this.amount = event.data.amount;
            }
        };
    }

    detectPitch() {
        let minDiff = Infinity;
        let period = 0;
        const maxPeriod = Math.floor(sampleRate / 60); // 60 Hz min
        const minPeriod = Math.floor(sampleRate / 1000); // 1000 Hz max
        
        // Simple AMDF (Average Magnitude Difference Function) to find fundamental frequency
        for (let p = minPeriod; p < maxPeriod; p++) {
            let diff = 0;
            for (let i = 0; i < 512; i++) {
                let idx1 = (this.writePtr - i - 1 + this.bufferSize) % this.bufferSize;
                let idx2 = (this.writePtr - i - 1 - p + this.bufferSize * 2) % this.bufferSize;
                diff += Math.abs(this.ringBuffer[idx1] - this.ringBuffer[idx2]);
            }
            if (diff < minDiff) {
                minDiff = diff;
                period = p;
            }
        }
        return period === 0 ? 0 : sampleRate / period;
    }

    getClosestNoteRatio(freq) {
        if (freq < 60 || freq > 1000) return 1.0;
        
        const midiFloat = 69 + 12 * Math.log2(freq / 440);
        const midiInt = Math.round(midiFloat);
        
        let closestMidi = midiInt;
        let minDistance = Infinity;
        
        // Find closest allowed note in the selected scale/key
        for (let i = midiInt - 12; i <= midiInt + 12; i++) {
            const noteClass = (i - this.rootNote) % 12;
            const normalizedNoteClass = noteClass < 0 ? noteClass + 12 : noteClass;
            
            if (this.scale.includes(normalizedNoteClass)) {
                const dist = Math.abs(midiFloat - i);
                if (dist < minDistance) { minDistance = dist; closestMidi = i; }
            }
        }
        
        const targetFreq = 440 * Math.pow(2, (closestMidi - 69) / 12);
        let r = targetFreq / freq;
        if (r > 2.0) r = 2.0;
        if (r < 0.5) r = 0.5;
        return r;
    }

    process(inputs, outputs, parameters) {
        const input = inputs[0];
        const output = outputs[0];
        if (!input || !input[0] || !output || !output[0]) return true;
        
        const channelIn = input[0];
        const channelOut = output[0];

        for (let i = 0; i < channelIn.length; i++) {
            this.ringBuffer[this.writePtr] = channelIn[i];
            
            // Run pitch detection every 512 samples (~11ms)
            if (this.frameCount % 512 === 0) {
                this.currentPitch = this.detectPitch();
                let targetRatio = this.getClosestNoteRatio(this.currentPitch);
                
                targetRatio = 1.0 + (targetRatio - 1.0) * this.amount;
                const smoothing = 0.95 - (this.speed * 0.95);
                this.ratio = this.ratio * smoothing + targetRatio * (1.0 - smoothing);
            }
            
            this.readPtr1 = (this.readPtr1 + this.ratio) % this.bufferSize;
            this.readPtr2 = (this.readPtr2 + this.ratio) % this.bufferSize;
            const idx1 = Math.floor(this.readPtr1);
            const idx2 = Math.floor(this.readPtr2);
            
            // Calculate distance from write pointer (0.0 to 1.0)
            const phase1 = ((this.writePtr - this.readPtr1 + this.bufferSize) % this.bufferSize) / this.bufferSize;
            const phase2 = ((this.writePtr - this.readPtr2 + this.bufferSize) % this.bufferSize) / this.bufferSize;
            
            // Create window envelope (0 at write pointer collision, 1 at opposite side)
            const env1 = Math.sin(Math.PI * phase1);
            const env2 = Math.sin(Math.PI * phase2);
            
            // Crossfade pointers to hide wrap-around glitches
            const shiftedSample = (this.ringBuffer[idx1] * env1 + this.ringBuffer[idx2] * env2) / (env1 + env2 || 1);
            
            channelOut[i] = Math.abs(this.ratio - 1.0) < 0.01 ? channelIn[i] : shiftedSample;
            
            this.writePtr = (this.writePtr + 1) % this.bufferSize;
            this.frameCount++;
        }
        
        if (output.length > 1 && input.length > 0) output[1].set(channelOut);
        return true;
    }
}

registerProcessor('autotune-processor', AutoTuneProcessor);