/**
 * @file [`app.js`](app.js:1)
 * @description Application logic for the Gemini Live Voice Studio.
 *
 * Architecture
 * ------------
 * [`config.js`](config.js:1) holds ONE shared configuration (API key, model, voice,
 * endpoint, sample rate). Both workflows — Text to Speech and Live Voice Query —
 * run on the same `gemini-3.8-live` model, so they intentionally share a single
 * WebSocket session and a single configuration block.
 *
 * Responsibilities
 * ----------------
 * - Session lifecycle: connect / reconnect / disconnect with API version fallback.
 * - Mode handling: switches the prompt semantics, presets and system instruction.
 * - Audio engine: PCM decoding, master buffer compilation, play / pause / stop / seek.
 * - Diagnostics: structured logging, latency + chunk statistics, log export.
 */

'use strict';

const $ = (id) => document.getElementById(id);

/* ==========================================================================
   Element References
   ========================================================================== */
const elements = {
    apiKey: $('apiKey'),
    saveKey: $('saveKey'),
    modelId: $('modelId'),
    voiceName: $('voiceName'),
    connectBtn: $('connectBtn'),
    disconnectBtn: $('disconnectBtn'),
    statusBox: $('statusBox'),
    connectionBadge: $('connectionBadge'),
    modeSwitch: $('modeSwitch'),
    modeCardTitle: $('modeCardTitle'),
    promptLabel: $('promptLabel'),
    textInput: $('textInput'),
    speakBtn: $('speakBtn'),
    playAudioBtn: $('playAudioBtn'),
    pauseAudioBtn: $('pauseAudioBtn'),
    stopAudioBtn: $('stopAudioBtn'),
    downloadWavBtn: $('downloadWavBtn'),
    seekContainer: $('seekContainer'),
    seekSlider: $('seekSlider'),
    currentTimeDisplay: $('currentTimeDisplay'),
    totalDurationDisplay: $('totalDurationDisplay'),
    resultBox: $('resultBox'),
    transcriptBox: $('transcriptBox'),
    presetChips: $('presetChips'),
    visualizer: $('visualizer'),
    logs: $('logs'),
    clearLogs: $('clearLogs'),
    exportLogs: $('exportLogs'),
    themeToggle: $('themeToggle'),
    statLatency: $('statLatency'),
    statChunks: $('statChunks'),
    statDuration: $('statDuration'),
    clearInputBtn: $('clearInputBtn'),
    micBtn: $('micBtn'),
    sidebarToggleBtn: $('sidebarToggleBtn'),
    sidebarCloseBtn: $('sidebarCloseBtn'),
    sidebar: $('sidebar'),
    sidebarOverlay: $('sidebarOverlay'),
    maxTokensSlider: $('maxTokensSlider'),
    maxTokensVal: $('maxTokensVal'),
    /* Image Upload Elements */
    imageUploadSection: $('imageUploadSection'),
    dropHint: $('dropHint'),
    imageUploadInput: $('imageUploadInput'),
    imageUploadBtn: $('imageUploadBtn'),
    imagePreviewContainer: $('imagePreviewContainer'),
    imagePreview: $('imagePreview'),
    removeImageBtn: $('removeImageBtn'),
    /* Real-Time Voice Bot Elements */
    voiceChatContainer: $('voiceChatContainer'),
    textWorkflowContainer: $('textWorkflowContainer'),
    voiceBotStateBadge: $('voiceBotStateBadge'),
    voiceBotStateText: $('voiceBotStateText'),
    stateDot: $('stateDot'),
    audioLevelFill: $('audioLevelFill'),
    voiceOrbWrapper: $('voiceOrbWrapper'),
    voiceOrbHalo: $('voiceOrbHalo'),
    voiceOrbCanvas: $('voiceOrbCanvas'),
    voiceOrbSubtext: $('voiceOrbSubtext'),
    startVoiceChatBtn: $('startVoiceChatBtn'),
    startVoiceChatBtnText: $('startVoiceChatBtnText'),
    muteMicBtn: $('muteMicBtn'),
    muteMicBtnIcon: $('muteMicBtnIcon'),
    muteMicBtnText: $('muteMicBtnText'),
    interruptBtn: $('interruptBtn'),
    voiceDialogueBox: $('voiceDialogueBox'),
    dialoguePlaceholder: $('dialoguePlaceholder'),
    clearDialogueBtn: $('clearDialogueBtn'),
    voicePresetChips: $('voicePresetChips'),
    micSensitivitySelect: $('micSensitivitySelect'),
    /* Live Voice Query Captions Elements */
    liveQueryCaptionsPanel: $('liveQueryCaptionsPanel'),
    liveQueryDialogueBox: $('liveQueryDialogueBox'),
    liveQueryPlaceholder: $('liveQueryPlaceholder'),
    clearLiveQueryDialogueBtn: $('clearLiveQueryDialogueBtn'),
    ttsTranscriptContainer: $('ttsTranscriptContainer')
};

/* ==========================================================================
   Application State
   ========================================================================== */
const state = {
    ws: null,
    audioCtx: null,
    analyser: null,

    isConnected: false,
    isGenerating: false,
    isSpeaking: false,

    sessionCounter: 0,
    connectTimeout: null,
    connectionAttempts: 0,
    activeApiVersion: null,

    chunkCount: 0,
    totalAudioDuration: 0,
    connectionStartTime: 0,

    /* Audio playback state */
    recordedAudioBuffers: [],
    masterAudioBuffer: null,
    currentSourceNode: null,
    isPlaying: false,
    isPaused: false,
    startedAt: 0,
    pausedAt: 0,
    playbackTimer: null,

    /* Live-streaming state (used by the Live Voice Query workflow) */
    streamNodes: [],
    streamNextStartTime: 0,
    streamStartedAt: 0,
    isStreaming: false,

    /* Workflow state */
    mode: GEMINI_CONFIG.defaultMode,
    transcriptParts: [],
    turnComplete: false,
    currentCaptionAbortController: null,

    /* Real-Time Voice-to-Voice AI Chatbot state */
    voiceChat: {
        isActive: false,
        isMuted: false,
        pendingActivation: false,
        botState: 'ready', // 'ready' | 'connecting' | 'listening' | 'user-speaking' | 'thinking' | 'ai-speaking' | 'interrupted' | 'muted' | 'disconnected'
        micStream: null,
        micAudioCtx: null,
        micSource: null,
        micProcessor: null,
        micAnalyser: null,
        micDataArray: null,
        speechRecognition: null,
        aiAudioScheduledEndTime: 0,
        activeAiAudioNodes: [],
        currentAiBubble: null,
        currentAiText: '',
        currentUserBubble: null,
        currentUserText: '',
        currentTurnUserText: '',
        lastInterimText: '',
        vadThreshold: GEMINI_CONFIG.voiceChatConfig?.vadThreshold || 0.05,
        noiseFloor: 0.02,
        sensitivityMode: 'smart',
        consecutiveSpeechFrames: 0,
        consecutiveSilenceFrames: 0,
        hasSpokenInTurn: false,
        lastCapturedSpeech: '',
        lastVADTimestamp: 0,
        interruptionDebounce: 0,
        silenceTimer: null,
        thinkingWatchdog: null,
        isSpeechRecognitionSuppressed: false,
        lastAiSpeechEndTime: 0,
        suppressUserTranscriptionUntil: 0,
        recentAiTexts: []
    },

    /* Live Voice Query Dialogue State */
    liveQuery: {
        currentAiBubble: null,
        currentAiText: ''
    },

    /* Image state */
    uploadedImage: null  // { dataURL: string, mimeType: string }
};

/* ==========================================================================
   Logging & Status
   ========================================================================== */
function logMessage(message, data) {
    const timestamp = new Date().toLocaleTimeString();
    let formatted = `[${timestamp}] ${message}`;
    if (data !== undefined) {
        formatted += '\n' + (typeof data === 'string' ? data : JSON.stringify(data, null, 2));
    }
    elements.logs.textContent += formatted + '\n\n';
    elements.logs.scrollTop = elements.logs.scrollHeight;
    console.log(formatted);
}

function updateStatus(message, isError = false) {
    elements.statusBox.textContent = `Status: ${message}`;
    elements.statusBox.style.borderColor = isError ? 'var(--danger)' : 'var(--border-color)';
    logMessage(`STATUS: ${message}`);
}

function setConnectionState(connected) {
    state.isConnected = connected;
    elements.connectBtn.disabled = connected;
    elements.disconnectBtn.disabled = !connected;
    elements.speakBtn.disabled = !connected || state.isGenerating;

    if (connected) {
        elements.connectionBadge.textContent = 'Connected';
        elements.connectionBadge.className = 'badge connected';
    } else {
        elements.connectionBadge.textContent = 'Disconnected';
        elements.connectionBadge.className = 'badge disconnected';
    }
}

function formatTime(seconds) {
    if (isNaN(seconds) || seconds < 0) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
}

/* ==========================================================================
   Mode Handling — TTS and Live Query share ONE configuration
   ========================================================================== */
function getActiveMode() {
    return GEMINI_CONFIG.modes[state.mode] || GEMINI_CONFIG.modes[GEMINI_CONFIG.defaultMode];
}

/**
 * True when the active workflow plays audio as it streams in, instead of
 * buffering the whole turn first. Driven by the shared configuration.
 */
function isStreamingMode() {
    return getActiveMode().streaming === true;
}

/**
 * Shows or hides the transport controls that only make sense for a finished,
 * seekable clip. A live stream has no finished clip, so the seek bar and the
 * download button are hidden in Live Voice Query mode.
 */
function applyModeControlVisibility() {
    const streaming = isStreamingMode();

    elements.downloadWavBtn.style.display = streaming ? 'none' : '';
    elements.seekContainer.style.display = streaming ? 'none' : '';

    if (streaming) {
        // A hidden control must never stay enabled in the DOM.
        elements.downloadWavBtn.disabled = true;
        elements.seekSlider.disabled = true;
        // A live stream has no finished clip, so it cannot be replayed.
        elements.playAudioBtn.disabled = true;
    }
}

function setMode(modeId) {
    if (!GEMINI_CONFIG.modes[modeId] || modeId === state.mode) return;

    // If switching away from voiceChat while an active call is running, end call
    if (state.mode === 'voiceChat' && state.voiceChat.isActive) {
        endVoiceChat();
    }

    state.mode = modeId;
    const mode = getActiveMode();
    localStorage.setItem(GEMINI_CONFIG.modeStorageKey, modeId);
    state.uploadedImage = null;  // Clear image when switching modes

    elements.modeCardTitle.textContent = mode.cardTitle;
    elements.promptLabel.textContent = mode.promptLabel;
    elements.textInput.placeholder = mode.placeholder;
    elements.speakBtn.textContent = mode.buttonLabel;

    applyModeControlVisibility();

    // Toggle Voice Chat view vs Text/Image workflow view
    if (state.mode === 'voiceChat') {
        if (elements.voiceChatContainer) elements.voiceChatContainer.style.display = 'flex';
        if (elements.textWorkflowContainer) elements.textWorkflowContainer.style.display = 'none';
        if (elements.resultBox) elements.resultBox.style.display = 'none';
        renderVoicePresets(mode.presets);
    } else {
        if (elements.voiceChatContainer) elements.voiceChatContainer.style.display = 'none';
        if (elements.textWorkflowContainer) elements.textWorkflowContainer.style.display = 'block';
        if (elements.resultBox) elements.resultBox.style.display = 'block';

        // Show/hide image upload & Live Captions vs TTS Transcript based on mode
        if (state.mode === 'live') {
            if (elements.imageUploadSection) elements.imageUploadSection.style.display = 'block';
            if (elements.liveQueryCaptionsPanel) elements.liveQueryCaptionsPanel.style.display = 'block';
            if (elements.ttsTranscriptContainer) elements.ttsTranscriptContainer.style.display = 'none';
        } else {
            if (elements.imageUploadSection) elements.imageUploadSection.style.display = 'none';
            if (elements.liveQueryCaptionsPanel) elements.liveQueryCaptionsPanel.style.display = 'none';
            if (elements.ttsTranscriptContainer) elements.ttsTranscriptContainer.style.display = 'block';
        }
        renderPresets(mode.presets);
    }

    // Hide image preview and clear any uploaded image
    elements.imagePreviewContainer.style.display = 'none';
    elements.textInput.value = '';

    // Keep the tab strip in sync with the active workflow.
    document.querySelectorAll('.mode-tab').forEach((tab) => {
        tab.classList.toggle('active', tab.dataset.mode === state.mode);
    });

    logMessage(`Workflow mode switched to: ${mode.label}`);

    if (state.isConnected && state.mode !== 'voiceChat') {
        // The system instruction travels with the handshake, so the session is
        // re-established automatically to apply the new mode's instruction.
        updateStatus(`Mode switched to ${mode.label}. Reconnecting to apply the new system instruction...`);
        connectSession();
    }
}

function renderPresets(presets) {
    elements.presetChips.innerHTML = '';
    presets.forEach((preset) => {
        const chip = document.createElement('span');
        chip.className = 'chip';
        chip.textContent = preset.label;
        chip.title = preset.text;
        chip.addEventListener('click', () => {
            elements.textInput.value = preset.text;
            elements.textInput.focus();
            logMessage(`Loaded preset "${preset.label}" (${preset.text.length} chars).`);
        });
        elements.presetChips.appendChild(chip);
    });
}

/**
 * Builds the prompt payload for sending to Gemini.
 * Supports both text-only and image+text inputs.
 * @param {string} text - The text to send (can be empty if only sending image)
 * @returns {Object} The payload object for WebSocket send
 */
function buildPromptPayload(text) {
    const mode = getActiveMode();
    const finalText = mode.promptPrefix ? `${mode.promptPrefix}${text}` : text;

    const parts = [];

    // Add image if present (for Live Voice Query mode)
    if (state.uploadedImage) {
        // Convert dataURL to base64 (remove the data:image/...;base64, prefix)
        const base64Data = state.uploadedImage.dataURL.split(',')[1];
        parts.push({
            inlineData: {
                mimeType: state.uploadedImage.mimeType,
                data: base64Data
            }
        });
    }

    // Add text part
    if (finalText.trim()) {
        parts.push({ text: finalText.trim() });
    }

    return {
        clientContent: {
            turns: [
                {
                    role: 'user',
                    parts: parts
                }
            ],
            turnComplete: true
        }
    };
}

/* ==========================================================================
   Preferences: API Key, Theme, Voices
   ========================================================================== */
function loadPreferences() {
    const savedKey = localStorage.getItem(GEMINI_CONFIG.apiKeyStorageKey);
    if (savedKey) {
        elements.apiKey.value = savedKey;
        logMessage('Loaded saved Ustad API key from localStorage.');
    }

    const savedTheme = localStorage.getItem(GEMINI_CONFIG.themeStorageKey) || 'dark';
    document.documentElement.setAttribute('data-theme', savedTheme);

    const savedMode = localStorage.getItem(GEMINI_CONFIG.modeStorageKey);
    if (savedMode && GEMINI_CONFIG.modes[savedMode]) {
        state.mode = savedMode;
    }

    elements.modelId.value = GEMINI_CONFIG.modelLabel || GEMINI_CONFIG.model;

    // Populate the voice roster from the shared configuration
    elements.voiceName.innerHTML = '';
    GEMINI_CONFIG.voices.forEach((voice) => {
        const option = document.createElement('option');
        option.value = voice.id;
        option.textContent = `${voice.label} — ${voice.hint}`;
        elements.voiceName.appendChild(option);
    });
    elements.voiceName.value = GEMINI_CONFIG.defaultVoice;

    const mode = getActiveMode();
    elements.modeCardTitle.textContent = mode.cardTitle;
    elements.promptLabel.textContent = mode.promptLabel;
    elements.textInput.placeholder = mode.placeholder;
    applyModeControlVisibility();

    // Toggle Voice Chat view vs Text/Image workflow view
    if (state.mode === 'voiceChat') {
        if (elements.voiceChatContainer) elements.voiceChatContainer.style.display = 'flex';
        if (elements.textWorkflowContainer) elements.textWorkflowContainer.style.display = 'none';
        if (elements.resultBox) elements.resultBox.style.display = 'none';
        renderVoicePresets(mode.presets);
    } else {
        if (elements.voiceChatContainer) elements.voiceChatContainer.style.display = 'none';
        if (elements.textWorkflowContainer) elements.textWorkflowContainer.style.display = 'block';
        if (elements.resultBox) elements.resultBox.style.display = 'block';

        // Show image upload section and captions based on mode
        if (state.mode === 'live') {
            if (elements.imageUploadSection) elements.imageUploadSection.style.display = 'block';
            if (elements.liveQueryCaptionsPanel) elements.liveQueryCaptionsPanel.style.display = 'block';
            if (elements.ttsTranscriptContainer) elements.ttsTranscriptContainer.style.display = 'none';
        } else {
            if (elements.imageUploadSection) elements.imageUploadSection.style.display = 'none';
            if (elements.imagePreviewContainer) elements.imagePreviewContainer.style.display = 'none';
            if (elements.liveQueryCaptionsPanel) elements.liveQueryCaptionsPanel.style.display = 'none';
            if (elements.ttsTranscriptContainer) elements.ttsTranscriptContainer.style.display = 'block';
        }
        renderPresets(mode.presets);
    }

    document.querySelectorAll('.mode-tab').forEach((tab) => {
        tab.classList.toggle('active', tab.dataset.mode === state.mode);
    });

    const savedMaxTokens = localStorage.getItem(GEMINI_CONFIG.maxTokensStorageKey) || GEMINI_CONFIG.defaultMaxOutputTokens;
    if (elements.maxTokensSlider) {
        elements.maxTokensSlider.value = savedMaxTokens;
    }
    if (elements.maxTokensVal) {
        elements.maxTokensVal.textContent = savedMaxTokens;
    }
}

elements.saveKey.onclick = () => {
    const key = elements.apiKey.value.trim();
    if (key) {
        localStorage.setItem(GEMINI_CONFIG.apiKeyStorageKey, key);
        logMessage('API key saved to localStorage.');
        alert('API key saved successfully!');
    } else {
        localStorage.removeItem(GEMINI_CONFIG.apiKeyStorageKey);
        logMessage('API key removed from localStorage.');
    }
};

elements.themeToggle.onclick = () => {
    const current = document.documentElement.getAttribute('data-theme');
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem(GEMINI_CONFIG.themeStorageKey, next);
    logMessage(`Switched theme to ${next}.`);
};

document.querySelectorAll('.mode-tab').forEach((tab) => {
    tab.addEventListener('click', () => setMode(tab.dataset.mode));
});

/* ==========================================================================
   Sidebar & Settings Drawer Controls
   ========================================================================== */
function openSidebar() {
    if (elements.sidebar) elements.sidebar.classList.add('open');
    if (elements.sidebarOverlay) elements.sidebarOverlay.classList.add('open');
}

function closeSidebar() {
    if (elements.sidebar) elements.sidebar.classList.remove('open');
    if (elements.sidebarOverlay) elements.sidebarOverlay.classList.remove('open');
}

if (elements.sidebarToggleBtn) {
    elements.sidebarToggleBtn.onclick = openSidebar;
}

if (elements.sidebarCloseBtn) {
    elements.sidebarCloseBtn.onclick = closeSidebar;
}

if (elements.sidebarOverlay) {
    elements.sidebarOverlay.onclick = closeSidebar;
}

if (elements.maxTokensSlider) {
    elements.maxTokensSlider.oninput = (e) => {
        const val = e.target.value;
        if (elements.maxTokensVal) {
            elements.maxTokensVal.textContent = val;
        }
        localStorage.setItem(GEMINI_CONFIG.maxTokensStorageKey, val);
    };
}

/* ==========================================================================
   Image Upload Handling
   ========================================================================== */

/**
 * Shared image processing: validates the file, reads it as a data URL,
 * and updates the preview UI. Used by the file input, drag-and-drop,
 * and paste (Ctrl+V) handlers.
 */
function handleImageFile(file) {
    if (!file) return;

    if (!file.type.startsWith('image/')) {
        alert('Please select a valid image file (PNG, JPEG, etc.)');
        return;
    }

    const maxSizeMB = 10;
    if (file.size > maxSizeMB * 1024 * 1024) {
        alert(`Image too large. Maximum size is ${maxSizeMB}MB.`);
        return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
        state.uploadedImage = {
            dataURL: e.target.result,
            mimeType: file.type
        };
        elements.imagePreview.src = e.target.result;
        elements.imagePreviewContainer.style.display = 'flex';
        elements.imagePreview.style.display = 'block';
        elements.imageUploadSection?.classList.add('has-image');
        logMessage(`Image loaded: ${file.name} (${(file.size / 1024).toFixed(1)} KB, ${file.type})`);
    };
    reader.readAsDataURL(file);
}

elements.imageUploadBtn?.addEventListener('click', () => {
    elements.imageUploadInput?.click();
});

elements.imageUploadSection?.addEventListener('click', (e) => {
    // Allow clicking anywhere in the drop zone to open the file picker,
    // but ignore clicks on buttons inside it.
    if (e.target === elements.imageUploadSection || e.target === elements.dropHint) {
        elements.imageUploadInput?.click();
    }
});

elements.imageUploadInput?.addEventListener('change', (event) => {
    const file = event.target.files[0];
    handleImageFile(file);
    event.target.value = '';
});

/* --- Drag-and-Drop Support --- */
let dragCounter = 0;

elements.imageUploadSection?.addEventListener('dragenter', (e) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter++;
    elements.imageUploadSection.classList.add('drag-over');
});

elements.imageUploadSection?.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.stopPropagation();
});

elements.imageUploadSection?.addEventListener('dragleave', (e) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter--;
    if (dragCounter <= 0) {
        dragCounter = 0;
        elements.imageUploadSection.classList.remove('drag-over');
    }
});

elements.imageUploadSection?.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter = 0;
    elements.imageUploadSection.classList.remove('drag-over');

    const file = e.dataTransfer?.files?.[0];
    if (file) {
        handleImageFile(file);
    }
});

/* --- Paste (Ctrl+V) Support --- */
document.addEventListener('paste', async (e) => {
    // Only handle paste when the image upload section is visible (live mode)
    const isImageSectionVisible = elements.imageUploadSection?.style.display !== 'none' &&
        elements.imageUploadSection?.style.display !== '';
    if (!isImageSectionVisible) {
        return;
    }

    const clipboard = e.clipboardData || window.clipboardData;
    if (!clipboard) {
        logMessage('Clipboard API not available', true);
        return;
    }

    const items = clipboard.items;
    if (!items) return;

    let foundImage = false;

    // Log clipboard item types for debugging (visible in console)
    for (const item of items) {
        if (item.type.startsWith('image/')) {
            foundImage = true;
            logMessage(`Pasted image detected: ${item.type}`);
        }
    }

    if (!foundImage) {
        logMessage('No image found in clipboard items');
        return;
    }

    // Find the first image item
    for (const item of items) {
        if (item.type.startsWith('image/')) {
            e.preventDefault();
            try {
                const file = item.getAsFile();
                if (file) {
                    handleImageFile(file);
                    logMessage('Image pasted from clipboard successfully.');
                } else {
                    logMessage('Failed to convert clipboard item to file', true);
                }
            } catch (error) {
                logMessage(`Error processing image paste: ${error.message}`, true);
            }
            break;
        }
    }
});

elements.removeImageBtn?.addEventListener('click', () => {
    state.uploadedImage = null;
    elements.imagePreviewContainer.style.display = 'none';
    elements.imagePreview.src = '';
    elements.imageUploadInput.value = '';
    elements.imageUploadSection?.classList.remove('has-image');
    logMessage('Image removed.');
});

/* ==========================================================================
   WebSocket Session Lifecycle
   ========================================================================== */
function clearSessionTimeout() {
    if (state.connectTimeout) {
        clearTimeout(state.connectTimeout);
        state.connectTimeout = null;
    }
}

function buildSetupPayload() {
    const mode = getActiveMode();
    const maxTokens = parseInt(
        elements.maxTokensSlider
            ? elements.maxTokensSlider.value
            : (localStorage.getItem(GEMINI_CONFIG.maxTokensStorageKey) || GEMINI_CONFIG.defaultMaxOutputTokens),
        10
    );

    return {
        setup: {
            model: `models/${GEMINI_CONFIG.model}`,
            generationConfig: {
                responseModalities: ['AUDIO'],
                maxOutputTokens: maxTokens,
                speechConfig: {
                    voiceConfig: {
                        prebuiltVoiceConfig: {
                            voiceName: elements.voiceName.value
                        }
                    }
                }
            },
            systemInstruction: {
                parts: [{ text: mode.systemInstruction }]
            }
        }
    };
}

function ensureAudioContext() {
    if (!state.audioCtx) {
        const AudioCtor = window.AudioContext || window.webkitAudioContext;
        state.audioCtx = new AudioCtor({ sampleRate: GEMINI_CONFIG.sampleRate });
        state.analyser = state.audioCtx.createAnalyser();
        state.analyser.fftSize = 256;
        state.analyser.connect(state.audioCtx.destination);
    }
    if (state.audioCtx.state === 'suspended') {
        state.audioCtx.resume();
    }
    return state.audioCtx;
}

function connectSession() {
    const apiKey = elements.apiKey.value.trim();
    if (!apiKey) {
        alert('Please enter your Ustad API Key.');
        elements.apiKey.focus();
        return;
    }

    // Bump the session counter FIRST so the outgoing socket's `onclose`
    // handler is recognised as stale and cannot report a false disconnect.
    state.sessionCounter++;
    const currentSession = state.sessionCounter;

    if (state.ws) {
        const staleSocket = state.ws;
        state.ws = null;
        try {
            staleSocket.close();
        } catch (_) {
            /* ignore */
        }
    }

    clearSessionTimeout();
    // Drop the previous clip so a reconnect never leaves a stale buffer behind.
    state.recordedAudioBuffers = [];
    state.masterAudioBuffer = null;
    state.pausedAt = 0;
    state.isPaused = false;
    stopAudioPlayback();

    setConnectionState(false);
    state.isGenerating = false;
    state.connectionStartTime = performance.now();
    state.connectionAttempts = 0;
    updateStatus('Initializing AudioContext and WebSocket...');

    try {
        ensureAudioContext();

        const version = GEMINI_CONFIG.apiVersions[0];
        state.activeApiVersion = version;
        const url = buildLiveEndpoint(version, apiKey);

        logMessage(`Connecting to Ustad Live (${GEMINI_CONFIG.modelLabel || GEMINI_CONFIG.model})...`, {
            endpoint: url.replace(/key=.*/, 'key=***'),
            mode: getActiveMode().label
        });

        const socket = new WebSocket(url);
        state.ws = socket;
        let setupCompleteReceived = false;

        state.connectTimeout = setTimeout(() => {
            if (currentSession !== state.sessionCounter || setupCompleteReceived) return;
            logMessage(`TIMEOUT: setupComplete not received within ${GEMINI_CONFIG.handshakeTimeoutMs}ms on ${version}.`);
            try {
                socket.close();
            } catch (_) {
                /* ignore */
            }
            handleConnectionFailure(0, 'Handshake timed out.');
        }, GEMINI_CONFIG.handshakeTimeoutMs);

        socket.onopen = () => {
            if (currentSession !== state.sessionCounter) return;
            logMessage(`WebSocket open on ${version}. Sending setup payload...`);

            const setupPayload = buildSetupPayload();
            try {
                socket.send(JSON.stringify(setupPayload));
            } catch (err) {
                logMessage(`Setup send error: ${err.message}`);
            }
        };

        socket.onmessage = async (event) => {
            if (currentSession !== state.sessionCounter) return;

            try {
                const raw = event.data instanceof Blob ? await event.data.text() : event.data;
                const message = JSON.parse(raw);

                if (message.setupComplete) {
                    clearSessionTimeout();
                    setupCompleteReceived = true;
                    state.connectionAttempts = 0;
                    setConnectionState(true);

                    const latency = Math.round(performance.now() - state.connectionStartTime);
                    elements.statLatency.textContent = `${latency}ms`;
                    updateStatus(`Connected successfully (${GEMINI_CONFIG.modelLabel || GEMINI_CONFIG.model})`);
                    elements.resultBox.textContent = 'Session active. ' + getActiveMode().idleHint;
                    logMessage('Setup complete confirmed by server.');

                    if (state.mode === 'voiceChat' && state.voiceChat.pendingActivation) {
                        state.voiceChat.pendingActivation = false;
                        onVoiceChatConnected();
                    }
                    return;
                }

                handleServerMessage(message);
            } catch (err) {
                logMessage(`Message processing exception: ${err.message}`);
            }
        };

        socket.onerror = () => {
            if (currentSession !== state.sessionCounter) return;
            logMessage(`WebSocket error on ${version}.`);
            updateStatus('WebSocket error. Check network & API key.', true);
        };

        socket.onclose = (event) => {
            if (currentSession !== state.sessionCounter) return;
            clearSessionTimeout();

            if (state.voiceChat.isActive) {
                endVoiceChat();
            }

            if (setupCompleteReceived) {
                setConnectionState(false);
                state.isGenerating = false;
                state.activeApiVersion = null;
                logMessage(`WebSocket closed. Code: ${event.code}, Reason: ${event.reason || 'None'}`);
                updateStatus(`Disconnected (Code: ${event.code})`, event.code !== 1000);
            } else {
                handleConnectionFailure(currentSession, `Closed before setup (code ${event.code}).`);
            }
        };
    } catch (err) {
        clearSessionTimeout();
        logMessage(`Connection exception: ${err.message}`);
        updateStatus(`Connection failed: ${err.message}`, true);
    }
}

/**
 * Handles a failed handshake by retrying with the next API version, then with the
 * same version, up to `maxConnectionAttempts`.
 */
function handleConnectionFailure(currentSession, reason) {
    if (currentSession !== state.sessionCounter) return;

    state.connectionAttempts++;
    const maxAttempts = GEMINI_CONFIG.maxConnectionAttempts;

    if (state.connectionAttempts >= maxAttempts) {
        setConnectionState(false);
        state.isGenerating = false;
        state.activeApiVersion = null;
        logMessage(`Connection failed permanently after ${maxAttempts} attempts. ${reason}`);
        updateStatus('Connection failed. Verify API key, model access and network.', true);
        return;
    }

    // Rotate through the available API versions on each retry.
    const versions = GEMINI_CONFIG.apiVersions;
    const nextVersion = versions[state.connectionAttempts % versions.length];
    logMessage(`Retrying connection on ${nextVersion} (attempt ${state.connectionAttempts + 1}/${maxAttempts}).`);

    setTimeout(() => {
        if (currentSession !== state.sessionCounter) return;
        state.activeApiVersion = nextVersion;
        const apiKey = elements.apiKey.value.trim();
        const url = buildLiveEndpoint(nextVersion, apiKey);
        try {
            const socket = new WebSocket(url);
            state.ws = socket;
            let setupCompleteReceived = false;

            state.connectTimeout = setTimeout(() => {
                if (currentSession !== state.sessionCounter || setupCompleteReceived) return;
                try {
                    socket.close();
                } catch (_) {
                    /* ignore */
                }
                handleConnectionFailure(currentSession, 'Handshake timed out.');
            }, GEMINI_CONFIG.handshakeTimeoutMs);

            socket.onopen = () => {
                if (currentSession !== state.sessionCounter) return;
                try {
                    socket.send(JSON.stringify(buildSetupPayload()));
                } catch (err) {
                    logMessage(`Setup send error: ${err.message}`);
                }
            };

            socket.onmessage = async (event) => {
                if (currentSession !== state.sessionCounter) return;
                try {
                    const raw = event.data instanceof Blob ? await event.data.text() : event.data;
                    const message = JSON.parse(raw);
                    if (message.setupComplete) {
                        clearSessionTimeout();
                        setupCompleteReceived = true;
                        state.connectionAttempts = 0;
                        setConnectionState(true);
                        const latency = Math.round(performance.now() - state.connectionStartTime);
                        elements.statLatency.textContent = `${latency}ms`;
                        updateStatus(`Connected successfully (${GEMINI_CONFIG.modelLabel || GEMINI_CONFIG.model})`);
                        elements.resultBox.textContent = 'Session active. ' + getActiveMode().idleHint;
                        logMessage('Setup complete confirmed by server.');

                        if (state.mode === 'voiceChat' && state.voiceChat.pendingActivation) {
                            state.voiceChat.pendingActivation = false;
                            onVoiceChatConnected();
                        }
                        return;
                    }
                    handleServerMessage(message);
                } catch (err) {
                    logMessage(`Message processing exception: ${err.message}`);
                }
            };

            socket.onerror = () => {
                if (currentSession !== state.sessionCounter) return;
                logMessage(`WebSocket error on ${nextVersion}.`);
            };

            socket.onclose = (event) => {
                if (currentSession !== state.sessionCounter) return;
                clearSessionTimeout();

                if (state.voiceChat.isActive) {
                    endVoiceChat();
                }

                if (setupCompleteReceived) {
                    setConnectionState(false);
                    state.isGenerating = false;
                    state.activeApiVersion = null;
                    updateStatus(`Disconnected (Code: ${event.code})`, event.code !== 1000);
                } else {
                    handleConnectionFailure(currentSession, `Closed before setup (code ${event.code}).`);
                }
            };
        } catch (err) {
            logMessage(`Retry exception: ${err.message}`);
            handleConnectionFailure(currentSession, err.message);
        }
    }, 800);
}

function handleServerMessage(message) {
    const serverContent = message.serverContent;

    if (serverContent) {
        // --- Input (User) Audio Transcription ---
        // Fired when inputAudioTranscription is enabled in setup.
        // Routes to the correct dialogue panel per mode.
        const inputText = serverContent.inputTranscription?.text;
        if (inputText) {
            logMessage(`Input transcript: ${inputText}`);
            if (state.mode === 'voiceChat') {
                appendUserDialogue(inputText, true);
            }
            // (Live Voice Query mode uses typed text via speakBtn, not mic transcription)
        }

        // --- Output (Model) Audio Transcription ---
        // Fired when outputAudioTranscription is enabled in setup.
        // This is the text version of what Gemini just spoke — used for Live Captions.
        const outputText = serverContent.outputTranscription?.text;
        if (outputText) {
            logMessage(`Output transcript: ${outputText}`);
            if (state.mode === 'voiceChat') {
                appendAiDialogue(outputText);
            } else if (state.mode === 'live') {
                appendLiveQueryAiDialogue(outputText);
            }
            appendTranscript(outputText);
        }

        const parts = serverContent.modelTurn?.parts || [];

        for (const part of parts) {
            if (part.text) {
                // modelTurn text parts (non-audio transcription paths, e.g. text-only responses)
                logMessage(`Model text part: ${part.text}`);
                if (!outputText) {
                    // Only append if we haven't already shown an outputTranscription for this turn
                    if (state.mode === 'voiceChat') {
                        appendAiDialogue(part.text);
                    } else if (state.mode === 'live') {
                        appendLiveQueryAiDialogue(part.text);
                    }
                    appendTranscript(part.text);
                }
            }
            if (part.inlineData?.data) {
                state.chunkCount++;
                elements.statChunks.textContent = state.chunkCount;
                logMessage(`Received audio chunk #${state.chunkCount} (${part.inlineData.mimeType || 'audio/pcm'})`);
                try {
                    if (state.mode === 'voiceChat') {
                        processVoiceChatAudioChunk(part.inlineData.data);
                    } else {
                        processPCMChunk(part.inlineData.data);
                    }
                } catch (audioErr) {
                    logMessage(`Audio processing error: ${audioErr.message}`);
                }
            }
        }

        if (serverContent.turnComplete) {
            state.isGenerating = false;
            state.turnComplete = true;
            elements.speakBtn.disabled = !state.isConnected;

            if (state.mode === 'voiceChat') {
                logMessage('Voice turn complete.');
                if (state.voiceChat.activeAiAudioNodes.length === 0) {
                    setVoiceBotState('listening');
                    state.voiceChat.currentAiBubble = null;
                }
            } else if (state.mode === 'live') {
                state.liveQuery.currentAiBubble = null;
                state.liveQuery.currentAiText = '';
                elements.resultBox.textContent = 'Response complete. Audio streamed live.';
                logMessage('Response turn complete (streamed live).');
            } else if (isStreamingMode()) {
                // The audio was already played while it streamed in, so the turn
                // simply ends once the last chunk has been scheduled.
                elements.resultBox.textContent = 'Response complete. Audio streamed live.';
                logMessage('Response turn complete (streamed live).');
            } else {
                // Compile the full turn into a single buffer and start playback automatically.
                compileMasterAudioBuffer();
                if (state.masterAudioBuffer) {
                    startPlayback(0);
                    elements.resultBox.textContent = 'Speech generation finished. Playing automatically...';
                } else {
                    elements.resultBox.textContent = 'Generation finished. No audio data received.';
                }
                logMessage('Response turn complete.');
            }
        }

        if (serverContent.interrupted) {
            if (state.mode === 'voiceChat') {
                // In voiceChat mode, server-side interruptions are ignored.
                // The AI response must ONLY be interrupted by the user pressing the Interrupt button.
                // Ignoring server 'interrupted' events prevents false stops from echo / ambient noise.
                logMessage('Server sent interrupted signal — ignored (button-only interruption mode).');
            } else {
                stopAudioPlayback();
                if (state.mode === 'live') {
                    state.liveQuery.currentAiBubble = null;
                    state.liveQuery.currentAiText = '';
                }
                if (isStreamingMode()) {
                    state.recordedAudioBuffers = [];
                    state.masterAudioBuffer = null;
                    elements.currentTimeDisplay.textContent = '0:00';
                }
            }
            logMessage('Response interrupted.');
        }
    }

    if (message.goAway) {
        logMessage('Server requested session closure.', message.goAway);
        if (state.mode === 'voiceChat' && state.voiceChat.isActive) {
            endVoiceChat();
        }
    }
}

function appendTranscript(text) {
    state.transcriptParts.push(text);
    elements.transcriptBox.textContent = state.transcriptParts.join(' ');
    elements.transcriptBox.scrollTop = elements.transcriptBox.scrollHeight;
}

elements.connectBtn.onclick = connectSession;

elements.disconnectBtn.onclick = () => {
    if (state.mode === 'voiceChat' && state.voiceChat.isActive) {
        endVoiceChat();
    }
    clearSessionTimeout();
    state.sessionCounter++;
    const socket = state.ws;
    state.ws = null;
    stopAudioPlayback();
    state.isGenerating = false;
    state.activeApiVersion = null;
    setConnectionState(false);
    if (socket) {
        try {
            socket.close(1000, 'User disconnected');
        } catch (_) {
            /* ignore */
        }
    }
    updateStatus('Disconnected by user.');
    logMessage('Session terminated by user action.');
};

/* ==========================================================================
   Send Query / Generate Speech
   ========================================================================== */
elements.speakBtn.onclick = () => {
    const text = elements.textInput.value.trim();

    if (!state.isConnected || !state.ws || state.ws.readyState !== WebSocket.OPEN) {
        updateStatus('Error: Not connected to live session.', true);
        return;
    }
    if (!text && !state.uploadedImage) {
        alert('Please enter text or upload an image before sending.');
        elements.textInput.focus();
        return;
    }
    if (state.isGenerating) return;

    // Reset the previous clip so a new generation never overlaps the old one.
    stopAudioPlayback();
    state.recordedAudioBuffers = [];
    state.masterAudioBuffer = null;
    state.pausedAt = 0;
    state.isPaused = false;
    state.turnComplete = false;
    state.transcriptParts = [];
    state.streamNextStartTime = 0;
    elements.transcriptBox.textContent = '';
    resetPlayerUI();

    state.isGenerating = true;
    elements.speakBtn.disabled = true;
    elements.resultBox.textContent = getActiveMode().id === 'tts'
        ? 'Generating speech...'
        : 'Sending query to Ustad Live...';

    const infoMsg = state.uploadedImage
        ? `Sending request (${state.uploadedImage.dataURL.length} chars base64 image + ${text.length} chars text)`
        : text;
    logMessage(`Sending request in "${getActiveMode().label}" mode.${state.uploadedImage ? ' [Image attached]' : ''}`);

    try {
        if (state.mode === 'live' && text) {
            appendLiveQueryUserDialogue(text);
            // Stream real-time AI response captions in the Live Captions panel
            fetchAndStreamAiCaptions(text, 'live');
        }
        state.ws.send(JSON.stringify(buildPromptPayload(text)));
        logMessage('Payload sent successfully.');
    } catch (err) {
        state.isGenerating = false;
        elements.speakBtn.disabled = !state.isConnected;
        logMessage(`Send error: ${err.message}`);
        updateStatus(`Send error: ${err.message}`, true);
    }
};

function resetPlayerUI() {
    const streaming = isStreamingMode();

    elements.playAudioBtn.disabled = true;
    elements.pauseAudioBtn.disabled = true;
    elements.stopAudioBtn.disabled = true;
    elements.downloadWavBtn.disabled = true;
    elements.seekSlider.disabled = true;
    elements.seekSlider.value = 0;
    elements.currentTimeDisplay.textContent = '0:00';
    elements.totalDurationDisplay.textContent = '0:00';

    if (streaming) {
        // A live stream has no seek bar and no downloadable clip.
        elements.seekContainer.style.display = 'none';
        elements.downloadWavBtn.style.display = 'none';
    } else {
        elements.seekContainer.style.display = '';
        elements.downloadWavBtn.style.display = '';
    }
}

/* ==========================================================================
   Audio Engine — decode, compile, play, pause, stop, seek
   ========================================================================== */
function processPCMChunk(base64Data) {
    if (!state.audioCtx) return;

    const rawBinary = atob(base64Data);
    const sampleCount = Math.floor(rawBinary.length / 2);
    if (!sampleCount) return;

    const audioBuffer = state.audioCtx.createBuffer(1, sampleCount, GEMINI_CONFIG.sampleRate);
    const channelData = audioBuffer.getChannelData(0);

    for (let i = 0; i < sampleCount; i++) {
        let sample = rawBinary.charCodeAt(i * 2) | (rawBinary.charCodeAt(i * 2 + 1) << 8);
        if (sample >= 32768) sample -= 65536;
        channelData[i] = sample / 32768;
    }

    state.recordedAudioBuffers.push(audioBuffer);

    // Live Voice Query: schedule the chunk right away so the model starts
    // speaking without waiting for the complete turn to be generated.
    if (isStreamingMode()) {
        scheduleStreamChunk(audioBuffer);
        return;
    }

    // A chunk that arrives after the turn was already closed is folded into the
    // master buffer and playback restarts, so no audio is silently lost.
    if (state.turnComplete && state.masterAudioBuffer) {
        const shouldResume = state.isPlaying;
        const livePosition = shouldResume && state.audioCtx
            ? Math.max(0, state.audioCtx.currentTime - state.startedAt)
            : 0;

        compileMasterAudioBuffer();
        if (shouldResume) {
            startPlayback(livePosition);
        }
        logMessage(`Late audio chunk folded into the master buffer at ${livePosition.toFixed(2)}s.`);
    }
}

/**
 * Schedules a single PCM chunk for immediate playback.
 *
 * Chunks are queued back to back on the audio clock, so the model is heard
 * while it is still generating the rest of the answer. The queue is drained by
 * `state.streamNodes`; a chunk that has already been consumed is discarded.
 */
function scheduleStreamChunk(audioBuffer) {
    if (!state.audioCtx) return;

    // A suspended context means the user paused the stream, so it must stay
    // paused until they explicitly resume it.
    if (state.audioCtx.state === 'suspended' && !state.isPaused) {
        state.audioCtx.resume();
    }

    const sourceNode = state.audioCtx.createBufferSource();
    sourceNode.buffer = audioBuffer;
    sourceNode.connect(state.analyser);

    // The first chunk starts now, every later chunk starts exactly when the
    // previous one ends, which keeps the audio gapless.
    const now = state.audioCtx.currentTime;
    const startAt = Math.max(now, state.streamNextStartTime);

    sourceNode.start(startAt);
    state.streamNextStartTime = startAt + audioBuffer.duration;

    if (!state.isStreaming) {
        state.isStreaming = true;
        state.streamStartedAt = now;
        state.playbackTimer = setInterval(updateStreamClock, 100);
        elements.resultBox.textContent = 'Streaming response — speaking live...';
        elements.pauseAudioBtn.disabled = false;
        elements.stopAudioBtn.disabled = false;
        logMessage('Live streaming playback started.');
    }

    state.streamNodes.push(sourceNode);
    sourceNode.onended = () => {
        const index = state.streamNodes.indexOf(sourceNode);
        if (index !== -1) state.streamNodes.splice(index, 1);

        // The last chunk finished playing, so the live clock can stop.
        if (state.streamNodes.length === 0 && state.turnComplete) {
            if (state.playbackTimer) {
                clearInterval(state.playbackTimer);
                state.playbackTimer = null;
            }
            state.isStreaming = false;
            elements.pauseAudioBtn.disabled = true;
            elements.stopAudioBtn.disabled = true;
        }
    };
}

/**
 * Updates the elapsed streaming clock shown to the user.
 */
function updateStreamClock() {
    if (!state.audioCtx || !state.isStreaming) return;

    const elapsed = Math.max(0, state.audioCtx.currentTime - state.streamStartedAt);
    elements.currentTimeDisplay.textContent = formatTime(elapsed);
    elements.statDuration.textContent = `${elapsed.toFixed(1)}s`;
}

/**
 * Stops the live stream and releases every scheduled chunk.
 */
function stopStreamPlayback() {
    if (state.playbackTimer) {
        clearInterval(state.playbackTimer);
        state.playbackTimer = null;
    }

    state.streamNodes.forEach((node) => {
        try {
            node.stop();
        } catch (_) {
            /* ignore */
        }
        try {
            node.disconnect();
        } catch (_) {
            /* ignore */
        }
    });
    state.streamNodes = [];

    state.streamNextStartTime = 0;
    state.streamStartedAt = 0;
    state.isStreaming = false;
}

function compileMasterAudioBuffer() {
    if (state.recordedAudioBuffers.length === 0 || !state.audioCtx) return;

    const totalLength = state.recordedAudioBuffers.reduce((acc, buf) => acc + buf.length, 0);
    const masterBuffer = state.audioCtx.createBuffer(1, totalLength, GEMINI_CONFIG.sampleRate);
    const channelData = masterBuffer.getChannelData(0);

    let offset = 0;
    for (const buf of state.recordedAudioBuffers) {
        channelData.set(buf.getChannelData(0), offset);
        offset += buf.length;
    }

    state.masterAudioBuffer = masterBuffer;
    state.totalAudioDuration = masterBuffer.duration;
    state.pausedAt = 0;
    state.isPaused = false;
    elements.statDuration.textContent = `${state.totalAudioDuration.toFixed(1)}s`;
    elements.totalDurationDisplay.textContent = formatTime(masterBuffer.duration);

    elements.playAudioBtn.disabled = false;
    elements.stopAudioBtn.disabled = false;
    elements.downloadWavBtn.disabled = false;
    elements.seekSlider.disabled = false;

    logMessage(`Master audio buffer compiled. Duration: ${masterBuffer.duration.toFixed(2)}s`);
}

/**
 * Starts playback from an offset. Any currently playing clip is stopped first so
 * two clips can never overlap.
 */
function startPlayback(offsetSeconds = 0) {
    if (!state.masterAudioBuffer || !state.audioCtx) return;

    stopAudioNodeOnly();

    if (state.audioCtx.state === 'suspended') {
        state.audioCtx.resume();
    }

    const sourceNode = state.audioCtx.createBufferSource();
    sourceNode.buffer = state.masterAudioBuffer;
    sourceNode.connect(state.analyser);

    const startOffset = Math.max(0, Math.min(offsetSeconds, state.masterAudioBuffer.duration));

    sourceNode.start(0, startOffset);
    state.currentSourceNode = sourceNode;
    state.startedAt = state.audioCtx.currentTime - startOffset;
    state.isPlaying = true;
    state.isPaused = false;

    elements.playAudioBtn.disabled = true;
    elements.pauseAudioBtn.disabled = false;
    elements.stopAudioBtn.disabled = false;
    elements.resultBox.textContent =
        `Playing audio (${formatTime(startOffset)} / ${formatTime(state.masterAudioBuffer.duration)})`;

    sourceNode.onended = () => {
        if (state.currentSourceNode === sourceNode) {
            finishPlayback();
        }
    };

    startPlaybackTimer();
}

function stopAudioNodeOnly() {
    if (state.playbackTimer) {
        clearInterval(state.playbackTimer);
        state.playbackTimer = null;
    }
    if (state.currentSourceNode) {
        try {
            state.currentSourceNode.stop();
        } catch (_) {
            /* ignore */
        }
        try {
            state.currentSourceNode.disconnect();
        } catch (_) {
            /* ignore */
        }
        state.currentSourceNode = null;
    }
}

function pauseAudioPlayback() {
    if (!state.isPlaying) return;

    if (state.audioCtx) {
        state.pausedAt = Math.max(0, state.audioCtx.currentTime - state.startedAt);
    }
    stopAudioNodeOnly();

    state.isPlaying = false;
    state.isPaused = true;

    elements.playAudioBtn.disabled = false;
    elements.pauseAudioBtn.disabled = true;
    elements.stopAudioBtn.disabled = false;
    elements.resultBox.textContent = `Paused at ${formatTime(state.pausedAt)}.`;
    logMessage(`Playback paused at ${state.pausedAt.toFixed(2)}s.`);
}

function stopAudioPlayback() {
    stopAudioNodeOnly();
    stopStreamPlayback();

    state.isPlaying = false;
    state.isPaused = false;
    state.pausedAt = 0;

    if (state.masterAudioBuffer && !isStreamingMode()) {
        elements.playAudioBtn.disabled = false;
        elements.stopAudioBtn.disabled = false;
        elements.seekSlider.disabled = false;
        elements.resultBox.textContent = 'Playback stopped. Ready to play.';
    } else {
        elements.playAudioBtn.disabled = true;
        elements.stopAudioBtn.disabled = true;
        elements.seekSlider.disabled = true;
        elements.resultBox.textContent = 'Stream stopped.';
    }
    elements.pauseAudioBtn.disabled = true;
    elements.seekSlider.value = 0;
    elements.currentTimeDisplay.textContent = '0:00';
}

/**
 * Marks the clip as fully played. The seek bar holds at the end instead of
 * snapping back to zero, so the user can replay it with a single click.
 */
function finishPlayback() {
    stopAudioNodeOnly();

    state.isPlaying = false;
    state.isPaused = false;
    state.pausedAt = state.masterAudioBuffer ? state.masterAudioBuffer.duration : 0;

    elements.playAudioBtn.disabled = false;
    elements.pauseAudioBtn.disabled = true;
    elements.stopAudioBtn.disabled = false;
    elements.seekSlider.disabled = false;
    elements.seekSlider.value = 100;
    elements.currentTimeDisplay.textContent = formatTime(state.pausedAt);
    elements.resultBox.textContent = 'Playback finished.';
    logMessage('Playback reached the end of the clip.');
}

function startPlaybackTimer() {
    if (state.playbackTimer) clearInterval(state.playbackTimer);

    state.playbackTimer = setInterval(() => {
        if (!state.isPlaying || !state.audioCtx || !state.masterAudioBuffer) return;

        const currentPos = state.audioCtx.currentTime - state.startedAt;

        if (currentPos >= state.masterAudioBuffer.duration) {
            finishPlayback();
            return;
        }

        elements.currentTimeDisplay.textContent = formatTime(currentPos);
        elements.seekSlider.value = (currentPos / state.masterAudioBuffer.duration) * 100;
    }, 100);
}

elements.playAudioBtn.onclick = () => {
    // In Live Voice Query the audio streams in live, so there is no finished
    // clip to replay — resuming the stream is the only sensible action.
    if (isStreamingMode()) {
        if (state.audioCtx) {
            state.isPaused = false;
            state.audioCtx.resume();
            elements.pauseAudioBtn.disabled = false;
            elements.playAudioBtn.disabled = true;
            elements.resultBox.textContent = 'Streaming response — speaking live...';
            logMessage('Stream resumed.');
        }
        return;
    }

    if (!state.masterAudioBuffer) return;

    const duration = state.masterAudioBuffer.duration;
    let offset = state.isPaused ? state.pausedAt : 0;

    // Only a clip parked exactly at the end restarts from the beginning; a
    // legitimate seek near the end keeps its position.
    if (offset >= duration) offset = 0;

    startPlayback(offset);
    logMessage('Play button clicked.');
};

elements.pauseAudioBtn.onclick = () => {
    if (isStreamingMode()) {
        // Suspending the context pauses the live stream in place.
        if (state.audioCtx) {
            state.audioCtx.suspend();
            state.isPaused = true;
            elements.playAudioBtn.disabled = false;
            elements.pauseAudioBtn.disabled = true;
            elements.resultBox.textContent = 'Stream paused.';
            logMessage('Stream paused.');
        }
        return;
    }

    pauseAudioPlayback();
    logMessage('Pause button clicked.');
};

elements.stopAudioBtn.onclick = () => {
    stopAudioPlayback();
    if (isStreamingMode()) {
        state.recordedAudioBuffers = [];
        state.masterAudioBuffer = null;
        elements.currentTimeDisplay.textContent = '0:00';
        elements.resultBox.textContent = 'Stream stopped.';
    }
    logMessage('Stop button clicked.');
};

elements.seekSlider.oninput = (event) => {
    if (!state.masterAudioBuffer || isStreamingMode()) return;
    const targetTime = (parseFloat(event.target.value) / 100) * state.masterAudioBuffer.duration;
    elements.currentTimeDisplay.textContent = formatTime(targetTime);
};

elements.seekSlider.onchange = (event) => {
    if (!state.masterAudioBuffer || isStreamingMode()) return;
    const targetTime = (parseFloat(event.target.value) / 100) * state.masterAudioBuffer.duration;
    state.pausedAt = targetTime;

    if (state.isPlaying) {
        startPlayback(targetTime);
    } else {
        // The position is remembered so Play resumes from where the user seeked.
        state.isPaused = true;
        elements.playAudioBtn.disabled = false;
        elements.resultBox.textContent = `Seeked to ${formatTime(targetTime)}. Press Play to resume from here.`;
    }
    logMessage(`Seeked to ${targetTime.toFixed(2)}s.`);
};

/* ==========================================================================
   WAV Export
   ========================================================================== */
elements.downloadWavBtn.onclick = () => {
    if (isStreamingMode()) return;

    if (!state.masterAudioBuffer) {
        alert('No generated audio available to download.');
        return;
    }

    try {
        const sampleRate = GEMINI_CONFIG.sampleRate;
        const channelData = state.masterAudioBuffer.getChannelData(0);
        const pcmData = new Int16Array(channelData.length);

        for (let i = 0; i < channelData.length; i++) {
            const s = Math.max(-1, Math.min(1, channelData[i]));
            pcmData[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }

        const dataByteLength = pcmData.length * 2;
        const buffer = new ArrayBuffer(44 + dataByteLength);
        const view = new DataView(buffer);

        const writeString = (offset, str) => {
            for (let i = 0; i < str.length; i++) {
                view.setUint8(offset + i, str.charCodeAt(i));
            }
        };

        writeString(0, 'RIFF');
        view.setUint32(4, 36 + dataByteLength, true);
        writeString(8, 'WAVE');
        writeString(12, 'fmt ');
        view.setUint32(16, 16, true);
        view.setUint16(20, 1, true);
        view.setUint16(22, 1, true);
        view.setUint32(24, sampleRate, true);
        view.setUint32(28, sampleRate * 2, true);
        view.setUint16(32, 2, true);
        view.setUint16(34, 16, true);
        writeString(36, 'data');
        view.setUint32(40, dataByteLength, true);

        new Int16Array(buffer, 44).set(pcmData);

        const blob = new Blob([buffer], { type: 'audio/wav' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `ustad-live-${state.mode}-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.wav`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);

        logMessage('Downloaded generated audio as WAV successfully.');
    } catch (err) {
        logMessage(`WAV download error: ${err.message}`);
        alert(`Failed to download WAV: ${err.message}`);
    }
};

/* ==========================================================================
   Visualizer
   ========================================================================== */
const canvas = elements.visualizer;
const canvasCtx = canvas.getContext('2d');

function initVisualizer() {
    function resizeCanvas() {
        const parent = canvas.parentElement;
        if (!parent) return;
        const rect = parent.getBoundingClientRect();
        const style = window.getComputedStyle(parent);
        const pLeft = parseFloat(style.paddingLeft) || 0;
        const pRight = parseFloat(style.paddingRight) || 0;
        canvas.width = Math.max(100, Math.floor(rect.width - pLeft - pRight));
        canvas.height = 80;
    }
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    const bufferLength = 64;
    const dataArray = new Uint8Array(bufferLength);

    function draw() {
        requestAnimationFrame(draw);

        canvasCtx.fillStyle =
            getComputedStyle(canvas).getPropertyValue('--bg-primary').trim() || '#070a14';
        canvasCtx.fillRect(0, 0, canvas.width, canvas.height);

        if (state.analyser && (state.isConnected || state.isPlaying)) {
            state.analyser.getByteFrequencyData(dataArray);

            const barWidth = (canvas.width / bufferLength) * 2.5;
            let x = 0;

            for (let i = 0; i < bufferLength; i++) {
                const barHeight = (dataArray[i] / 255) * canvas.height;
                const gradient = canvasCtx.createLinearGradient(0, canvas.height, 0, 0);
                gradient.addColorStop(0, '#7565f5');
                gradient.addColorStop(1, '#0ea5e9');

                canvasCtx.fillStyle = gradient;
                canvasCtx.fillRect(x, canvas.height - barHeight, barWidth, barHeight);
                x += barWidth + 1;
            }
        } else {
            canvasCtx.strokeStyle = '#263556';
            canvasCtx.lineWidth = 2;
            canvasCtx.beginPath();
            const sliceWidth = canvas.width / 50;
            let x = 0;
            for (let i = 0; i < 50; i++) {
                const y = canvas.height / 2 + Math.sin((i + performance.now() * 0.003) * 0.2) * 8;
                if (i === 0) canvasCtx.moveTo(x, y);
                else canvasCtx.lineTo(x, y);
                x += sliceWidth;
            }
            canvasCtx.stroke();
        }
    }

    draw();
}

/* ==========================================================================
   Log Utilities
   ========================================================================== */
elements.clearLogs.onclick = () => {
    elements.logs.textContent = '[Logs cleared]\n';
};

elements.clearInputBtn.onclick = () => {
    elements.textInput.value = '';
    elements.textInput.focus();
    logMessage('Prompt text input cleared.');
};

/* ==========================================================================
   Speech Recognition
   ========================================================================== */
let recognition = null;
let isRecording = false;

// Initialize SpeechRecognition if available
function initSpeechRecognition() {
    // Check for Web Speech API support
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
        logMessage('Speech recognition not supported in this browser.', true);
        elements.micBtn.disabled = true;
        elements.micBtn.title = 'Speech recognition not supported';
        return null;
    }

    recognition = new SpeechRecognition();
    recognition.continuous = false;  // Stop after one utterance
    recognition.interimResults = true;  // Show results as they happen
    recognition.lang = 'en-US';

    // Handle start
    recognition.onstart = () => {
        isRecording = true;
        elements.micBtn.style.background = 'var(--danger)';
        elements.micBtn.style.color = '#fff';
        elements.micBtn.innerHTML = '🔴';
        logMessage('Microphone recording started...');
    };

    // Handle result
    recognition.onresult = (event) => {
        let interimTranscript = '';
        let finalTranscript = '';

        for (let i = event.resultIndex; i < event.results.length; i++) {
            const transcript = event.results[i][0].transcript;
            if (event.results[i].isFinal) {
                finalTranscript += transcript;
            } else {
                interimTranscript += transcript;
            }
        }

        // Append final transcript to existing text
        if (finalTranscript) {
            const currentValue = elements.textInput.value;
            elements.textInput.value = currentValue + (currentValue ? ' ' : '') + finalTranscript;
        }

        // Update interim results in real-time (optional)
        if (interimTranscript) {
            elements.textInput.placeholder = interimTranscript + '...';
        } else {
            elements.textInput.placeholder = 'Type the text you want Ustad to read aloud...';
        }
    };

    // Handle end (whether manually stopped or speech ended)
    recognition.onend = () => {
        if (isRecording) {
            // This was a manual stop
            isRecording = false;
            elements.micBtn.style.background = '';
            elements.micBtn.style.color = 'var(--accent-primary)';
            elements.micBtn.innerHTML = '🎙️';
            logMessage('Microphone recording stopped.');
        }
    };

    // Handle error
    recognition.onerror = (event) => {
        isRecording = false;
        elements.micBtn.style.background = '';
        elements.micBtn.style.color = 'var(--accent-primary)';
        elements.micBtn.innerHTML = '🎙️';

        let errorMsg = 'Speech recognition error';
        switch (event.error) {
            case 'not-allowed':
                errorMsg = 'Microphone access denied. Please allow microphone access and try again.';
                break;
            case 'no-speech':
                errorMsg = 'No speech detected.';
                break;
            case 'audio-capture':
                errorMsg = 'No microphone found.';
                break;
            default:
                errorMsg = `Speech recognition error: ${event.error}`;
        }

        logMessage(errorMsg, true);
        elements.textInput.placeholder = 'Type the text you want Ustad to read aloud...';
    };

    logMessage('Speech recognition initialized.');
    return recognition;
}

// Toggle microphone recording for text inputs
elements.micBtn.onclick = () => {
    if (state.voiceChat.isActive) {
        alert('Voice conversation is currently active. Please use the Voice Bot controls or stop the conversation first.');
        return;
    }

    if (!recognition) {
        initSpeechRecognition();
        return;
    }

    if (isRecording) {
        recognition.stop();
    } else {
        try {
            recognition.start();
        } catch (e) {
            logMessage('Failed to start recording: ' + e.message, true);
        }
    }
};

elements.exportLogs.onclick = () => {
    const blob = new Blob([elements.logs.textContent], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `ustad-live-logs-${new Date().toISOString().slice(0, 10)}.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    logMessage('Exported diagnostics logs to text file.');
};

/* ==========================================================================
   Real-Time Voice-to-Voice AI Chatbot Engine
   ========================================================================== */

/**
 * High-quality linear interpolation resampler to convert microphone audio (typically 44.1kHz or 48kHz)
 * down to 16,000Hz (the format required by Gemini Multimodal Live API).
 */
function downsampleBuffer(buffer, sampleRate, outSampleRate) {
    if (outSampleRate === sampleRate) {
        return buffer;
    }
    if (outSampleRate > sampleRate) {
        return buffer;
    }
    const sampleRateRatio = sampleRate / outSampleRate;
    const newLength = Math.round(buffer.length / sampleRateRatio);
    const result = new Float32Array(newLength);
    let offsetResult = 0;
    let offsetBuffer = 0;
    while (offsetResult < result.length) {
        const nextOffsetBuffer = Math.round((offsetResult + 1) * sampleRateRatio);
        let accum = 0;
        let count = 0;
        for (let i = offsetBuffer; i < nextOffsetBuffer && i < buffer.length; i++) {
            accum += buffer[i];
            count++;
        }
        result[offsetResult] = count > 0 ? accum / count : 0;
        offsetResult++;
        offsetBuffer = nextOffsetBuffer;
    }
    return result;
}

/**
 * Converts Float32 audio samples [-1.0, 1.0] to 16-bit signed PCM integers (Int16Array).
 */
function floatTo16BitPCM(float32Array) {
    const buffer = new Int16Array(float32Array.length);
    for (let i = 0; i < float32Array.length; i++) {
        const s = Math.max(-1, Math.min(1, float32Array[i]));
        buffer[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    return buffer;
}

/**
 * Converts ArrayBuffer / Int16Array into a Base64 string safely without stack overflows.
 */
function arrayBufferToBase64(buffer) {
    let binary = '';
    const bytes = new Uint8Array(buffer.buffer ? buffer.buffer : buffer);
    const len = bytes.byteLength;
    const chunkSize = 8192;
    for (let i = 0; i < len; i += chunkSize) {
        const chunk = bytes.subarray(i, Math.min(i + chunkSize, len));
        binary += String.fromCharCode.apply(null, chunk);
    }
    return btoa(binary);
}

/**
 * Updates conversational state for the Real-Time Voice Bot.
 * Manages indicator dot, text label, subtext hint, and button enable states.
 */
function setVoiceBotState(newState) {
    state.voiceChat.botState = newState;

    if (elements.stateDot) {
        elements.stateDot.className = `state-dot ${newState}`;
    }

    let label = 'Ready to Converse';
    let subtext = 'Click "Start Conversation" to begin';

    switch (newState) {
        case 'connecting':
            label = 'Connecting to Ustad Live...';
            subtext = 'Establishing bidirectional audio stream...';
            break;
        case 'listening':
            label = 'Listening (Speak naturally...)';
            subtext = 'Listening... Speak in any language anytime';
            break;
        case 'user-speaking':
            label = 'Hearing You...';
            subtext = 'Streaming microphone input...';
            break;
        case 'thinking':
            label = 'Thinking...';
            subtext = 'Ustad is formulating response...';
            break;
        case 'ai-speaking':
            label = 'AI Speaking...';
            subtext = 'Speaking live — talk anytime to interrupt';
            break;
        case 'interrupted':
            label = 'Interrupted';
            subtext = 'AI paused immediately — listening to you...';
            break;
        case 'muted':
            label = 'Microphone Muted';
            subtext = 'Microphone is muted — click Unmute to talk';
            break;
        case 'disconnected':
            label = 'Disconnected';
            subtext = 'Session ended. Click "Start Conversation" to restart';
            break;
        case 'ready':
            label = 'Ready to Converse';
            subtext = 'Click "Start Conversation" to begin';
            break;
    }

    if (elements.voiceBotStateText) elements.voiceBotStateText.textContent = label;
    if (elements.voiceOrbSubtext) elements.voiceOrbSubtext.textContent = subtext;

    if (elements.interruptBtn) {
        elements.interruptBtn.disabled = !state.voiceChat.isActive || newState !== 'ai-speaking';
    }
}

/**
 * Initializes the procedural reactive Voice Orb canvas.
 * Renders dynamic fluid particles and concentric frequency rings that morph
 * based on whether the user is speaking or Gemini AI is responding.
 */
function initVoiceOrb() {
    const canvas = elements.voiceOrbCanvas;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    function resizeOrb() {
        if (!canvas.parentElement) return;
        const rect = canvas.parentElement.getBoundingClientRect();
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = Math.max(100, Math.floor(rect.width * dpr));
        canvas.height = Math.max(100, Math.floor(rect.height * dpr));
    }
    resizeOrb();
    window.addEventListener('resize', resizeOrb);

    const freqData = new Uint8Array(64);
    let rotation = 0;
    let waveOffset = 0;

    function renderOrb() {
        requestAnimationFrame(renderOrb);
        const w = canvas.width;
        const h = canvas.height;
        ctx.clearRect(0, 0, w, h);

        const cx = w / 2;
        const cy = h / 2;
        const baseRadius = Math.min(w, h) * 0.22;
        const botState = state.voiceChat.botState;

        // Get live audio energy depending on active speaker
        let audioEnergy = 0;
        if (botState === 'ai-speaking' && state.analyser) {
            state.analyser.getByteFrequencyData(freqData);
            let sum = 0;
            for (let i = 0; i < 32; i++) sum += freqData[i];
            audioEnergy = (sum / 32) / 255;
        } else if (botState === 'user-speaking' && state.voiceChat.micAnalyser) {
            state.voiceChat.micAnalyser.getByteFrequencyData(freqData);
            let sum = 0;
            for (let i = 0; i < 32; i++) sum += freqData[i];
            audioEnergy = (sum / 32) / 255;
        }

        // Color palettes per state
        let colorA, colorB, haloColor;
        switch (botState) {
            case 'listening':
                colorA = '#06b6d4';
                colorB = '#3b82f6';
                haloColor = 'rgba(6, 182, 212, 0.45)';
                break;
            case 'user-speaking':
                colorA = '#10b981';
                colorB = '#06b6d4';
                haloColor = 'rgba(16, 185, 129, 0.6)';
                break;
            case 'thinking':
                colorA = '#8b5cf6';
                colorB = '#ec4899';
                haloColor = 'rgba(139, 92, 246, 0.6)';
                break;
            case 'ai-speaking':
                colorA = '#ec4899';
                colorB = '#8b5cf6';
                haloColor = 'rgba(236, 72, 153, 0.65)';
                break;
            case 'interrupted':
                colorA = '#f97316';
                colorB = '#ef4444';
                haloColor = 'rgba(249, 115, 22, 0.6)';
                break;
            case 'muted':
                colorA = '#ef4444';
                colorB = '#7f1d1d';
                haloColor = 'rgba(239, 68, 68, 0.35)';
                break;
            case 'connecting':
                colorA = '#f59e0b';
                colorB = '#6366f1';
                haloColor = 'rgba(245, 158, 11, 0.45)';
                break;
            default: // ready / disconnected
                colorA = '#475569';
                colorB = '#6366f1';
                haloColor = 'rgba(99, 102, 241, 0.25)';
        }

        // Update CSS backdrop halo glow
        if (elements.voiceOrbHalo) {
            elements.voiceOrbHalo.style.background = `radial-gradient(circle, ${haloColor} 0%, transparent 70%)`;
        }

        rotation += (botState === 'thinking' ? 0.045 : 0.012);
        waveOffset += (0.03 + audioEnergy * 0.12);

        // Draw layered concentric fluid waveform rings
        const numRings = 3;
        for (let ring = numRings; ring >= 1; ring--) {
            const ringScale = 1 + (ring - 1) * 0.22 + audioEnergy * 0.35;
            const points = 48;
            ctx.beginPath();
            for (let i = 0; i <= points; i++) {
                const angle = (i / points) * Math.PI * 2 + rotation * (ring % 2 === 0 ? 1 : -1);
                const freqIndex = Math.floor((i / points) * 32);
                const freqVal = (freqData[freqIndex] || 0) / 255;
                const wave = Math.sin(angle * 4 + waveOffset * (ring + 1)) * (8 * ringScale);
                const r = (baseRadius * ringScale) + (wave * (0.4 + audioEnergy * 1.6)) + (freqVal * 22 * audioEnergy);
                const x = cx + Math.cos(angle) * r;
                const y = cy + Math.sin(angle) * r;
                if (i === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            }
            ctx.closePath();

            ctx.strokeStyle = colorA;
            ctx.lineWidth = 2 * (window.devicePixelRatio || 1);
            ctx.shadowBlur = 15 * (window.devicePixelRatio || 1);
            ctx.shadowColor = colorA;
            ctx.stroke();
        }

        // Draw glowing inner core orb
        ctx.beginPath();
        const coreRadius = baseRadius * (0.85 + Math.sin(waveOffset * 1.5) * 0.05 + audioEnergy * 0.22);
        ctx.arc(cx, cy, coreRadius, 0, Math.PI * 2);
        const grad = ctx.createRadialGradient(
            cx - coreRadius * 0.25,
            cy - coreRadius * 0.25,
            coreRadius * 0.1,
            cx,
            cy,
            coreRadius
        );
        grad.addColorStop(0, '#ffffff');
        grad.addColorStop(0.35, colorA);
        grad.addColorStop(0.85, colorB);
        grad.addColorStop(1, 'rgba(0,0,0,0.6)');
        ctx.fillStyle = grad;
        ctx.shadowBlur = (25 + audioEnergy * 35) * (window.devicePixelRatio || 1);
        ctx.shadowColor = colorA;
        ctx.fill();
        ctx.shadowBlur = 0;
    }

    renderOrb();
}

/**
 * Initializes microphone audio capture and 16kHz PCM streaming pipeline.
 */
async function initVoiceChatMicrophone() {
    ensureAudioContext();

    if (!state.voiceChat.micStream) {
        state.voiceChat.micStream = await navigator.mediaDevices.getUserMedia({
            audio: {
                channelCount: 1,
                sampleRate: 16000,
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true
            }
        });
    }

    state.voiceChat.micAudioCtx = state.audioCtx;
    state.voiceChat.micSource = state.audioCtx.createMediaStreamSource(state.voiceChat.micStream);

    state.voiceChat.micAnalyser = state.audioCtx.createAnalyser();
    state.voiceChat.micAnalyser.fftSize = 128;
    state.voiceChat.micDataArray = new Uint8Array(state.voiceChat.micAnalyser.frequencyBinCount);

    state.voiceChat.micSource.connect(state.voiceChat.micAnalyser);

    const bufferSize = 2048;
    const processor = state.audioCtx.createScriptProcessor(bufferSize, 1, 1);
    state.voiceChat.micProcessor = processor;

    state.voiceChat.micAnalyser.connect(processor);

    // Silent gain connection to keep the processor active
    const silentGain = state.audioCtx.createGain();
    silentGain.gain.value = 0;
    processor.connect(silentGain);
    silentGain.connect(state.audioCtx.destination);

    let preRollChunks = [];

    processor.onaudioprocess = (e) => {
        if (!state.voiceChat.isActive || state.voiceChat.isMuted) {
            if (elements.audioLevelFill) elements.audioLevelFill.style.width = '0%';
            return;
        }

        const inputData = e.inputBuffer.getChannelData(0);

        // Compute RMS audio level
        let sum = 0;
        for (let i = 0; i < inputData.length; i++) {
            sum += inputData[i] * inputData[i];
        }
        const rms = Math.sqrt(sum / inputData.length);

        if (elements.audioLevelFill) {
            // Responsive meter scaling (750x) so mobile microphones give active visual feedback
            elements.audioLevelFill.style.width = Math.min(100, Math.round(rms * 750)) + '%';
        }

        const now = performance.now();
        const isAiSpeaking = state.voiceChat.botState === 'ai-speaking' ||
            state.voiceChat.activeAiAudioNodes.length > 0 ||
            (state.audioCtx && state.voiceChat.aiAudioScheduledEndTime > state.audioCtx.currentTime);
        const isThinking = state.voiceChat.botState === 'thinking';
        const inEchoTail = (now < state.voiceChat.suppressUserTranscriptionUntil) ||
            (now - state.voiceChat.lastAiSpeechEndTime < 600);

        // === RULE: When AI is speaking, thinking, or in acoustic echo tail, mic stream is blocked ===
        // Prevents speaker audio feedback loop and false speech triggers
        if (isAiSpeaking || isThinking || inEchoTail) {
            state.voiceChat.consecutiveSpeechFrames = 0;
            preRollChunks = [];
            return;
        }

        // Detect mobile device for calibrated microphone gain
        const isMobileDevice = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
            (window.matchMedia && window.matchMedia('(max-width: 800px)').matches && 'ontouchstart' in window);

        // Mobile microphones with AGC generally output RMS between 0.010 and 0.030 for normal speaking voices
        let baseThreshold = isMobileDevice ? 0.012 : 0.022;
        if (state.voiceChat.sensitivityMode === 'noisy') {
            baseThreshold = isMobileDevice ? 0.025 : 0.042;
        } else if (state.voiceChat.sensitivityMode === 'quiet') {
            baseThreshold = isMobileDevice ? 0.006 : 0.010;
        }

        // Calibrate ambient background noise floor during quiet moments
        if (rms < baseThreshold) {
            state.voiceChat.noiseFloor = state.voiceChat.noiseFloor * 0.94 + rms * 0.06;
        }

        // Dynamic threshold: never lower than base, and adaptive to room noise floor
        const effectiveThreshold = Math.max(baseThreshold, state.voiceChat.noiseFloor * 1.5);

        // Check if current frame exceeds threshold
        const isFrameAboveThreshold = rms > effectiveThreshold;

        if (isFrameAboveThreshold) {
            state.voiceChat.consecutiveSpeechFrames++;
            state.voiceChat.consecutiveSilenceFrames = 0;
        } else {
            state.voiceChat.consecutiveSilenceFrames++;
            state.voiceChat.consecutiveSpeechFrames = 0;
        }

        // Convert audio chunk to 16kHz PCM
        const resampled = downsampleBuffer(inputData, e.inputBuffer.sampleRate, 16000);
        const pcm16 = floatTo16BitPCM(resampled);
        const base64Pcm = arrayBufferToBase64(pcm16);

        // Maintain rolling 3-frame (~130ms) pre-roll buffer so initial words are never clipped
        if (state.voiceChat.botState !== 'user-speaking') {
            preRollChunks.push(base64Pcm);
            if (preRollChunks.length > 3) preRollChunks.shift();
        }

        // SPEECH START: Require 2 consecutive frames (~85ms) of audio to declare speech.
        if (state.voiceChat.consecutiveSpeechFrames >= 2) {
            state.voiceChat.lastVADTimestamp = now;
            state.voiceChat.hasSpokenInTurn = true;

            if (state.voiceChat.botState !== 'user-speaking' && state.voiceChat.botState !== 'interrupted') {
                setVoiceBotState('user-speaking');
                if (!state.voiceChat.currentUserBubble) {
                    appendUserDialogue('🎙️ Speaking...', false);
                }

                // Immediately flush pre-roll audio so Ustad Live receives the beginning of the sentence
                if (state.ws && state.ws.readyState === WebSocket.OPEN && preRollChunks.length > 0) {
                    for (const chunk of preRollChunks) {
                        try {
                            state.ws.send(JSON.stringify({
                                realtimeInput: {
                                    mediaChunks: [{
                                        mimeType: 'audio/pcm;rate=16000',
                                        data: chunk
                                    }]
                                }
                            }));
                        } catch (_) {}
                    }
                    preRollChunks = [];
                }
            }

            if (state.voiceChat.silenceTimer) {
                clearTimeout(state.voiceChat.silenceTimer);
                state.voiceChat.silenceTimer = null;
            }
        }

        // STREAM AUDIO: While user is speaking, stream 16kHz PCM chunks live to Ustad Live
        if (state.voiceChat.botState === 'user-speaking' && state.ws && state.ws.readyState === WebSocket.OPEN) {
            try {
                state.ws.send(JSON.stringify({
                    realtimeInput: {
                        mediaChunks: [{
                            mimeType: 'audio/pcm;rate=16000',
                            data: base64Pcm
                        }]
                    }
                }));
            } catch (err) {
                logMessage(`Mic send error: ${err.message}`);
            }
        }

        // SPEECH END / TURN COMPLETION:
        // After user stops speaking, wait for 2 full seconds of silence before triggering response.
        if (state.voiceChat.botState === 'user-speaking' && state.voiceChat.hasSpokenInTurn) {
            if (state.voiceChat.consecutiveSilenceFrames >= 7 && !state.voiceChat.silenceTimer) {
                state.voiceChat.silenceTimer = setTimeout(() => {
                    if (state.voiceChat.isActive && state.voiceChat.botState === 'user-speaking' && state.voiceChat.hasSpokenInTurn) {
                        finishUserVoiceTurn();
                    }
                    state.voiceChat.silenceTimer = null;
                }, 2000); // 2-second pause before model responds
            }
        }
    };
}

/**
 * Signals end of user voice turn after a 2-second silence.
 * Dispatches the captured spoken query to Gemini Live so the model starts
 * generating and speaking its response, and starts live caption streaming.
 */
function finishUserVoiceTurn() {
    if (!state.voiceChat.isActive || !state.ws || state.ws.readyState !== WebSocket.OPEN) return;

    let userQuery = (
        (state.voiceChat.currentTurnUserText || '') +
        (state.voiceChat.lastInterimText ? ' ' + state.voiceChat.lastInterimText : '')
    ).trim();
    if (!userQuery) {
        const bubbleText = state.voiceChat.currentUserBubble?.querySelector('.bubble-content')?.textContent || '';
        if (bubbleText && !bubbleText.includes('Speaking...')) {
            userQuery = bubbleText.trim();
        }
    }

    logMessage(`2-second silence confirmed. Initiating model response for: "${userQuery || '[Voice Query]'}"`);
    setVoiceBotState('thinking');
    state.voiceChat.isSpeechRecognitionSuppressed = true;
    try {
        state.voiceChat.speechRecognition?.abort();
    } catch (_) {}

    // Finalize user dialogue bubble in the conversation history
    if (userQuery) {
        appendUserDialogue(userQuery, true);
    } else {
        appendUserDialogue('🎙️ Spoken voice query', true);
    }

    state.voiceChat.hasSpokenInTurn = false;
    state.voiceChat.consecutiveSpeechFrames = 0;
    state.voiceChat.consecutiveSilenceFrames = 0;
    state.voiceChat.currentTurnUserText = '';
    state.voiceChat.lastInterimText = '';
    state.voiceChat.currentUserBubble = null;

    try {
        if (userQuery) {
            // Send clientContent turn containing the user's query text with turnComplete: true.
            // This triggers Ustad Live to generate its spoken audio response answering the query.
            state.ws.send(JSON.stringify({
                clientContent: {
                    turns: [{
                        role: 'user',
                        parts: [{ text: userQuery }]
                    }],
                    turnComplete: true
                }
            }));
            logMessage(`Dispatched spoken query to Ustad Live: "${userQuery}"`);
        } else {
            // Native audio turn completion: tell Ustad Live the voice stream turn is complete
            // so it responds directly to the streamed 16kHz PCM audio without requiring client-side SpeechRecognition.
            state.ws.send(JSON.stringify({
                clientContent: {
                    turnComplete: true
                }
            }));
            logMessage('Dispatched turnComplete signal to Ustad Live for native audio query.');
            // Note: Never call fetchAndStreamAiCaptions with dummy text ('Voice conversation response')
            // as that triggers generic greeting loops! Ustad Live sends its own speech and text stream.
        }

        if (userQuery) {
            // Stream text captions in real time for the AI response
            fetchAndStreamAiCaptions(userQuery, 'voiceChat');
        }

    } catch (e) {
        logMessage(`Turn completion dispatch error: ${e.message}`, true);
    }

    // Safety watchdog: ensure UI never stays stuck on 'thinking' if server stalls
    if (state.voiceChat.thinkingWatchdog) clearTimeout(state.voiceChat.thinkingWatchdog);
    state.voiceChat.thinkingWatchdog = setTimeout(() => {
        if (state.voiceChat.isActive && state.voiceChat.botState === 'thinking') {
            logMessage('Thinking watchdog: server took >10s, resetting to listening.');
            state.voiceChat.isSpeechRecognitionSuppressed = false;
            setVoiceBotState('listening');
            try { state.voiceChat.speechRecognition?.start(); } catch (_) {}
        }
    }, 10000);
}

/**
 * Detects whether incoming speech recognition text is a loopback echo of the
 * model's own voice output (from room speakers picking up into the microphone).
 */
function isModelSpeechEcho(text) {
    if (!text || !text.trim()) return false;
    const normalize = (s) => s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, '').replace(/\s+/g, ' ').trim();
    const candNorm = normalize(text);
    if (!candNorm || candNorm.length < 3) return false;

    const textsToCheck = [
        state.voiceChat.currentAiText || '',
        ...(state.voiceChat.recentAiTexts || [])
    ];

    for (const aiText of textsToCheck) {
        const aiNorm = normalize(aiText);
        if (!aiNorm) continue;

        // Direct containment
        if (aiNorm.includes(candNorm) || (candNorm.length > 8 && candNorm.includes(aiNorm))) {
            return true;
        }

        // Substantial word overlap
        const candWords = candNorm.split(' ').filter(w => w.length > 2);
        if (candWords.length >= 2) {
            const aiWords = new Set(aiNorm.split(' '));
            let matchCount = 0;
            for (const w of candWords) {
                if (aiWords.has(w)) matchCount++;
            }
            if (matchCount / candWords.length >= 0.6) {
                return true;
            }
        }
    }

    return false;
}

/**
 * Initializes continuous Web Speech API speech recognition for instant live captions of user speech.
 */
function initVoiceChatSpeechRecognition() {
    // 1. Mobile & Touch Screen Conflict Prevention:
    // On Android (Chrome), the operating system locks the hardware microphone exclusively for getUserMedia.
    // Concurrently initializing the Web Speech API triggers the Android OS system notification:
    // "Speech recognition (this is from Google) can't record now as Google Chrome is recording."
    // Because Ustad Live (Gemini 3.8 Live) natively processes raw 16kHz PCM microphone audio directly
    // over the WebSocket, auxiliary client-side speech recognition is disabled on mobile devices.
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
        (window.matchMedia && window.matchMedia('(max-width: 800px)').matches && 'ontouchstart' in window);

    if (isMobile) {
        logMessage('Mobile device active: Direct 16kHz PCM audio streaming to Ustad Live is active (auxiliary SpeechRecognition bypassed to prevent Android microphone hardware lock conflicts).');
        state.voiceChat.speechRecognitionAvailable = false;
        return;
    }

    const SpeechRecog = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecog) {
        logMessage('Speech recognition not available for client-side live captions.');
        state.voiceChat.speechRecognitionAvailable = false;
        return;
    }

    state.voiceChat.speechRecognitionAvailable = true;

    try {
        const recognition = new SpeechRecog();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = navigator.language || 'en-US';

        recognition.onresult = (event) => {
            if (!state.voiceChat.isActive) return;

            const now = performance.now();
            const isAiSpeaking = state.voiceChat.botState === 'ai-speaking' ||
                state.voiceChat.activeAiAudioNodes.length > 0 ||
                (state.audioCtx && state.audioCtx.currentTime < state.voiceChat.aiAudioScheduledEndTime) ||
                state.voiceChat.isSpeechRecognitionSuppressed;
            const isThinking = state.voiceChat.botState === 'thinking';
            const inEchoTail = (now < state.voiceChat.suppressUserTranscriptionUntil) ||
                (now - state.voiceChat.lastAiSpeechEndTime < 650);

            // Suppress transcription when model is speaking, thinking, or in echo tail
            if (isAiSpeaking || isThinking || inEchoTail) {
                return;
            }

            let interim = '';
            let final = '';

            for (let i = event.resultIndex; i < event.results.length; i++) {
                const transcript = event.results[i][0].transcript;
                if (event.results[i].isFinal) {
                    final += transcript;
                } else {
                    interim += transcript;
                }
            }

            // Echo filter: verify the text does NOT match words spoken by the model
            if (isModelSpeechEcho(final) || isModelSpeechEcho(interim)) {
                logMessage('Echo filter dropped model voice output from user transcription.');
                return;
            }

            if (final) {
                state.voiceChat.currentTurnUserText = (
                    (state.voiceChat.currentTurnUserText ? state.voiceChat.currentTurnUserText + ' ' : '') + final.trim()
                ).trim();
                state.voiceChat.lastInterimText = '';
                appendUserDialogue(state.voiceChat.currentTurnUserText, true);
            } else if (interim) {
                state.voiceChat.lastInterimText = interim.trim();
                const display = (
                    (state.voiceChat.currentTurnUserText ? state.voiceChat.currentTurnUserText + ' ' : '') + interim.trim()
                ).trim();
                appendUserDialogue(display, false);
            }
        };

        recognition.onerror = (e) => {
            if (e.error === 'audio-capture' || e.error === 'not-allowed') {
                logMessage(`Speech recognition hardware conflict (${e.error}). Disabling auxiliary speech recognition.`);
                state.voiceChat.speechRecognitionAvailable = false;
                try { recognition.abort(); } catch (_) {}
                state.voiceChat.speechRecognition = null;
                return;
            }
            if (e.error !== 'no-speech') {
                logMessage(`Live captions recognition event: ${e.error}`);
            }
        };

        recognition.onend = () => {
            if (!state.voiceChat.speechRecognitionAvailable) return;
            if (state.voiceChat.isActive && !state.voiceChat.isMuted && !state.voiceChat.isSpeechRecognitionSuppressed) {
                try { recognition.start(); } catch (_) {}
            }
        };

        state.voiceChat.speechRecognition = recognition;
        recognition.start();
        logMessage('Live captions speech recognition active.');
    } catch (e) {
        state.voiceChat.speechRecognitionAvailable = false;
        logMessage(`Speech recognition init notice: ${e.message}`);
    }
}

/**
 * Schedules gapless playback for AI voice chunks streaming in from Gemini Live (24kHz 16-bit PCM).
 */
function processVoiceChatAudioChunk(base64Data) {
    if (!state.audioCtx) return;

    const rawBinary = atob(base64Data);
    const sampleCount = Math.floor(rawBinary.length / 2);
    if (!sampleCount) return;

    const audioBuffer = state.audioCtx.createBuffer(1, sampleCount, GEMINI_CONFIG.sampleRate);
    const channelData = audioBuffer.getChannelData(0);

    for (let i = 0; i < sampleCount; i++) {
        let sample = rawBinary.charCodeAt(i * 2) | (rawBinary.charCodeAt(i * 2 + 1) << 8);
        if (sample >= 32768) sample -= 65536;
        channelData[i] = sample / 32768;
    }

    if (state.audioCtx.state === 'suspended') {
        state.audioCtx.resume();
    }

    const sourceNode = state.audioCtx.createBufferSource();
    sourceNode.buffer = audioBuffer;
    sourceNode.connect(state.analyser); // Analyser connects to destination

    const now = state.audioCtx.currentTime;
    const startAt = Math.max(now, state.voiceChat.aiAudioScheduledEndTime);

    sourceNode.start(startAt);
    state.voiceChat.aiAudioScheduledEndTime = startAt + audioBuffer.duration;
    state.voiceChat.activeAiAudioNodes.push(sourceNode);

    // Suppress speech recognition while AI audio is playing to prevent speaker loopback
    state.voiceChat.isSpeechRecognitionSuppressed = true;

    // If we were waiting in thinking state, transition to AI speaking and clear watchdog
    if (state.voiceChat.botState === 'thinking') {
        if (state.voiceChat.thinkingWatchdog) {
            clearTimeout(state.voiceChat.thinkingWatchdog);
            state.voiceChat.thinkingWatchdog = null;
        }
    }
    setVoiceBotState('ai-speaking');

    sourceNode.onended = () => {
        const idx = state.voiceChat.activeAiAudioNodes.indexOf(sourceNode);
        if (idx !== -1) state.voiceChat.activeAiAudioNodes.splice(idx, 1);

        if (state.voiceChat.activeAiAudioNodes.length === 0) {
            if (state.voiceChat.isActive && state.voiceChat.botState === 'ai-speaking') {
                const nowPerf = performance.now();
                state.voiceChat.lastAiSpeechEndTime = nowPerf;
                // Add a 650ms acoustic echo settling window
                state.voiceChat.suppressUserTranscriptionUntil = nowPerf + 650;

                // Cache recent AI text for echo filtering
                if (state.voiceChat.currentAiText) {
                    state.voiceChat.recentAiTexts.push(state.voiceChat.currentAiText);
                    if (state.voiceChat.recentAiTexts.length > 6) {
                        state.voiceChat.recentAiTexts.shift();
                    }
                }

                // Reset turn buffers to pristine state
                state.voiceChat.currentTurnUserText = '';
                state.voiceChat.lastInterimText = '';
                state.voiceChat.currentUserBubble = null;
                state.voiceChat.hasSpokenInTurn = false;
                state.voiceChat.consecutiveSpeechFrames = 0;
                state.voiceChat.consecutiveSilenceFrames = 0;

                setVoiceBotState('listening');
                state.voiceChat.currentAiBubble = null;

                // Resume speech recognition listening after echo has decayed
                setTimeout(() => {
                    if (state.voiceChat.isActive && state.voiceChat.botState === 'listening') {
                        state.voiceChat.isSpeechRecognitionSuppressed = false;
                        try {
                            state.voiceChat.speechRecognition?.start();
                        } catch (_) {}
                    }
                }, 500);
            }
        }
    };
}

/**
 * Instantly halts and cuts off all scheduled and active AI audio nodes.
 * Used for both server-driven barge-in (`serverContent.interrupted`) and user voice/click interruptions.
 */
function interruptAiSpeech(reason = 'Interrupted') {
    if (state.voiceChat.activeAiAudioNodes.length > 0) {
        logMessage(`AI Speech Interrupted: ${reason}`);
    }

    const now = performance.now();
    state.voiceChat.lastAiSpeechEndTime = now;
    state.voiceChat.suppressUserTranscriptionUntil = now + 400;

    if (state.currentCaptionAbortController) {
        try { state.currentCaptionAbortController.abort(); } catch (_) {}
        state.currentCaptionAbortController = null;
    }
    if (state.voiceChat.thinkingWatchdog) {
        clearTimeout(state.voiceChat.thinkingWatchdog);
        state.voiceChat.thinkingWatchdog = null;
    }

    state.voiceChat.activeAiAudioNodes.forEach((node) => {
        try { node.stop(); } catch (_) {}
        try { node.disconnect(); } catch (_) {}
    });
    state.voiceChat.activeAiAudioNodes = [];

    if (state.audioCtx) {
        state.voiceChat.aiAudioScheduledEndTime = state.audioCtx.currentTime;
    }

    // Cache interrupted text for echo filter
    if (state.voiceChat.currentAiText) {
        state.voiceChat.recentAiTexts.push(state.voiceChat.currentAiText);
        if (state.voiceChat.recentAiTexts.length > 6) state.voiceChat.recentAiTexts.shift();
    }

    // Reset turn buffers
    state.voiceChat.currentTurnUserText = '';
    state.voiceChat.lastInterimText = '';
    state.voiceChat.currentUserBubble = null;
    state.voiceChat.hasSpokenInTurn = false;
    state.voiceChat.consecutiveSpeechFrames = 0;
    state.voiceChat.consecutiveSilenceFrames = 0;

    if (state.voiceChat.currentAiBubble) {
        const content = state.voiceChat.currentAiBubble.querySelector('.bubble-content');
        if (content && !content.classList.contains('interrupted')) {
            content.classList.add('interrupted');
            const tag = document.createElement('span');
            tag.className = 'interrupted-tag';
            tag.textContent = ' ⚡ [Interrupted]';
            content.appendChild(tag);
        }
        state.voiceChat.currentAiBubble = null;
    }

    setVoiceBotState('interrupted');

    setTimeout(() => {
        if (state.voiceChat.isActive && state.voiceChat.botState === 'interrupted') {
            state.voiceChat.isSpeechRecognitionSuppressed = false;
            setVoiceBotState('listening');
            try {
                state.voiceChat.speechRecognition?.start();
            } catch (_) {}
        }
    }, 350);
}

/**
 * Appends or updates user speech in the live captions dialogue panel.
 */
function appendUserDialogue(text, isFinal = false) {
    if (!text || !text.trim()) return;

    if (elements.dialoguePlaceholder && elements.dialoguePlaceholder.style.display !== 'none') {
        elements.dialoguePlaceholder.style.display = 'none';
    }

    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

    if (!state.voiceChat.currentUserBubble) {
        const bubble = document.createElement('div');
        bubble.className = 'dialogue-bubble user';
        bubble.innerHTML = `
            <div class="bubble-meta"><span>You 👤</span> • <span>${time}</span></div>
            <div class="bubble-content"></div>
        `;
        elements.voiceDialogueBox.appendChild(bubble);
        state.voiceChat.currentUserBubble = bubble;
    }

    const contentEl = state.voiceChat.currentUserBubble.querySelector('.bubble-content');
    contentEl.textContent = text;
    elements.voiceDialogueBox.scrollTop = elements.voiceDialogueBox.scrollHeight;

    if (isFinal) {
        state.voiceChat.currentUserBubble = null;
    }
}

/**
 * Appends incoming AI response text tokens to the live captions dialogue panel.
 */
function appendAiDialogue(text) {
    if (!text) return;

    if (elements.dialoguePlaceholder && elements.dialoguePlaceholder.style.display !== 'none') {
        elements.dialoguePlaceholder.style.display = 'none';
    }

    const voice = elements.voiceName?.value || GEMINI_CONFIG.defaultVoice;
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

    if (!state.voiceChat.currentAiBubble) {
        const bubble = document.createElement('div');
        bubble.className = 'dialogue-bubble ai';
        bubble.innerHTML = `
            <div class="bubble-meta"><span>Ustad 🤖 (${voice})</span> • <span>${time}</span></div>
            <div class="bubble-content"></div>
        `;
        elements.voiceDialogueBox.appendChild(bubble);
        state.voiceChat.currentAiBubble = bubble;
        state.voiceChat.currentAiText = '';
    }

    state.voiceChat.currentAiText += text;
    const contentEl = state.voiceChat.currentAiBubble.querySelector('.bubble-content');
    contentEl.textContent = state.voiceChat.currentAiText;
    elements.voiceDialogueBox.scrollTop = elements.voiceDialogueBox.scrollHeight;
}

/**
 * Appends user query in the Live Voice Query captions panel.
 */
function appendLiveQueryUserDialogue(text) {
    if (!text || !text.trim() || !elements.liveQueryDialogueBox) return;

    if (elements.liveQueryPlaceholder && elements.liveQueryPlaceholder.style.display !== 'none') {
        elements.liveQueryPlaceholder.style.display = 'none';
    }

    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

    const bubble = document.createElement('div');
    bubble.className = 'dialogue-bubble user';
    bubble.innerHTML = `
        <div class="bubble-meta"><span>You 👤</span> • <span>${time}</span></div>
        <div class="bubble-content"></div>
    `;
    bubble.querySelector('.bubble-content').textContent = text;
    elements.liveQueryDialogueBox.appendChild(bubble);
    elements.liveQueryDialogueBox.scrollTop = elements.liveQueryDialogueBox.scrollHeight;
}

/**
 * Appends streaming model response tokens to the Live Voice Query captions panel.
 */
function appendLiveQueryAiDialogue(text) {
    if (!text || !elements.liveQueryDialogueBox) return;

    if (elements.liveQueryPlaceholder && elements.liveQueryPlaceholder.style.display !== 'none') {
        elements.liveQueryPlaceholder.style.display = 'none';
    }

    const voice = elements.voiceName?.value || GEMINI_CONFIG.defaultVoice;
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

    if (!state.liveQuery.currentAiBubble) {
        const bubble = document.createElement('div');
        bubble.className = 'dialogue-bubble ai';
        bubble.innerHTML = `
            <div class="bubble-meta"><span>Ustad 🤖 (${voice})</span> • <span>${time}</span></div>
            <div class="bubble-content"></div>
        `;
        elements.liveQueryDialogueBox.appendChild(bubble);
        state.liveQuery.currentAiBubble = bubble;
        state.liveQuery.currentAiText = '';
    }

    state.liveQuery.currentAiText += text;
    const contentEl = state.liveQuery.currentAiBubble.querySelector('.bubble-content');
    if (contentEl) {
        contentEl.textContent = state.liveQuery.currentAiText;
    }
    elements.liveQueryDialogueBox.scrollTop = elements.liveQueryDialogueBox.scrollHeight;
}

/**
 * Streams real-time AI response text captions to the dialogue panel
 * concurrently while Gemini Live speaks the response audio.
 */
async function fetchAndStreamAiCaptions(query, targetMode = 'voiceChat') {
    const apiKey = elements.apiKey.value.trim();
    if (!apiKey || !query) return;

    // Abort previous caption fetch if still active
    if (state.currentCaptionAbortController) {
        try { state.currentCaptionAbortController.abort(); } catch (_) {}
    }
    const abortController = new AbortController();
    state.currentCaptionAbortController = abortController;

    const mode = getActiveMode();
    const systemInstruction = mode.systemInstruction ||
        "You are Ustad (also respectfully called Ustad Ji), a helpful, concise AI voice assistant. Your name is Ustad. If asked about your name or identity, always answer that your name is Ustad or Ustad Ji (e.g. 'Mera naam Ustad hai.', 'My name is Ustad.'). Answer naturally, directly, and conversationally in 1 to 3 sentences.";

    try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:streamGenerateContent?alt=sse&key=${encodeURIComponent(apiKey)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{
                    role: 'user',
                    parts: [{ text: query }]
                }],
                systemInstruction: {
                    parts: [{ text: systemInstruction }]
                },
                generationConfig: {
                    maxOutputTokens: 300,
                    temperature: 0.7
                }
            }),
            signal: abortController.signal
        });

        if (!response.ok) {
            logMessage(`Caption stream status ${response.status} — audio stream continues.`);
            return;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder('utf-8');
        let buffer = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop();

            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    const jsonStr = line.slice(6).trim();
                    if (!jsonStr || jsonStr === '[DONE]') continue;
                    try {
                        const parsed = JSON.parse(jsonStr);
                        const chunkText = parsed.candidates?.[0]?.content?.parts?.[0]?.text;
                        if (chunkText) {
                            if (targetMode === 'voiceChat') {
                                appendAiDialogue(chunkText);
                            } else if (targetMode === 'live') {
                                appendLiveQueryAiDialogue(chunkText);
                            }
                            appendTranscript(chunkText);
                        }
                    } catch (_) {}
                }
            }
        }
    } catch (err) {
        if (err.name !== 'AbortError') {
            logMessage(`Caption stream notice: ${err.message}`);
        }
    } finally {
        if (state.currentCaptionAbortController === abortController) {
            state.currentCaptionAbortController = null;
        }
    }
}

/**
 * Initiates the real-time voice-to-voice conversation.
 * Verifies API key, requests microphone permissions, establishes live WebSocket session,
 * and activates streaming.
 */
async function startVoiceChat() {
    const apiKey = elements.apiKey.value.trim();
    if (!apiKey) {
        alert('Please enter your Ustad API Key first.');
        elements.apiKey.focus();
        return;
    }

    setVoiceBotState('connecting');

    try {
        if (!state.voiceChat.micStream) {
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    channelCount: 1,
                    sampleRate: 16000,
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true
                }
            });
            state.voiceChat.micStream = stream;
        }
    } catch (err) {
        logMessage(`Microphone permission error: ${err.name} - ${err.message}`, true);
        alert(`Microphone access is required for real-time voice chat.\n${err.message}`);
        setVoiceBotState('ready');
        return;
    }

    state.voiceChat.pendingActivation = true;

    if (!state.isConnected || !state.ws || state.ws.readyState !== WebSocket.OPEN) {
        connectSession();
    } else {
        onVoiceChatConnected();
    }
}

/**
 * Called once the Gemini Live WebSocket session handshake completes in voiceChat mode.
 */
async function onVoiceChatConnected() {
    state.voiceChat.isActive = true;
    elements.startVoiceChatBtnText.textContent = 'End Conversation';
    elements.startVoiceChatBtn.classList.add('in-call');
    elements.startVoiceChatBtn.querySelector('.btn-icon').textContent = '📞';
    elements.muteMicBtn.disabled = false;

    try {
        await initVoiceChatMicrophone();
        initVoiceChatSpeechRecognition();
        setVoiceBotState('listening');
        logMessage('Real-time voice-to-voice conversation is now LIVE! Speak naturally in any language.');
    } catch (err) {
        logMessage(`Failed to initialize microphone processing: ${err.message}`, true);
        alert(`Microphone error: ${err.message}`);
        endVoiceChat();
    }
}

/**
 * Cleanly ends the real-time voice conversation and releases all audio and microphone resources.
 */
function endVoiceChat() {
    state.voiceChat.pendingActivation = false;
    state.voiceChat.isActive = false;

    if (state.voiceChat.silenceTimer) {
        clearTimeout(state.voiceChat.silenceTimer);
        state.voiceChat.silenceTimer = null;
    }
    if (state.voiceChat.thinkingWatchdog) {
        clearTimeout(state.voiceChat.thinkingWatchdog);
        state.voiceChat.thinkingWatchdog = null;
    }
    if (state.currentCaptionAbortController) {
        try { state.currentCaptionAbortController.abort(); } catch (_) {}
        state.currentCaptionAbortController = null;
    }

    if (state.voiceChat.micStream) {
        state.voiceChat.micStream.getTracks().forEach((track) => track.stop());
        state.voiceChat.micStream = null;
    }

    if (state.voiceChat.micProcessor) {
        try { state.voiceChat.micProcessor.disconnect(); } catch (_) {}
        state.voiceChat.micProcessor = null;
    }
    if (state.voiceChat.micSource) {
        try { state.voiceChat.micSource.disconnect(); } catch (_) {}
        state.voiceChat.micSource = null;
    }

    if (state.voiceChat.speechRecognition) {
        try { state.voiceChat.speechRecognition.stop(); } catch (_) {}
        state.voiceChat.speechRecognition = null;
    }

    interruptAiSpeech('Conversation ended');

    elements.startVoiceChatBtnText.textContent = 'Start Conversation';
    elements.startVoiceChatBtn.classList.remove('in-call');
    elements.startVoiceChatBtn.querySelector('.btn-icon').textContent = '🎙️';
    elements.muteMicBtn.disabled = true;
    elements.muteMicBtn.classList.remove('muted');
    elements.muteMicBtnIcon.textContent = '🎤';
    elements.muteMicBtnText.textContent = 'Mute';
    state.voiceChat.isMuted = false;
    elements.interruptBtn.disabled = true;
    if (elements.audioLevelFill) elements.audioLevelFill.style.width = '0%';

    setVoiceBotState('ready');
    logMessage('Voice chat conversation ended. Audio and mic resources released.');
}

/**
 * Toggles microphone mute state during an active voice session.
 */
function toggleMicMute() {
    if (!state.voiceChat.isActive) return;

    state.voiceChat.isMuted = !state.voiceChat.isMuted;

    if (state.voiceChat.isMuted) {
        elements.muteMicBtn.classList.add('muted');
        elements.muteMicBtnIcon.textContent = '🔇';
        elements.muteMicBtnText.textContent = 'Unmute';
        if (state.voiceChat.micStream) {
            state.voiceChat.micStream.getAudioTracks().forEach((t) => t.enabled = false);
        }
        if (elements.audioLevelFill) elements.audioLevelFill.style.width = '0%';
        setVoiceBotState('muted');
        logMessage('Microphone muted.');
    } else {
        elements.muteMicBtn.classList.remove('muted');
        elements.muteMicBtnIcon.textContent = '🎤';
        elements.muteMicBtnText.textContent = 'Mute';
        if (state.voiceChat.micStream) {
            state.voiceChat.micStream.getAudioTracks().forEach((t) => t.enabled = true);
        }
        setVoiceBotState('listening');
        logMessage('Microphone unmuted.');
    }
}

/**
 * Renders quick conversation topic starter chips for Voice Bot mode.
 */
function renderVoicePresets(presets) {
    if (!elements.voicePresetChips) return;
    elements.voicePresetChips.innerHTML = '';
    (presets || []).forEach((preset) => {
        const chip = document.createElement('span');
        chip.className = 'chip';
        chip.textContent = preset.label;
        chip.title = preset.text;
        chip.addEventListener('click', async () => {
            logMessage(`Voice topic clicked: "${preset.label}"`);
            if (!state.voiceChat.isActive) {
                await startVoiceChat();
            }
            setTimeout(() => {
                if (state.ws && state.ws.readyState === WebSocket.OPEN) {
                    appendUserDialogue(preset.text, true);
                    setVoiceBotState('thinking');
                    try {
                        state.ws.send(JSON.stringify({
                            clientContent: {
                                turns: [{
                                    role: 'user',
                                    parts: [{ text: preset.text }]
                                }],
                                turnComplete: true
                            }
                        }));
                    } catch (e) {
                        logMessage(`Topic prompt error: ${e.message}`);
                    }
                }
            }, 600);
        });
        elements.voicePresetChips.appendChild(chip);
    });
}

// Wire Voice Bot control buttons
elements.startVoiceChatBtn?.addEventListener('click', async () => {
    if (state.voiceChat.isActive) {
        endVoiceChat();
    } else {
        await startVoiceChat();
    }
});

elements.muteMicBtn?.addEventListener('click', () => {
    toggleMicMute();
});

elements.interruptBtn?.addEventListener('click', () => {
    interruptAiSpeech('User tapped Interrupt button');
});

elements.clearDialogueBtn?.addEventListener('click', () => {
    if (elements.voiceDialogueBox) {
        elements.voiceDialogueBox.innerHTML = `
            <div class="dialogue-placeholder" id="dialoguePlaceholder">
                💬 Your live conversation captions will stream here in real time. Speak naturally into your microphone!
            </div>
        `;
        elements.dialoguePlaceholder = $('dialoguePlaceholder');
    }
    state.voiceChat.currentAiBubble = null;
    state.voiceChat.currentUserBubble = null;
    logMessage('Live dialogue cleared.');
});

// Wire Live Voice Query dialogue clear button
elements.clearLiveQueryDialogueBtn?.addEventListener('click', () => {
    if (elements.liveQueryDialogueBox) {
        elements.liveQueryDialogueBox.innerHTML = `
            <div class="dialogue-placeholder" id="liveQueryPlaceholder">
                💬 Your query and Ustad's streamed live response captions will appear here in real time.
            </div>
        `;
        elements.liveQueryPlaceholder = $('liveQueryPlaceholder');
    }
    state.liveQuery.currentAiBubble = null;
    state.liveQuery.currentAiText = '';
    logMessage('Live Voice Query dialogue cleared.');
});

// Wire Microphone Sensitivity dropdown
elements.micSensitivitySelect?.addEventListener('change', (e) => {
    state.voiceChat.sensitivityMode = e.target.value;
    logMessage(`Microphone sensitivity set to: ${e.target.value}`);
});

/* ==========================================================================
   Keyboard Shortcuts
   ========================================================================== */
document.addEventListener('keydown', (event) => {
    const target = event.target;
    const typing = target && (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT');

    if (event.ctrlKey && event.key === 'Enter') {
        event.preventDefault();
        if (state.mode === 'voiceChat') {
            elements.startVoiceChatBtn?.click();
        } else {
            elements.speakBtn?.click();
        }
        return;
    }

    if (event.key === 'Escape') {
        if (state.mode === 'voiceChat' && state.voiceChat.botState === 'ai-speaking') {
            event.preventDefault();
            interruptAiSpeech('Escape key pressed');
            return;
        }
        closeSidebar();
        return;
    }

    if (typing) return;

    if (state.mode === 'voiceChat' && state.voiceChat.isActive) {
        if (event.key === 'm' || event.key === 'M') {
            event.preventDefault();
            toggleMicMute();
            return;
        }
    }

    if (event.code === 'Space') {
        event.preventDefault();
        if (state.mode === 'voiceChat') {
            if (state.voiceChat.isActive) {
                toggleMicMute();
            } else {
                elements.startVoiceChatBtn?.click();
            }
            return;
        }

        if (isStreamingMode()) {
            if (state.isStreaming && !state.isPaused) {
                elements.pauseAudioBtn.click();
            } else {
                elements.playAudioBtn.click();
            }
            return;
        }

        if (state.isPlaying) {
            elements.pauseAudioBtn.click();
        } else {
            elements.playAudioBtn.click();
        }
    }
});

/* ==========================================================================
   Boot
   ========================================================================== */
window.addEventListener('DOMContentLoaded', () => {
    loadPreferences();
    initVisualizer();
    initVoiceOrb();
    logMessage(
        `Ustad Live Voice Studio v3.9.0 ready — model ${GEMINI_CONFIG.modelLabel || GEMINI_CONFIG.model} with Real-Time Voice Bot.`
    );
});
