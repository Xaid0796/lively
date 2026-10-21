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
    clearInputBtn: $('clearInputBtn')
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
    turnComplete: false
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

    state.mode = modeId;
    const mode = getActiveMode();
    localStorage.setItem(GEMINI_CONFIG.modeStorageKey, modeId);

    elements.modeCardTitle.textContent = mode.cardTitle;
    elements.promptLabel.textContent = mode.promptLabel;
    elements.textInput.placeholder = mode.placeholder;
    elements.speakBtn.textContent = mode.buttonLabel;

    applyModeControlVisibility();

    // Keep the tab strip in sync with the active workflow.
    document.querySelectorAll('.mode-tab').forEach((tab) => {
        tab.classList.toggle('active', tab.dataset.mode === state.mode);
    });

    renderPresets(mode.presets);
    elements.textInput.value = '';

    logMessage(`Workflow mode switched to: ${mode.label}`);

    if (state.isConnected) {
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

function buildPromptPayload(text) {
    const mode = getActiveMode();
    const finalText = mode.promptPrefix ? `${mode.promptPrefix}${text}` : text;

    return {
        clientContent: {
            turns: [
                {
                    role: 'user',
                    parts: [{ text: finalText }]
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
        logMessage('Loaded saved Gemini API key from localStorage.');
    }

    const savedTheme = localStorage.getItem(GEMINI_CONFIG.themeStorageKey) || 'dark';
    document.documentElement.setAttribute('data-theme', savedTheme);

    const savedMode = localStorage.getItem(GEMINI_CONFIG.modeStorageKey);
    if (savedMode && GEMINI_CONFIG.modes[savedMode]) {
        state.mode = savedMode;
    }

    elements.modelId.value = GEMINI_CONFIG.model;

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
    elements.speakBtn.textContent = mode.buttonLabel;
    renderPresets(mode.presets);
    applyModeControlVisibility();

    document.querySelectorAll('.mode-tab').forEach((tab) => {
        tab.classList.toggle('active', tab.dataset.mode === state.mode);
    });
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

    return {
        setup: {
            model: `models/${GEMINI_CONFIG.model}`,
            generationConfig: {
                responseModalities: ['AUDIO'],
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
        alert('Please enter your Google Gemini API Key.');
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

        logMessage(`Connecting to Gemini Live (${GEMINI_CONFIG.model})...`, {
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
            handleConnectionFailure(currentSession, 'Handshake timed out.');
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
                    updateStatus(`Connected successfully (${GEMINI_CONFIG.model})`);
                    elements.resultBox.textContent = 'Session active. ' + getActiveMode().idleHint;
                    logMessage('Setup complete confirmed by server.');
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
                        updateStatus(`Connected successfully (${GEMINI_CONFIG.model})`);
                        elements.resultBox.textContent = 'Session active. ' + getActiveMode().idleHint;
                        logMessage('Setup complete confirmed by server.');
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
        const parts = serverContent.modelTurn?.parts || [];

        for (const part of parts) {
            if (part.text) {
                logMessage(`Model text: ${part.text}`);
                appendTranscript(part.text);
            }
            if (part.inlineData?.data) {
                state.chunkCount++;
                elements.statChunks.textContent = state.chunkCount;
                logMessage(`Received audio chunk #${state.chunkCount} (${part.inlineData.mimeType || 'audio/pcm'})`);
                try {
                    processPCMChunk(part.inlineData.data);
                } catch (audioErr) {
                    logMessage(`Audio processing error: ${audioErr.message}`);
                }
            }
        }

        if (serverContent.turnComplete) {
            state.isGenerating = false;
            state.turnComplete = true;
            elements.speakBtn.disabled = !state.isConnected;

            if (isStreamingMode()) {
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
            stopAudioPlayback();
            if (isStreamingMode()) {
                state.recordedAudioBuffers = [];
                state.masterAudioBuffer = null;
                elements.currentTimeDisplay.textContent = '0:00';
            }
            logMessage('Response interrupted.');
        }
    }

    if (message.goAway) {
        logMessage('Server requested session closure.', message.goAway);
    }
}

function appendTranscript(text) {
    state.transcriptParts.push(text);
    elements.transcriptBox.textContent = state.transcriptParts.join(' ');
    elements.transcriptBox.scrollTop = elements.transcriptBox.scrollHeight;
}

elements.connectBtn.onclick = connectSession;

elements.disconnectBtn.onclick = () => {
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
    if (!text) {
        alert('Please enter text before sending.');
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
        : 'Sending query to Gemini Live...';
    logMessage(`Sending request (${text.length} characters) in "${getActiveMode().label}" mode.`);

    try {
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
        link.download = `gemini-live-${state.mode}-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.wav`;
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
        canvas.width = canvas.parentElement.clientWidth - 48;
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

elements.exportLogs.onclick = () => {
    const blob = new Blob([elements.logs.textContent], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `gemini-live-logs-${new Date().toISOString().slice(0, 10)}.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    logMessage('Exported diagnostics logs to text file.');
};

/* ==========================================================================
   Keyboard Shortcuts
   ========================================================================== */
document.addEventListener('keydown', (event) => {
    const target = event.target;
    const typing = target && (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT');

    if (event.ctrlKey && event.key === 'Enter') {
        event.preventDefault();
        elements.speakBtn.click();
        return;
    }
    if (typing) return;

    if (event.code === 'Space') {
        event.preventDefault();
        if (isStreamingMode()) {
            // In live mode the space bar toggles the live stream itself.
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
    logMessage(
        `Gemini Live Voice Studio v3.9.0 ready — model ${GEMINI_CONFIG.model} (shared by Text to Speech and Live Voice Query).`
    );
});
