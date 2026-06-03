window.VODstudioEngine = {
    audioCtx: null,
    tracks: {
        vocals: { buffer: null, source: null, gain: null, panner: null },
        drums:  { buffer: null, source: null, gain: null, panner: null },
        bass:   { buffer: null, source: null, gain: null, panner: null },
        melody: { buffer: null, source: null, gain: null, panner: null }
    },
    masterGain: null,
    tapeSaturation: null,
    playbackRate: 1.0,
    
    isRecording: false,
    armedTrack: null,
    micStream: null,
    mediaRecorder: null,

    init() {
        // Initialize the Web Audio API context
        this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        
        // Create Master Fader
        this.masterGain = this.audioCtx.createGain();
        
        // Create "VODCAM 414" analog tape warmth effect
        this.tapeSaturation = this.audioCtx.createWaveShaper();
        this.tapeSaturation.curve = this.makeDistortionCurve(50); // Add analog drive
        
        // Route: Master Fader -> Tape Saturation -> Speakers
        this.masterGain.connect(this.tapeSaturation);
        this.tapeSaturation.connect(this.audioCtx.destination);
        
        // Initialize hardware routing for all tracks so it works even without stems loaded
        for (const trackName in this.tracks) {
            this.tracks[trackName].gain = this.audioCtx.createGain();
            this.tracks[trackName].gain.gain.value = 0.55;
            this.tracks[trackName].panner = this.audioCtx.createStereoPanner();
            this.tracks[trackName].panner.connect(this.tracks[trackName].gain);
            this.tracks[trackName].gain.connect(this.masterGain);
        }
        
        console.log('[VODSTUDIO] 🎛️ 4-Track Engine Ready.');
    },

    async loadStems(stemUrls) {
        // Fetch the 4 stem URLs provided by the StemSplitterEngine
        for (const [trackName, url] of Object.entries(stemUrls)) {
            const response = await fetch(url);
            const arrayBuffer = await response.arrayBuffer();
            const audioBuffer = await this.audioCtx.decodeAudioData(arrayBuffer);
            
            this.tracks[trackName].buffer = audioBuffer;
            
            this.playbackRate = 1.0; // Reset pitch to default when loading a new tape
            
            if (!this.tracks[trackName].gain) {
                this.tracks[trackName].gain = this.audioCtx.createGain();
                this.tracks[trackName].gain.gain.value = 0.55;
                this.tracks[trackName].panner = this.audioCtx.createStereoPanner();
                this.tracks[trackName].panner.connect(this.tracks[trackName].gain);
                this.tracks[trackName].gain.connect(this.masterGain);
            }
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
        
        let recordedChunks = [];
        this.mediaRecorder = new MediaRecorder(this.micStream);
        this.mediaRecorder.ondataavailable = e => { if (e.data.size > 0) recordedChunks.push(e.data); };
        this.mediaRecorder.onstop = async () => {
            const blob = new Blob(recordedChunks, { type: 'audio/webm' });
            const arrayBuffer = await blob.arrayBuffer();
            this.tracks[this.armedTrack].buffer = await this.audioCtx.decodeAudioData(arrayBuffer);
            this.isRecording = false;
            alert(`🎙️ TAPE PUNCH-IN COMPLETE: New audio laid down on the ${this.armedTrack.toUpperCase()} track!`);
        };
        this.isRecording = true;
        this.mediaRecorder.start();
    },

    play() {
        if (this.audioCtx.state === 'suspended') this.audioCtx.resume();
        this.stop(); // Stop any overlapping playback
        
        // Start all 4 tracks simultaneously to keep them perfectly in sync
        for (const trackName in this.tracks) {
            const track = this.tracks[trackName];
            // Analog Tape logic: Don't play the track we are currently recording over!
            if (this.isRecording && trackName === this.armedTrack) continue;

            if (track.buffer) {
                track.source = this.audioCtx.createBufferSource();
                track.source.buffer = track.buffer;
                track.source.playbackRate.value = this.playbackRate;
                track.source.connect(track.panner);
                track.source.start(0);
            }
        }
    },

    stop() {
        for (const trackName in this.tracks) {
            if (this.tracks[trackName].source) {
                try { this.tracks[trackName].source.stop(); } catch(e){}
            }
        }
        if (this.isRecording && this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
            this.mediaRecorder.stop();
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
                font-family: 'Courier New', Courier, monospace; color: #fff; user-select: none;
            }
            #vodstudio-modal .console {
                background-color: var(--vodcam-blue); width: 1080px; height: 640px;
                border-radius: 20px; padding: 25px;
                box-shadow: 0 35px 80px rgba(0,0,0,0.9), inset 0 3px 10px rgba(255,255,255,0.2);
                border: 6px solid #1a252f; display: grid; grid-template-columns: 68% 32%;
                box-sizing: border-box; position: relative;
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
                width: 24%; background: rgba(0, 0, 0, 0.2); border-radius: 6px; padding: 10px 0;
                display: flex; flex-direction: column; align-items: center; border: 1px dashed rgba(255,255,255,0.05);
            }
            #vodstudio-modal .knob-pot {
                width: 30px; height: 30px; border-radius: 50%; border: 2px dashed #fff;
                margin: 4px 0; position: relative; cursor: ns-resize;
            }
            #vodstudio-modal .knob-pot::after {
                content: ''; position: absolute; top: 2px; left: 50%; width: 2px; height: 10px; background: #fff; transform: translateX(-50%);
            }
            #vodstudio-modal .knob-pot.grey { background: var(--knob-grey); }
            #vodstudio-modal .knob-pot.blue { background: var(--knob-blue); }
            #vodstudio-modal .knob-pot.green { background: var(--knob-green); }
            #vodstudio-modal .knob-pot.orange { background: var(--knob-orange); }
            #vodstudio-modal .toggle-switch-3way {
                width: 40px; height: 16px; background: #000; border: 1px solid #fff; margin: 4px 0; border-radius: 2px; cursor: pointer;
            }
            #vodstudio-modal .fader-track {
                width: 6px; height: 130px; background: #111; border: 1px solid rgba(255,255,255,0.3);
                position: relative; margin-top: 15px; border-radius: 3px;
            }
            #vodstudio-modal .fader-cap {
                width: 24px; height: 30px; background: #f5f5f5; border: 1px solid #333;
                position: absolute; left: -10px; top: 45px; border-radius: 2px; cursor: ns-resize; box-shadow: 0 3px 5px rgba(0,0,0,0.5);
            }
            #vodstudio-modal .fader-cap::before {
                content: ''; position: absolute; top: 50%; left: 0; width: 100%; height: 2px; background: #e74c3c;
            }
            #vodstudio-modal .master-bay {
                padding-left: 20px; display: flex; flex-direction: column; justify-content: space-between;
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
                width: 100%; height: 170px; background: #151515; border: 4px solid #34495e; border-radius: 10px;
                display: flex; align-items: center; justify-content: center; position: relative; box-shadow: inset 0 0 20px #000;
            }
            #vodstudio-modal .window-pane {
                width: 70%; height: 65%; background: rgba(255,255,255,0.03); border: 2px solid #444; border-radius: 4px;
                display: flex; justify-content: space-around; align-items: center;
            }
            #vodstudio-modal .tape-hub { width: 22px; height: 22px; background: #222; border: 2px dashed #fff; border-radius: 50%; }
            #vodstudio-modal .tape-hub.spinning { animation: spin 2s linear infinite; }
            @keyframes spin { 100% { transform: rotate(360deg); } }
            #vodstudio-modal .mechanical-keys { display: flex; gap: 5px; background: #111; padding: 8px; border-radius: 6px; }
            #vodstudio-modal .m-key {
                flex: 1; height: 40px; background: #f5f5f5; color: #222; font-family: inherit; font-size: 0.65rem; font-weight: bold;
                border: 1px solid #000; border-radius: 3px; cursor: pointer; box-shadow: 0 4px 0 #999;
            }
            #vodstudio-modal .m-key:active { transform: translateY(3px); box-shadow: 0 1px 0 #999; }
            #vodstudio-modal .m-key.rec-key { color: #cc0000; }
            #vodstudio-modal .m-key.active-playback { background: var(--knob-green); color: #fff; }
            #vodstudio-modal .web3-mint-bar {
                background: #fff !important; color: #000 !important; padding: 10px; margin-top: 10px; border-radius: 4px;
                cursor: pointer; font-weight: bold; text-align: center; border: 2px solid #000; transition: background 0.2s;
            }
            #vodstudio-modal .web3-mint-bar:hover { background: #eee !important; }
            #vodstudio-modal .rec-arm-switch.armed { background: #e74c3c !important; box-shadow: inset 0 0 5px #000; }
        `;
        document.head.appendChild(style);

        const trackNames = ['vocals', 'drums', 'bass', 'melody'];
        let stripsHtml = '';
        trackNames.forEach((trackName, i) => {
            stripsHtml += `
            <div class="channel-strip" data-track="${trackName}">
                <span class="chalk-text" style="font-size: 0.9rem; margin-bottom: 8px;">CH ${i+1}<br><span style="font-size:10px; color:#aaa;">${trackName.toUpperCase()}</span></span>
                <span class="chalk-text">TRIM</span><div class="knob-pot grey"></div>
                <span class="chalk-text" style="margin-top: 6px;">EQ HIGH</span><div class="knob-pot blue"></div>
                <span class="chalk-text">EQ LOW</span><div class="knob-pot blue"></div>
                <span class="chalk-text" style="margin-top: 6px;">EFFECT 1</span><div class="knob-pot green"></div>
                <span class="chalk-text">EFF 2 / CUE</span><div class="knob-pot green"></div>
                <span class="chalk-text" style="margin-top: 6px;">PAN</span><div class="knob-pot grey pan-pot"></div>
                <span class="chalk-text" style="margin-top: 4px;">INPUT</span><div class="toggle-switch-3way"></div>
                <span class="chalk-text" style="margin-top: 4px;">REC FUNC</span><div class="toggle-switch-3way rec-arm-switch" data-track="${trackName}" style="border-color:#ff3333; transition: 0.2s;"></div>
                <div class="fader-track"><div class="fader-cap volume-fader"></div></div>
            </div>
            `;
        });

        modal.innerHTML = `
        <div class="console">
            <button class="close-btn" id="btn-close-vodcam">X</button>
            <div class="mixer-bay">${stripsHtml}</div>
            <div class="master-bay">
                <div class="sub-mixers-row">
                    <div class="aux-pods">
                        <div><span class="chalk-text">LEVEL 5-6</span><div class="knob-pot orange"></div></div>
                        <div><span class="chalk-text">LEVEL 7-8</span><div class="knob-pot orange"></div></div>
                        <div><span class="chalk-text">MONITOR</span><div class="knob-pot orange"></div></div>
                        <div><span class="chalk-text">2-TRK IN</span><div class="knob-pot orange"></div></div>
                    </div>
                    <div class="pitch-wheel-wrapper"><span class="chalk-text">PITCH</span><div class="pitch-dial"></div></div>
                </div>
                <div class="tape-compartment">
                    <span class="chalk-text" style="position: absolute; bottom: 8px; font-size: 0.5rem; opacity: 0.4;">4-TRACK REWRITABLE MEMORY CORE</span>
                    <div class="window-pane"><div class="tape-hub"></div><div class="tape-hub"></div></div>
                </div>
                <div class="mechanical-keys">
                    <button class="m-key rec-key" id="btn-record">RECORD</button>
                    <button class="m-key" id="btn-play">PLAY</button>
                    <button class="m-key">REWIND</button>
                    <button class="m-key">FFWD</button>
                    <button class="m-key" id="btn-stop">STOP</button>
                    <button class="m-key">PAUSE</button>
                </div>
                <div class="web3-mint-bar chalk-text" id="btn-mint">🚀 EXPORT STEMS & MINT AUDIO TO PLATFORM</div>
            </div>
        </div>
        `;
        document.body.appendChild(modal);
        this.bindEvents(modal);
    },

    bindEvents(modal) {
        let activeFader = null, activePan = null, activePitch = null;
        let startY = 0; let currentPanRots = new Map(); let currentPitchRot = 0;

        const mouseMoveHandler = (e) => {
            if (activeFader) {
                const track = activeFader.parentElement;
                const rect = track.getBoundingClientRect();
                let y = Math.max(0, Math.min(rect.height - activeFader.offsetHeight, e.clientY - rect.top));
                activeFader.style.top = y + 'px';
                const val = 1.0 - (y / (rect.height - activeFader.offsetHeight));
                this.setVolume(activeFader.closest('.channel-strip').dataset.track, val);
            } else if (activePan) {
                let rot = Math.max(-150, Math.min(150, currentPanRots.get(activePan) + (startY - e.clientY) * 2));
                startY = e.clientY;
                currentPanRots.set(activePan, rot);
                activePan.style.transform = `rotate(${rot}deg)`;
                this.setPan(activePan.closest('.channel-strip').dataset.track, rot / 150);
            } else if (activePitch) {
                currentPitchRot = Math.max(-150, Math.min(150, currentPitchRot + (startY - e.clientY) * 2));
                startY = e.clientY;
                activePitch.style.transform = `rotate(${currentPitchRot}deg)`;
                this.playbackRate = 1.0 + (currentPitchRot / 300);
                for (const tr in this.tracks) {
                    if (this.tracks[tr].source) try { this.tracks[tr].source.playbackRate.value = this.playbackRate; } catch(err){}
                }
            }
        };

        const mouseUpHandler = () => { activeFader = activePan = activePitch = null; };

        modal.addEventListener('mousedown', (e) => {
            if (e.target.classList.contains('volume-fader')) activeFader = e.target;
            else if (e.target.classList.contains('pan-pot')) { activePan = e.target; startY = e.clientY; if (!currentPanRots.has(activePan)) currentPanRots.set(activePan, 0); }
            else if (e.target.classList.contains('pitch-dial')) { activePitch = e.target; startY = e.clientY; }
        });

        document.addEventListener('mousemove', mouseMoveHandler);
        document.addEventListener('mouseup', mouseUpHandler);

        modal.querySelectorAll('.rec-arm-switch').forEach(sw => {
            sw.onclick = () => this.toggleArmTrack(sw.dataset.track, sw);
        });

        document.getElementById('btn-close-vodcam').onclick = () => {
            document.removeEventListener('mousemove', mouseMoveHandler);
            document.removeEventListener('mouseup', mouseUpHandler);
            this.stop();
            if (this.micStream) {
                this.micStream.getTracks().forEach(t => t.stop());
                this.micStream = null;
            }
            modal.remove();
        };

        const recBtn = document.getElementById('btn-record');
        const playBtn = document.getElementById('btn-play');
        
        recBtn.onclick = () => {
            if (this.armedTrack && !this.isRecording) {
                this.startRecording();
                this.play();
                recBtn.classList.add('active-playback');
                document.querySelectorAll('.tape-hub').forEach(h => h.classList.add('spinning'));
            } else if (!this.armedTrack) {
                alert('Please arm a track by clicking its REC FUNC switch first.');
            }
        };

        playBtn.onclick = () => {
            if (this.isRecording) return; // Don't let play button interrupt a live recording
            this.play(); playBtn.classList.add('active-playback');
            document.querySelectorAll('.tape-hub').forEach(h => h.classList.add('spinning'));
        };
        
        document.getElementById('btn-stop').onclick = () => {
            this.stop(); playBtn.classList.remove('active-playback');
            recBtn.classList.remove('active-playback');
            document.querySelectorAll('.tape-hub').forEach(h => h.classList.remove('spinning'));
        };

        const mintBtn = document.getElementById('btn-mint');
        mintBtn.onclick = () => {
            mintBtn.innerText = "⏳ MIXING DOWN AUDIO Bouncing to Master...";
            mintBtn.style.background = "var(--knob-orange)";
            mintBtn.style.pointerEvents = "none";
            setTimeout(() => this.bounceMixdown(), 100);
        };
    },

    async bounceMixdown() {
        if (!this.tracks.vocals.buffer && !this.tracks.drums.buffer) return alert("Please load stems first.");
        
        let maxDur = Math.max(...Object.values(this.tracks).map(t => t.buffer ? t.buffer.duration : 0));
        const offlineCtx = new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(2, Math.ceil(44100 * (maxDur / this.playbackRate)), 44100);
        
        const offlineMaster = offlineCtx.createGain();
        const offlineTape = offlineCtx.createWaveShaper();
        offlineTape.curve = this.makeDistortionCurve(50);
        offlineMaster.connect(offlineTape);
        offlineTape.connect(offlineCtx.destination);

        for (const trackName in this.tracks) {
            const track = this.tracks[trackName];
            if (track.buffer) {
                const source = offlineCtx.createBufferSource();
                source.buffer = track.buffer;
                source.playbackRate.value = this.playbackRate;
                
                const panner = offlineCtx.createStereoPanner();
                panner.pan.value = track.panner ? track.panner.pan.value : 0;
                const gain = offlineCtx.createGain();
                gain.gain.value = track.gain ? track.gain.gain.value : 1;
                
                source.connect(panner); panner.connect(gain); gain.connect(offlineMaster);
                source.start(0);
            }
        }

        const renderedBuffer = await offlineCtx.startRendering();
        const wavBlob = this.audioBufferToWav(renderedBuffer);
        const file = new File([wavBlob], "vodstudio_mixdown.wav", { type: "audio/wav" });
        
        const dataTransfer = new DataTransfer();
        dataTransfer.items.add(file);
        
        const audUploadEl = document.getElementById('composer-audio-upload');
        if (audUploadEl) {
            audUploadEl.files = dataTransfer.files;
            const feedTab = document.querySelector('.side-nav-item');
            if (window.switchTab) window.switchTab('feed', feedTab);
            if (window.updateComposerPreview) window.updateComposerPreview();
            document.getElementById('btn-close-vodcam').click(); // Clean up modal
            alert("Mixdown complete! The WAV file is loaded into the composer. Just add a title and hit Broadcast!");
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
    }
};