window.VODstudioEngine = {
    audioCtx: null,
    tracks: {
        track1: { name: 'TRACK 1', buffer: null, source: null, gain: null, panner: null, trim: null, eqHigh: null, eqLow: null, eff1Send: null, eff2Send: null, autotuneBypass: null, autotuneMix: null, autotuneNode: null, autotuneEnabled: false, analyser: null, dataArray: null, tapeSaturation: null, isMuted: false, isSoloed: false, targetVolume: 0.55, vocalChain: false, autoScoop: false, widthVal: 0.5 },
        track2: { name: 'TRACK 2', buffer: null, source: null, gain: null, panner: null, trim: null, eqHigh: null, eqLow: null, eff1Send: null, eff2Send: null, autotuneBypass: null, autotuneMix: null, autotuneNode: null, autotuneEnabled: false, analyser: null, dataArray: null, tapeSaturation: null, isMuted: false, isSoloed: false, targetVolume: 0.55, vocalChain: false, autoScoop: false, widthVal: 0.5 },
        track3: { name: 'TRACK 3', buffer: null, source: null, gain: null, panner: null, trim: null, eqHigh: null, eqLow: null, eff1Send: null, eff2Send: null, autotuneBypass: null, autotuneMix: null, autotuneNode: null, autotuneEnabled: false, analyser: null, dataArray: null, tapeSaturation: null, isMuted: false, isSoloed: false, targetVolume: 0.55, vocalChain: false, autoScoop: false, widthVal: 0.5 },
        track4: { name: 'TRACK 4', buffer: null, source: null, gain: null, panner: null, trim: null, eqHigh: null, eqLow: null, eff1Send: null, eff2Send: null, autotuneBypass: null, autotuneMix: null, autotuneNode: null, autotuneEnabled: false, analyser: null, dataArray: null, tapeSaturation: null, isMuted: false, isSoloed: false, targetVolume: 0.55, vocalChain: false, autoScoop: false, widthVal: 0.5 }
    },
    masterGain: null,
    limiterNode: null,
    limiterEnabled: false,
    masterAnalyser: null,
    masterDataArray: null,
    vuMeterAnimation: null,

    tapeSaturation: null,
    playbackRate: 1.0,
    
    fx1Type: 'delay', fx1Param1Val: 0.4, fx1Param2Val: 0.33,
    fx2Type: 'lowpass', fx2Param1Val: 0.15, fx2Param2Val: 0.05,
    
    globalFx1Input: null, globalFx2Input: null,
    fx1Nodes: null, fx2Nodes: null,
    fx1Param1: null, fx1Param2: null, fx2Param1: null, fx2Param2: null,

    autotuneRootNote: 0,
    autotuneScaleType: 'chromatic',
    autotuneSpeedVal: 1.0,
    autotuneAmountVal: 1.0,

    isRecording: false,
    armedTrack: null,
    micStream: null,
    mediaRecorder: null,

    playbackStartTime: 0,
    maxDuration: 0,
    tapeAnimFrame: null,
    playbackPosition: 0,
    isPlaying: false,
    currentKnobRots: new Map(),

    async init() {
        // Initialize the Web Audio API context
        this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        
        // Load Native AutoTune Worklet
        try {
            await this.audioCtx.audioWorklet.addModule('/AutoTuneProcessor.js');
        } catch(e) {
            console.warn('[VODSTUDIO] Could not load AutoTuneProcessor', e);
        }

        // Create Master Fader
        this.masterGain = this.audioCtx.createGain();
        
        // Create Limiter to prevent clipping
        this.limiterNode = this.audioCtx.createDynamicsCompressor();
        this.limiterNode.threshold.value = -2.0;
        this.limiterNode.knee.value = 0.0;
        this.limiterNode.ratio.value = this.limiterEnabled ? 20.0 : 1.0;
        this.limiterNode.attack.value = 0.005;
        this.limiterNode.release.value = 0.050;

        // Create "VODCAM 414" analog tape warmth effect
        this.tapeSaturation = this.audioCtx.createWaveShaper();
        this.tapeSaturation.curve = window.FXEngine.makeDistortionCurve(50); // Add analog drive
        
        // Create Analyser for VU Meter
        this.masterAnalyser = this.audioCtx.createAnalyser();
        this.masterAnalyser.fftSize = 256;
        this.masterDataArray = new Uint8Array(this.masterAnalyser.frequencyBinCount);

        // Route: Master Fader -> Limiter -> Analyser -> Tape Saturation -> Speakers
        this.masterGain.connect(this.limiterNode);
        this.limiterNode.connect(this.masterAnalyser);
        this.masterAnalyser.connect(this.tapeSaturation);
        this.tapeSaturation.connect(this.audioCtx.destination);
        
        this.globalFx1Input = this.audioCtx.createGain();
        this.globalFx2Input = this.audioCtx.createGain();
        
        this.rebuildFx(1);
        this.rebuildFx(2);

        // Initialize hardware routing for all tracks so it works even without stems loaded
        for (const trackName in this.tracks) {
            this.setupTrackRouting(trackName);
        }
        
        this.loadStudioState();
        console.log('[VODSTUDIO] 🎛️ 4-Track Engine Ready.');
    },

    setupTrackRouting(trackName) {
        if (this.tracks[trackName].gain) return; // Already setup

        // Stereo Width M/S Matrix
        this.tracks[trackName].widthSplitter = this.audioCtx.createChannelSplitter(2);
        this.tracks[trackName].widthMid = this.audioCtx.createGain(); this.tracks[trackName].widthMid.gain.value = 0.5;
        this.tracks[trackName].widthSide = this.audioCtx.createGain(); this.tracks[trackName].widthSide.gain.value = 0.5;
        this.tracks[trackName].widthInvR = this.audioCtx.createGain(); this.tracks[trackName].widthInvR.gain.value = -1.0;
        this.tracks[trackName].widthL = this.audioCtx.createGain();
        this.tracks[trackName].widthR = this.audioCtx.createGain();
        this.tracks[trackName].widthInvSide = this.audioCtx.createGain(); this.tracks[trackName].widthInvSide.gain.value = -1.0;
        this.tracks[trackName].widthMerger = this.audioCtx.createChannelMerger(2);

        this.tracks[trackName].widthSplitter.connect(this.tracks[trackName].widthMid, 0); this.tracks[trackName].widthSplitter.connect(this.tracks[trackName].widthMid, 1);
        this.tracks[trackName].widthSplitter.connect(this.tracks[trackName].widthSide, 0); this.tracks[trackName].widthSplitter.connect(this.tracks[trackName].widthInvR, 1); this.tracks[trackName].widthInvR.connect(this.tracks[trackName].widthSide);
        this.tracks[trackName].widthMid.connect(this.tracks[trackName].widthL); this.tracks[trackName].widthMid.connect(this.tracks[trackName].widthR);
        this.tracks[trackName].widthSide.connect(this.tracks[trackName].widthL); this.tracks[trackName].widthSide.connect(this.tracks[trackName].widthInvSide); this.tracks[trackName].widthInvSide.connect(this.tracks[trackName].widthR);
        this.tracks[trackName].widthL.connect(this.tracks[trackName].widthMerger, 0, 0); this.tracks[trackName].widthR.connect(this.tracks[trackName].widthMerger, 0, 1);

        this.tracks[trackName].trim = this.audioCtx.createGain();
        this.tracks[trackName].trim.gain.value = 0.5;

        this.tracks[trackName].vocalFilter = this.audioCtx.createBiquadFilter();
        this.tracks[trackName].vocalFilter.type = 'highpass';
        this.tracks[trackName].vocalFilter.frequency.value = 80;
        this.tracks[trackName].vocalComp = this.audioCtx.createDynamicsCompressor();
        this.tracks[trackName].vocalComp.threshold.value = -24;
        this.tracks[trackName].vocalComp.knee.value = 10;
        this.tracks[trackName].vocalComp.ratio.value = 4;
        this.tracks[trackName].vocalComp.attack.value = 0.005;
        this.tracks[trackName].vocalComp.release.value = 0.080;
        this.tracks[trackName].vocalMakeup = this.audioCtx.createGain();
        this.tracks[trackName].vocalMakeup.gain.value = 1.5;
        this.tracks[trackName].vocalBypass = this.audioCtx.createGain();
        this.tracks[trackName].vocalBypass.gain.value = 1.0;
        this.tracks[trackName].vocalMix = this.audioCtx.createGain();
        this.tracks[trackName].vocalMix.gain.value = 0.0;
        this.tracks[trackName].trim.connect(this.tracks[trackName].vocalBypass);
        this.tracks[trackName].trim.connect(this.tracks[trackName].vocalFilter);
        this.tracks[trackName].vocalFilter.connect(this.tracks[trackName].vocalComp);
        this.tracks[trackName].vocalComp.connect(this.tracks[trackName].vocalMakeup);
        this.tracks[trackName].vocalMakeup.connect(this.tracks[trackName].vocalMix);

        this.tracks[trackName].tapeSaturation = this.audioCtx.createWaveShaper();
        this.tracks[trackName].tapeSaturation.curve = window.FXEngine.makeDistortionCurve(10);
        this.tracks[trackName].vocalBypass.connect(this.tracks[trackName].tapeSaturation);
        this.tracks[trackName].vocalMix.connect(this.tracks[trackName].tapeSaturation);

        // AutoTune Routing
        this.tracks[trackName].autotuneBypass = this.audioCtx.createGain();
        this.tracks[trackName].autotuneBypass.gain.value = 1.0;
        this.tracks[trackName].autotuneMix = this.audioCtx.createGain();
        this.tracks[trackName].autotuneMix.gain.value = 0.0;

        try {
            this.tracks[trackName].autotuneNode = new AudioWorkletNode(this.audioCtx, 'autotune-processor');
            this.tracks[trackName].autotuneNode.port.postMessage({
                type: 'set-params',
                rootNote: this.autotuneRootNote,
                scale: this.getScaleArray(this.autotuneScaleType),
                speed: this.autotuneSpeedVal,
                amount: this.autotuneAmountVal
            });
            this.tracks[trackName].tapeSaturation.connect(this.tracks[trackName].autotuneNode);
            this.tracks[trackName].autotuneNode.connect(this.tracks[trackName].autotuneMix);
        } catch(e) {}

        this.tracks[trackName].tapeSaturation.connect(this.tracks[trackName].autotuneBypass);

        this.tracks[trackName].scoopFilter = this.audioCtx.createBiquadFilter();
        this.tracks[trackName].scoopFilter.type = 'peaking';
        this.tracks[trackName].scoopFilter.frequency.value = 3000;
        this.tracks[trackName].scoopFilter.Q.value = 1.5;
        this.tracks[trackName].scoopFilter.gain.value = 0;

        this.tracks[trackName].eqHigh = this.audioCtx.createBiquadFilter();
        this.tracks[trackName].eqHigh.type = 'highshelf';
        this.tracks[trackName].eqHigh.frequency.value = 3000;
        this.tracks[trackName].eqHigh.gain.value = 0;
        this.tracks[trackName].eqLow = this.audioCtx.createBiquadFilter();
        this.tracks[trackName].eqLow.type = 'lowshelf';
        this.tracks[trackName].eqLow.frequency.value = 300;
        this.tracks[trackName].eqLow.gain.value = 0;
        this.tracks[trackName].eff1Send = this.audioCtx.createGain();
        this.tracks[trackName].eff1Send.gain.value = 0;
        if (this.globalFx1Input) this.tracks[trackName].eff1Send.connect(this.globalFx1Input);
        this.tracks[trackName].eff2Send = this.audioCtx.createGain();
        this.tracks[trackName].eff2Send.gain.value = 0;
        if (this.globalFx2Input) this.tracks[trackName].eff2Send.connect(this.globalFx2Input);
        this.tracks[trackName].panner = this.audioCtx.createStereoPanner();
        this.tracks[trackName].panner.pan.value = 0;
        this.tracks[trackName].gain = this.audioCtx.createGain();
        this.tracks[trackName].gain.gain.value = this.tracks[trackName].targetVolume;

        this.tracks[trackName].autotuneBypass.connect(this.tracks[trackName].eqHigh);
        this.tracks[trackName].autotuneMix.connect(this.tracks[trackName].eqHigh);

        this.tracks[trackName].eqHigh.connect(this.tracks[trackName].eqLow);
        this.tracks[trackName].eqLow.connect(this.tracks[trackName].scoopFilter);
        this.tracks[trackName].scoopFilter.connect(this.tracks[trackName].widthSplitter);
        this.tracks[trackName].widthMerger.connect(this.tracks[trackName].panner);
        
        this.tracks[trackName].analyser = this.audioCtx.createAnalyser();
        this.tracks[trackName].analyser.fftSize = 256;
        this.tracks[trackName].dataArray = new Uint8Array(this.tracks[trackName].analyser.frequencyBinCount);
        this.tracks[trackName].panner.connect(this.tracks[trackName].gain);
        this.tracks[trackName].gain.connect(this.tracks[trackName].analyser);
        this.tracks[trackName].analyser.connect(this.masterGain);
        this.tracks[trackName].scoopFilter.connect(this.tracks[trackName].eff1Send);
        this.tracks[trackName].scoopFilter.connect(this.tracks[trackName].eff2Send);
    },

    async loadStems(stemUrls) {
        // Fetch the 4 stem URLs provided by the StemSplitterEngine
        const trackKeys = ['track1', 'track2', 'track3', 'track4'];
        let i = 0;
        for (const [stemName, url] of Object.entries(stemUrls)) {
            if (i >= 4) break;
            const trackName = trackKeys[i];
            const response = await fetch(url);
            const arrayBuffer = await response.arrayBuffer();
            const audioBuffer = await this.audioCtx.decodeAudioData(arrayBuffer);
            
            this.tracks[trackName].buffer = audioBuffer;
            this.tracks[trackName].name = stemName.toUpperCase();
            
            this.playbackRate = 1.0; // Reset pitch to default when loading a new tape
            
            if (!this.tracks[trackName].gain) {
                this.setupTrackRouting(trackName);
            }
            
            const nameInput = document.querySelector(`.track-name-input[data-track="${trackName}"]`);
            if (nameInput) nameInput.value = this.tracks[trackName].name;
            
            i++;
        }
        
        this.renderUI();
    },

    async toggleArmTrack(trackName, element) {
        document.querySelectorAll('.rec-arm-switch').forEach(el => el.classList.remove('armed'));
        if (this.armedTrack === trackName) {
            this.armedTrack = null;
        } else {
            this.armedTrack = trackName;
            element.classList.add('armed');
            if (!this.micStream) {
                try {
                    // Request raw studio mic input (disable echo cancellation for pure music quality)
                    this.micStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
                } catch (e) {
                    alert("Microphone access is required to lay down a track.");
                    this.armedTrack = null;
                    element.classList.remove('armed');
                }
            }
        }
    },

    startRecording() {
        if (!this.micStream || !this.armedTrack) return;
        
        let recordStream = this.micStream;

        let recordedChunks = [];
        this.mediaRecorder = new MediaRecorder(recordStream);
        this.mediaRecorder.ondataavailable = e => { if (e.data.size > 0) recordedChunks.push(e.data); };
        this.mediaRecorder.onstop = async () => {
            const blob = new Blob(recordedChunks, { type: 'audio/webm' });
            const arrayBuffer = await blob.arrayBuffer();
            this.tracks[this.armedTrack].buffer = await this.audioCtx.decodeAudioData(arrayBuffer);
            this.isRecording = false;
            this.playbackPosition = 0;
            this.resetTapeVisuals();
            
            let msg = `🎙️ TAPE PUNCH-IN COMPLETE: New audio laid down on the ${this.armedTrack.toUpperCase()} track!`;
            alert(msg);
        };
        this.isRecording = true;
        this.playbackPosition = 0;
        this.resetTapeVisuals();
        this.mediaRecorder.start();
    },

    async play() {
        try {
            if (!this.audioCtx) return;
            if (this.audioCtx.state === 'suspended') await this.audioCtx.resume();
            if (this.isPlaying) return;
            this.stopSources();
            
            let maxDur = Math.max(...Object.values(this.tracks).map(t => t.buffer ? t.buffer.duration : 0));
            this.maxDuration = maxDur > 0 ? maxDur : 60; // Fallback to 60s if no buffers loaded
            
            // Reset if we reached the end of the tape
            if (this.playbackPosition >= this.maxDuration) this.playbackPosition = 0;
            
            this.playbackStartTime = this.audioCtx.currentTime;
            this.isPlaying = true;
            
            if (this.tapeAnimFrame) cancelAnimationFrame(this.tapeAnimFrame);
            this.animateTape();
            
            // Start all 4 tracks simultaneously to keep them perfectly in sync
            for (const trackName in this.tracks) {
                const track = this.tracks[trackName];
                // Analog Tape logic: Don't play the track we are currently recording over!
                if (this.isRecording && trackName === this.armedTrack) continue;

                if (track.buffer) {
                    track.source = this.audioCtx.createBufferSource();
                    track.source.buffer = track.buffer;
                    track.source.playbackRate.value = this.playbackRate || 1.0;
                    
                    if (!track.trim) this.setupTrackRouting(trackName);
                    track.source.connect(track.trim || track.gain);
                    
                    if (this.playbackPosition < track.buffer.duration) {
                        track.source.start(0, this.playbackPosition);
                    }
                }
            }
        } catch (err) {
            console.error("[VODSTUDIO] Playback initialization error:", err);
            this.isPlaying = false;
        }
    },
    setTrim(trackName, val) {
        if (this.tracks[trackName].trim) this.tracks[trackName].trim.gain.value = val;
    },
    setEqHigh(trackName, val) {
        if (this.tracks[trackName].eqHigh) this.tracks[trackName].eqHigh.gain.value = val;
    },
    applyScoop(trackName) {
        const track = this.tracks[trackName];
        if (!track || !track.scoopFilter) return;
        track.autoScoop = !track.autoScoop;
        track.scoopFilter.gain.value = track.autoScoop ? -6 : 0;
        
        if (track.autoScoop) {
            let vocalTrack = null;
            for (const t in this.tracks) {
                if (this.tracks[t].vocalChain) { vocalTrack = this.tracks[t]; break; }
            }
            if (vocalTrack && vocalTrack.analyser) {
                const bufferLength = vocalTrack.analyser.frequencyBinCount;
                const dataArray = new Uint8Array(bufferLength);
                vocalTrack.analyser.getByteFrequencyData(dataArray);
                
                let maxVal = 0; let peakIndex = 0;
                for (let i = 0; i < bufferLength; i++) {
                    const freq = i * (this.audioCtx.sampleRate / 2) / bufferLength;
                    if (freq > 1000 && freq < 5000 && dataArray[i] > maxVal) {
                        maxVal = dataArray[i]; peakIndex = i;
                    }
                }
                if (maxVal > 0) {
                    const targetFreq = peakIndex * (this.audioCtx.sampleRate / 2) / bufferLength;
                    track.scoopFilter.frequency.value = targetFreq;
                } else {
                    track.scoopFilter.frequency.value = 3000;
                }
            } else {
                track.scoopFilter.frequency.value = 3000;
            }
        }
    },
    
    applySmartVocalChain(trackName) {
        const track = this.tracks[trackName];
        if (!track || !track.buffer || !track.vocalComp) return;

        const buffer = track.buffer;
        const data = buffer.getChannelData(0);
        let sumSquares = 0; let peak = 0;
        let zeroCrossings = 0; let lastVal = 0;

        const step = 10;
        for (let i = 0; i < data.length; i += step) {
            const val = data[i];
            sumSquares += val * val;
            if (Math.abs(val) > peak) peak = Math.abs(val);
            
            if ((val >= 0 && lastVal < 0) || (val < 0 && lastVal >= 0)) zeroCrossings++;
            lastVal = val;
        }
        
        const numSamples = Math.floor(data.length / step);
        const rms = Math.sqrt(sumSquares / numSamples);
        const rmsDb = 20 * Math.log10(rms || 0.0001);
        const peakDb = 20 * Math.log10(peak || 0.0001);

        const zcrRate = (zeroCrossings / numSamples) * (buffer.sampleRate / step);
        const approxFreq = zcrRate / 2;

        let threshold = rmsDb > -40 ? rmsDb - 15 : -24; 
        threshold = Math.max(-50, Math.min(-10, threshold));
        
        const dynamicRange = peakDb - rmsDb;
        let ratio = dynamicRange > 18 ? 6 : (dynamicRange > 12 ? 4 : 2.5);

        let estimatedGR = (threshold - peakDb) * (1 - 1/ratio);
        let makeupDb = Math.abs(estimatedGR) * 0.6; 
        makeupDb = Math.max(0, Math.min(15, makeupDb));
        const linearMakeup = Math.pow(10, makeupDb / 20);

        track.vocalComp.threshold.value = threshold;
        track.vocalComp.ratio.value = ratio;
        if (track.vocalMakeup) track.vocalMakeup.gain.value = linearMakeup;
        
        if (track.vocalFilter) track.vocalFilter.frequency.value = approxFreq > 200 ? 120 : 80;
        
        console.log(`[SMART VOCAL] ${trackName} | Peak: ${peakDb.toFixed(1)}dB | RMS: ${rmsDb.toFixed(1)}dB | Freq: ${approxFreq.toFixed(0)}Hz`);
        console.log(`[SMART VOCAL] Set Threshold: ${threshold.toFixed(1)}dB | Ratio: ${ratio}:1 | Makeup: +${makeupDb.toFixed(1)}dB`);
    },
    setWidth(trackName, val) {
        if (this.tracks[trackName].widthSide) this.tracks[trackName].widthSide.gain.value = val;
        this.tracks[trackName].widthVal = val;
    },
    setEqLow(trackName, val) {
        if (this.tracks[trackName].eqLow) this.tracks[trackName].eqLow.gain.value = val;
    },
    setEff1(trackName, val) {
        if (this.tracks[trackName].eff1Send) this.tracks[trackName].eff1Send.gain.value = val;
    },
    setEff2(trackName, val) {
        if (this.tracks[trackName].eff2Send) this.tracks[trackName].eff2Send.gain.value = val;
    },
    applyAutotuneMix(trackName) {
        const track = this.tracks[trackName];
        if (track && track.autotuneMix && track.autotuneBypass) {
            const mix = track.autotuneEnabled ? 1.0 : 0.0;
            track.autotuneMix.gain.value = mix;
            track.autotuneBypass.gain.value = 1.0 - mix;
        }
    },
    updateAllAutotuneNodes() {
        const scale = this.getScaleArray(this.autotuneScaleType);
        for (const t in this.tracks) {
            if (this.tracks[t].autotuneNode) this.tracks[t].autotuneNode.port.postMessage({ 
                type: 'set-params', 
                rootNote: parseInt(this.autotuneRootNote), 
                scale: scale,
                speed: this.autotuneSpeedVal,
                amount: this.autotuneAmountVal
            });
        }
    },
    getScaleArray(type) {
        if (type === 'major') return [0, 2, 4, 5, 7, 9, 11];
        if (type === 'minor') return [0, 2, 3, 5, 7, 8, 10];
        return [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
    },

    drawVUMeter() {
        if (!this.masterAnalyser) return;
        this.vuMeterAnimation = requestAnimationFrame(() => this.drawVUMeter());
        
        this.masterAnalyser.getByteTimeDomainData(this.masterDataArray);
        let max = 0;
        for (let i = 0; i < this.masterDataArray.length; i++) {
            let val = Math.abs(this.masterDataArray[i] - 128);
            if (val > max) max = val;
        }
        let percentage = Math.min(100, (max / 128) * 100 * 1.6);
        
        const meter = document.getElementById('master-vu-meter');
        if (meter) {
            meter.style.height = `${percentage}%`;
            meter.style.background = percentage > 90 ? 'var(--danger)' : 'var(--warning)';
            meter.style.boxShadow = `0 0 10px ${percentage > 90 ? 'var(--danger)' : 'var(--warning)'}`;
        }

        // Calculate and draw VU meter for all 4 individual tracks
        for (const trackName in this.tracks) {
            const track = this.tracks[trackName];
            if (!track.analyser || !track.dataArray) continue;
            
            track.analyser.getByteTimeDomainData(track.dataArray);
            let maxTrack = 0;
            for (let i = 0; i < track.dataArray.length; i++) {
                let val = Math.abs(track.dataArray[i] - 128);
                if (val > maxTrack) maxTrack = val;
            }
            let trackPercentage = Math.min(100, (maxTrack / 128) * 100 * 1.6);
            
            const trackMeter = document.getElementById(`vu-meter-${trackName}`);
            if (trackMeter) {
                trackMeter.style.height = `${trackPercentage}%`;
                trackMeter.style.background = trackPercentage > 90 ? 'var(--danger)' : 'var(--knob-green)';
                trackMeter.style.boxShadow = `0 0 10px ${trackPercentage > 90 ? 'var(--danger)' : 'var(--knob-green)'}`;
            }
        }
    },

    showTrackActionMenu(trackId) {
        const modal = document.getElementById('vodstudio-modal');
        let actionModal = document.getElementById('vodstudio-track-action-modal');
        if (!actionModal) {
            actionModal = document.createElement('div');
            actionModal.id = 'vodstudio-track-action-modal';
            actionModal.className = 'hidden';
            actionModal.style = 'position: absolute; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.8); z-index: 1000; display: flex; justify-content: center; align-items: center; flex-direction: column;';
            actionModal.innerHTML = `
                <div style="background: #1a252f; padding: 20px; border-radius: 8px; border: 2px solid var(--primary); text-align: center; width: 300px;">
                    <h3 id="track-action-title" style="margin-top: 0; color: #fff;">Target: Track</h3>
                    <button id="track-action-upload" style="margin-bottom: 10px; width: 100%;">📤 Upload Audio File</button>
                    <button class="secondary" id="track-action-bounce" style="margin-bottom: 10px; width: 100%;">♻️ Bounce Tracks Here</button>
                    <button class="secondary" onclick="document.getElementById('vodstudio-track-action-modal').classList.add('hidden')">Cancel</button>
                </div>
            `;
            modal.appendChild(actionModal);
            
            const bounceModal = document.createElement('div');
            bounceModal.id = 'vodstudio-bounce-modal';
            bounceModal.className = 'hidden';
            bounceModal.style = 'position: absolute; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.8); z-index: 1001; display: flex; justify-content: center; align-items: center; flex-direction: column;';
            bounceModal.innerHTML = `
                <div style="background: #1a252f; padding: 20px; border-radius: 8px; border: 2px solid var(--primary); text-align: center; width: 300px;">
                    <h3 id="bounce-title" style="margin-top: 0; color: #fff;">Bounce to Track</h3>
                    <p style="font-size: 12px; color: var(--text-muted); margin-bottom: 15px;">Select tracks to mixdown into this channel:</p>
                    <div id="bounce-track-list" style="text-align: left; margin-bottom: 15px; display: flex; flex-direction: column; gap: 8px;"></div>
                    <button id="btn-execute-bounce" style="width: 100%; margin-bottom: 10px;">Bounce Selected</button>
                    <button class="secondary" onclick="document.getElementById('vodstudio-bounce-modal').classList.add('hidden')">Cancel</button>
                </div>
            `;
            modal.appendChild(bounceModal);
        }

        document.getElementById('track-action-title').innerText = `Target: ${this.tracks[trackId].name || trackId.toUpperCase()}`;
        document.getElementById('track-action-upload').onclick = () => {
            actionModal.classList.add('hidden');
            document.getElementById(`upload-${trackId}`).click();
        };
        
        document.getElementById('track-action-bounce').onclick = () => {
            actionModal.classList.add('hidden');
            this.showBounceMenu(trackId);
        };

        actionModal.classList.remove('hidden');
    },

    showBounceMenu(targetTrackId) {
        const bounceModal = document.getElementById('vodstudio-bounce-modal');
        document.getElementById('bounce-title').innerText = `Bounce to ${this.tracks[targetTrackId].name || targetTrackId.toUpperCase()}`;
        
        let html = '';
        Object.keys(this.tracks).forEach(t => {
            if (t !== targetTrackId) {
                const hasAudio = !!this.tracks[t].buffer;
                html += `
                    <label style="display: flex; align-items: center; gap: 10px; color: ${hasAudio ? '#fff' : '#666'};">
                        <input type="checkbox" class="bounce-source-cb" value="${t}" ${hasAudio ? '' : 'disabled'}>
                        ${this.tracks[t].name || t.toUpperCase()} ${hasAudio ? '' : '(Empty)'}
                    </label>
                `;
            }
        });
        document.getElementById('bounce-track-list').innerHTML = html;
        
        document.getElementById('btn-execute-bounce').onclick = () => {
            const selected = Array.from(document.querySelectorAll('.bounce-source-cb:checked')).map(cb => cb.value);
            if (selected.length === 0) return alert('Select at least one track to bounce.');
            bounceModal.classList.add('hidden');
            this.executeBounce(selected, targetTrackId);
        };

        bounceModal.classList.remove('hidden');
    },

    async executeBounce(sourceTracks, targetTrack) {
        let maxDur = 0;
        sourceTracks.forEach(t => {
            if (this.tracks[t].buffer && this.tracks[t].buffer.duration > maxDur) {
                maxDur = this.tracks[t].buffer.duration;
            }
        });
        if (maxDur === 0) return alert("Selected tracks are empty.");

        const modal = document.getElementById('vodstudio-modal');
        let loader = document.getElementById('vodstudio-loader');
        if (!loader) {
            loader = document.createElement('div');
            loader.id = 'vodstudio-loader';
            loader.style = 'position: absolute; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.8); z-index: 2000; display: flex; justify-content: center; align-items: center; color: var(--primary); font-weight: bold; font-size: 24px;';
            modal.appendChild(loader);
        }
        loader.innerText = '♻️ Bouncing Tracks...';
        loader.classList.remove('hidden');

        await new Promise(r => setTimeout(r, 50));

        const offlineCtx = new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(2, Math.ceil(44100 * (maxDur / this.playbackRate)), 44100);
        
        try {
            await offlineCtx.audioWorklet.addModule('/AutoTuneProcessor.js');
        } catch(e) {}

        const offlineMaster = offlineCtx.createGain();
        offlineMaster.connect(offlineCtx.destination);
        
        const offlineFx1Input = offlineCtx.createGain();
        const offlineFx2Input = offlineCtx.createGain();
        this.buildFxChain(offlineCtx, this.fx1Type, offlineFx1Input, offlineMaster, this.fx1Param1Val, this.fx1Param2Val);
        this.buildFxChain(offlineCtx, this.fx2Type, offlineFx2Input, offlineMaster, this.fx2Param1Val, this.fx2Param2Val);

        for (const trackName of sourceTracks) {
            const track = this.tracks[trackName];
            if (track.buffer) {
                const source = offlineCtx.createBufferSource();
                source.buffer = track.buffer;
                source.playbackRate.value = this.playbackRate;
                
                const trim = offlineCtx.createGain();
                trim.gain.value = track.trim ? track.trim.gain.value : 0.5;
                
                const trackTape = offlineCtx.createWaveShaper();
                trackTape.curve = window.FXEngine.makeDistortionCurve(10);
                trim.connect(trackTape);

                const autotuneBypass = offlineCtx.createGain();
                autotuneBypass.gain.value = track.autotuneBypass ? track.autotuneBypass.gain.value : 1.0;
                
                const autotuneMix = offlineCtx.createGain();
                autotuneMix.gain.value = track.autotuneMix ? track.autotuneMix.gain.value : 0.0;

                try {
                    const autotuneNode = new AudioWorkletNode(offlineCtx, 'autotune-processor');
                    autotuneNode.port.postMessage({
                        type: 'set-params',
                        rootNote: parseInt(this.autotuneRootNote),
                        scale: this.getScaleArray(this.autotuneScaleType),
                        speed: this.autotuneSpeedVal,
                        amount: this.autotuneAmountVal
                    });
                    trackTape.connect(autotuneNode);
                    autotuneNode.connect(autotuneMix);
                } catch(e) {}

                trackTape.connect(autotuneBypass);

                const eqHigh = offlineCtx.createBiquadFilter();
                eqHigh.type = 'highshelf'; eqHigh.frequency.value = 3000;
                eqHigh.gain.value = track.eqHigh ? track.eqHigh.gain.value : 0;
                
                const eqLow = offlineCtx.createBiquadFilter();
                eqLow.type = 'lowshelf'; eqLow.frequency.value = 300;
                eqLow.gain.value = track.eqLow ? track.eqLow.gain.value : 0;

                const eff1Send = offlineCtx.createGain();
                eff1Send.gain.value = track.eff1Send ? track.eff1Send.gain.value : 0;
                eff1Send.connect(offlineFx1Input);

                const eff2Send = offlineCtx.createGain();
                eff2Send.gain.value = track.eff2Send ? track.eff2Send.gain.value : 0;
                eff2Send.connect(offlineFx2Input);

                const panner = offlineCtx.createStereoPanner();
                panner.pan.value = track.panner ? track.panner.pan.value : 0;
                
                const gain = offlineCtx.createGain();
                let trackGainVal = track.targetVolume;
                const anySolo = Object.values(this.tracks).some(t => t.isSoloed);
                if (anySolo && !track.isSoloed) trackGainVal = 0;
                else if (track.isMuted) trackGainVal = 0;
                
                gain.gain.value = trackGainVal;
                
                source.connect(trim); 
                autotuneBypass.connect(eqHigh); autotuneMix.connect(eqHigh);
                eqHigh.connect(eqLow); 
                eqLow.connect(panner); panner.connect(gain); gain.connect(offlineMaster);
                eqLow.connect(eff1Send); eqLow.connect(eff2Send);
                source.start(0);
            }
        }

        const renderedBuffer = await offlineCtx.startRendering();
        
        this.tracks[targetTrack].buffer = renderedBuffer;
        this.tracks[targetTrack].name = 'BOUNCED';
        
        const nameInput = document.querySelector(`.track-name-input[data-track="${targetTrack}"]`);
        if (nameInput) nameInput.value = 'BOUNCED';

        if (!this.tracks[targetTrack].gain) {
            this.setupTrackRouting(targetTrack);
        }
        
        loader.classList.add('hidden');

        if (confirm("Bounce complete! Do you want to clear the source tracks to free them up?")) {
            sourceTracks.forEach(t => {
                this.tracks[t].buffer = null;
                this.tracks[t].name = `TRACK ${t.replace('track', '')}`;
                const nInput = document.querySelector(`.track-name-input[data-track="${t}"]`);
                if (nInput) nInput.value = this.tracks[t].name;
            });
        }
    },

    stopSources() {
        for (const trackName in this.tracks) {
            const track = this.tracks[trackName];
            if (track.source) {
                try { 
                    track.source.stop(); 
                    track.source.disconnect(); 
                } catch(e){}
                track.source = null;
            }
        }
    },
    
    pause() {
        if (!this.isPlaying) return;
        this.playbackPosition += (this.audioCtx.currentTime - this.playbackStartTime) * this.playbackRate;
        this.stopSources();
        this.isPlaying = false;
        if (this.tapeAnimFrame) {
            cancelAnimationFrame(this.tapeAnimFrame);
            this.tapeAnimFrame = null;
        }
        const modal = document.getElementById('vodstudio-modal');
        if (modal) modal.querySelectorAll('.tape-hub').forEach(h => h.classList.remove('spinning'));
    },
    
    async rewind() {
        let wasPlaying = this.isPlaying;
        if (wasPlaying) this.pause();
        this.playbackPosition = Math.max(0, this.playbackPosition - 5);
        if (wasPlaying) await this.play();
        else this.updateTapeVisualsToPosition();
    },
    
    async fastForward() {
        let wasPlaying = this.isPlaying;
        if (wasPlaying) this.pause();
        if (!this.maxDuration) {
            let maxDur = Math.max(...Object.values(this.tracks).map(t => t.buffer ? t.buffer.duration : 0));
            this.maxDuration = maxDur > 0 ? maxDur : 60;
        }
        this.playbackPosition = Math.min(this.maxDuration, this.playbackPosition + 5);
        if (wasPlaying) await this.play();
        else this.updateTapeVisualsToPosition();
    },

    stop() {
        this.stopSources();
        this.isPlaying = false;
        this.playbackPosition = 0;
        if (this.isRecording && this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
            this.mediaRecorder.stop();
        }
        if (this.tapeAnimFrame) {
            cancelAnimationFrame(this.tapeAnimFrame);
            this.tapeAnimFrame = null;
        }
        this.resetTapeVisuals();
        
        const modal = document.getElementById('vodstudio-modal');
        if (modal) {
            modal.querySelectorAll('.tape-hub').forEach(h => h.classList.remove('spinning'));
            const playBtn = modal.querySelector('#btn-play');
            if (playBtn) playBtn.classList.remove('active-playback');
            const pauseBtn = modal.querySelector('#btn-pause');
            if (pauseBtn) pauseBtn.classList.remove('active-playback');
            const recBtn = modal.querySelector('#btn-record');
            if (recBtn) recBtn.classList.remove('active-playback');
        }
    },

    resetTapeVisuals() {
        const leftRoll = document.getElementById('tape-roll-left');
        const rightRoll = document.getElementById('tape-roll-right');
        if (leftRoll) { leftRoll.style.width = '85px'; leftRoll.style.height = '85px'; }
        if (rightRoll) { rightRoll.style.width = '28px'; rightRoll.style.height = '28px'; }
    },

    updateTapeVisualsToPosition() {
        if (!this.maxDuration) {
            let maxDur = Math.max(...Object.values(this.tracks).map(t => t.buffer ? t.buffer.duration : 0));
            this.maxDuration = maxDur > 0 ? maxDur : 60;
        }
        const progress = Math.max(0, Math.min(1.0, this.playbackPosition / this.maxDuration));
        const minSize = 28; const maxSize = 85;
        const leftSize = minSize + Math.sqrt(1 - progress) * (maxSize - minSize);
        const rightSize = minSize + Math.sqrt(progress) * (maxSize - minSize);
        const leftRoll = document.getElementById('tape-roll-left');
        const rightRoll = document.getElementById('tape-roll-right');
        if (leftRoll) { leftRoll.style.width = leftSize + 'px'; leftRoll.style.height = leftSize + 'px'; }
        if (rightRoll) { rightRoll.style.width = rightSize + 'px'; rightRoll.style.height = rightSize + 'px'; }
    },

    animateTape() {
        if (!this.maxDuration) return;
        const currentPos = this.playbackPosition + (this.audioCtx.currentTime - this.playbackStartTime) * this.playbackRate;
        const progress = Math.max(0, Math.min(1.0, currentPos / this.maxDuration));
        
        const minSize = 28; const maxSize = 85;
        
        // Use square root to ensure the physical *area* of the tape circle shrinks linearly, simulating real film winding
        const leftSize = minSize + Math.sqrt(1 - progress) * (maxSize - minSize);
        const rightSize = minSize + Math.sqrt(progress) * (maxSize - minSize);
        
        const leftRoll = document.getElementById('tape-roll-left');
        const rightRoll = document.getElementById('tape-roll-right');
        if (leftRoll) { leftRoll.style.width = leftSize + 'px'; leftRoll.style.height = leftSize + 'px'; }
        if (rightRoll) { rightRoll.style.width = rightSize + 'px'; rightRoll.style.height = rightSize + 'px'; }
        
        if (progress < 1) this.tapeAnimFrame = requestAnimationFrame(() => this.animateTape());
        else {
            document.querySelectorAll('.tape-hub').forEach(h => h.classList.remove('spinning'));
            const playBtn = document.getElementById('btn-play'); const recBtn = document.getElementById('btn-record');
            if (playBtn) playBtn.classList.remove('active-playback');
            if (recBtn) recBtn.classList.remove('active-playback');
        }
    },

    // --- HARDWARE KNOB CONTROLS ---
    setVolume(trackName, volumeLevel) {
        this.tracks[trackName].targetVolume = volumeLevel;
        this.updateTrackGains();
    },
    
    updateTrackGains() {
        const anySolo = Object.values(this.tracks).some(t => t.isSoloed);
        for (const trackName in this.tracks) {
            const track = this.tracks[trackName];
            if (!track.gain) continue;
            
            if (anySolo && !track.isSoloed) {
                track.gain.gain.value = 0;
            } else if (track.isMuted) {
                track.gain.gain.value = 0;
            } else {
                track.gain.gain.value = track.targetVolume;
            }
        }
    },

    setPan(trackName, panLevel) {
        // panLevel from -1.0 (Left) to 1.0 (Right)
        if (this.tracks[trackName].panner) {
            this.tracks[trackName].panner.pan.value = panLevel;
        }
    },

    // --- HARDWARE UI INJECTION ---
    renderUI() {
        if (document.getElementById('vodstudio-modal')) return;
        
        const modal = document.createElement('div');
        modal.id = 'vodstudio-modal';
        
        const style = document.createElement('style');
        style.innerHTML = `
            :root {
                --vodcam-blue: #2c3e50;
                --knob-grey: #95a5a6;
                --knob-blue: #3498db;
                --knob-green: #2ecc71;
                --knob-orange: #e67e22;
                --chalk-white: rgba(255,255,255,0.9);
            }
            #vodstudio-modal {
                position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
                background-color: rgba(17, 17, 17, 0.95); z-index: 9999;
                display: flex; justify-content: center; align-items: center;
                font-family: 'Courier New', Courier, monospace; color: #fff; user-select: none; overflow: hidden;
            }
            #vodstudio-modal .console {
                background-color: var(--vodcam-blue); min-width: 1080px; width: max-content; height: 780px;
                border-radius: 20px; padding: 15px 25px;
                box-shadow: 0 35px 80px rgba(0,0,0,0.9), inset 0 3px 10px rgba(255,255,255,0.2);
                border: 6px solid #1a252f; display: flex; flex-direction: column;
                box-sizing: border-box; position: relative;
                transform-origin: center center;
            }
            #vodstudio-modal .console-top-bar {
                width: 100%; height: 40px; background: #95a5a6; border-radius: 8px; margin-bottom: 20px;
                display: flex; align-items: center; justify-content: center;
                box-shadow: inset 0 0 10px rgba(0,0,0,0.3); border: 2px solid #7f8c8d; flex-shrink: 0;
            }
            #vodstudio-modal .console-top-bar-text {
                color: #2c3e50; font-size: 22px; font-weight: 900; letter-spacing: 8px; text-shadow: 0 1px 1px rgba(255,255,255,0.5);
            }
            #vodstudio-modal .console-body {
                display: grid; grid-template-columns: 65% 35%; flex: 1; min-height: 0;
            }
            #vodstudio-modal .close-btn {
                position: absolute; top: -15px; right: -15px; background: #e74c3c; color: #fff;
                border: 3px solid #111; border-radius: 50%; width: 40px; height: 40px;
                font-weight: bold; cursor: pointer; box-shadow: 0 4px 0 #902e23;
            }
            #vodstudio-modal .close-btn:active { transform: translateY(3px); box-shadow: 0 1px 0 #902e23; }
            #vodstudio-modal .chalk-text {
                font-size: 0.65rem; font-weight: bold; text-transform: uppercase;
                text-shadow: 0 0 2px var(--chalk-white); text-align: center; letter-spacing: 0.5px;
            }
            #vodstudio-modal .mixer-bay {
                display: flex; justify-content: space-between;
                border-right: 4px dashed rgba(255,255,255,0.2); padding-right: 15px;
            }
            #vodstudio-modal .channel-strip {
                width: 22%; background: rgba(0, 0, 0, 0.2); border-radius: 6px; padding: 6px 0;
                display: flex; flex-direction: column; align-items: center; border: 1px dashed rgba(255,255,255,0.05);
            }
            #vodstudio-modal .knob-pot {
                width: 30px; height: 30px; border-radius: 50%; border: 2px dashed #fff;
                margin: 2px 0 6px 0; position: relative; cursor: ns-resize;
            }
            #vodstudio-modal .knob-pot, #vodstudio-modal .fader-cap, #vodstudio-modal .pitch-dial {
                touch-action: none;
            }
            #vodstudio-modal .knob-pot::after {
                content: ''; position: absolute; top: 2px; left: 50%; width: 2px; height: 10px; background: #fff; transform: translateX(-50%);
            }
            #vodstudio-modal .knob-pot.grey { background: var(--knob-grey); }
            #vodstudio-modal .knob-pot.blue { background: var(--knob-blue); }
            #vodstudio-modal .knob-pot.green { background: var(--knob-green); }
            #vodstudio-modal .knob-pot.orange { background: var(--knob-orange); }
            #vodstudio-modal .toggle-switch-3way {
                width: 40px; height: 16px; background: #000; border: 1px solid #fff; margin: 2px 0 6px 0; border-radius: 2px; cursor: pointer;
            }
            #vodstudio-modal .fader-track {
                width: 10px; flex-grow: 1; min-height: 80px; background: #050505; border: 1px solid rgba(255,255,255,0.2);
                box-shadow: inset 0 2px 5px rgba(0,0,0,0.8);
                position: relative; margin-top: 15px; margin-bottom: 10px; border-radius: 4px;
            }
            #vodstudio-modal .fader-cap {
                width: 38px; height: 50px; background: linear-gradient(180deg, #dcdcdc, #fff 10%, #ccc 45%, #777);
                border: 1px solid #111;
                position: absolute; left: -15px; top: 45px; border-radius: 4px; cursor: ns-resize; 
                box-shadow: 0 6px 12px rgba(0,0,0,0.8), inset 0 1px 2px rgba(255,255,255,0.9), inset 0 -2px 3px rgba(0,0,0,0.5);
            }
            #vodstudio-modal .fader-cap::before {
                content: ''; position: absolute; top: 50%; left: 10%; width: 80%; height: 4px; background: #e74c3c;
                border-radius: 2px; box-shadow: inset 0 2px 2px rgba(0,0,0,0.5), 0 1px 1px rgba(255,255,255,0.5); transform: translateY(-50%);
            }
            #vodstudio-modal .master-bay {
                padding-left: 10px; display: flex; flex-direction: column; justify-content: space-between;
            }
            #vodstudio-modal .sub-mixers-row { display: flex; justify-content: space-between; align-items: flex-start; }
            #vodstudio-modal .aux-pods { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
            #vodstudio-modal .pitch-wheel-wrapper { text-align: center; }
            #vodstudio-modal .pitch-dial {
                width: 55px; height: 55px; background: var(--knob-orange); border-radius: 50%;
                border: 3px solid #111; margin: 5px auto; position: relative; box-shadow: 0 4px 0 #b35600; cursor: ns-resize;
            }
            #vodstudio-modal .pitch-dial::after {
                content: ''; position: absolute; top: 5px; left: 50%; width: 4px; height: 15px; background: #111; transform: translateX(-50%);
            }
            #vodstudio-modal .tape-compartment {
                width: 100%; height: 160px; background: #151515; border: 4px solid #34495e; border-radius: 10px;
                display: flex; align-items: center; justify-content: center; position: relative; box-shadow: inset 0 0 30px #000;
            }
            #vodstudio-modal .cassette-tape {
                width: 220px; height: 130px; background: rgba(30, 30, 30, 0.8);
                border: 2px solid rgba(255, 255, 255, 0.15); border-radius: 12px;
                position: relative; box-shadow: 0 5px 15px rgba(0,0,0,0.8), inset 0 0 10px rgba(0,0,0,0.8);
                display: flex; justify-content: center; align-items: center; overflow: hidden;
            }
            #vodstudio-modal .cassette-sticker {
                position: absolute; top: 10px; bottom: 25px; left: 15px; right: 15px;
                border-width: 32px 30px 18px 30px; border-style: solid; border-color: #fdf5e6;
                border-radius: 6px; z-index: 2; box-sizing: border-box; pointer-events: none;
            }
            #vodstudio-modal .cassette-label-text {
                position: absolute; top: -30px; left: -25px; width: 180px; text-align: center;
                color: #c0392b; font-weight: bold; font-family: 'Courier New', Courier, monospace; font-size: 13px; z-index: 3;
                border-bottom: 1px solid #ccc; padding: 0 0 2px 0; margin: 0; pointer-events: auto; background: transparent; border-top: none; border-left: none; border-right: none; outline: none; line-height: 1; height: 18px;
            }
            #vodstudio-modal .tape-roll {
                position: absolute; border-radius: 50%; background: #1a1a1a; box-shadow: 0 0 0 1px #000, inset 0 0 5px #000;
                transform: translate(-50%, -50%); z-index: 1; display: flex; align-items: center; justify-content: center;
            }
            #vodstudio-modal .tape-roll-ridges {
                position: absolute; width: 100%; height: 100%; border-radius: 50%;
                background: repeating-radial-gradient(circle, transparent, transparent 1px, rgba(255,255,255,0.05) 2px, rgba(0,0,0,0.5) 3px);
            }
            #vodstudio-modal .window-pane {
                width: 130px; height: 40px; background: rgba(0,0,0,0.6); border: 2px solid #222; border-radius: 4px;
                display: flex; justify-content: space-between; padding: 0 8px; align-items: center; position: relative; z-index: 3; box-shadow: inset 0 0 15px #000;
                margin-bottom: 20px; box-sizing: border-box;
            }
            #vodstudio-modal .cassette-bottom-cutout {
                position: absolute; bottom: 0; width: 140px; height: 15px; background: #111;
                border-top: 1px solid #333; border-radius: 10px 10px 0 0; display: flex; justify-content: space-evenly; align-items: center; z-index: 3;
            }
            #vodstudio-modal .cassette-bottom-cutout div {
                width: 8px; height: 8px; background: #000; border-radius: 50%; box-shadow: inset 0 0 3px rgba(255,255,255,0.2);
            }
            #vodstudio-modal .tape-hub { width: 28px; height: 28px; background: #ddd; border: 3px solid #111; border-radius: 50%; position: relative; display: flex; align-items: center; justify-content: center; z-index: 2; }
            #vodstudio-modal .tape-hub::after { content: ''; width: 8px; height: 8px; background: #111; border-radius: 50%; }
            #vodstudio-modal .tape-hub.spinning { animation: spin 2s linear infinite; }
            #vodstudio-modal .tape-hub-spokes { position: absolute; width: 100%; height: 100%; }
            #vodstudio-modal .tape-hub-spokes::before, #vodstudio-modal .tape-hub-spokes::after {
                content: ''; position: absolute; background: #111;
                top: 50%; left: 50%; transform: translate(-50%, -50%);
            }
            #vodstudio-modal .tape-hub-spokes::before { width: 4px; height: 100%; }
            #vodstudio-modal .tape-hub-spokes::after { width: 100%; height: 4px; }
            @keyframes spin { 100% { transform: rotate(360deg); } }
            #vodstudio-modal .mechanical-keys { display: flex; gap: 8px; background: #111; padding: 8px; border-radius: 8px; justify-content: space-between; margin-top: 8px; }
            #vodstudio-modal .m-key {
                flex: 1; height: 35px; background: #f5f5f5; color: #222; font-family: inherit; font-size: 1.1rem; font-weight: bold;
                border: 1px solid #000; border-radius: 4px; cursor: pointer; box-shadow: 0 4px 0 #999; padding: 0; display: flex; align-items: center; justify-content: center;
            }
            #vodstudio-modal .m-key:active { transform: translateY(3px); box-shadow: 0 1px 0 #999; }
            #vodstudio-modal .m-key.rec-key { color: #cc0000; }
            #vodstudio-modal .m-key.active-playback { background: var(--knob-green); color: #fff; }
            #vodstudio-modal .vocal-btn.active { background: var(--primary); color: #000; box-shadow: inset 0 0 5px #000; border-color: #000; }
            #vodstudio-modal .scoop-btn.active { background: var(--primary); color: #000; box-shadow: inset 0 0 5px #000; border-color: #000; }
            #vodstudio-modal .mute-btn.active { background: var(--danger); color: #fff; box-shadow: inset 0 0 5px #000; border-color: #000; }
            #vodstudio-modal .solo-btn.active { background: var(--warning); color: #000; box-shadow: inset 0 0 5px #000; border-color: #000; }
            #vodstudio-modal .web3-mint-bar {
                background: #fff !important; color: #000 !important; padding: 10px; margin-top: 8px; border-radius: 4px;
                cursor: pointer; font-weight: bold; text-align: center; border: 2px solid #000; transition: background 0.2s;
            }
            #vodstudio-modal .web3-mint-bar:hover { background: #eee !important; }
            #vodstudio-modal .rec-arm-switch.armed { background: #e74c3c !important; box-shadow: inset 0 0 5px #000; }
            #vodstudio-modal .autotune-switch.armed { background: var(--knob-orange) !important; box-shadow: inset 0 0 5px #000; }
            #vodstudio-modal .limiter-switch.armed { background: var(--danger) !important; box-shadow: inset 0 0 5px #000; }
        `;
        document.head.appendChild(style);

        const trackNames = ['track1', 'track2', 'track3', 'track4'];
        let stripsHtml = '';
        trackNames.forEach((trackName, i) => {
            const tName = this.tracks[trackName].name || `TRACK ${i+1}`;
            stripsHtml += `
            <div class="channel-strip" data-track="${trackName}">
                <input type="text" class="track-name-input chalk-text" data-track="${trackName}" value="${tName}" style="background:transparent; border:none; border-bottom:1px dashed #666; color:#aaa; font-size:12px; text-align:center; width:90%; outline:none; font-family:inherit; text-transform:uppercase; margin-bottom: 4px; padding-bottom: 2px;">
                <span class="chalk-text">TRIM</span><div class="knob-pot grey trim-pot"></div>
                <div style="display:flex; justify-content:center; gap: 15px; width: 100%;">
                    <div style="display:flex; flex-direction:column; align-items:center;">
                        <span class="chalk-text">EQ LO</span><div class="knob-pot blue eq-low-pot"></div>
                    </div>
                    <div style="display:flex; flex-direction:column; align-items:center;">
                        <span class="chalk-text">EQ HI</span><div class="knob-pot blue eq-high-pot"></div>
                    </div>
                </div>
                <div style="display:flex; justify-content:center; gap: 15px; width: 100%;">
                    <div style="display:flex; flex-direction:column; align-items:center;">
                        <span class="chalk-text">FX 1</span><div class="knob-pot green eff1-pot"></div>
                    </div>
                    <div style="display:flex; flex-direction:column; align-items:center;">
                        <span class="chalk-text">FX 2</span><div class="knob-pot green eff2-pot"></div>
                    </div>
                </div>
                <div style="display:flex; justify-content:center; gap: 15px; width: 100%;">
                    <div style="display:flex; flex-direction:column; align-items:center;">
                        <span class="chalk-text">PAN</span><div class="knob-pot grey pan-pot"></div>
                    </div>
                    <div style="display:flex; flex-direction:column; align-items:center;">
                        <span class="chalk-text">WIDTH</span><div class="knob-pot grey width-pot"></div>
                    </div>
                </div>
                <span class="chalk-text">AUTOTUNE</span><div class="toggle-switch-3way autotune-switch" data-track="${trackName}" style="border-color:var(--warning); transition: 0.2s;"></div>
                
                <div style="display: flex; width: 100%; justify-content: space-evenly; align-items: center; margin-top: 2px;">
                    <div style="display: flex; flex-direction: column; align-items: center;">
                        <span class="chalk-text" style="margin-bottom: 2px;">REC FUNC</span>
                        <div class="toggle-switch-3way rec-arm-switch" data-track="${trackName}" style="border-color:#ff3333; transition: 0.2s; margin:0;"></div>
                    </div>
                    <div style="display: flex; flex-direction: column; align-items: center;">
                        <span class="chalk-text" style="margin-bottom: 2px;">LOAD</span>
                        <button class="secondary track-action-btn" data-track="${trackName}" style="font-size: 10px; padding: 1px 6px; margin:0;" title="Load or Bounce">LOAD</button>
                        <input type="file" accept="audio/*" class="track-upload-input" id="upload-${trackName}" data-track="${trackName}" style="display:none;" />
                    </div>
                </div>
                <div style="display: flex; flex-direction: column; width: 100%; gap: 4px; margin-top: 8px; padding: 0 5px; box-sizing: border-box;">
                    <div style="display: flex; gap: 4px; width: 100%;">
                        <button class="m-key vocal-btn ${this.tracks[trackName].vocalChain ? 'active' : ''}" data-track="${trackName}" style="flex:1; height: 20px; font-size: 9px; padding: 0;" title="Vocal Compressor & Filter">VOCAL</button>
                        <button class="m-key scoop-btn ${this.tracks[trackName].autoScoop ? 'active' : ''}" data-track="${trackName}" style="flex:1; height: 20px; font-size: 9px; padding: 0;" title="Auto-Scoop Mids">SCOOP</button>
                    </div>
                    <div style="display: flex; gap: 4px; width: 100%;">
                        <button class="m-key mute-btn ${this.tracks[trackName].isMuted ? 'active' : ''}" data-track="${trackName}" style="flex:1; height: 20px; font-size: 9px; padding: 0;" title="Mute Track">MUTE</button>
                        <button class="m-key solo-btn ${this.tracks[trackName].isSoloed ? 'active' : ''}" data-track="${trackName}" style="flex:1; height: 20px; font-size: 9px; padding: 0;" title="Solo Track">SOLO</button>
                    </div>
                </div>
                <div class="fader-track" style="margin-top: 15px; margin-bottom: 10px;">
                    <div id="vu-meter-${trackName}" style="position: absolute; bottom: 0; left: 0; width: 100%; height: 0%; background: var(--knob-green); opacity: 0.6; pointer-events: none; transition: height 0.05s ease-out; box-shadow: 0 0 10px var(--knob-green); border-radius: 3px;"></div>
                    <div class="fader-cap volume-fader" style="z-index: 2;"></div>
                </div>
            </div>
            `;
        });

        modal.innerHTML = `
        <div id="vodstudio-splash" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; background: rgba(17, 17, 17, 0.98); z-index: 10001; display: flex; flex-direction: column; justify-content: center; align-items: center; padding: 40px; box-sizing: border-box; text-align: center;">
            <h1 style="color: var(--primary); font-size: 32px; margin-bottom: 20px; letter-spacing: 4px;">VODSTUDIO MK I</h1>
            <div style="max-width: 800px; color: #ccc; font-size: 16px; line-height: 1.6; text-align: left; background: #1a252f; padding: 30px; border-radius: 12px; border: 2px solid var(--border);">
                <p><strong style="color: var(--warning);">Welcome to the VODstudio 4-Track.</strong> This is a fully functional digital audio workstation built entirely in your browser.</p>
                <ul style="padding-left: 20px; margin-top: 15px;">
                    <li style="margin-bottom: 10px;"><strong>Load & Split:</strong> Use the "STEM SPLIT" to upload a full track and automatically extract 4 stems, or click "LOAD" on each channel for individual files.</li>
                    <li style="margin-bottom: 10px;"><strong>Record:</strong> Click "REC FUNC" on a channel to arm it, then hit the red record button to lay down vocals or instruments.</li>
                    <li style="margin-bottom: 10px;"><strong>Mix:</strong> Use the channel strips to adjust EQ, Pan, Stereo Width, and FX Sends. The Master bay includes global FX chains, Autotune, and Limiter settings.</li>
                    <li style="margin-bottom: 10px;"><strong>Export:</strong> Click "EXPORT STEMS & MINT" to bounce your final mixdown to the global feed.</li>
                </ul>
                <div style="text-align: center; margin-top: 30px;">
                    <button id="btn-start-vodstudio" style="padding: 15px 30px; font-size: 18px; border-radius: 8px;">Start Mixing</button>
                </div>
            </div>
        </div>
        <div class="console">
            <button class="close-btn" id="btn-close-vodcam">X</button>
            <div class="console-top-bar"><div class="console-top-bar-text">VODSTUDIO MK I</div></div>
            <div class="console-body">
                <div class="mixer-bay">${stripsHtml}</div>
                <div class="master-bay" style="flex-direction: row; display: flex; gap: 15px;">
                    <div style="display: flex; flex-direction: column; justify-content: flex-end; align-items: center; padding-bottom: 10px; width: 50px;">
                        <span class="chalk-text" style="color:var(--danger); margin-bottom: 2px;">LIMIT</span>
                        <div class="toggle-switch-3way limiter-switch" style="border-color:var(--danger); margin-bottom: 10px; width: 30px; height: 14px; transition: 0.2s;"></div>
                        <span class="chalk-text" style="color:var(--warning); margin-bottom: 5px;">MASTER</span>
                        <div class="fader-track" style="flex-grow: 1; min-height: 80px; border-color: rgba(255,170,0,0.5); margin-top: 0; margin-bottom: 10px;">
                            <div id="master-vu-meter" style="position: absolute; bottom: 0; left: 0; width: 100%; height: 0%; background: var(--warning); opacity: 0.6; pointer-events: none; transition: height 0.05s ease-out; box-shadow: 0 0 10px var(--warning); border-radius: 3px;"></div>
                                <div class="fader-cap monitor-fader" style="top: 55px; background: linear-gradient(180deg, #444, #777 10%, #333 45%, #111); border-color: var(--warning); z-index: 2;"></div>
                        </div>
                        </div>
                    <div style="display: flex; flex-direction: column; justify-content: space-between; flex: 1; align-items: center;">
                        <div style="width: 100%; max-width: 250px; display: flex; flex-direction: column; flex-grow: 1; justify-content: space-evenly;">
                            <div>
                                <label style="background: rgba(102, 252, 241, 0.1); border: 1px dashed var(--primary); padding: 6px; border-radius: 4px; text-align: center; cursor: pointer; display: block; margin-bottom: 10px; transition: 0.2s;" onmouseover="this.style.background='rgba(102, 252, 241, 0.2)'" onmouseout="this.style.background='rgba(102, 252, 241, 0.1)'">
                                    <span style="font-size: 12px; font-weight: bold; color: var(--primary);">🪄 STEM SPLIT TRACK</span>
                                    <input type="file" id="vodstudio-ai-split-input" accept="audio/*" style="display:none;" />
                                    <div id="vodstudio-ai-split-status" style="font-size: 9px; color: var(--text-muted); margin-top: 2px;">Upload full track to auto-extract stems to Ch 1-4</div>
                                </label>
                                <div style="display:flex; flex-direction:column; gap:10px;">
                                    <div style="display:flex; justify-content:space-between; align-items:flex-end;">
                                <div class="autotune-master-panel" style="background: rgba(0,0,0,0.3); border: 1px dashed var(--warning); padding: 8px; border-radius: 6px; width: 175px; margin-right:15px;">
                                            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
                                                <span class="chalk-text" style="color:var(--warning)">AUTOTUNE SETTINGS</span>
                                            </div>
                                            <div style="display:flex; gap:2px; margin-bottom: 6px;">
                                                <select id="autotune-root-select" style="background:#111; color:var(--warning); border:1px solid #444; font-family:inherit; font-size:10px; width:40px; padding:0; outline:none;"><option value="0">C</option><option value="1">C#</option><option value="2">D</option><option value="3">D#</option><option value="4">E</option><option value="5">F</option><option value="6">F#</option><option value="7">G</option><option value="8">G#</option><option value="9">A</option><option value="10">A#</option><option value="11">B</option></select>
                                                <select id="autotune-scale-select" style="background:#111; color:var(--warning); border:1px solid #444; font-family:inherit; font-size:10px; flex:1; padding:0; outline:none;"><option value="chromatic">CHROM</option><option value="major">MAJOR</option><option value="minor">MINOR</option></select>
                                            </div>
                                            <div style="display: flex; gap: 10px; justify-content: space-around;">
                                                <div style="text-align:center;"><span class="chalk-text">SPEED</span><div class="knob-pot orange autotune-speed-pot"></div></div>
                                                <div style="text-align:center;"><span class="chalk-text">AMOUNT</span><div class="knob-pot orange autotune-amount-pot"></div></div>
                                            </div>
                                        </div>
                                        <div class="pitch-wheel-wrapper"><span class="chalk-text">PITCH</span><div class="pitch-dial"></div></div>
                                    </div>
                                    <div style="display:flex; gap: 10px; justify-content: space-between;">
                                        <div class="fx-panel" style="background: rgba(0,0,0,0.3); border: 1px dashed var(--knob-green); padding: 5px; border-radius: 4px; flex: 1;">
                                            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
                                                <span class="chalk-text" style="color:var(--knob-green)">FX 1</span>
                                                <select id="fx1-type-select" style="background:#111; color:var(--knob-green); border:1px solid #444; font-family:inherit; font-size:10px; padding:0; outline:none; width: 60px;">
                                                    <option value="delay">Delay</option>
                                                    <option value="reverb">Reverb</option>
                                                    <option value="lowpass">Lowpass</option>
                                                    <option value="highpass">Highpass</option>
                                                    <option disabled>── DIGITAL & LO-FI ──</option>
                                                    <option value="bitcrusher">Bitcrusher</option>
                                                    <option value="vinyl">Vinyl Simulator</option>
                                                    <option disabled>── SATURATION ──</option>
                                                    <option value="tape_sat">Tape Saturation</option>
                                                    <option value="wavefolder">Wavefolder</option>
                                                    <option disabled>── MODULATION ──</option>
                                                    <option value="chorus">Chorus / Flanger</option>
                                                    <option value="phaser">Phaser</option>
                                                    <option value="autopan">Auto-Pan</option>
                                                    <option value="pingpong">Ping-Pong Delay</option>
                                                    <option disabled>── SPECTRAL ──</option>
                                                    <option value="tremolo">Tremolo</option>
                                                    <option disabled>── GLITCH ──</option>
                                                    <option value="stutter">Stutter / Tape Stop</option>
                                                    <option value="freqshift">Frequency Shifter</option>
                                                </select>
                                            </div>
                                            <div style="display: flex; gap: 10px; justify-content: space-around;">
                                                <div style="text-align:center;"><span class="chalk-text" id="fx1-p1-label">TIME</span><div class="knob-pot green fx1-p1-pot" data-fx="1" data-param="1"></div></div>
                                                <div style="text-align:center;"><span class="chalk-text" id="fx1-p2-label">FDBK</span><div class="knob-pot green fx1-p2-pot" data-fx="1" data-param="2"></div></div>
                                            </div>
                                        </div>

                                        <div class="fx-panel" style="background: rgba(0,0,0,0.3); border: 1px dashed var(--knob-green); padding: 5px; border-radius: 4px; flex: 1;">
                                            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
                                                <span class="chalk-text" style="color:var(--knob-green)">FX 2</span>
                                                <select id="fx2-type-select" style="background:#111; color:var(--knob-green); border:1px solid #444; font-family:inherit; font-size:10px; padding:0; outline:none; width: 60px;">
                                                    <option value="delay">Delay</option>
                                                    <option value="reverb">Reverb</option>
                                                    <option value="lowpass">Lowpass</option>
                                                    <option value="highpass">Highpass</option>
                                                    <option disabled>── DIGITAL & LO-FI ──</option>
                                                    <option value="bitcrusher">Bitcrusher</option>
                                                    <option value="vinyl">Vinyl Simulator</option>
                                                    <option disabled>── SATURATION ──</option>
                                                    <option value="tape_sat">Tape Saturation</option>
                                                    <option value="wavefolder">Wavefolder</option>
                                                    <option disabled>── MODULATION ──</option>
                                                    <option value="chorus">Chorus / Flanger</option>
                                                    <option value="phaser">Phaser</option>
                                                    <option value="autopan">Auto-Pan</option>
                                                    <option value="pingpong">Ping-Pong Delay</option>
                                                    <option disabled>── SPECTRAL ──</option>
                                                    <option value="tremolo">Tremolo</option>
                                                    <option disabled>── GLITCH ──</option>
                                                    <option value="stutter">Stutter / Tape Stop</option>
                                                    <option value="freqshift">Frequency Shifter</option>
                                                </select>
                                            </div>
                                            <div style="display: flex; gap: 10px; justify-content: space-around;">
                                                <div style="text-align:center;"><span class="chalk-text" id="fx2-p1-label">FREQ</span><div class="knob-pot green fx2-p1-pot" data-fx="2" data-param="1"></div></div>
                                                <div style="text-align:center;"><span class="chalk-text" id="fx2-p2-label">RES</span><div class="knob-pot green fx2-p2-pot" data-fx="2" data-param="2"></div></div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div style="display:flex; flex-direction:column; gap:8px;">
                                <div class="tape-compartment" style="margin-top: 0;">
                                    <span class="chalk-text" style="position: absolute; bottom: 8px; font-size: 0.5rem; opacity: 0.4;">4-TRACK REWRITABLE MEMORY CORE</span>
                                    <div class="cassette-tape">
                                        <div class="cassette-sticker">
                                            <input type="text" id="mixtape-title-input" class="cassette-label-text" value="VOD-90 MIXTAPE" maxlength="30" />
                                        </div>
                                        <div class="tape-roll" id="tape-roll-left" style="left: 67px; top: 55px; width: 85px; height: 85px;">
                                            <div class="tape-roll-ridges"></div>
                                        </div>
                                        <div class="tape-roll" id="tape-roll-right" style="left: 153px; top: 55px; width: 28px; height: 28px;">
                                            <div class="tape-roll-ridges"></div>
                                        </div>
                                        <div class="window-pane">
                                            <div class="tape-hub"><div class="tape-hub-spokes"></div></div>
                                            <div class="tape-hub"><div class="tape-hub-spokes"></div></div>
                                        </div>
                                        <div class="cassette-bottom-cutout">
                                            <div></div><div></div><div></div>
                                        </div>
                                    </div>
                                </div>
                                <div class="mechanical-keys" style="margin-top: 0;">
                                    <button class="m-key rec-key" id="btn-record" title="Record">🔴</button>
                                    <button class="m-key" id="btn-play" title="Play">▶</button>
                                    <button class="m-key" id="btn-rewind" title="Rewind">⏪</button>
                                    <button class="m-key" id="btn-ffwd" title="Fast Forward">⏩</button>
                                    <button class="m-key" id="btn-stop" title="Stop">⏹</button>
                                    <button class="m-key" id="btn-pause" title="Pause">⏸</button>
                                </div>
                                <div style="display: flex; gap: 5px; margin-top: 5px;">
                                <button id="btn-new-tape" class="secondary" style="flex: 1; padding: 6px; font-size: 11px;">📄 NEW TAPE</button>
                                    <button id="btn-save-tape" class="secondary" style="flex: 1; padding: 6px; font-size: 11px;">💾 SAVE TAPE</button>
                                    <button id="btn-load-tape" class="secondary" style="flex: 1; padding: 6px; font-size: 11px;">📂 LOAD TAPE</button>
                                </div>
                                <div class="web3-mint-bar chalk-text" id="btn-mint" style="margin-top: 5px;">🚀 EXPORT STEMS & MINT</div>
                                <button id="btn-open-po33" class="secondary" style="margin-top: 5px; width: 100%; font-size: 12px; font-weight: bold; padding: 8px; border-color: var(--knob-orange); color: var(--knob-orange); background: rgba(0,0,0,0.5);">📟 OPEN VO-88</button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            </div>
        `;
        document.body.appendChild(modal);
        
        if (!this.vuMeterAnimation) {
            this.drawVUMeter();
        }

        if (this._resizeHandler) window.removeEventListener('resize', this._resizeHandler);
        this._resizeHandler = () => {
            const consoleEl = modal.querySelector('.console');
            if (!consoleEl) return;
            
            consoleEl.style.transform = 'none';
            const actualWidth = consoleEl.offsetWidth || 1080;

            const availableWidth = window.innerWidth;
            const availableHeight = window.innerHeight;
            const padding = 20;

            const scaleWidth = Math.min(1, (availableWidth - padding) / actualWidth);
            let targetHeight = (availableHeight - padding) / scaleWidth;
            const finalHeight = Math.max(580, Math.min(780, targetHeight));
            
            let finalScale = scaleWidth;
            if (finalHeight * finalScale > availableHeight - padding) {
                finalScale = (availableHeight - padding) / finalHeight;
            }
            
            consoleEl.style.transform = `scale(${finalScale})`;
            consoleEl.style.height = `${finalHeight}px`;
            this.syncUI();
        };
        window.addEventListener('resize', this._resizeHandler);
        this._resizeHandler();

        this.bindEvents(modal);
    },

    bindEvents(modal) {
        const startBtn = modal.querySelector('#btn-start-vodstudio');
        if (startBtn) {
            startBtn.onclick = () => {
                const splash = modal.querySelector('#vodstudio-splash');
                if (splash) splash.style.display = 'none';
                if (this.audioCtx && this.audioCtx.state === 'suspended') {
                    this.audioCtx.resume();
                }
            };
        }

        const limiterSwitch = modal.querySelector('.limiter-switch');
        if (limiterSwitch) {
            if (this.limiterEnabled) limiterSwitch.classList.add('armed');
            limiterSwitch.onclick = () => {
                this.limiterEnabled = !this.limiterEnabled;
                limiterSwitch.classList.toggle('armed', this.limiterEnabled);
                if (this.limiterNode) {
                    this.limiterNode.ratio.value = this.limiterEnabled ? 20.0 : 1.0;
                }
                this.saveStudioState();
            };
        }

        let activeFader = null, activeKnob = null, activePitch = null;
        let startY = 0; let currentPitchRot = 0; let currentScale = 1.0;
        this.currentKnobRots.clear();

        const pointerMoveHandler = (e) => {
            if (!activeFader && !activeKnob && !activePitch) return;
            
            if (activeFader) {
                const track = activeFader.parentElement;
                const rect = track.getBoundingClientRect();
                let unscaledY = (e.clientY - rect.top) / currentScale;
                let y = Math.max(0, Math.min(track.offsetHeight - activeFader.offsetHeight, unscaledY - (activeFader.offsetHeight / 2)));
                activeFader.style.top = y + 'px';
                const val = 1.0 - (y / (track.offsetHeight - activeFader.offsetHeight));
                if (activeFader.classList.contains('volume-fader')) {
                    this.setVolume(activeFader.closest('.channel-strip').dataset.track, val);
                } else if (activeFader.classList.contains('monitor-fader')) {
                    if (this.masterGain) this.masterGain.gain.value = val * 1.5;
                }
            } else if (activeKnob) {
                let rot = Math.max(-150, Math.min(150, (this.currentKnobRots.get(activeKnob) || 0) + ((startY - e.clientY) / currentScale) * 2));
                startY = e.clientY;
                this.currentKnobRots.set(activeKnob, rot);
                activeKnob.style.transform = `rotate(${rot}deg)`;
                
                let trackId = null;
                const strip = activeKnob.closest('.channel-strip');
                if (strip) trackId = strip.dataset.track;

                if (trackId) {
                    if (activeKnob.classList.contains('pan-pot')) this.setPan(trackId, rot / 150);
                    else if (activeKnob.classList.contains('width-pot')) this.setWidth(trackId, Math.max(0, (rot + 150) / 300));
                    else if (activeKnob.classList.contains('trim-pot')) this.setTrim(trackId, 1.0 + (rot / 150));
                    else if (activeKnob.classList.contains('eq-high-pot')) this.setEqHigh(trackId, (rot / 150) * 15);
                    else if (activeKnob.classList.contains('eq-low-pot')) this.setEqLow(trackId, (rot / 150) * 15);
                    else if (activeKnob.classList.contains('eff1-pot')) this.setEff1(trackId, Math.max(0, (rot + 150) / 300));
                    else if (activeKnob.classList.contains('eff2-pot')) this.setEff2(trackId, Math.max(0, (rot + 150) / 300));
                } else if (activeKnob.classList.contains('autotune-speed-pot')) {
                    this.autotuneSpeedVal = Math.max(0, (rot + 150) / 300);
                    this.updateAllAutotuneNodes();
                } else if (activeKnob.classList.contains('autotune-amount-pot')) {
                    this.autotuneAmountVal = Math.max(0, (rot + 150) / 300);
                    this.updateAllAutotuneNodes();
                } else {
                    const fx = activeKnob.dataset.fx;
                    const param = activeKnob.dataset.param;
                    if (fx && param) {
                        this.setFxParam(fx, parseInt(param), Math.max(0, (rot + 150) / 300));
                    }
                } 
            } else if (activePitch) {
                currentPitchRot = Math.max(-150, Math.min(150, currentPitchRot + ((startY - e.clientY) / currentScale) * 2));
                startY = e.clientY;
                activePitch.style.transform = `rotate(${currentPitchRot}deg)`;
                this.playbackRate = 1.0 + (currentPitchRot / 300);
                for (const tr in this.tracks) {
                    if (this.tracks[tr].source) try { this.tracks[tr].source.playbackRate.value = this.playbackRate; } catch(err){}
                }
            }
        };

        const pointerUpHandler = () => { 
            if (activeFader || activeKnob || activePitch) this.saveStudioState();
            activeFader = activeKnob = activePitch = null; 
        };

        const pointerDownHandler = (e) => {
            let target = e.target;
            if (target.classList.contains('volume-fader') || target.classList.contains('monitor-fader')) {
                activeFader = target;
                currentScale = modal.querySelector('.console').getBoundingClientRect().width / 1080;
                target.setPointerCapture(e.pointerId);
            } else if (target.classList.contains('knob-pot')) { 
                activeKnob = target; startY = e.clientY; 
                currentScale = modal.querySelector('.console').getBoundingClientRect().width / 1080;
                if (!this.currentKnobRots.has(activeKnob)) this.currentKnobRots.set(activeKnob, 0); 
                target.setPointerCapture(e.pointerId);
            } else if (target.classList.contains('pitch-dial')) { 
                activePitch = target; startY = e.clientY; 
                currentScale = modal.querySelector('.console').getBoundingClientRect().width / 1080;
                target.setPointerCapture(e.pointerId);
            }
        };

        modal.addEventListener('pointerdown', pointerDownHandler);
        document.addEventListener('pointermove', pointerMoveHandler);
        document.addEventListener('pointerup', pointerUpHandler);
        document.addEventListener('pointercancel', pointerUpHandler);

        const updateFxVisuals = (fxNum) => {
            const rot1 = (this[`fx${fxNum}Param1Val`] * 300) - 150;
            const rot2 = (this[`fx${fxNum}Param2Val`] * 300) - 150;
            const el1 = modal.querySelector(`.fx${fxNum}-p1-pot`);
            if (el1) { el1.style.transform = `rotate(${rot1}deg)`; this.currentKnobRots.set(el1, rot1); }
            const el2 = modal.querySelector(`.fx${fxNum}-p2-pot`);
            if (el2) { el2.style.transform = `rotate(${rot2}deg)`; this.currentKnobRots.set(el2, rot2); }
        };

        const newTapeBtn = modal.querySelector('#btn-new-tape');
        if (newTapeBtn) newTapeBtn.onclick = () => this.newTape();

        const saveTapeBtn = modal.querySelector('#btn-save-tape');
        if (saveTapeBtn) saveTapeBtn.onclick = () => this.saveTape();

        const loadTapeBtn = modal.querySelector('#btn-load-tape');
        if (loadTapeBtn) loadTapeBtn.onclick = () => this.showLoadTapeModal();

        const setFxDefaults = (fxNum, type) => {
            const defaults = {
                'delay': [0.4, 0.33], 'reverb': [0.1, 0.8], 'lowpass': [0.15, 0.05], 'highpass': [0.1, 0.05],
                'bitcrusher': [0.5, 0.5], 'vinyl': [0.3, 0.3], 'tape_sat': [0.5, 0.5], 'wavefolder': [0.5, 0.5],
                'chorus': [0.3, 0.5], 'phaser': [0.2, 0.6], 'autopan': [0.5, 0.8], 'pingpong': [0.4, 0.5],
                'tremolo': [0.5, 0.8], 'stutter': [0.5, 0.5], 'freqshift': [0.2, 0.5]
            };
            const d = defaults[type] || [0.5, 0.5];
            this[`fx${fxNum}Param1Val`] = d[0];
            this[`fx${fxNum}Param2Val`] = d[1];
            updateFxVisuals(fxNum);
        };

        const fx1Select = document.getElementById('fx1-type-select');
        if (fx1Select) {
            fx1Select.value = this.fx1Type;
            fx1Select.onchange = (e) => { this.fx1Type = e.target.value; setFxDefaults(1, this.fx1Type); this.rebuildFx(1); this.saveStudioState(); };
        }
        const fx2Select = document.getElementById('fx2-type-select');
        if (fx2Select) {
            fx2Select.value = this.fx2Type;
            fx2Select.onchange = (e) => { this.fx2Type = e.target.value; setFxDefaults(2, this.fx2Type); this.rebuildFx(2); this.saveStudioState(); };
        }

        const rootSelect = document.getElementById('autotune-root-select');
        if (rootSelect) {
            rootSelect.value = this.autotuneRootNote;
            rootSelect.onchange = (e) => { this.autotuneRootNote = parseInt(e.target.value); this.updateAllAutotuneNodes(); this.saveStudioState(); };
        }
        const scaleSelect = document.getElementById('autotune-scale-select');
        if (scaleSelect) {
            scaleSelect.value = this.autotuneScaleType;
            scaleSelect.onchange = (e) => { this.autotuneScaleType = e.target.value; this.updateAllAutotuneNodes(); this.saveStudioState(); };
        }

        modal.querySelectorAll('.autotune-switch').forEach(sw => {
            sw.onclick = () => {
                const trackId = sw.dataset.track;
                const track = this.tracks[trackId];
                if (track) {
                    track.autotuneEnabled = !track.autotuneEnabled;
                    sw.classList.toggle('armed', track.autotuneEnabled);
                    this.applyAutotuneMix(trackId);
                    this.saveStudioState();
                }
            };
        });

        modal.querySelectorAll('.vocal-btn').forEach(btn => {
            btn.onclick = () => {
                const t = this.tracks[btn.dataset.track];
                if (t) {
                    t.vocalChain = !t.vocalChain;
                    btn.classList.toggle('active', t.vocalChain);
                    if (t.vocalMix && t.vocalBypass) {
                        const mix = t.vocalChain ? 1.0 : 0.0;
                        t.vocalMix.gain.value = mix;
                        t.vocalBypass.gain.value = 1.0 - mix;
                    }
                    if (t.vocalChain) {
                        this.applySmartVocalChain(btn.dataset.track);
                    }
                    this.saveStudioState();
                }
            };
        });

        modal.querySelectorAll('.scoop-btn').forEach(btn => {
            btn.onclick = () => {
                const trackId = btn.dataset.track;
                if (this.tracks[trackId]) {
                    this.applyScoop(trackId);
                    btn.classList.toggle('active', this.tracks[trackId].autoScoop);
                    this.saveStudioState();
                }
            };
        });

        modal.querySelectorAll('.mute-btn').forEach(btn => {
            btn.onclick = () => {
                const t = this.tracks[btn.dataset.track];
                if (t) {
                    t.isMuted = !t.isMuted;
                    btn.classList.toggle('active', t.isMuted);
                    this.updateTrackGains();
                    this.saveStudioState();
                }
            };
        });
        
        modal.querySelectorAll('.solo-btn').forEach(btn => {
            btn.onclick = () => {
                const t = this.tracks[btn.dataset.track];
                if (t) {
                    t.isSoloed = !t.isSoloed;
                    btn.classList.toggle('active', t.isSoloed);
                    this.updateTrackGains();
                    this.saveStudioState();
                }
            };
        });

        modal.querySelectorAll('.rec-arm-switch').forEach(sw => {
            sw.onclick = () => this.toggleArmTrack(sw.dataset.track, sw);
        });

        modal.querySelectorAll('.track-name-input').forEach(input => {
            input.addEventListener('change', (e) => {
                const trackId = e.target.dataset.track;
                if (this.tracks[trackId]) {
                    this.tracks[trackId].name = e.target.value.toUpperCase();
                    this.saveStudioState();
                }
            });
        });

        modal.querySelectorAll('.track-action-btn').forEach(btn => {
            btn.onclick = () => {
                this.showTrackActionMenu(btn.dataset.track);
            };
        });

        modal.querySelectorAll('.track-upload-input').forEach(input => {
            input.addEventListener('change', async (e) => {
                const trackId = e.target.dataset.track;
                const file = e.target.files[0];
                if (file && this.tracks[trackId]) {
                    this.stop();
                    try {
                        const arrayBuffer = await file.arrayBuffer();
                        const audioBuffer = await this.audioCtx.decodeAudioData(arrayBuffer);
                        this.tracks[trackId].buffer = audioBuffer;
                        
                        let safeName = file.name.replace(/\.[^/.]+$/, "").substring(0, 16).toUpperCase();
                        this.tracks[trackId].name = safeName;
                        
                        const nameInput = modal.querySelector(`.track-name-input[data-track="${trackId}"]`);
                        if (nameInput) nameInput.value = safeName;
                        
                        if (!this.tracks[trackId].gain) {
                            this.setupTrackRouting(trackId);
                        }
                    } catch(err) {
                        console.error(err);
                        alert("Could not load audio file. Please ensure it is a valid format.");
                    }
                }
                e.target.value = ''; // Reset input to allow re-uploading the same file
            });
        });

        const stemSplitInput = modal.querySelector('#vodstudio-ai-split-input');
        if (stemSplitInput) {
            stemSplitInput.addEventListener('change', async (e) => {
                const file = e.target.files[0];
                if (!file) return;
                this.stop();
                
                if (!window.CoreEngine || !window.CoreEngine.userKeys.publicKey) {
                    alert("You must be logged in to use the Stem Splitter.");
                    e.target.value = '';
                    return;
                }

                const statusEl = document.getElementById('vodstudio-ai-split-status');
                
                try {
                    statusEl.innerText = "Fetching cost...";
                    statusEl.style.color = "var(--warning)";
                    const costRes = await fetch(`/api/tools/stem-cost?publicKey=${window.CoreEngine.userKeys.publicKey}`);
                    const costData = await costRes.json();
                    const cost = costData.cost;

                    if (!confirm(`This will route your track through the Stem Splitter and cost ${cost.toLocaleString()} $VOD. Proceed?`)) {
                        statusEl.innerText = "Upload full track to auto-extract stems to Ch 1-4";
                        statusEl.style.color = "var(--text-muted)";
                        e.target.value = '';
                        return;
                    }

                    statusEl.innerText = "1/3 Analyzing Frequencies (Native DSP)...";
                    await new Promise(r => setTimeout(r, 50));
                    const stems = await window.StemSplitterEngine.processNativeStemSplit(file);

                    statusEl.innerText = "2/3 Recording to Ledger...";
                    await window.CoreEngine.sendSignedTransaction('STEM_SPLIT', '0x00', { cost: cost });

                    statusEl.innerText = "3/3 Loading into Engine...";
                    await this.loadStems(stems);

                    statusEl.innerText = "Split Complete!";
                    statusEl.style.color = "var(--success)";
                    
                    if (window.fetchUserProfile) window.fetchUserProfile(window.CoreEngine.userKeys.publicKey, true);

                    setTimeout(() => {
                        statusEl.innerText = "Upload full track to auto-extract stems to Ch 1-4";
                        statusEl.style.color = "var(--text-muted)";
                    }, 5000);
                } catch (err) {
                    alert(`An error occurred: ${err.message}`);
                    console.error(err);
                    statusEl.innerText = "Error: " + err.message;
                    statusEl.style.color = "var(--danger)";
                }
                e.target.value = '';
            });
        }

        document.getElementById('btn-close-vodcam').onclick = () => {
            if (this.vuMeterAnimation) {
                cancelAnimationFrame(this.vuMeterAnimation);
                this.vuMeterAnimation = null;
            }
            document.removeEventListener('pointermove', pointerMoveHandler);
            document.removeEventListener('pointerup', pointerUpHandler);
            document.removeEventListener('pointercancel', pointerUpHandler);
            window.removeEventListener('resize', this._resizeHandler);
            this.stop();
            if (this.micStream) {
                this.micStream.getTracks().forEach(t => t.stop());
                this.micStream = null;
            }
            modal.remove();
        };

        const recBtn = modal.querySelector('#btn-record');
        const playBtn = modal.querySelector('#btn-play');
        const pauseBtn = modal.querySelector('#btn-pause');
        const rewBtn = modal.querySelector('#btn-rewind');
        const ffwdBtn = modal.querySelector('#btn-ffwd');
        
        recBtn.onclick = async () => {
            if (this.armedTrack && !this.isRecording) {
                this.startRecording();
                await this.play();
                if (this.isPlaying) {
                    recBtn.classList.add('active-playback');
                    document.querySelectorAll('.tape-hub').forEach(h => h.classList.add('spinning'));
                }
            } else if (!this.armedTrack) {
                alert('Please arm a track by clicking its REC FUNC switch first.');
            }
        };

        playBtn.onclick = async () => {
            if (this.isRecording) return; // Don't let play button interrupt a live recording
            await this.play(); 
            if (this.isPlaying) {
                playBtn.classList.add('active-playback');
                if(pauseBtn) pauseBtn.classList.remove('active-playback');
                document.querySelectorAll('.tape-hub').forEach(h => h.classList.add('spinning'));
            }
        };
        
        if (pauseBtn) {
            pauseBtn.onclick = () => {
                if (this.isRecording) return;
                this.pause();
                playBtn.classList.remove('active-playback');
                pauseBtn.classList.add('active-playback');
            };
        }
        
        if (rewBtn) rewBtn.onclick = async () => await this.rewind();
        if (ffwdBtn) ffwdBtn.onclick = async () => await this.fastForward();
        
        modal.querySelector('#btn-stop').onclick = () => {
            this.stop();
        };

        const mintBtn = modal.querySelector('#btn-mint');
        mintBtn.onclick = () => {
            mintBtn.innerText = "⏳ MIXING DOWN AUDIO Bouncing to Master...";
            mintBtn.style.background = "var(--knob-orange)";
            mintBtn.style.pointerEvents = "none";
            setTimeout(() => this.bounceMixdown(), 100);
        };
        
        const po33Btn = modal.querySelector('#btn-open-po33');
        if (po33Btn) {
            po33Btn.onclick = () => {
                if (!window.PO33Engine) {
                    const script = document.createElement('script');
                    script.src = '/PO33Engine.js';
                    script.onload = () => window.PO33Engine.init(this);
                    document.head.appendChild(script);
                } else {
                    window.PO33Engine.init(this);
                }
            };
        }

        setTimeout(() => {
            const rotATSpeed = (this.autotuneSpeedVal * 300) - 150;
            const rotATAmt = (this.autotuneAmountVal * 300) - 150;
            const q = (sel, rot) => { const el = modal.querySelector(sel); if(el){ el.style.transform = `rotate(${rot}deg)`; this.currentKnobRots.set(el, rot); } };
            
            const qAll = (sel, rot) => { 
                modal.querySelectorAll(sel).forEach(el => { 
                    el.style.transform = `rotate(${rot}deg)`; 
                    this.currentKnobRots.set(el, rot); 
                }); 
            };
            
            updateFxVisuals(1);
            updateFxVisuals(2);
            
            qAll('.autotune-speed-pot', rotATSpeed);
            qAll('.autotune-amount-pot', rotATAmt);
            
            for (let i = 1; i <= 4; i++) {
                const tr = this.tracks[`track${i}`];
                q(`.channel-strip[data-track="track${i}"] .trim-pot`, ((tr.trim ? tr.trim.gain.value : 0.5) - 1.0) * 150);
                q(`.channel-strip[data-track="track${i}"] .eq-high-pot`, (tr.eqHigh ? tr.eqHigh.gain.value : 0) / 15 * 150);
                q(`.channel-strip[data-track="track${i}"] .eq-low-pot`, (tr.eqLow ? tr.eqLow.gain.value : 0) / 15 * 150);
                q(`.channel-strip[data-track="track${i}"] .eff1-pot`, (tr.eff1Send ? tr.eff1Send.gain.value : 0) * 300 - 150);
                q(`.channel-strip[data-track="track${i}"] .eff2-pot`, (tr.eff2Send ? tr.eff2Send.gain.value : 0) * 300 - 150);
                q(`.channel-strip[data-track="track${i}"] .pan-pot`, (tr.panner ? tr.panner.pan.value : 0) * 150);
                
                const fader = modal.querySelector(`.channel-strip[data-track="track${i}"] .volume-fader`);
                if (fader) fader.style.top = ((1.0 - tr.targetVolume) * 200) + 'px';
            }
            
            const mFader = modal.querySelector('.monitor-fader');
            if (mFader) {
                mFader.style.top = ((1.0 - (this.masterGain ? this.masterGain.gain.value / 1.5 : 0.66)) * 265) + 'px';
            }
            
            this.rebuildFx(1);
            this.rebuildFx(2);
        }, 50);
    },

    syncUI() {
        const modal = document.getElementById('vodstudio-modal');
        if (!modal) return;
        
        modal.querySelectorAll('.track-name-input').forEach(input => {
            const trackId = input.dataset.track;
            if (this.tracks[trackId]) input.value = this.tracks[trackId].name;
        });
        
        const q = (sel, rot) => { const el = modal.querySelector(sel); if(el){ el.style.transform = `rotate(${rot}deg)`; this.currentKnobRots.set(el, rot); } };
        const qAll = (sel, rot) => { modal.querySelectorAll(sel).forEach(el => { el.style.transform = `rotate(${rot}deg)`; this.currentKnobRots.set(el, rot); }); };

        const rotATSpeed = (this.autotuneSpeedVal * 300) - 150;
        const rotATAmt = (this.autotuneAmountVal * 300) - 150;
        qAll('.autotune-speed-pot', rotATSpeed);
        qAll('.autotune-amount-pot', rotATAmt);

        for (let i = 1; i <= 4; i++) {
            const tr = this.tracks[`track${i}`];
            q(`.channel-strip[data-track="track${i}"] .trim-pot`, ((tr.trim ? tr.trim.gain.value : 0.5) - 1.0) * 150);
            q(`.channel-strip[data-track="track${i}"] .eq-high-pot`, (tr.eqHigh ? tr.eqHigh.gain.value : 0) / 15 * 150);
            q(`.channel-strip[data-track="track${i}"] .eq-low-pot`, (tr.eqLow ? tr.eqLow.gain.value : 0) / 15 * 150);
            q(`.channel-strip[data-track="track${i}"] .eff1-pot`, (tr.eff1Send ? tr.eff1Send.gain.value : 0) * 300 - 150);
            q(`.channel-strip[data-track="track${i}"] .eff2-pot`, (tr.eff2Send ? tr.eff2Send.gain.value : 0) * 300 - 150);
            q(`.channel-strip[data-track="track${i}"] .pan-pot`, (tr.panner ? tr.panner.pan.value : 0) * 150);
            q(`.channel-strip[data-track="track${i}"] .width-pot`, ((tr.widthVal !== undefined ? tr.widthVal : 0.5) * 300) - 150);
            
            const fader = modal.querySelector(`.channel-strip[data-track="track${i}"] .volume-fader`);
            if (fader) fader.style.top = ((1.0 - tr.targetVolume) * 200) + 'px';
            
            const muteBtn = modal.querySelector(`.mute-btn[data-track="track${i}"]`);
            if (muteBtn) muteBtn.classList.toggle('active', tr.isMuted);
            const soloBtn = modal.querySelector(`.solo-btn[data-track="track${i}"]`);
            if (soloBtn) soloBtn.classList.toggle('active', tr.isSoloed);
            const vocalBtn = modal.querySelector(`.vocal-btn[data-track="track${i}"]`);
            if (vocalBtn) vocalBtn.classList.toggle('active', tr.vocalChain);
            const scoopBtn = modal.querySelector(`.scoop-btn[data-track="track${i}"]`);
            if (scoopBtn) scoopBtn.classList.toggle('active', tr.autoScoop);
            const autoTuneSw = modal.querySelector(`.autotune-switch[data-track="track${i}"]`);
            if (autoTuneSw) autoTuneSw.classList.toggle('armed', tr.autotuneEnabled);
        }
        
        const mFader = modal.querySelector('.monitor-fader');
        if (mFader) mFader.style.top = ((1.0 - (this.masterGain ? this.masterGain.gain.value / 1.5 : 0.66)) * 265) + 'px';
        
        const limiterSwitch = modal.querySelector('.limiter-switch');
        if (limiterSwitch) limiterSwitch.classList.toggle('armed', this.limiterEnabled);
        
        const fx1Select = modal.querySelector('#fx1-type-select');
        if (fx1Select) fx1Select.value = this.fx1Type;
        const fx2Select = modal.querySelector('#fx2-type-select');
        if (fx2Select) fx2Select.value = this.fx2Type;

        const rootSelect = modal.querySelector('#autotune-root-select');
        if (rootSelect) rootSelect.value = this.autotuneRootNote;
        const scaleSelect = modal.querySelector('#autotune-scale-select');
        if (scaleSelect) scaleSelect.value = this.autotuneScaleType;
        
        const rot1_1 = (this.fx1Param1Val * 300) - 150;
        const rot2_1 = (this.fx1Param2Val * 300) - 150;
        q('.fx1-p1-pot', rot1_1); q('.fx1-p2-pot', rot2_1);
        
        const rot1_2 = (this.fx2Param1Val * 300) - 150;
        const rot2_2 = (this.fx2Param2Val * 300) - 150;
        q('.fx2-p1-pot', rot1_2); q('.fx2-p2-pot', rot2_2);
    },

    newTape() {
        if (!confirm("Start a new blank tape? All unsaved audio and settings will be permanently cleared.")) return;
        this.stop();
        
        for (let i = 1; i <= 4; i++) {
            const tr = this.tracks[`track${i}`];
            tr.buffer = null;
            tr.name = `TRACK ${i}`;
            tr.targetVolume = 0.55;
            tr.isMuted = false;
            tr.isSoloed = false;
            tr.vocalChain = false;
            tr.autoScoop = false;
            tr.autotuneEnabled = false;
            tr.widthVal = 0.5;
            if (tr.trim) tr.trim.gain.value = 0.5;
            if (tr.eqHigh) tr.eqHigh.gain.value = 0;
            if (tr.eqLow) tr.eqLow.gain.value = 0;
            if (tr.eff1Send) tr.eff1Send.gain.value = 0;
            if (tr.eff2Send) tr.eff2Send.gain.value = 0;
            if (tr.panner) tr.panner.pan.value = 0;
            if (tr.widthSide) tr.widthSide.gain.value = 0.5;
            if (tr.vocalMix && tr.vocalBypass) {
                tr.vocalMix.gain.value = 0;
                tr.vocalBypass.gain.value = 1.0;
            }
            if (tr.scoopFilter) tr.scoopFilter.gain.value = 0;
        }
        
        this.fx1Type = 'delay'; this.fx1Param1Val = 0.4; this.fx1Param2Val = 0.33;
        this.fx2Type = 'lowpass'; this.fx2Param1Val = 0.15; this.fx2Param2Val = 0.05;
        this.autotuneRootNote = 0; this.autotuneScaleType = 'chromatic'; this.autotuneSpeedVal = 1.0; this.autotuneAmountVal = 1.0;
        this.limiterEnabled = false;
        
        if (this.limiterNode) this.limiterNode.ratio.value = 1.0;
        if (this.masterGain) this.masterGain.gain.value = 1.0;
        
        this.updateTrackGains();
        this.applyAutotuneMix('track1'); this.applyAutotuneMix('track2'); this.applyAutotuneMix('track3'); this.applyAutotuneMix('track4');
        this.updateAllAutotuneNodes();
        this.rebuildFx(1); this.rebuildFx(2);
        this.saveStudioState();
        
        this.syncUI();
        alert("Tape wiped! Ready for a fresh mix.");
    },

    async bounceMixdown() {
        if (!this.tracks.track1.buffer && !this.tracks.track2.buffer && !this.tracks.track3.buffer && !this.tracks.track4.buffer) return alert("Please load stems first.");
        
        let maxDur = Math.max(...Object.values(this.tracks).map(t => t.buffer ? t.buffer.duration : 0));
        const offlineCtx = new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(2, Math.ceil(44100 * (maxDur / this.playbackRate)), 44100);
        
        // Load Native AutoTune Worklet into Offline Context
        try {
            await offlineCtx.audioWorklet.addModule('/AutoTuneProcessor.js');
        } catch(e) {
            console.warn('[VODSTUDIO] Could not load AutoTuneProcessor for mixdown', e);
        }

        const offlineMaster = offlineCtx.createGain();
        offlineMaster.gain.value = this.masterGain ? this.masterGain.gain.value : 1.0;
        
        const offlineLimiter = offlineCtx.createDynamicsCompressor();
        offlineLimiter.threshold.value = -2.0;
        offlineLimiter.knee.value = 0.0;
        offlineLimiter.ratio.value = this.limiterEnabled ? 20.0 : 1.0;
        offlineLimiter.attack.value = 0.005;
        offlineLimiter.release.value = 0.050;

        const offlineTape = offlineCtx.createWaveShaper();
        offlineTape.curve = window.FXEngine.makeDistortionCurve(50);
        offlineMaster.connect(offlineLimiter);
        offlineLimiter.connect(offlineTape);
        offlineTape.connect(offlineCtx.destination);
        
        const offlineFx1Input = offlineCtx.createGain();
        const offlineFx2Input = offlineCtx.createGain();
        window.FXEngine.buildNativeFxChain(offlineCtx, this.wasmModule, this.fx1Type, offlineFx1Input, offlineMaster, this.fx1Param1Val, this.fx1Param2Val);
        window.FXEngine.buildNativeFxChain(offlineCtx, this.wasmModule, this.fx2Type, offlineFx2Input, offlineMaster, this.fx2Param1Val, this.fx2Param2Val);

        for (const trackName in this.tracks) {
            const track = this.tracks[trackName];
            if (track.buffer) {
                const source = offlineCtx.createBufferSource();
                source.buffer = track.buffer;
                source.playbackRate.value = this.playbackRate;
                
                const trim = offlineCtx.createGain();
                trim.gain.value = track.trim ? track.trim.gain.value : 0.5;
                
                const vocalFilter = offlineCtx.createBiquadFilter(); vocalFilter.type = 'highpass'; vocalFilter.frequency.value = track.vocalFilter ? track.vocalFilter.frequency.value : 80;
                const vocalComp = offlineCtx.createDynamicsCompressor(); 
                vocalComp.threshold.value = track.vocalComp ? track.vocalComp.threshold.value : -24; 
                vocalComp.knee.value = track.vocalComp ? track.vocalComp.knee.value : 10; 
                vocalComp.ratio.value = track.vocalComp ? track.vocalComp.ratio.value : 4; 
                vocalComp.attack.value = track.vocalComp ? track.vocalComp.attack.value : 0.005; 
                vocalComp.release.value = track.vocalComp ? track.vocalComp.release.value : 0.080;
                const vocalMakeup = offlineCtx.createGain(); vocalMakeup.gain.value = track.vocalMakeup ? track.vocalMakeup.gain.value : 1.5;
                const vocalBypass = offlineCtx.createGain(); vocalBypass.gain.value = track.vocalChain ? 0.0 : 1.0;
                const vocalMix = offlineCtx.createGain(); vocalMix.gain.value = track.vocalChain ? 1.0 : 0.0;
                trim.connect(vocalBypass); trim.connect(vocalFilter); vocalFilter.connect(vocalComp); vocalComp.connect(vocalMakeup); vocalMakeup.connect(vocalMix);

                const trackTape = offlineCtx.createWaveShaper();
                trackTape.curve = this.makeDistortionCurve(10);
                vocalBypass.connect(trackTape);
                vocalMix.connect(trackTape);

                const autotuneBypass = offlineCtx.createGain();
                autotuneBypass.gain.value = track.autotuneBypass ? track.autotuneBypass.gain.value : 1.0;
                
                const autotuneMix = offlineCtx.createGain();
                autotuneMix.gain.value = track.autotuneMix ? track.autotuneMix.gain.value : 0.0;

                try {
                    const autotuneNode = new AudioWorkletNode(offlineCtx, 'autotune-processor');
                    autotuneNode.port.postMessage({
                        type: 'set-params',
                        rootNote: parseInt(this.autotuneRootNote),
                        scale: this.getScaleArray(this.autotuneScaleType),
                        speed: this.autotuneSpeedVal,
                        amount: this.autotuneAmountVal
                    });
                    trackTape.connect(autotuneNode);
                    autotuneNode.connect(autotuneMix);
                } catch(e) {}

                trackTape.connect(autotuneBypass);

                const eqHigh = offlineCtx.createBiquadFilter();
                eqHigh.type = 'highshelf'; eqHigh.frequency.value = 3000;
                eqHigh.gain.value = track.eqHigh ? track.eqHigh.gain.value : 0;
                
                const eqLow = offlineCtx.createBiquadFilter();
                eqLow.type = 'lowshelf'; eqLow.frequency.value = 300;
                eqLow.gain.value = track.eqLow ? track.eqLow.gain.value : 0;

                const scoopFilter = offlineCtx.createBiquadFilter();
                scoopFilter.type = 'peaking'; scoopFilter.frequency.value = track.scoopFilter ? track.scoopFilter.frequency.value : 3000;
                scoopFilter.Q.value = 1.5;
                scoopFilter.gain.value = track.autoScoop ? -6 : 0;

                const eff1Send = offlineCtx.createGain();
                eff1Send.gain.value = track.eff1Send ? track.eff1Send.gain.value : 0;
                eff1Send.connect(offlineFx1Input);

                const eff2Send = offlineCtx.createGain();
                eff2Send.gain.value = track.eff2Send ? track.eff2Send.gain.value : 0;
                eff2Send.connect(offlineFx2Input);

                const widthSplitter = offlineCtx.createChannelSplitter(2);
                const widthMid = offlineCtx.createGain(); widthMid.gain.value = 0.5;
                const widthSide = offlineCtx.createGain(); widthSide.gain.value = track.widthVal !== undefined ? track.widthVal : 0.5;
                const widthInvR = offlineCtx.createGain(); widthInvR.gain.value = -1.0;
                const widthL = offlineCtx.createGain();
                const widthR = offlineCtx.createGain();
                const widthInvSide = offlineCtx.createGain(); widthInvSide.gain.value = -1.0;
                const widthMerger = offlineCtx.createChannelMerger(2);
                widthSplitter.connect(widthMid, 0); widthSplitter.connect(widthMid, 1); widthSplitter.connect(widthSide, 0); widthSplitter.connect(widthInvR, 1); widthInvR.connect(widthSide);
                widthMid.connect(widthL); widthMid.connect(widthR); widthSide.connect(widthL); widthSide.connect(widthInvSide); widthInvSide.connect(widthR);
                widthL.connect(widthMerger, 0, 0); widthR.connect(widthMerger, 0, 1);

                const panner = offlineCtx.createStereoPanner();
                panner.pan.value = track.panner ? track.panner.pan.value : 0;
                
                const gain = offlineCtx.createGain();
                let trackGainVal = track.targetVolume;
                const anySolo = Object.values(this.tracks).some(t => t.isSoloed);
                if (anySolo && !track.isSoloed) trackGainVal = 0;
                else if (track.isMuted) trackGainVal = 0;
                
                gain.gain.value = trackGainVal;
                
                source.connect(trim); 
                autotuneBypass.connect(eqHigh); autotuneMix.connect(eqHigh);
                eqHigh.connect(eqLow); eqLow.connect(scoopFilter); 
                scoopFilter.connect(widthSplitter);
                widthMerger.connect(panner); panner.connect(gain); gain.connect(offlineMaster);
                scoopFilter.connect(eff1Send); scoopFilter.connect(eff2Send);
                source.start(0);
            }
        }

        const renderedBuffer = await offlineCtx.startRendering();
        const wavBlob = this.audioBufferToWav(renderedBuffer);
        
        const titleInput = document.getElementById('mixtape-title-input');
        const customTitle = titleInput && titleInput.value.trim() ? titleInput.value.trim() : 'VOD-90 MIXTAPE';
        const file = new File([wavBlob], `${customTitle}.wav`, { type: "audio/wav" });
        
        const dataTransfer = new DataTransfer();
        dataTransfer.items.add(file);
        
        const audUploadEl = document.getElementById('composer-audio-upload');
        if (audUploadEl) {
            audUploadEl.files = dataTransfer.files;
            const feedTab = document.querySelector('.side-nav-item');
            if (window.switchTab) window.switchTab('feed', feedTab);
            if (window.updateComposerPreview) window.updateComposerPreview();
            
            const audMetaTitle = document.getElementById('audio-meta-title');
            if (audMetaTitle) audMetaTitle.value = customTitle;
            
            document.getElementById('btn-close-vodcam').click(); // Clean up modal
            alert(`Mixdown complete! "${customTitle}" is loaded into the composer. Just hit Broadcast!`);
        }
    },
    createReverbIR(audioCtx, duration, decay) {
        const sampleRate = audioCtx.sampleRate;
        const length = sampleRate * duration;
        const impulse = audioCtx.createBuffer(2, length, sampleRate);
        const left = impulse.getChannelData(0);
        const right = impulse.getChannelData(1);
        for (let i = 0; i < length; i++) {
            left[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
            right[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
        }
        return impulse;
    },
    buildFxChain(ctx, type, inputNode, outputNode, p1Val, p2Val) {
        let param1 = (v) => {};
        let param2 = (v) => {};
        let nodes = [];
        if (type === 'delay') {
            const delay = ctx.createDelay();
            const feedback = ctx.createGain();
            inputNode.connect(delay);
            delay.connect(feedback);
            feedback.connect(delay);
            delay.connect(outputNode);
            param1 = (v) => { delay.delayTime.value = v * 1.0; };
            param2 = (v) => { feedback.gain.value = v * 0.9; };
            nodes = [delay, feedback];
        } else if (type === 'reverb') {
            const preDelay = ctx.createDelay();
            const convolver = ctx.createConvolver();
            convolver.buffer = this.createReverbIR(ctx, 2.5, 2);
            const filter = ctx.createBiquadFilter();
            filter.type = 'lowpass';
            inputNode.connect(preDelay);
            preDelay.connect(convolver);
            convolver.connect(filter);
            filter.connect(outputNode);
            param1 = (v) => { preDelay.delayTime.value = v * 0.2; };
            param2 = (v) => { filter.frequency.value = 500 + v * 10000; };
            nodes = [preDelay, convolver, filter];
        } else if (type === 'lowpass' || type === 'highpass') {
            const filter = ctx.createBiquadFilter();
            filter.type = type;
            inputNode.connect(filter);
            filter.connect(outputNode);
            param1 = (v) => { filter.frequency.value = 20 + v * 10000; };
            param2 = (v) => { filter.Q.value = v * 20; };
            nodes = [filter];
        } else if (type === 'bitcrusher') {
            const shaper = ctx.createWaveShaper();
            const filter = ctx.createBiquadFilter(); filter.type = 'lowpass';
            inputNode.connect(shaper); shaper.connect(filter); filter.connect(outputNode);
            param1 = (v) => {
                const bits = Math.floor(v * 15) + 1; // 1 to 16 bits
                const steps = Math.pow(2, bits);
                const curve = new Float32Array(4096);
                for(let i=0; i<4096; i++) { let x = (i/4096) * 2 - 1; curve[i] = Math.round(x * steps) / steps; }
                shaper.curve = curve;
            };
            param2 = (v) => { filter.frequency.value = 200 + (1.0 - v) * 15000; }; // Downsample/Alias Muffling
            nodes = [shaper, filter];
        } else if (type === 'vinyl') {
            const noiseLen = ctx.sampleRate * 2;
            const noiseBuf = ctx.createBuffer(1, noiseLen, ctx.sampleRate);
            const nData = noiseBuf.getChannelData(0);
            for(let i=0; i<noiseLen; i++) { if (Math.random() > 0.999) nData[i] = Math.random() * 2 - 1; else nData[i] = (Math.random() * 2 - 1) * 0.05; }
            const noiseSrc = ctx.createBufferSource(); noiseSrc.buffer = noiseBuf; noiseSrc.loop = true;
            const noiseGain = ctx.createGain();
            const lpf = ctx.createBiquadFilter(); lpf.type = 'lowpass'; lpf.frequency.value = 4000;
            noiseSrc.connect(noiseGain); noiseGain.connect(lpf); lpf.connect(outputNode); noiseSrc.start(0);
            const delay = ctx.createDelay(); delay.delayTime.value = 0.05;
            const lfo = ctx.createOscillator(); lfo.frequency.value = 0.5;
            const lfoGain = ctx.createGain(); lfo.connect(lfoGain); lfoGain.connect(delay.delayTime); lfo.start(0);
            inputNode.connect(delay); delay.connect(outputNode);
            param1 = (v) => { noiseGain.gain.value = v * 0.5; };
            param2 = (v) => { lfoGain.gain.value = v * 0.02; };
            nodes = [noiseSrc, noiseGain, lpf, delay, lfo, lfoGain];
        } else if (type === 'tape_sat') {
            const driveGain = ctx.createGain();
            const waveShaper = ctx.createWaveShaper();
            waveShaper.oversample = '4x';
            const filter = ctx.createBiquadFilter();
            filter.type = 'lowpass';
            const outGain = ctx.createGain();
            outGain.gain.value = 0.5;
            inputNode.connect(driveGain);
            driveGain.connect(waveShaper);
            waveShaper.connect(filter);
            filter.connect(outGain);
            outGain.connect(outputNode);
            param1 = (v) => { driveGain.gain.value = 1 + v * 50; };
            param2 = (v) => {
                let k = v * 100;
                const curve = new Float32Array(4096);
                const deg = Math.PI / 180;
                for(let i=0; i<4096; i++) { let x = (i/4096) * 2 - 1; curve[i] = (3 + k) * x * 20 * deg / (Math.PI + k * Math.abs(x)); }
                waveShaper.curve = curve;
                filter.frequency.value = 500 + (1-v) * 10000;
            };
            nodes = [driveGain, waveShaper, filter, outGain];
        } else if (type === 'wavefolder') {
            const shaper = ctx.createWaveShaper();
            const out = ctx.createGain(); out.gain.value = 0.8;
            inputNode.connect(shaper); shaper.connect(out); out.connect(outputNode);
            let wfFold = 1, wfBias = 0;
            const updateWf = () => {
                const curve = new Float32Array(4096);
                for(let i=0; i<4096; i++) { let x = (i/4096) * 2 - 1; curve[i] = Math.sin((x + wfBias) * wfFold * Math.PI); }
                shaper.curve = curve;
            };
            param1 = (v) => { wfFold = 1 + v * 5; updateWf(); };
            param2 = (v) => { wfBias = v * 0.5; updateWf(); };
            nodes = [shaper, out];
        } else if (type === 'chorus') {
            const delay = ctx.createDelay(); delay.delayTime.value = 0.015;
            const lfo = ctx.createOscillator(); const lfoGain = ctx.createGain();
            const dry = ctx.createGain(); const wet = ctx.createGain();
            inputNode.connect(dry); inputNode.connect(delay); delay.connect(wet); dry.connect(outputNode); wet.connect(outputNode);
            lfo.connect(lfoGain); lfoGain.connect(delay.delayTime); lfo.start(0);
            param1 = (v) => { lfo.frequency.value = 0.1 + v * 10; };
            param2 = (v) => { lfoGain.gain.value = v * 0.01; wet.gain.value = v; dry.gain.value = 1.0 - (v*0.5); };
            nodes = [delay, lfo, lfoGain, dry, wet];
        } else if (type === 'phaser') {
            const ap1 = ctx.createBiquadFilter(); ap1.type = 'allpass'; const ap2 = ctx.createBiquadFilter(); ap2.type = 'allpass'; const ap3 = ctx.createBiquadFilter(); ap3.type = 'allpass';
            const fb = ctx.createGain(); const dry = ctx.createGain(); const wet = ctx.createGain();
            inputNode.connect(ap1); ap1.connect(ap2); ap2.connect(ap3); ap3.connect(fb); fb.connect(ap1);
            inputNode.connect(dry); ap3.connect(wet); dry.connect(outputNode); wet.connect(outputNode);
            const lfo = ctx.createOscillator(); const lfoGain = ctx.createGain();
            lfo.connect(lfoGain); lfoGain.connect(ap1.frequency); lfoGain.connect(ap2.frequency); lfoGain.connect(ap3.frequency); lfo.start(0);
            param1 = (v) => { lfo.frequency.value = 0.1 + v * 5; };
            param2 = (v) => { fb.gain.value = v * 0.9; lfoGain.gain.value = 500 + v * 2000; wet.gain.value = v; };
            nodes = [ap1, ap2, ap3, fb, dry, wet, lfo, lfoGain];
        } else if (type === 'autopan') {
            const panner = ctx.createStereoPanner();
            const lfo = ctx.createOscillator(); const lfoGain = ctx.createGain();
            lfo.connect(lfoGain); lfoGain.connect(panner.pan); lfo.start(0);
            inputNode.connect(panner); panner.connect(outputNode);
            param1 = (v) => { lfo.frequency.value = 0.1 + v * 10; };
            param2 = (v) => { lfoGain.gain.value = v; };
            nodes = [panner, lfo, lfoGain];
        } else if (type === 'pingpong') {
            const delayL = ctx.createDelay(); const delayR = ctx.createDelay();
            const fbL = ctx.createGain(); const fbR = ctx.createGain();
            const panL = ctx.createStereoPanner(); panL.pan.value = -1; const panR = ctx.createStereoPanner(); panR.pan.value = 1;
            inputNode.connect(delayL); delayL.connect(panL); panL.connect(outputNode); delayL.connect(fbL); fbL.connect(delayR);
            delayR.connect(panR); panR.connect(outputNode); delayR.connect(fbR); fbR.connect(delayL);
            param1 = (v) => { const t = 0.1 + v * 0.9; delayL.delayTime.value = t; delayR.delayTime.value = t; };
            param2 = (v) => { const g = v * 0.9; fbL.gain.value = g; fbR.gain.value = g; };
            nodes = [delayL, delayR, fbL, fbR, panL, panR];
        } else if (type === 'tremolo') {
            const gain = ctx.createGain();
            const lfo = ctx.createOscillator(); const lfoGain = ctx.createGain();
            lfo.connect(lfoGain); lfoGain.connect(gain.gain); lfo.start(0);
            inputNode.connect(gain); gain.connect(outputNode);
            param1 = (v) => { lfo.frequency.value = 0.5 + v * 15; };
            param2 = (v) => { lfoGain.gain.value = v * 0.5; gain.gain.value = 1.0 - (v * 0.5); };
            nodes = [gain, lfo, lfoGain];
        } else if (type === 'stutter') {
            const delay = ctx.createDelay(); const fb = ctx.createGain(); const wet = ctx.createGain();
            inputNode.connect(delay); delay.connect(fb); fb.connect(delay); delay.connect(wet); wet.connect(outputNode); inputNode.connect(outputNode);
            param1 = (v) => { delay.delayTime.value = 0.02 + v * 0.2; fb.gain.value = v * 0.95; wet.gain.value = v; };
            param2 = (v) => { delay.delayTime.setTargetAtTime(0.02 + v * 2.0, ctx.currentTime || 0, 0.1); };
            nodes = [delay, fb, wet];
        } else if (type === 'freqshift') {
            const gain = ctx.createGain(); const lfo = ctx.createOscillator(); lfo.start(0);
            const dry = ctx.createGain(); const wet = ctx.createGain();
            lfo.connect(gain.gain);
            inputNode.connect(dry); inputNode.connect(gain); gain.connect(wet); dry.connect(outputNode); wet.connect(outputNode);
            param1 = (v) => { lfo.frequency.value = v * 2000; };
            param2 = (v) => { wet.gain.value = v; dry.gain.value = 1.0 - v; };
            nodes = [gain, lfo, dry, wet];
        }
        
        param1(p1Val);
        param2(p2Val);
        
        return { nodes, param1, param2 };
    },
    rebuildFx(fxNum) {
        const input = this[`globalFx${fxNum}Input`];
        
        // Sever the incoming audio link to the previous effect chain before trashing it
        if (input) {
            try { input.disconnect(); } catch(e) {}
        }

        if (this[`fx${fxNum}Nodes`]) {
            this[`fx${fxNum}Nodes`].forEach(n => { try { n.disconnect(); } catch(e){} });
        }
        const type = this[`fx${fxNum}Type`];
        const p1 = this[`fx${fxNum}Param1Val`];
        const p2 = this[`fx${fxNum}Param2Val`];
        
        const chain = window.FXEngine.buildNativeFxChain(this.audioCtx, this.wasmModule, type, input, this.masterGain, p1, p2);
        this[`fx${fxNum}Nodes`] = chain.nodes;
        this[`fx${fxNum}Param1`] = chain.param1;
        this[`fx${fxNum}Param2`] = chain.param2;

        let p1Label = "PARAM1", p2Label = "PARAM2";
        if (type === 'delay') { p1Label = "TIME"; p2Label = "FDBK"; }
        else if (type === 'reverb') { p1Label = "PREDLY"; p2Label = "TONE"; }
        else if (type === 'lowpass' || type === 'highpass') { p1Label = "FREQ"; p2Label = "RES"; }
        else if (type === 'bitcrusher') { p1Label = "BITS"; p2Label = "DOWNSMPL"; }
        else if (type === 'vinyl') { p1Label = "DUST"; p2Label = "WOW"; }
        else if (type === 'tape_sat') { p1Label = "DRIVE"; p2Label = "BIAS"; }
        else if (type === 'wavefolder') { p1Label = "FOLD"; p2Label = "SYM"; }
        else if (type === 'chorus') { p1Label = "RATE"; p2Label = "DEPTH"; }
        else if (type === 'phaser') { p1Label = "RATE"; p2Label = "FDBK"; }
        else if (type === 'autopan') { p1Label = "RATE"; p2Label = "WIDTH"; }
        else if (type === 'pingpong') { p1Label = "TIME"; p2Label = "FDBK"; }
        else if (type === 'tremolo') { p1Label = "RATE"; p2Label = "DEPTH"; }
        else if (type === 'stutter') { p1Label = "RATE"; p2Label = "TAPE STP"; }
        else if (type === 'freqshift') { p1Label = "SHIFT"; p2Label = "MIX"; }

        const lbl1 = document.getElementById(`fx${fxNum}-p1-label`);
        const lbl2 = document.getElementById(`fx${fxNum}-p2-label`);
        if (lbl1) lbl1.innerText = p1Label;
        if (lbl2) lbl2.innerText = p2Label;
    },
    setFxParam(fxNum, paramNum, val0to1) {
        this[`fx${fxNum}Param${paramNum}Val`] = val0to1;
        const paramSetter = this[`fx${fxNum}Param${paramNum}`];
        if (typeof paramSetter === 'function') {
            paramSetter(val0to1);
        }
    },

    audioBufferToWav(buffer) {
        let numOfChan = buffer.numberOfChannels, length = buffer.length * numOfChan * 2 + 44,
            bufferArray = new ArrayBuffer(length), view = new DataView(bufferArray),
            channels = [], sample, offset = 0, pos = 0;

        const setUint16 = (data) => { view.setUint16(offset, data, true); offset += 2; };
        const setUint32 = (data) => { view.setUint32(offset, data, true); offset += 4; };

        setUint32(0x46464952); setUint32(length - 8); setUint32(0x45564157); setUint32(0x20746d66);
        setUint32(16); setUint16(1); setUint16(numOfChan); setUint32(buffer.sampleRate);
        setUint32(buffer.sampleRate * 2 * numOfChan); setUint16(numOfChan * 2); setUint16(16);
        setUint32(0x61746164); setUint32(length - pos - 4);

        for(let i = 0; i < buffer.numberOfChannels; i++) channels.push(buffer.getChannelData(i));
        while(pos < buffer.length) {
            for(let i = 0; i < numOfChan; i++) {
                sample = Math.max(-1, Math.min(1, channels[i][pos]));
                sample = (0.5 + sample < 0 ? sample * 32768 : sample * 32767)|0;
                view.setInt16(offset, sample, true); offset += 2;
            }
            pos++;
        }
        return new Blob([bufferArray], {type: "audio/wav"});
    },
    
    saveStudioState() {
        try {
            const state = {
                fx1Type: this.fx1Type, fx1Param1Val: this.fx1Param1Val, fx1Param2Val: this.fx1Param2Val,
                fx2Type: this.fx2Type, fx2Param1Val: this.fx2Param1Val, fx2Param2Val: this.fx2Param2Val,
                autotuneRootNote: this.autotuneRootNote, autotuneScaleType: this.autotuneScaleType,
                autotuneSpeedVal: this.autotuneSpeedVal, autotuneAmountVal: this.autotuneAmountVal,
                limiterEnabled: this.limiterEnabled,
                masterVolume: this.masterGain ? this.masterGain.gain.value : 1.0,
                tracks: {}
            };
            for (const t in this.tracks) {
                const tr = this.tracks[t];
                state.tracks[t] = {
                    name: tr.name, targetVolume: tr.targetVolume,
                    trim: tr.trim ? tr.trim.gain.value : 0.5,
                    eqHigh: tr.eqHigh ? tr.eqHigh.gain.value : 0,
                    eqLow: tr.eqLow ? tr.eqLow.gain.value : 0,
                    eff1: tr.eff1Send ? tr.eff1Send.gain.value : 0,
                    eff2: tr.eff2Send ? tr.eff2Send.gain.value : 0,
                    width: tr.widthVal !== undefined ? tr.widthVal : 0.5,
                    pan: tr.panner ? tr.panner.pan.value : 0,
                    autotuneEnabled: tr.autotuneEnabled,
                    vocalChain: tr.vocalChain, autoScoop: tr.autoScoop,
                    isMuted: tr.isMuted, isSoloed: tr.isSoloed
                };
            }
            localStorage.setItem('vodstudio_state', JSON.stringify(state));
        } catch(e) {}
    },
    
    loadStudioState() {
        try {
            const saved = localStorage.getItem('vodstudio_state');
            if (!saved) return;
            const state = JSON.parse(saved);
            
            this.fx1Type = state.fx1Type || 'delay';
            this.fx1Param1Val = state.fx1Param1Val !== undefined ? state.fx1Param1Val : 0.4;
            this.fx1Param2Val = state.fx1Param2Val !== undefined ? state.fx1Param2Val : 0.33;
            
            this.fx2Type = state.fx2Type || 'lowpass';
            this.fx2Param1Val = state.fx2Param1Val !== undefined ? state.fx2Param1Val : 0.15;
            this.fx2Param2Val = state.fx2Param2Val !== undefined ? state.fx2Param2Val : 0.05;
            
            this.autotuneRootNote = state.autotuneRootNote !== undefined ? state.autotuneRootNote : 0;
            this.autotuneScaleType = state.autotuneScaleType || 'chromatic';
            this.autotuneSpeedVal = state.autotuneSpeedVal !== undefined ? state.autotuneSpeedVal : 1.0;
            this.autotuneAmountVal = state.autotuneAmountVal !== undefined ? state.autotuneAmountVal : 1.0;
            
            this.limiterEnabled = !!state.limiterEnabled;
            if (this.limiterNode) this.limiterNode.ratio.value = this.limiterEnabled ? 20.0 : 1.0;
            if (this.masterGain) this.masterGain.gain.value = state.masterVolume !== undefined ? state.masterVolume : 1.0;
            
            for (const t in state.tracks) {
                if (this.tracks[t] && state.tracks[t]) {
                    const st = state.tracks[t];
                    Object.assign(this.tracks[t], {
                        name: st.name || `TRACK ${t.replace('track', '')}`,
                        targetVolume: st.targetVolume !== undefined ? st.targetVolume : 0.55,
                        autotuneEnabled: !!st.autotuneEnabled, vocalChain: !!st.vocalChain,
                        autoScoop: !!st.autoScoop, isMuted: !!st.isMuted, isSoloed: !!st.isSoloed
                    });
                    if (this.tracks[t].trim) this.tracks[t].trim.gain.value = st.trim !== undefined ? st.trim : 0.5;
                    if (this.tracks[t].eqHigh) this.tracks[t].eqHigh.gain.value = st.eqHigh !== undefined ? st.eqHigh : 0;
                    if (this.tracks[t].eqLow) this.tracks[t].eqLow.gain.value = st.eqLow !== undefined ? st.eqLow : 0;
                    if (this.tracks[t].eff1Send) this.tracks[t].eff1Send.gain.value = st.eff1 !== undefined ? st.eff1 : 0;
                    if (this.tracks[t].eff2Send) this.tracks[t].eff2Send.gain.value = st.eff2 !== undefined ? st.eff2 : 0;
                    this.tracks[t].widthVal = st.width !== undefined ? st.width : 0.5;
                    if (this.tracks[t].widthSide) this.tracks[t].widthSide.gain.value = this.tracks[t].widthVal;
                    if (this.tracks[t].panner) this.tracks[t].panner.pan.value = st.pan !== undefined ? st.pan : 0;
                    
                    if (this.tracks[t].vocalMix && this.tracks[t].vocalBypass) {
                        const mix = st.vocalChain ? 1.0 : 0.0;
                        this.tracks[t].vocalMix.gain.value = mix;
                        this.tracks[t].vocalBypass.gain.value = 1.0 - mix;
                    }
                    if (this.tracks[t].scoopFilter) this.tracks[t].scoopFilter.gain.value = st.autoScoop ? -6 : 0;
                }
            }
            this.updateTrackGains();
            this.applyAutotuneMix('track1'); this.applyAutotuneMix('track2'); this.applyAutotuneMix('track3'); this.applyAutotuneMix('track4');
            this.updateAllAutotuneNodes();
        } catch(e) { console.warn('Could not load VODstudio state:', e); }
    },
    
    initTapeDB() {
        return new Promise((resolve, reject) => {
            const req = indexedDB.open('VOD_Studio_Tapes', 1);
            req.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains('tapes')) {
                    db.createObjectStore('tapes', { keyPath: 'name' });
                }
            };
            req.onsuccess = (e) => resolve(e.target.result);
            req.onerror = (e) => reject(e.target.error);
        });
    },

    async saveTape() {
        const tapeName = prompt("Enter a name for this tape session:");
        if (!tapeName || !tapeName.trim()) return;

        const btn = document.getElementById('btn-save-tape');
        if (btn) {
            btn.innerText = "⏳ SAVING...";
            btn.disabled = true;
        }

        try {
            const db = await this.initTapeDB();
            const state = {
                name: tapeName.trim(),
                timestamp: Date.now(),
                fx1Type: this.fx1Type, fx1Param1Val: this.fx1Param1Val, fx1Param2Val: this.fx1Param2Val,
                fx2Type: this.fx2Type, fx2Param1Val: this.fx2Param1Val, fx2Param2Val: this.fx2Param2Val,
                autotuneRootNote: this.autotuneRootNote, autotuneScaleType: this.autotuneScaleType,
                autotuneSpeedVal: this.autotuneSpeedVal, autotuneAmountVal: this.autotuneAmountVal,
                limiterEnabled: this.limiterEnabled,
                masterVolume: this.masterGain ? this.masterGain.gain.value : 1.0,
                tracks: {}
            };

            for (const t in this.tracks) {
                const tr = this.tracks[t];
                let trackWavBlob = null;
                if (tr.buffer) {
                    trackWavBlob = this.audioBufferToWav(tr.buffer);
                }
                
                state.tracks[t] = {
                    name: tr.name, targetVolume: tr.targetVolume,
                    trim: tr.trim ? tr.trim.gain.value : 0.5,
                    eqHigh: tr.eqHigh ? tr.eqHigh.gain.value : 0,
                    eqLow: tr.eqLow ? tr.eqLow.gain.value : 0,
                    eff1: tr.eff1Send ? tr.eff1Send.gain.value : 0,
                    eff2: tr.eff2Send ? tr.eff2Send.gain.value : 0,
                    width: tr.widthVal !== undefined ? tr.widthVal : 0.5,
                    pan: tr.panner ? tr.panner.pan.value : 0,
                    autotuneEnabled: tr.autotuneEnabled,
                    vocalChain: tr.vocalChain, autoScoop: tr.autoScoop,
                    isMuted: tr.isMuted, isSoloed: tr.isSoloed,
                    audioBlob: trackWavBlob
                };
            }

            const tx = db.transaction('tapes', 'readwrite');
            const store = tx.objectStore('tapes');
            store.put(state);
            
            await new Promise((resolve, reject) => {
                tx.oncomplete = resolve;
                tx.onerror = () => reject(tx.error);
            });
            alert("Tape session saved successfully!");
        } catch(e) {
            console.error("Save Tape Error:", e);
            alert("Failed to save tape: " + e.message);
        } finally {
            if (btn) {
                btn.innerText = "💾 SAVE TAPE";
                btn.disabled = false;
            }
        }
    },

    async loadTapeList() {
        try {
            const db = await this.initTapeDB();
            const tx = db.transaction('tapes', 'readonly');
            const store = tx.objectStore('tapes');
            const req = store.getAll();
            
            const tapes = await new Promise((resolve, reject) => {
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => reject(req.error);
            });
            return tapes;
        } catch(e) {
            console.error("Load Tape List Error:", e);
            return [];
        }
    },

    async showLoadTapeModal() {
        const tapes = await this.loadTapeList();
        if (tapes.length === 0) {
            return alert("No saved tapes found.");
        }

        const modal = document.getElementById('vodstudio-modal');
        let loadModal = document.getElementById('vodstudio-load-tape-modal');
        if (!loadModal) {
            loadModal = document.createElement('div');
            loadModal.id = 'vodstudio-load-tape-modal';
            loadModal.className = 'hidden';
            loadModal.style = 'position: absolute; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.8); z-index: 1000; display: flex; justify-content: center; align-items: center; flex-direction: column;';
            modal.appendChild(loadModal);
        }

        let tapeListHtml = tapes.sort((a,b) => b.timestamp - a.timestamp).map(t => {
            return `
                <div style="display:flex; justify-content:space-between; align-items:center; background: rgba(0,0,0,0.3); padding: 10px; border-radius: 4px; margin-bottom: 5px; border: 1px solid var(--border);">
                    <div style="text-align: left;">
                        <div style="color: #fff; font-weight: bold;">${window.escapeHtml(t.name)}</div>
                        <div style="font-size: 10px; color: var(--text-muted);">${new Date(t.timestamp).toLocaleString()}</div>
                    </div>
                    <div style="display: flex; gap: 5px;">
                        <button class="secondary" style="padding: 4px 8px; font-size: 11px;" onclick="window.VODstudioEngine.loadTapeData('${window.escapeJsArg(t.name)}')">Load</button>
                        <button class="secondary" style="padding: 4px 8px; font-size: 11px; border-color: var(--danger); color: var(--danger);" onclick="window.VODstudioEngine.deleteTapeData('${window.escapeJsArg(t.name)}')">Delete</button>
                    </div>
                </div>
            `;
        }).join('');

        loadModal.innerHTML = `
            <div style="background: #1a252f; padding: 20px; border-radius: 8px; border: 2px solid var(--primary); text-align: center; width: 350px; max-height: 80%; display: flex; flex-direction: column;">
                <h3 style="margin-top: 0; color: #fff;">Load Tape Session</h3>
                <div style="overflow-y: auto; flex-grow: 1; margin-bottom: 15px;">
                    ${tapeListHtml}
                </div>
                <button class="secondary" style="width: 100%;" onclick="document.getElementById('vodstudio-load-tape-modal').classList.add('hidden')">Cancel</button>
            </div>
        `;
        loadModal.classList.remove('hidden');
    },

    async deleteTapeData(tapeName) {
        if(!confirm(`Are you sure you want to delete the tape "${tapeName}"?`)) return;
        try {
            const db = await this.initTapeDB();
            const tx = db.transaction('tapes', 'readwrite');
            const store = tx.objectStore('tapes');
            store.delete(tapeName);
            await new Promise((resolve, reject) => {
                tx.oncomplete = resolve;
                tx.onerror = () => reject(tx.error);
            });
            this.showLoadTapeModal(); // refresh list
        } catch(e) {
            console.error("Delete tape error", e);
        }
    },

    async loadTapeData(tapeName) {
        const loadModal = document.getElementById('vodstudio-load-tape-modal');
        if (loadModal) loadModal.classList.add('hidden');

        try {
            const db = await this.initTapeDB();
            const tx = db.transaction('tapes', 'readonly');
            const store = tx.objectStore('tapes');
            const req = store.get(tapeName);
            
            const state = await new Promise((resolve, reject) => {
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => reject(req.error);
            });

            if (!state) return alert("Tape not found.");

            this.stop();
            
            let loader = document.getElementById('vodstudio-loader');
            if (!loader) {
                const modal = document.getElementById('vodstudio-modal');
                loader = document.createElement('div');
                loader.id = 'vodstudio-loader';
                loader.style = 'position: absolute; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.8); z-index: 2000; display: flex; justify-content: center; align-items: center; color: var(--primary); font-weight: bold; font-size: 24px;';
                modal.appendChild(loader);
            }
            loader.innerText = '📂 Loading Tape...';
            loader.classList.remove('hidden');

            // Wait a moment for UI to paint
            await new Promise(r => setTimeout(r, 50));

            this.fx1Type = state.fx1Type || 'delay';
            this.fx1Param1Val = state.fx1Param1Val !== undefined ? state.fx1Param1Val : 0.4;
            this.fx1Param2Val = state.fx1Param2Val !== undefined ? state.fx1Param2Val : 0.33;
            
            this.fx2Type = state.fx2Type || 'lowpass';
            this.fx2Param1Val = state.fx2Param1Val !== undefined ? state.fx2Param1Val : 0.15;
            this.fx2Param2Val = state.fx2Param2Val !== undefined ? state.fx2Param2Val : 0.05;
            
            this.autotuneRootNote = state.autotuneRootNote !== undefined ? state.autotuneRootNote : 0;
            this.autotuneScaleType = state.autotuneScaleType || 'chromatic';
            this.autotuneSpeedVal = state.autotuneSpeedVal !== undefined ? state.autotuneSpeedVal : 1.0;
            this.autotuneAmountVal = state.autotuneAmountVal !== undefined ? state.autotuneAmountVal : 1.0;
            
            this.limiterEnabled = !!state.limiterEnabled;
            if (this.limiterNode) this.limiterNode.ratio.value = this.limiterEnabled ? 20.0 : 1.0;
            if (this.masterGain) this.masterGain.gain.value = state.masterVolume !== undefined ? state.masterVolume : 1.0;

            for (const t in state.tracks) {
                if (this.tracks[t] && state.tracks[t]) {
                    const st = state.tracks[t];
                    Object.assign(this.tracks[t], {
                        name: st.name || `TRACK ${t.replace('track', '')}`,
                        targetVolume: st.targetVolume !== undefined ? st.targetVolume : 0.55,
                        autotuneEnabled: !!st.autotuneEnabled, vocalChain: !!st.vocalChain,
                        autoScoop: !!st.autoScoop, isMuted: !!st.isMuted, isSoloed: !!st.isSoloed
                    });

                    if (st.audioBlob) {
                        const arrayBuffer = await st.audioBlob.arrayBuffer();
                        this.tracks[t].buffer = await this.audioCtx.decodeAudioData(arrayBuffer);
                        if (!this.tracks[t].gain) this.setupTrackRouting(t);
                    } else {
                        this.tracks[t].buffer = null;
                    }

                    if (this.tracks[t].trim) this.tracks[t].trim.gain.value = st.trim !== undefined ? st.trim : 0.5;
                    if (this.tracks[t].eqHigh) this.tracks[t].eqHigh.gain.value = st.eqHigh !== undefined ? st.eqHigh : 0;
                    if (this.tracks[t].eqLow) this.tracks[t].eqLow.gain.value = st.eqLow !== undefined ? st.eqLow : 0;
                    if (this.tracks[t].eff1Send) this.tracks[t].eff1Send.gain.value = st.eff1 !== undefined ? st.eff1 : 0;
                    if (this.tracks[t].eff2Send) this.tracks[t].eff2Send.gain.value = st.eff2 !== undefined ? st.eff2 : 0;
                    this.tracks[t].widthVal = st.width !== undefined ? st.width : 0.5;
                    if (this.tracks[t].widthSide) this.tracks[t].widthSide.gain.value = this.tracks[t].widthVal;
                    if (this.tracks[t].panner) this.tracks[t].panner.pan.value = st.pan !== undefined ? st.pan : 0;
                    
                    if (this.tracks[t].vocalMix && this.tracks[t].vocalBypass) {
                        const mix = st.vocalChain ? 1.0 : 0.0;
                        this.tracks[t].vocalMix.gain.value = mix;
                        this.tracks[t].vocalBypass.gain.value = 1.0 - mix;
                    }
                    if (this.tracks[t].scoopFilter) this.tracks[t].scoopFilter.gain.value = st.autoScoop ? -6 : 0;
                }
            }
            this.updateTrackGains();
            this.applyAutotuneMix('track1'); this.applyAutotuneMix('track2'); this.applyAutotuneMix('track3'); this.applyAutotuneMix('track4');
            this.updateAllAutotuneNodes();
            this.saveStudioState(); // save to localstorage as current
            
            this.syncUI();
            this.rebuildFx(1);
            this.rebuildFx(2);
            loader.classList.add('hidden');
            
            // Rebind the visual angles back into the Map for the pointer event handlers
            setTimeout(() => {
                if (!modal) return;
                const setRot = (el) => { if(el) { const rot = parseFloat(el.style.transform.replace('rotate(','').replace('deg)','')) || 0; this.currentKnobRots.set(el, rot); } };
                modal.querySelectorAll('.knob-pot').forEach(setRot);
            }, 100);

            alert("Tape loaded successfully!");

        } catch(e) {
            console.error("Load tape data error", e);
            alert("Failed to load tape: " + e.message);
            const loader = document.getElementById('vodstudio-loader');
            if (loader) loader.classList.add('hidden');
        }
    }
};