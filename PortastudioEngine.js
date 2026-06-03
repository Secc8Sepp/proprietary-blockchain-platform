window.PortastudioEngine = {
    audioCtx: null,
    tracks: {
        vocals: { buffer: null, source: null, gain: null, panner: null },
        drums:  { buffer: null, source: null, gain: null, panner: null },
        bass:   { buffer: null, source: null, gain: null, panner: null },
        melody: { buffer: null, source: null, gain: null, panner: null }
    },
    masterGain: null,
    tapeSaturation: null,

    init() {
        // Initialize the Web Audio API context
        this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        
        // Create Master Fader
        this.masterGain = this.audioCtx.createGain();
        
        // Create "Tascam 414" analog tape warmth effect
        this.tapeSaturation = this.audioCtx.createWaveShaper();
        this.tapeSaturation.curve = this.makeDistortionCurve(50); // Add analog drive
        
        // Route: Master Fader -> Tape Saturation -> Speakers
        this.masterGain.connect(this.tapeSaturation);
        this.tapeSaturation.connect(this.audioCtx.destination);
        
        console.log('[PORTASTUDIO] 🎛️ 4-Track Engine Ready.');
    },

    async loadStems(stemUrls) {
        // Fetch the 4 stem URLs provided by the StemSplitterEngine
        for (const [trackName, url] of Object.entries(stemUrls)) {
            const response = await fetch(url);
            const arrayBuffer = await response.arrayBuffer();
            const audioBuffer = await this.audioCtx.decodeAudioData(arrayBuffer);
            
            this.tracks[trackName].buffer = audioBuffer;
            
            // Set up hardware routing for this specific track
            this.tracks[trackName].gain = this.audioCtx.createGain();     // Volume Fader
            this.tracks[trackName].panner = this.audioCtx.createStereoPanner(); // Pan Knob
            
            // Route: Track -> Panner -> Fader -> Master
            this.tracks[trackName].panner.connect(this.tracks[trackName].gain);
            this.tracks[trackName].gain.connect(this.masterGain);
        }
        alert("Tape loaded! Ready to mix.");
    },

    play() {
        if (this.audioCtx.state === 'suspended') this.audioCtx.resume();
        
        // Start all 4 tracks simultaneously to keep them perfectly in sync
        for (const trackName in this.tracks) {
            const track = this.tracks[trackName];
            if (track.buffer) {
                track.source = this.audioCtx.createBufferSource();
                track.source.buffer = track.buffer;
                track.source.connect(track.panner);
                track.source.start(0);
            }
        }
    },

    stop() {
        for (const trackName in this.tracks) {
            if (this.tracks[trackName].source) {
                this.tracks[trackName].source.stop();
            }
        }
    },

    // --- HARDWARE KNOB CONTROLS ---
    setVolume(trackName, volumeLevel) {
        // volumeLevel from 0.0 to 1.0
        if (this.tracks[trackName].gain) {
            this.tracks[trackName].gain.gain.value = volumeLevel;
        }
    },

    setPan(trackName, panLevel) {
        // panLevel from -1.0 (Left) to 1.0 (Right)
        if (this.tracks[trackName].panner) {
            this.tracks[trackName].panner.pan.value = panLevel;
        }
    },

    // Math formula to simulate analog tape saturation
    makeDistortionCurve(amount) {
        let k = typeof amount === 'number' ? amount : 50;
        const n_samples = 44100;
        const curve = new Float32Array(n_samples);
        const deg = Math.PI / 180;
        for (let i = 0; i < n_samples; ++i) {
            let x = i * 2 / n_samples - 1;
            curve[i] = (3 + k) * x * 20 * deg / (Math.PI + k * Math.abs(x));
        }
        return curve;
    }
};