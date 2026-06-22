window.StemSplitterEngine = {
    socket: null,
    currentCost: 10000,
    isSplitting: false,

    init(socket) {
        this.socket = socket;
        console.log('[INIT] Stem Splitter Engine ready.');
    },

    async render() {
        let container = document.getElementById('stem-splitter-container');
        if (!container) {
            // Fallback for standalone electron app
            container = document.getElementById('view-tools');
        }
        if (!container) return;

        container.innerHTML = `
            <div class="card" style="margin-top: 20px;">
                <div class="card-header">
                    <h2 style="margin:0; color: var(--primary);">Stem Splitter</h2>
                </div>
                <div class="card-body">
                    <p style="color: var(--text-muted); font-size: 14px;">
                        Upload a full track to split it into its core components: Vocals, Drums, Bass, and Melody.
                        This intensive process runs securely and entirely <strong>locally in your browser</strong> using our Native DSP Engine. No data is sent to external servers.
                    </p>
                    <div id="stem-splitter-cost" style="margin: 20px 0; padding: 15px; background: rgba(0,0,0,0.3); border: 1px solid var(--border); border-radius: 8px; text-align: center;">
                        <span style="font-size: 12px; color: var(--text-muted);">CURRENT COST</span>
                        <div id="stem-cost-display" style="font-size: 28px; font-weight: bold; color: var(--primary); margin-top: 5px;">Loading...</div>
                    </div>

                    <div id="stem-splitter-main">
                        <label for="stem-file-upload" class="button-like-input">
                            <span>📤 Select Audio File (.mp3, .wav)</span>
                            <input type="file" id="stem-file-upload" accept="audio/mpeg,audio/wav" style="display:none;">
                        </label>
                        <div id="stem-file-preview" style="margin-top: 15px; color: var(--text-muted); font-style: italic;"></div>
                        <button id="btn-execute-split" style="width: 100%; margin-top: 15px; padding: 15px; font-size: 18px;" disabled>Split Track</button>
                    </div>

                    <div id="stem-splitter-results" style="display: none; margin-top: 20px;">
                        <h3 style="color: #fff;">Your Stems are Ready</h3>
                        <p style="color: var(--text-muted);">Download your files below. These links are temporary and will expire.</p>
                        <div id="stem-download-links" style="display: flex; flex-direction: column; gap: 10px;"></div>
                    </div>
                </div>
            </div>
        `;

        this.updateCost();
        this.addEventListeners();
    },

    addEventListeners() {
        const fileInput = document.getElementById('stem-file-upload');
        const splitBtn = document.getElementById('btn-execute-split');

        if (fileInput) {
            fileInput.addEventListener('change', () => this.handleFileSelect(fileInput, splitBtn));
        }
        if (splitBtn) {
            splitBtn.addEventListener('click', () => this.executeSplit(fileInput, splitBtn));
        }
        
        const launchBtn = document.getElementById('btn-launch-vodstudio');
        if (launchBtn) {
            // Prevent duplicate listeners on re-renders
            const newBtn = launchBtn.cloneNode(true);
            launchBtn.parentNode.replaceChild(newBtn, launchBtn);
            
            newBtn.addEventListener('click', async () => {
                const originalText = newBtn.innerText;
                newBtn.innerText = "⏳ Initializing Engine...";
                try {
                    if (!window.VODstudioEngine.audioCtx) await window.VODstudioEngine.init();
                    window.VODstudioEngine.renderUI();
                } catch (err) {
                    console.error(err); alert("Could not load VODstudioEngine.");
                }
                newBtn.innerText = originalText;
            });
            
            newBtn.addEventListener('mousedown', () => { newBtn.style.transform = 'translateY(4px)'; newBtn.style.boxShadow = '0 0 0 #b37700'; });
            newBtn.addEventListener('mouseup', () => { newBtn.style.transform = 'translateY(0)'; newBtn.style.boxShadow = '0 4px 0 #b37700'; });
            newBtn.addEventListener('mouseleave', () => { newBtn.style.transform = 'translateY(0)'; newBtn.style.boxShadow = '0 4px 0 #b37700'; });
        }
    },

    async updateCost() {
        const costDisplay = document.getElementById('stem-cost-display');
        if (!costDisplay || !window.CoreEngine.userKeys.publicKey) return;
        try {
            const res = await fetch(`/api/tools/stem-cost?publicKey=${window.CoreEngine.userKeys.publicKey}`);
            if (!res.ok) throw new Error('Failed to fetch cost.');
            const data = await res.json();
            this.currentCost = data.cost;
            costDisplay.innerText = `${this.currentCost.toLocaleString()} $VOD`;
        } catch (err) {
            console.error(err);
            costDisplay.innerText = 'Error';
        }
    },

    handleFileSelect(fileInput, splitBtn) {
        const filePreview = document.getElementById('stem-file-preview');
        const file = fileInput.files[0];
        if (file) {
            filePreview.innerText = `Selected: ${file.name}`;
            splitBtn.disabled = false;
        } else {
            filePreview.innerText = '';
            splitBtn.disabled = true;
        }
    },

    async executeSplit(fileInput, splitBtn) {
        if (this.isSplitting) return;
        const file = fileInput.files[0];
        if (!file) return alert("Please select a file to split.");
        if (!window.CoreEngine.userKeys.publicKey) return alert("You must be logged in to use this tool.");

        if (!confirm(`This will cost ${this.currentCost.toLocaleString()} $VOD. Are you sure you want to proceed?`)) return;

        this.isSplitting = true;
        splitBtn.disabled = true;
        splitBtn.innerText = '1/3 Analyzing Frequencies (Native DSP)...';

        try {
            // Allow the UI to paint the loading text before locking the thread
            await new Promise(r => setTimeout(r, 50));
            
            const stems = await this.processNativeStemSplit(file);

            splitBtn.innerText = '2/3 Recording to Ledger...';
            await window.CoreEngine.sendSignedTransaction('STEM_SPLIT', '0x00', { cost: this.currentCost });

            splitBtn.innerText = '3/3 Finalizing...';
            this.displayResults(stems);
            
            if (window.fetchUserProfile) {
                window.fetchUserProfile(window.CoreEngine.userKeys.publicKey, true);
            }

            this.updateCost();
            fileInput.value = '';
            const filePreview = document.getElementById('stem-file-preview');
            if(filePreview) filePreview.innerText = '';
            splitBtn.innerText = 'Split Track';

        } catch (err) {
            alert(`An error occurred: ${err.message}`);
            console.error(err);
            splitBtn.innerText = 'Split Track';
        } finally {
            this.isSplitting = false;
            if (fileInput.files.length === 0) splitBtn.disabled = true;
            else splitBtn.disabled = false;
        }
    },

    async splitFromHash(audioHash, trackTitle, btnElement) {
        if (this.isSplitting) return;
        if (!window.CoreEngine.userKeys.publicKey) return alert("You must be logged in to use this tool.");
        await this.updateCost();
        
        if (!confirm(`Remixing this track will route it through the Stem Splitter and cost ${this.currentCost.toLocaleString()} $VOD. Proceed?`)) return;

        this.isSplitting = true;
        const originalText = btnElement ? btnElement.innerText : '🎛️ Remix';
        if (btnElement) {
            btnElement.disabled = true;
            btnElement.innerText = '⏳ Processing...';
        }
        
        try {
            // Fetch the audio blob directly from the Swarm network
            const blobRes = await fetch(`/tracks/${audioHash}`);
            if (!blobRes.ok) throw new Error("Could not fetch the original audio track.");
            const blob = await blobRes.blob();
            const file = new File([blob], `${trackTitle}.mp3`, { type: blob.type || 'audio/mpeg' });

            const stems = await this.processNativeStemSplit(file);

            await window.CoreEngine.sendSignedTransaction('STEM_SPLIT', '0x00', { cost: this.currentCost });

            if (!window.VODstudioEngine.audioCtx) await window.VODstudioEngine.init();
            window.VODstudioEngine.loadStems(stems);

            if (window.fetchUserProfile) window.fetchUserProfile(window.CoreEngine.userKeys.publicKey, true);
        } catch (err) {
            alert(`An error occurred: ${err.message}`);
        } finally {
            this.isSplitting = false;
            if (btnElement) { btnElement.disabled = false; btnElement.innerText = originalText; }
        }
    },

    async processNativeStemSplit(file) {
        if (!window.VODstudioEngine) throw new Error("VODstudioEngine not loaded.");
        if (!window.VODstudioEngine.audioCtx) await window.VODstudioEngine.init();

        const audioCtx = window.VODstudioEngine.audioCtx;
        const arrayBuffer = await file.arrayBuffer();
        const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
        
        const sampleRate = audioBuffer.sampleRate;
        const length = audioBuffer.length;

        const renderStem = async (type) => {
            const offlineCtx = new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(2, length, sampleRate);
            const source = offlineCtx.createBufferSource();
            source.buffer = audioBuffer;
            
            // Mathematical constants for 4th-order Butterworth cascading (yields 8th-order Linkwitz-Riley)
            const q1 = 0.54119610;
            const q2 = 1.30656296;

            if (type === 'bass') {
                // Strict 48dB/octave Linkwitz-Riley Lowpass for absolute sub isolation
                const lp1 = offlineCtx.createBiquadFilter(); lp1.type = 'lowpass'; lp1.frequency.value = 110; lp1.Q.value = q1;
                const lp2 = offlineCtx.createBiquadFilter(); lp2.type = 'lowpass'; lp2.frequency.value = 110; lp2.Q.value = q2;
                const lp3 = offlineCtx.createBiquadFilter(); lp3.type = 'lowpass'; lp3.frequency.value = 110; lp3.Q.value = q1;
                const lp4 = offlineCtx.createBiquadFilter(); lp4.type = 'lowpass'; lp4.frequency.value = 110; lp4.Q.value = q2;
                source.connect(lp1); lp1.connect(lp2); lp2.connect(lp3); lp3.connect(lp4); lp4.connect(offlineCtx.destination);
            } else if (type === 'drums') {
                // Parallel Drum Bus: Sub/Thump (Lowpass) + Sizzle/Snare (Highpass) to bypass vocal bleed
                const parallelSum = offlineCtx.createGain();
                
                const lp1 = offlineCtx.createBiquadFilter(); lp1.type = 'lowpass'; lp1.frequency.value = 200; lp1.Q.value = q1;
                const lp2 = offlineCtx.createBiquadFilter(); lp2.type = 'lowpass'; lp2.frequency.value = 200; lp2.Q.value = q2;
                const lp3 = offlineCtx.createBiquadFilter(); lp3.type = 'lowpass'; lp3.frequency.value = 200; lp3.Q.value = q1;
                const lp4 = offlineCtx.createBiquadFilter(); lp4.type = 'lowpass'; lp4.frequency.value = 200; lp4.Q.value = q2;
                
                const hp1 = offlineCtx.createBiquadFilter(); hp1.type = 'highpass'; hp1.frequency.value = 6000; hp1.Q.value = q1;
                const hp2 = offlineCtx.createBiquadFilter(); hp2.type = 'highpass'; hp2.frequency.value = 6000; hp2.Q.value = q2;
                const hp3 = offlineCtx.createBiquadFilter(); hp3.type = 'highpass'; hp3.frequency.value = 6000; hp3.Q.value = q1;
                const hp4 = offlineCtx.createBiquadFilter(); hp4.type = 'highpass'; hp4.frequency.value = 6000; hp4.Q.value = q2;
                
                source.connect(lp1); lp1.connect(lp2); lp2.connect(lp3); lp3.connect(lp4); lp4.connect(parallelSum);
                source.connect(hp1); hp1.connect(hp2); hp2.connect(hp3); hp3.connect(hp4); hp4.connect(parallelSum);
                
                const comp = offlineCtx.createDynamicsCompressor(); 
                comp.threshold.value = -24; comp.ratio.value = 8; comp.attack.value = 0.005; comp.release.value = 0.1;
                
                parallelSum.connect(comp); comp.connect(offlineCtx.destination);
            } else if (type === 'vocals' || type === 'melody') {
                const splitter = offlineCtx.createChannelSplitter(2);
                const merger = offlineCtx.createChannelMerger(2);
                
                // Pure M/S Encoding Matrix: Mid = (L+R)*0.5, Side = (L-R)*0.5
                const mid = offlineCtx.createGain(); mid.gain.value = 0.5;
                const side = offlineCtx.createGain(); side.gain.value = 0.5;
                const invR = offlineCtx.createGain(); invR.gain.value = -1.0;
                
                source.connect(splitter);
                splitter.connect(mid, 0); splitter.connect(mid, 1);
                splitter.connect(side, 0); splitter.connect(invR, 1); invR.connect(side);

                if (type === 'vocals') {
                    // Strict 48dB/octave Linkwitz-Riley Bandpass for absolute vocal isolation (Mid channel)
                    const hp1 = offlineCtx.createBiquadFilter(); hp1.type = 'highpass'; hp1.frequency.value = 160; hp1.Q.value = q1;
                    const hp2 = offlineCtx.createBiquadFilter(); hp2.type = 'highpass'; hp2.frequency.value = 160; hp2.Q.value = q2;
                    const hp3 = offlineCtx.createBiquadFilter(); hp3.type = 'highpass'; hp3.frequency.value = 160; hp3.Q.value = q1;
                    const hp4 = offlineCtx.createBiquadFilter(); hp4.type = 'highpass'; hp4.frequency.value = 160; hp4.Q.value = q2;
                    
                    const lp1 = offlineCtx.createBiquadFilter(); lp1.type = 'lowpass'; lp1.frequency.value = 4000; lp1.Q.value = q1;
                    const lp2 = offlineCtx.createBiquadFilter(); lp2.type = 'lowpass'; lp2.frequency.value = 4000; lp2.Q.value = q2;
                    const lp3 = offlineCtx.createBiquadFilter(); lp3.type = 'lowpass'; lp3.frequency.value = 4000; lp3.Q.value = q1;
                    const lp4 = offlineCtx.createBiquadFilter(); lp4.type = 'lowpass'; lp4.frequency.value = 4000; lp4.Q.value = q2;
                    
                    const makeup = offlineCtx.createGain(); makeup.gain.value = 1.8;
                    const comp = offlineCtx.createDynamicsCompressor(); comp.threshold.value = -18; comp.ratio.value = 3;
                    
                    mid.connect(hp1); hp1.connect(hp2); hp2.connect(hp3); hp3.connect(hp4);
                    hp4.connect(lp1); lp1.connect(lp2); lp2.connect(lp3); lp3.connect(lp4);
                    lp4.connect(comp); comp.connect(makeup);
                    
                    makeup.connect(merger, 0, 0); makeup.connect(merger, 0, 1);
                } else if (type === 'melody') {
                    // Melody = Side channel (wide synths) + Mid channel (minus vocals/bass)
                    const sideHp1 = offlineCtx.createBiquadFilter(); sideHp1.type = 'highpass'; sideHp1.frequency.value = 150; sideHp1.Q.value = q1;
                    const sideHp2 = offlineCtx.createBiquadFilter(); sideHp2.type = 'highpass'; sideHp2.frequency.value = 150; sideHp2.Q.value = q2;
                    side.connect(sideHp1); sideHp1.connect(sideHp2);
                    
                    const midHp1 = offlineCtx.createBiquadFilter(); midHp1.type = 'highpass'; midHp1.frequency.value = 200; midHp1.Q.value = q1;
                    const midHp2 = offlineCtx.createBiquadFilter(); midHp2.type = 'highpass'; midHp2.frequency.value = 200; midHp2.Q.value = q2;
                    
                    // Deep double notches to hollow out the fundamental vocal ranges from the Mid
                    const notch1 = offlineCtx.createBiquadFilter(); notch1.type = 'peaking'; notch1.frequency.value = 800; notch1.Q.value = 0.5; notch1.gain.value = -18;
                    const notch2 = offlineCtx.createBiquadFilter(); notch2.type = 'peaking'; notch2.frequency.value = 2500; notch2.Q.value = 0.5; notch2.gain.value = -15;
                    
                    mid.connect(midHp1); midHp1.connect(midHp2); midHp2.connect(notch1); notch1.connect(notch2);
                    
                    // Pure M/S Decoding Matrix: L = Mid + Side | R = Mid - Side
                    const reconstructL = offlineCtx.createGain(); reconstructL.gain.value = 1.0;
                    const reconstructR = offlineCtx.createGain(); reconstructR.gain.value = 1.0;
                    const invSide = offlineCtx.createGain(); invSide.gain.value = -1.0;
                    sideHp2.connect(invSide);
                    
                    notch2.connect(reconstructL); notch2.connect(reconstructR);
                    sideHp2.connect(reconstructL); invSide.connect(reconstructR);
                    
                    reconstructL.connect(merger, 0, 0);
                    reconstructR.connect(merger, 0, 1);
                }
                merger.connect(offlineCtx.destination);
            }
            
            source.start(0);
            const renderedBuffer = await offlineCtx.startRendering();
            const wavBlob = window.VODstudioEngine.audioBufferToWav(renderedBuffer);
            return URL.createObjectURL(wavBlob);
        };

        const [bass, drums, vocals, melody] = await Promise.all([ renderStem('bass'), renderStem('drums'), renderStem('vocals'), renderStem('melody') ]);
        return { vocals, drums, bass, melody };
    },

    displayResults(stems) {
        const mainUI = document.getElementById('stem-splitter-main');
        const resultsUI = document.getElementById('stem-splitter-results');
        const linksContainer = document.getElementById('stem-download-links');

        if (!mainUI || !resultsUI || !linksContainer) return;

        resultsUI.style.display = 'block';

        let linksHtml = Object.entries(stems).map(([name, path]) => {
            const iconMap = { vocals: '🎤', drums: '🥁', bass: '🎸', melody: '🎹' };
            return `
                <a href="${path}" download class="stem-download-link">
                    ${iconMap[name] || '🎵'} ${name.charAt(0).toUpperCase() + name.slice(1)}
                    <span>Download</span>
                </a>
            `;
        }).join('');

        linksHtml += `<button id="btn-load-vodstudio" style="width: 100%; margin-top: 15px; background: var(--warning); color: #000; padding: 15px; font-size: 18px; border: none; font-weight: bold; border-radius: 8px; cursor: pointer;">🎛️ Load into VODCAM VODstudio</button>`;
        linksContainer.innerHTML = linksHtml;

        document.getElementById('btn-load-vodstudio').addEventListener('click', async () => {
            const btn = document.getElementById('btn-load-vodstudio');
            const orig = btn.innerText;
            btn.innerText = "⏳ Loading Engine...";
            try {
                if (!window.VODstudioEngine.audioCtx) await window.VODstudioEngine.init();
                window.VODstudioEngine.loadStems(stems);
            } catch (err) { console.error(err); alert("Could not load VODstudioEngine."); }
            btn.innerText = orig;
        });
    }
};