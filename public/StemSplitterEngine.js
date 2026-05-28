window.StemSplitterEngine = {
    socket: null,
    currentCost: 100000,
    isSplitting: false,

    init(socket) {
        this.socket = socket;
        console.log('[INIT] Stem Splitter Engine ready.');
    },

    async render() {
        const container = document.getElementById('view-tools');
        if (!container) return;

        container.innerHTML = `
            <div class="card">
                <div class="card-header">
                    <h2 style="margin:0; color: var(--primary);">AI Stem Splitter</h2>
                </div>
                <div class="card-body">
                    <p style="color: var(--text-muted); font-size: 14px;">
                        Upload a full track to split it into its core components: Vocals, Drums, Bass, and Melody.
                        This is a computationally expensive process on the network.
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
        splitBtn.innerText = '1/3 Uploading & Processing...';

        try {
            const formData = new FormData();
            formData.append('track', file);

            const res = await fetch('/api/tools/split-stem', {
                method: 'POST',
                body: formData
            });

            if (!res.ok) {
                const errData = await res.json();
                throw new Error(errData.error || 'Stem splitting failed on the server.');
            }

            const result = await res.json();

            splitBtn.innerText = '2/3 Recording to Ledger...';
            await window.CoreEngine.sendSignedTransaction('STEM_SPLIT', '0x00', { cost: this.currentCost });

            splitBtn.innerText = '3/3 Finalizing...';
            this.displayResults(result.stems);
            
            if (window.fetchUserProfile) {
                window.fetchUserProfile(window.CoreEngine.userKeys.publicKey, true);
            }

        } catch (err) {
            alert(`An error occurred: ${err.message}`);
            console.error(err);
        } finally {
            this.isSplitting = false;
            splitBtn.innerText = 'Split Another Track';
            splitBtn.disabled = false;
            const mainUI = document.getElementById('stem-splitter-main');
            if(mainUI) mainUI.style.display = 'block';
            fileInput.value = '';
            const filePreview = document.getElementById('stem-file-preview');
            if(filePreview) filePreview.innerText = '';
            this.updateCost();
        }
    },

    displayResults(stems) {
        const mainUI = document.getElementById('stem-splitter-main');
        const resultsUI = document.getElementById('stem-splitter-results');
        const linksContainer = document.getElementById('stem-download-links');

        if (!mainUI || !resultsUI || !linksContainer) return;

        mainUI.style.display = 'none';
        resultsUI.style.display = 'block';

        linksContainer.innerHTML = Object.entries(stems).map(([name, path]) => {
            const iconMap = { vocals: '🎤', drums: '🥁', bass: '🎸', melody: '🎹' };
            return `
                <a href="${path}" download class="stem-download-link">
                    ${iconMap[name] || '🎵'} ${name.charAt(0).toUpperCase() + name.slice(1)}
                    <span>Download</span>
                </a>
            `;
        }).join('');
    }
};