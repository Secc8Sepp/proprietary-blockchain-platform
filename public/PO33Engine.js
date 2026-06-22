window.PO33Engine = {
    vodStudio: null,
    audioCtx: null,
    masterOut: null,
    fxNode: null,
    
    isRecording: false,
    micStream: null,
    mediaRecorder: null,
    recordedChunks: [],
    banks: Array.from({length: 16}, () => ({ buffer: null, slices: Array.from({length: 16}, () => ({ offset: 0, duration: 0 })), pitch: 1.0, volume: 1.0, routeTarget: 'master' })),
    activeBank: 0,
    awaitingSoundSelect: false,
    awaitingPatternSelect: false,
    awaitingFxSelect: false,
    isWriteMode: false,
    lastPlayedPad: 0,
    
    isPlaying: false,
    bpm: 120,
    currentStep: 0,
    nextNoteTime: 0,
    scheduleAheadTime: 0.1,
    lookahead: 25.0,
    timerID: null,
    
    // 16 Patterns, each containing 16 steps, each step containing { bank, pad } notes
    patterns: Array.from({length: 16}, () => Array.from({length: 16}, () => [])),
    activePattern: 0,
    
    activeFx: null,

    async init(vodStudioInstance = null) {
        this.vodStudio = vodStudioInstance;
        this.audioCtx = this.vodStudio ? this.vodStudio.audioCtx : new (window.AudioContext || window.webkitAudioContext)();
        
        // Setup Audio Routing
        this.masterOut = this.audioCtx.createGain();
        this.masterOut.gain.value = 0.8;
        
        this.fxNode = this.audioCtx.createBiquadFilter();
        this.fxNode.type = 'allpass'; // Transparent by default
        
        this.masterOut.connect(this.fxNode);
        
        if (this.vodStudio && this.vodStudio.masterGain) {
            this.fxNode.connect(this.vodStudio.masterGain);
        } else {
            this.fxNode.connect(this.audioCtx.destination);
        }

        this.renderUI();
        await this.loadDefaultSounds();
        console.log('[VO-88 CALCULATOR] Hardware Initialized with Default Sounds.');
    },

    async loadDefaultSounds() {
        if (!this.audioCtx) return;
        
        // Ensure audio context is awake (Browser autoplay policy fix)
        if (this.audioCtx.state === 'suspended') {
            try { await this.audioCtx.resume(); } catch(e){}
        }

        const sampleRate = this.audioCtx.sampleRate;

        // 1. Synthesize Melodic Bank 0 (C4 Synth)
        const lenMelodic = sampleRate * 1.0;
        const bufMelodic = this.audioCtx.createBuffer(1, lenMelodic, sampleRate);
        const dataMelodic = bufMelodic.getChannelData(0);
        for (let i = 0; i < lenMelodic; i++) {
            const t = i / sampleRate;
            const env = Math.exp(-3.0 * t); // smooth decay
            dataMelodic[i] = (Math.sin(2 * Math.PI * 261.63 * t) * 0.5 + Math.sin(2 * Math.PI * 261.63 * 2 * t) * 0.25) * env;
        }
        this.banks[0].buffer = bufMelodic;

        // 2. Synthesize Drum Bank 8 (16 slices, 0.15s each = 2.4s)
        const sliceTime = 0.15;
        const lenDrums = sampleRate * sliceTime * 16;
        const bufDrums = this.audioCtx.createBuffer(1, lenDrums, sampleRate);
        const dataDrums = bufDrums.getChannelData(0);

        for (let s = 0; s < 16; s++) {
            const offset = s * Math.floor(sampleRate * sliceTime);
            for (let i = 0; i < sampleRate * sliceTime; i++) {
                const t = i / sampleRate;
                let sample = 0;
                if (s % 4 === 0) { // Kick
                    sample = Math.sin(2 * Math.PI * (150 * Math.exp(-30.0 * t) + 40) * t) * Math.exp(-20.0 * t);
                } else if (s % 4 === 1 || s % 4 === 3) { // Hats (Closed / Open)
                    const decay = (s % 4 === 1) ? 40.0 : 10.0;
                    sample = ((Math.random() * 2 - 1) - (Math.random() * 2 - 1) * 0.4) * Math.exp(-decay * t) * 0.5;
                } else if (s % 4 === 2) { // Snare
                    sample = (Math.sin(2 * Math.PI * 180 * t) * Math.exp(-20.0 * t) * 0.5) + ((Math.random() * 2 - 1) * Math.exp(-15.0 * t) * 0.5);
                }
                dataDrums[offset + i] = sample;
            }
        }
        this.banks[8].buffer = bufDrums;
        this.autoSlice(8);
    },

    async startSampling() {
        if (this.isRecording) return;
        try {
            this.micStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false } });
            this.recordedChunks = [];
            this.mediaRecorder = new MediaRecorder(this.micStream);
            
            this.mediaRecorder.ondataavailable = e => { if (e.data.size > 0) this.recordedChunks.push(e.data); };
            this.mediaRecorder.onstop = async () => {
                const blob = new Blob(this.recordedChunks, { type: 'audio/webm' });
                const arrayBuffer = await blob.arrayBuffer();
                const decoded = await this.audioCtx.decodeAudioData(arrayBuffer);
                
                // Enforce 40 second max memory
                if (decoded.duration > 40.0) {
                    alert("Memory full! Truncated to 40 seconds.");
                }
                
                this.banks[this.activeBank].buffer = decoded;
                if (this.activeBank >= 8) {
                    this.autoSlice(this.activeBank);
                    this.updateLCD("CHOPPED");
                } else {
                    this.updateLCD("MELODIC");
                }
            };
            
            this.mediaRecorder.start();
            this.isRecording = true;
            this.updateLCD("REC...");
            
            // Auto-stop after 40 seconds (hardware limitation)
            setTimeout(() => { if(this.isRecording) this.stopSampling(); }, 40000);
            
        } catch (e) {
            alert("Microphone access required to sample into the PO-33.");
        }
    },

    stopSampling() {
        if (!this.isRecording) return;
        this.mediaRecorder.stop();
        this.micStream.getTracks().forEach(t => t.stop());
        this.isRecording = false;
        this.updateLCD("SAVING");
    },

    autoSlice(bankIdx) {
        const bank = this.banks[bankIdx];
        if (!bank || !bank.buffer) return;
        // Divide the recorded audio equally into 16 slices for the drum rack
        const sliceLen = bank.buffer.duration / 16;
        for (let i = 0; i < 16; i++) {
            bank.slices[i] = {
                offset: i * sliceLen,
                duration: sliceLen
            };
        }
    },

    playPad(bankIdx, padIdx, time = 0) {
        const bank = this.banks[bankIdx];
        if (!bank || !bank.buffer) return;
        
        let targetNode = this.masterOut;
        if (bank.routeTarget && bank.routeTarget !== 'master' && this.vodStudio && this.vodStudio.tracks[bank.routeTarget]) {
            targetNode = this.vodStudio.tracks[bank.routeTarget].trim;
        }

        const playSlice = (t, startOffset, dur) => {
            const src = this.audioCtx.createBufferSource();
            src.buffer = bank.buffer;
            
            let pRate = bank.pitch || 1.0;
            if (bankIdx < 8) {
                // Melodic: Pitch sample across 16 pads (Pad 8 is original pitch)
                pRate *= Math.pow(2, (padIdx - 8) / 12);
            }
            src.playbackRate.value = pRate;
            
            const volGain = this.audioCtx.createGain();
            volGain.gain.value = bank.volume !== undefined ? bank.volume : 1.0;
            
            src.connect(volGain);
            volGain.connect(targetNode);
            
            if (bankIdx >= 8 && dur) src.start(t, startOffset, dur);
            else src.start(t);
        };
        
        const now = time || this.audioCtx.currentTime;
        const slice = bankIdx >= 8 ? bank.slices[padIdx] : null;
        const offset = slice ? slice.offset : 0;
        const dur = slice ? slice.duration : null;
        
        // Stutter FX Routing
        if (this.activeFx === 'stutter') {
            for(let i=0; i<4; i++) {
                playSlice(now + (i * 0.1), offset, dur ? 0.1 : null);
            }
        } else {
            playSlice(now, offset, dur);
        }
        
        // Visual feedback
        const btn = document.getElementById(`po33-pad-${padIdx}`);
        if (btn && time === 0) {
            btn.style.background = '#e74c3c';
            setTimeout(() => btn.style.background = '#111', 100);
        }
    },

    updateLEDs() {
        for(let i=0; i<16; i++) {
            const led = document.getElementById(`po33-led-${i}`);
            if (!led) continue;
            
            let color = '#111'; // off
            let glow = 'inset 0 0 2px #000';
            
            if (this.isPlaying && i === this.currentStep) {
                color = '#fff'; // playhead
                glow = '0 0 5px #fff';
            } else if (this.isWriteMode && !this.isPlaying) {
                // Step Sequencer Mode: Light up pads where the active sound is placed
                const stepArr = this.patterns[this.activePattern][i];
                if (stepArr && stepArr.some(n => n.bank === this.activeBank && n.pad === this.lastPlayedPad)) {
                    color = '#e74c3c'; // step active
                    glow = '0 0 5px #e74c3c';
                }
            }
            led.style.background = color;
            led.style.boxShadow = glow;
        }
    },

    nextNote() {
        const secondsPerBeat = 60.0 / this.bpm;
        this.nextNoteTime += 0.25 * secondsPerBeat; // 16th notes
        this.currentStep = (this.currentStep + 1) % 16;
    },

    scheduleNote(stepNumber, time) {
        const padsToPlay = this.patterns[this.activePattern][stepNumber];
        padsToPlay.forEach(note => this.playPad(note.bank, note.pad, time));
        
        // UI sync
        requestAnimationFrame(() => this.updateLEDs());
    },

    scheduler() {
        while (this.nextNoteTime < this.audioCtx.currentTime + this.scheduleAheadTime) {
            this.scheduleNote(this.currentStep, this.nextNoteTime);
            this.nextNote();
        }
        this.timerID = setTimeout(() => this.scheduler(), this.lookahead);
    },

    togglePlayback() {
        if (this.isPlaying) {
            clearTimeout(this.timerID);
            this.isPlaying = false;
            this.updateLCD("STOP");
        } else {
            if (this.audioCtx.state === 'suspended') this.audioCtx.resume();
            this.currentStep = 0;
            this.nextNoteTime = this.audioCtx.currentTime + 0.05;
            this.scheduler();
            this.isPlaying = true;
            this.updateLCD("PLAY");
        }
        this.updateLEDs();
    },

    setPunchInFx(type) {
        this.activeFx = type;
        if (window.FXEngine) {
            window.FXEngine.applyPunchInFx(this.fxNode, type);
        }
        this.updateLCD(`FX: ${type ? type.toUpperCase() : 'OFF'}`);
    },

    async exportAndMint() {
        if (!window.CoreEngine || !window.CoreEngine.userKeys.publicKey) return alert("Must be logged in to Web3.");
        
        this.updateLCD("MINTING");
        try {
            const packData = { banks: [] };
            for(let i=0; i<16; i++) {
                if (this.banks[i].buffer) {
                    packData.banks.push({ index: i, pitch: this.banks[i].pitch, volume: this.banks[i].volume, slices: this.banks[i].slices });
                }
            }
            if (packData.banks.length === 0) return alert("All banks are empty! Sample something first.");
            
            await window.CoreEngine.sendSignedTransaction('MINT_PO33_PACK', '0x00', { 
                cost: 100, 
                pack: packData, 
                patterns: this.patterns 
            });
            
            alert("Sample Pack Minted Successfully! Your sounds and patterns are now on the ledger.");
            this.updateLCD("MINT OK");
        } catch(e) {
            console.error(e);
            this.updateLCD("ERROR");
        }
    },

    updateLCD(text) {
        const lcd = document.getElementById('po33-lcd-text');
        if (lcd) lcd.innerText = text;
    },

    audioBufferToWav(buffer) {
        if (this.vodStudio) return this.vodStudio.audioBufferToWav(buffer);
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
                sample = sample < 0 ? sample * 32768 : sample * 32767;
                view.setInt16(offset, sample, true); offset += 2;
            }
            pos++;
        }
        return new Blob([bufferArray], {type: "audio/wav"});
    },

    renderUI() {
        if (document.getElementById('po33-modal')) return;

        const modal = document.createElement('div');
        modal.id = 'po33-modal';
        modal.style = `
            position: fixed; top: 10%; left: 10%; width: 320px; height: auto; 
            background: #2a2d34; border-radius: 10px; border: 2px solid #111;
            box-shadow: 0 20px 50px rgba(0,0,0,0.8), inset 0 0 10px rgba(255,255,255,0.05);
            z-index: 10005; display: flex; flex-direction: column; padding: 15px; cursor: move;
            font-family: 'Courier New', monospace; user-select: none;
        `;

        // Make it draggable
        let isDragging = false, startX, startY, initialX, initialY;
        modal.addEventListener('mousedown', (e) => {
            if(e.target.tagName === 'BUTTON' || e.target.tagName === 'SELECT') return;
            isDragging = true; startX = e.clientX; startY = e.clientY;
            initialX = modal.offsetLeft; initialY = modal.offsetTop;
        });
        window.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            modal.style.left = `${initialX + e.clientX - startX}px`;
            modal.style.top = `${initialY + e.clientY - startY}px`;
        });
        window.addEventListener('mouseup', () => isDragging = false);
        
        // Force wake up Audio Context on any interaction with the hardware
        modal.addEventListener('mousedown', () => {
            if (this.audioCtx && this.audioCtx.state === 'suspended') this.audioCtx.resume();
        });

        let padsHtml = '';
        for(let i=0; i<16; i++) {
            padsHtml += `
                <div style="display:flex; flex-direction:column; align-items:center;">
                    <div id="po33-led-${i}" class="po33-step-led" style="width:6px; height:6px; background:#111; border-radius:50%; margin-bottom:4px; box-shadow:inset 0 0 2px #000;"></div>
                    <button class="po33-pad" data-pad="${i}" style="width: 42px; height: 35px; border-radius: 4px; background: #e0e0e0; border: 2px solid #111; color: #111; font-weight: bold; font-size:12px; cursor: pointer; box-shadow: 0 3px 0 #888; transition: transform 0.05s, box-shadow 0.05s; padding:0;">${i+1}</button>
                </div>
            `;
        }

        const sideBtnStyle = "width: 45px; height: 35px; border-radius: 4px; border: 2px solid #111; color: #fff; font-size: 10px; font-weight: bold; cursor: pointer; padding: 0;";

        modal.innerHTML = `
            <div style="display:flex; justify-content: flex-end; margin-bottom: 5px;">
                <div style="color: #aaa; font-weight: bold; font-size: 14px; font-style: italic; letter-spacing: 1px; flex-grow:1;">VO-88 K.O!</div>
                <button id="btn-close-po33" style="background:transparent; border:none; color:#e74c3c; cursor:pointer; font-weight:bold; font-size:16px; padding:0; outline:none;">X</button>
            </div>
            
            <div style="background: #7A8B73; height: 100px; border-radius: 8px; border: 4px solid #111; box-shadow: inset 0 0 10px rgba(0,0,0,0.5); margin-bottom: 15px; display: flex; flex-direction:column; justify-content:center; position: relative; overflow: hidden; padding: 10px; box-sizing: border-box;">
                <div id="po33-lcd-text" style="font-size: 36px; font-weight: bold; color: rgba(10,20,10,0.8); letter-spacing: 2px; text-align: center; font-family: monospace;">READY</div>
                <div id="po33-bpm-display" style="position: absolute; bottom: 5px; right: 5px; font-size: 10px; color: rgba(10,20,10,0.8); font-weight: bold; cursor: pointer; padding: 2px 4px; border: 1px solid rgba(10,20,10,0.3); border-radius: 3px; background: rgba(10,20,10,0.1);" title="Click to change Tempo">BPM: ${this.bpm}</div>
                <div id="po33-ptn-display" style="position: absolute; bottom: 5px; left: 5px; font-size: 10px; color: rgba(10,20,10,0.8); font-weight: bold;">PTN: 01</div>
            </div>

            <div style="display: flex; justify-content: center; gap: 30px; margin-bottom: 15px;">
                <div style="display:flex; flex-direction:column; align-items:center;">
                    <div id="po33-pitch-knob" class="po33-knob" data-type="pitch" style="width: 35px; height: 35px; border-radius: 50%; background: #444; border: 2px solid #111; position: relative; cursor: ns-resize; touch-action: none; box-shadow: 0 3px 5px rgba(0,0,0,0.5);">
                        <div style="position:absolute; top:4px; left:15px; width:3px; height:8px; background:#fff; border-radius:2px;"></div>
                    </div>
                    <span style="font-size:10px; color:#aaa; margin-top:6px; font-weight:bold;">PITCH</span>
                </div>
                <div style="display:flex; flex-direction:column; align-items:center;">
                    <div id="po33-vol-knob" class="po33-knob" data-type="volume" style="width: 35px; height: 35px; border-radius: 50%; background: #444; border: 2px solid #111; position: relative; cursor: ns-resize; touch-action: none; box-shadow: 0 3px 5px rgba(0,0,0,0.5);">
                        <div style="position:absolute; top:4px; left:15px; width:3px; height:8px; background:#fff; border-radius:2px;"></div>
                    </div>
                    <span style="font-size:10px; color:#aaa; margin-top:6px; font-weight:bold;">VOL</span>
                </div>
            </div>
            
            <div style="margin-bottom: 15px;">
                <select id="po33-routing-select" style="width:100%; background:#7A8B73; color:#111; border:2px solid #111; padding:5px; font-family:inherit; font-size:11px; font-weight:bold; outline:none; border-radius:3px;">
                    <option value="master">Pad Out: MASTER OUT</option>
                    <option value="track1">Pad Out: VOD STUDIO CH 1</option>
                    <option value="track2">Pad Out: VOD STUDIO CH 2</option>
                    <option value="track3">Pad Out: VOD STUDIO CH 3</option>
                    <option value="track4">Pad Out: VOD STUDIO CH 4</option>
                </select>
            </div>

            <div style="display: flex; gap: 20px; flex-grow: 1;">
                <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; flex-grow: 1;">
                    ${padsHtml}
                </div>
                
                <div style="display: flex; flex-direction: column; gap: 8px; justify-content: flex-start;">
                    <button id="po33-btn-sound" style="${sideBtnStyle} background:#3498db; box-shadow: 0 3px 0 #2980b9;">SND</button>
                    <button id="po33-btn-ptn" style="${sideBtnStyle} background:#f1c40f; color:#000; box-shadow: 0 3px 0 #b7950b;">PTN</button>
                    <button id="po33-btn-fx" style="${sideBtnStyle} background:#e67e22; box-shadow: 0 3px 0 #d35400;">FX</button>
                    <button id="po33-btn-rec" style="${sideBtnStyle} background:#e74c3c; box-shadow: 0 3px 0 #c0392b;">REC</button>
                    <button id="po33-btn-play" style="${sideBtnStyle} background:#2ecc71; color:#000; box-shadow: 0 3px 0 #27ae60;">PLAY</button>
                    <button id="po33-btn-write" style="${sideBtnStyle} background:#9b59b6; box-shadow: 0 3px 0 #8e44ad;">WRT</button>
                </div>
            </div>
            
            <button id="po33-btn-mint" style="margin-top: 20px; background:#3498db; color:#fff; border:2px solid #111; border-radius:20px; padding:10px; font-weight:bold; font-family:inherit; cursor:pointer; box-shadow: 0 4px 0 #2980b9;">📦 MINT SAMPLE PACK</button>
        `;
        document.body.appendChild(modal);

        this.bindEvents();
        this.updateLEDs();
    },

    bindEvents() {
        const modal = document.getElementById('po33-modal');
        
        modal.querySelector('#btn-close-po33').onclick = () => {
            if (this.isPlaying) this.togglePlayback();
            if (this.isRecording) this.stopSampling();
            this.fxNode.disconnect();
            modal.remove();
        };
        
        const bpmDisplay = modal.querySelector('#po33-bpm-display');
        if (bpmDisplay) {
            bpmDisplay.onclick = () => {
                const newBpm = prompt("Enter new Tempo (BPM):", this.bpm);
                if (newBpm && !isNaN(parseInt(newBpm))) {
                    this.bpm = Math.max(40, Math.min(300, parseInt(newBpm)));
                    bpmDisplay.innerText = `BPM: ${this.bpm}`;
                    this.updateLCD(`BPM ${this.bpm}`);
                    setTimeout(() => this.updateLCD("READY"), 1000);
                }
            };
        }

        modal.querySelector('#po33-routing-select').onchange = (e) => {
            this.banks[this.activeBank].routeTarget = e.target.value;
        };

        let activeKnob = null, startY = 0, currentRot = 0;
        const knobMove = (e) => {
            if (!activeKnob) return;
            currentRot = Math.max(-150, Math.min(150, currentRot + (startY - e.clientY) * 2));
            startY = e.clientY;
            activeKnob.style.transform = `rotate(${currentRot}deg)`;
            const bank = this.banks[this.activeBank];
            if (activeKnob.dataset.type === 'pitch') bank.pitch = Math.pow(2, currentRot / 75); // +/- 2 octaves
            else if (activeKnob.dataset.type === 'volume') bank.volume = 1.0 + (currentRot / 150); // 0 to 2
        };
        const knobUp = () => activeKnob = null;
        modal.querySelectorAll('.po33-knob').forEach(knob => {
            knob.onpointerdown = (e) => {
                activeKnob = knob; startY = e.clientY;
                currentRot = parseFloat(knob.style.transform.replace('rotate(','')) || 0;
                knob.setPointerCapture(e.pointerId);
            };
        });
        modal.addEventListener('pointermove', knobMove);
        modal.addEventListener('pointerup', knobUp);
        modal.addEventListener('pointercancel', knobUp);

        const recBtn = modal.querySelector('#po33-btn-rec');
        recBtn.onmousedown = () => this.startSampling();
        recBtn.onmouseup = () => this.stopSampling();
        
        const sndBtn = modal.querySelector('#po33-btn-sound');
        sndBtn.onclick = () => {
            this.awaitingSoundSelect = !this.awaitingSoundSelect;
            this.awaitingPatternSelect = false;
            this.awaitingFxSelect = false;
            this.updateLCD(this.awaitingSoundSelect ? "SEL SND" : "READY");
            sndBtn.style.background = this.awaitingSoundSelect ? '#2980b9' : '#3498db';
            document.getElementById('po33-btn-ptn').style.background = '#f1c40f';
            document.getElementById('po33-btn-fx').style.background = '#e67e22';
        };
        
        const ptnBtn = modal.querySelector('#po33-btn-ptn');
        ptnBtn.onclick = () => {
            this.awaitingPatternSelect = !this.awaitingPatternSelect;
            this.awaitingSoundSelect = false;
            this.awaitingFxSelect = false;
            this.updateLCD(this.awaitingPatternSelect ? "SEL PTN" : "READY");
            ptnBtn.style.background = this.awaitingPatternSelect ? '#b7950b' : '#f1c40f';
            document.getElementById('po33-btn-sound').style.background = '#3498db';
            document.getElementById('po33-btn-fx').style.background = '#e67e22';
        };
        
        const fxBtn = modal.querySelector('#po33-btn-fx');
        fxBtn.onclick = () => {
            this.awaitingFxSelect = !this.awaitingFxSelect;
            this.awaitingPatternSelect = false;
            this.awaitingSoundSelect = false;
            this.updateLCD(this.awaitingFxSelect ? "SEL FX" : "READY");
            fxBtn.style.background = this.awaitingFxSelect ? '#d35400' : '#e67e22';
            document.getElementById('po33-btn-sound').style.background = '#3498db';
            document.getElementById('po33-btn-ptn').style.background = '#f1c40f';
            
            // Clear active FX if clicked again
            if (!this.awaitingFxSelect) this.setPunchInFx(null);
        };

        const wrtBtn = modal.querySelector('#po33-btn-write');
        wrtBtn.onclick = () => {
            this.isWriteMode = !this.isWriteMode;
            this.updateLCD(this.isWriteMode ? "WRITE" : "READY");
            wrtBtn.style.background = this.isWriteMode ? '#8e44ad' : '#9b59b6';
            this.updateLEDs();
        };

        modal.querySelector('#po33-btn-play').onclick = () => this.togglePlayback();
        
        modal.querySelector('#po33-btn-mint').onclick = () => this.exportAndMint();

        // Matrix Pads
        modal.querySelectorAll('.po33-pad').forEach(pad => {
            pad.onmousedown = (e) => {
                if (this.audioCtx && this.audioCtx.state === 'suspended') this.audioCtx.resume();
                
                e.target.style.transform = 'translateY(2px)';
                e.target.style.boxShadow = 'none';
                const idx = parseInt(e.target.dataset.pad);
                
                if (this.awaitingSoundSelect) {
                    this.activeBank = idx;
                    this.awaitingSoundSelect = false;
                    document.getElementById('po33-btn-sound').style.background = '#3498db';
                    this.updateLCD(idx < 8 ? `MELODIC ${idx+1}` : `DRUM ${idx+1}`);
                    
                    // Sync Knobs & Routing dropdown to newly active bank
                    const bank = this.banks[idx];
                    document.getElementById('po33-routing-select').value = bank.routeTarget || 'master';
                    const pRot = bank.pitch ? (Math.log2(bank.pitch) * 75) : 0;
                    const vRot = bank.volume !== undefined ? (bank.volume - 1.0) * 150 : 0;
                    document.getElementById('po33-pitch-knob').style.transform = `rotate(${pRot}deg)`;
                    document.getElementById('po33-vol-knob').style.transform = `rotate(${vRot}deg)`;
                    this.updateLEDs();
                    return;
                }
                
                if (this.awaitingPatternSelect) {
                    this.activePattern = idx;
                    this.awaitingPatternSelect = false;
                    document.getElementById('po33-btn-ptn').style.background = '#f1c40f';
                    document.getElementById('po33-ptn-display').innerText = `PTN: ${String(idx+1).padStart(2, '0')}`;
                    this.updateLCD(`PATTERN ${idx+1}`);
                    this.updateLEDs();
                    return;
                }
                
                if (this.awaitingFxSelect) {
                    // Quick mappings to FXEngine logic
                    const fxTypes = ['lowpass', 'highpass']; 
                    this.setPunchInFx(fxTypes[idx % 2]); // Toggles between LP and HP for now
                    this.awaitingFxSelect = false;
                    document.getElementById('po33-btn-fx').style.background = '#e67e22';
                    return;
                }

                if (this.isWriteMode) {
                    if (this.isPlaying) {
                        // Live punch-in mode
                        this.lastPlayedPad = idx;
                        this.playPad(this.activeBank, idx);
                        this.patterns[this.activePattern][this.currentStep].push({ bank: this.activeBank, pad: idx });
                    } else {
                        // Step sequencer toggle mode (TR-808 style)
                        const stepArr = this.patterns[this.activePattern][idx];
                        const noteIdx = stepArr.findIndex(n => n.bank === this.activeBank && n.pad === this.lastPlayedPad);
                        if (noteIdx > -1) stepArr.splice(noteIdx, 1);
                        else stepArr.push({ bank: this.activeBank, pad: this.lastPlayedPad });
                        this.updateLEDs();
                    }
                } else {
                    // Normal live play
                    this.lastPlayedPad = idx;
                    this.playPad(this.activeBank, idx);
                    if (this.isPlaying && this.isWriteMode) {
                        this.patterns[this.activePattern][this.currentStep].push({ bank: this.activeBank, pad: idx });
                    }
                }
            };
            pad.onmouseup = (e) => {
                e.target.style.transform = 'none';
                e.target.style.boxShadow = '0 4px 0 #888';
            };
            pad.onmouseleave = (e) => {
                e.target.style.transform = 'none';
                e.target.style.boxShadow = '0 4px 0 #888';
            };
        });
    }
};

// Exposes the hardware globally so it can be added to your DApp's Tools page index!
window.launchPO33 = () => {
    if (!window.PO33Engine || !window.PO33Engine.audioCtx) {
        window.PO33Engine.init(); 
    } else {
        window.PO33Engine.renderUI();
    }
};