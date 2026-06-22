window.AutoMasterEngine = {
    audioCtx: null,
    isProcessing: false,

    init() {
        console.log('[INIT] Auto Master Engine ready.');
    },

    renderUI() {
        if (document.getElementById('automaster-modal')) return;

        const modal = document.createElement('div');
        modal.id = 'automaster-modal';
        modal.className = 'modal-overlay';
        modal.style.zIndex = '10005';
        
        modal.innerHTML = `
            <div class="modal-content" style="max-width: 500px; background: var(--bg-card); border: 2px solid var(--primary); border-radius: 12px; padding: 25px; box-shadow: 0 15px 40px rgba(0,0,0,0.8), 0 0 20px rgba(102, 252, 241, 0.2);">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; border-bottom: 1px solid var(--border); padding-bottom: 15px;">
                    <h2 style="margin: 0; color: var(--primary); display: flex; align-items: center; gap: 10px;">🎚️ AI Auto Master</h2>
                    <button class="secondary" style="padding: 4px 10px; font-size: 14px; border-radius: 6px;" onclick="document.getElementById('automaster-modal').remove()">✖</button>
                </div>
                
                <p style="color: var(--text-muted); font-size: 13px; margin-bottom: 20px;">
                    Drop your final mixdown here. The DSP engine will balance the EQ, enhance stereo width, and maximize loudness to commercial streaming standards.
                </p>

                <div style="display: flex; flex-direction: column; gap: 15px;">
                    <!-- File Upload -->
                    <div style="background: rgba(0,0,0,0.3); padding: 15px; border-radius: 8px; border: 1px dashed var(--border); text-align: center;">
                        <label for="automaster-file-upload" class="button-like-input" style="margin: 0; display: inline-block;">
                            <span>📤 Select Mixdown (.mp3, .wav)</span>
                            <input type="file" id="automaster-file-upload" accept="audio/*" style="display:none;">
                        </label>
                        <div id="automaster-file-preview" style="margin-top: 10px; font-size: 12px; color: var(--primary); font-weight: bold;"></div>
                    </div>

                    <!-- Controls -->
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px;">
                        <div>
                            <label style="font-size: 12px; color: var(--text-muted); font-weight: bold; margin-bottom: 5px; display: block;">Tonal Balance (EQ)</label>
                            <select id="automaster-profile" style="width: 100%; padding: 10px; border-radius: 6px; background: #111; color: #fff; border: 1px solid #333; outline: none;">
                                <option value="flat">Balanced / Flat</option>
                                <option value="warm">Warm (Boost Lows, Cut Highs)</option>
                                <option value="bright">Bright (Airy Highs)</option>
                                <option value="punchy">Punchy (Boost Kicks & Snares)</option>
                            </select>
                        </div>
                        <div>
                            <label style="font-size: 12px; color: var(--text-muted); font-weight: bold; margin-bottom: 5px; display: block;">Stereo Width</label>
                            <select id="automaster-width" style="width: 100%; padding: 10px; border-radius: 6px; background: #111; color: #fff; border: 1px solid #333; outline: none;">
                                <option value="1.0">Normal</option>
                                <option value="1.2">Wide (+20%)</option>
                                <option value="1.4">Ultra Wide (+40%)</option>
                                <option value="0.8">Narrow (-20%)</option>
                            </select>
                        </div>
                    </div>
                    
                    <div>
                        <label style="font-size: 12px; color: var(--text-muted); font-weight: bold; margin-bottom: 5px; display: flex; justify-content: space-between;">
                            <span>Mastering Intensity (Compression)</span>
                            <span id="automaster-intensity-val">75%</span>
                        </label>
                        <input type="range" id="automaster-intensity" min="0" max="100" value="75" style="width: 100%;">
                    </div>

                    <button id="btn-execute-automaster" style="padding: 15px; font-size: 16px; font-weight: bold; margin-top: 10px;" disabled>Master Track</button>
                </div>

                <div id="automaster-results" style="display: none; margin-top: 20px; background: rgba(46, 204, 113, 0.1); padding: 15px; border-radius: 8px; border: 1px solid var(--success); text-align: center;">
                    <h3 style="color: var(--success); margin-top: 0; margin-bottom: 10px;">Mastering Complete! 💽</h3>
                    <a id="automaster-download-link" href="#" download="Mastered_Track.wav" style="display: inline-block; background: var(--success); color: #000; padding: 10px 20px; border-radius: 6px; font-weight: bold; text-decoration: none; margin-bottom: 10px;">Download Master (.WAV)</a>
                </div>
            </div>
        `;

        document.body.appendChild(modal);
        this.bindEvents(modal);
    },

    bindEvents(modal) {
        const fileInput = modal.querySelector('#automaster-file-upload');
        const preview = modal.querySelector('#automaster-file-preview');
        const execBtn = modal.querySelector('#btn-execute-automaster');
        const intensitySlider = modal.querySelector('#automaster-intensity');
        const intensityVal = modal.querySelector('#automaster-intensity-val');

        intensitySlider.oninput = (e) => { intensityVal.innerText = e.target.value + '%'; };

        fileInput.onchange = (e) => {
            const file = e.target.files[0];
            if (file) {
                preview.innerText = file.name;
                execBtn.disabled = false;
            } else {
                preview.innerText = '';
                execBtn.disabled = true;
            }
        };

        execBtn.onclick = async () => {
            if (this.isProcessing) return;
            const file = fileInput.files[0];
            if (!file) return;

            this.isProcessing = true;
            execBtn.disabled = true;
            const originalText = execBtn.innerText;
            execBtn.innerText = '⏳ Analyzing & Mastering...';

            try {
                const profile = modal.querySelector('#automaster-profile').value;
                const width = parseFloat(modal.querySelector('#automaster-width').value);
                const intensity = parseInt(intensitySlider.value) / 100.0;

                const masterBlob = await this.processMaster(file, profile, width, intensity);
                
                const url = URL.createObjectURL(masterBlob);
                const dlLink = modal.querySelector('#automaster-download-link');
                dlLink.href = url;
                const safeName = file.name.replace(/\.[^/.]+$/, "");
                dlLink.download = `${safeName}_MASTERED.wav`;
                
                modal.querySelector('#automaster-results').style.display = 'block';
            } catch(e) {
                alert("Mastering failed: " + e.message);
                console.error(e);
            } finally {
                this.isProcessing = false;
                execBtn.innerText = originalText;
                execBtn.disabled = false;
            }
        };
    },

    async processMaster(file, profile, widthMod, intensity) {
        const tempCtx = new (window.AudioContext || window.webkitAudioContext)();
        const arrayBuffer = await file.arrayBuffer();
        const audioBuffer = await tempCtx.decodeAudioData(arrayBuffer);
        
        const sampleRate = audioBuffer.sampleRate;
        const length = audioBuffer.length;

        // 1. Analyze Peak to normalize input into the compressor
        const dataL = audioBuffer.getChannelData(0);
        const dataR = audioBuffer.numberOfChannels > 1 ? audioBuffer.getChannelData(1) : dataL;
        let peak = 0;
        for(let i=0; i<length; i+=100) {
            const absL = Math.abs(dataL[i]);
            const absR = Math.abs(dataR[i]);
            if(absL > peak) peak = absL;
            if(absR > peak) peak = absR;
        }
        
        // Target -3dBFS for the compressor input
        const targetPeak = 0.707; 
        const inputGainBoost = peak > 0.01 ? targetPeak / peak : 1.0;

        const offlineCtx = new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(2, length, sampleRate);
        const source = offlineCtx.createBufferSource();
        source.buffer = audioBuffer;

        const inGain = offlineCtx.createGain();
        inGain.gain.value = inputGainBoost;

        // 2. Sub-cut
        const subCut = offlineCtx.createBiquadFilter();
        subCut.type = 'highpass';
        subCut.frequency.value = 25; // Remove inaudible rumble

        // 3. EQ Profile
        const eqLow = offlineCtx.createBiquadFilter();
        eqLow.type = 'lowshelf'; eqLow.frequency.value = 150;
        
        const eqMid = offlineCtx.createBiquadFilter();
        eqMid.type = 'peaking'; eqMid.frequency.value = 2500; eqMid.Q.value = 1.0;
        
        const eqHigh = offlineCtx.createBiquadFilter();
        eqHigh.type = 'highshelf'; eqHigh.frequency.value = 8000;

        if (profile === 'warm') {
            eqLow.gain.value = 2.0; eqMid.gain.value = -1.0; eqHigh.gain.value = -1.5;
        } else if (profile === 'bright') {
            eqLow.gain.value = -1.0; eqMid.gain.value = 1.5; eqHigh.gain.value = 2.5;
        } else if (profile === 'punchy') {
            eqLow.gain.value = 1.5; eqMid.gain.value = 2.0; eqHigh.gain.value = 1.5;
        } else { // flat
            eqLow.gain.value = 0; eqMid.gain.value = 0; eqHigh.gain.value = 0;
        }

        // 4. Stereo Width (M/S Matrix)
        const splitter = offlineCtx.createChannelSplitter(2);
        const merger = offlineCtx.createChannelMerger(2);
        
        const mid = offlineCtx.createGain(); mid.gain.value = 0.5;
        const side = offlineCtx.createGain(); side.gain.value = 0.5 * widthMod;
        const invR = offlineCtx.createGain(); invR.gain.value = -1.0;
        
        const outL = offlineCtx.createGain();
        const outR = offlineCtx.createGain();
        const invSide = offlineCtx.createGain(); invSide.gain.value = -1.0;
        
        // 5. Glue Compressor
        const comp = offlineCtx.createDynamicsCompressor();
        comp.threshold.value = -18 + ((1 - intensity) * 10); // Ranges from -18 to -8
        comp.ratio.value = 2 + (intensity * 4); // Ranges from 2:1 to 6:1
        comp.attack.value = 0.03; // 30ms (let transients punch)
        comp.release.value = 0.25; // 250ms (smooth pumping)
        
        // Makeup gain based on intensity
        const makeup = offlineCtx.createGain();
        makeup.gain.value = 1.0 + (intensity * 1.5); 

        // 6. Brickwall Limiter
        const limiter = offlineCtx.createDynamicsCompressor();
        limiter.threshold.value = -0.2; // Catch anything near 0dBFS
        limiter.knee.value = 0.0;
        limiter.ratio.value = 20.0;
        limiter.attack.value = 0.001; // Instant
        limiter.release.value = 0.050; // Fast release

        // Routing
        source.connect(inGain);
        inGain.connect(subCut);
        subCut.connect(eqLow); eqLow.connect(eqMid); eqMid.connect(eqHigh);
        
        // MS Routing
        eqHigh.connect(splitter);
        splitter.connect(mid, 0); splitter.connect(mid, 1);
        splitter.connect(side, 0); splitter.connect(invR, 1); invR.connect(side);
        mid.connect(outL); mid.connect(outR);
        side.connect(outL); side.connect(invSide); invSide.connect(outR);
        outL.connect(merger, 0, 0); outR.connect(merger, 0, 1);

        merger.connect(comp);
        comp.connect(makeup);
        makeup.connect(limiter);
        limiter.connect(offlineCtx.destination);

        source.start(0);

        const renderedBuffer = await offlineCtx.startRendering();
        return this.audioBufferToWav(renderedBuffer);
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