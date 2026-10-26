/**
 * @file [`config.js`](config.js:1)
 * @description Single Source of Truth for the Gemini Live Voice Studio.
 * Both the Text-to-Speech (TTS) workflow and the Live Voice Query workflow run on the
 * SAME Gemini 3.8 Live model, therefore they intentionally share ONE configuration block:
 * API key, model ID, voice, endpoint, sample rate and system instruction.
 *
 * Changing a value here automatically applies to every feature of the studio.
 */

'use strict';

/**
 * Global (non-module) so the studio also works when opened directly via `file://`.
 * @type {Readonly<Object>}
 */
const GEMINI_CONFIG = Object.freeze({

    /* ---------------------------------------------------------------------- *
     * Shared Model / Credential Configuration
     * ---------------------------------------------------------------------- */
    /** Fixed model used by BOTH TTS and Live Voice Query. */
    model: 'gemini-3.8-live',

    /** Human readable label for the fixed model (shown in the UI). */
    modelLabel: 'Gemini 3.8 Live',

    /** storage key used to persist the Gemini API key in localStorage. */
    apiKeyStorageKey: 'gemini_live_api_key',

    /** storage key used to persist the selected theme. */
    themeStorageKey: 'gemini_live_theme',

    /** storage key used to persist the last selected workflow mode. */
    modeStorageKey: 'gemini_live_mode',

    /** storage key used to persist max response tokens setting. */
    maxTokensStorageKey: 'gemini_live_max_tokens',

    /** Default max output tokens for responses (~1 min duration default). */
    defaultMaxOutputTokens: 512,

    /* ---------------------------------------------------------------------- *
     * Live API Transport Configuration
     * ---------------------------------------------------------------------- */
    /**
     * Endpoint versions are tried in order. The first version that completes the
     * `setup` handshake wins; if it fails the client automatically falls back.
     */
    apiVersions: ['v1beta', 'v1alpha'],

    /** Fully qualified gRPC-web service path for bidirectional streaming. */
    servicePath: 'google.ai.generativelanguage.{version}.GenerativeService.BidiGenerateContent',

    /** Host used for the secure WebSocket connection. */
    host: 'generativelanguage.googleapis.com',

    /** Per-attempt handshake timeout in milliseconds. */
    handshakeTimeoutMs: 15000,

    /** Maximum number of endpoint attempts before giving up. */
    maxConnectionAttempts: 3,

    /* ---------------------------------------------------------------------- *
     * Audio Configuration
     * ---------------------------------------------------------------------- */
    /** Gemini Live returns 24kHz mono 16-bit little-endian PCM. */
    sampleRate: 24000,

    /** Audio output MIME type requested from the server. */
    outputAudioMimeType: 'audio/pcm;rate=24000',

    /* ---------------------------------------------------------------------- *
     * Voice Roster (shared by both workflows)
     * ---------------------------------------------------------------------- */
    voices: [
        { id: 'Kore', label: 'Kore', hint: 'Balanced & Warm' },
        { id: 'Puck', label: 'Puck', hint: 'Energetic & Direct' },
        { id: 'Charon', label: 'Charon', hint: 'Deep & Resonant' },
        { id: 'Fenrir', label: 'Fenrir', hint: 'Authoritative' },
        { id: 'Aoede', label: 'Aoede', hint: 'Melodic & Soft' },
        { id: 'Leda', label: 'Leda', hint: 'Bright & Clear' },
        { id: 'Orus', label: 'Orus', hint: 'Firm & Steady' },
        { id: 'Zephyr', label: 'Zephyr', hint: 'Light & Airy' }
    ],

    /** Voice used when the user has not picked one yet. */
    defaultVoice: 'Kore',

    /* ---------------------------------------------------------------------- *
     * Workflow Modes
     * Both modes reuse the SAME connection, model, voice and endpoint.
     * Only the system instruction, prompt shaping and presets differ.
     * ---------------------------------------------------------------------- */
    modes: {

        /** Mode A — Read a fixed text aloud (TTS). */
        tts: {
            id: 'tts',
            label: 'Text to Speech',
            icon: '🗣',
            cardTitle: '2. Text to Speech',
            promptLabel: 'Text to Read Aloud',
            placeholder: 'Type the text you want Gemini to read aloud...',
            buttonLabel: '▶ Generate Speech',
            idleHint: 'Enter text, then generate the speech.',
            /**
             * `false` — the whole turn is buffered, compiled into a single clip
             * and played back with the full transport (seek bar + download).
             */
            streaming: false,
            systemInstruction:
                "Read the user's supplied text aloud faithfully with natural voice modulation, " +
                'correct pronunciation and expressive pacing. Do not add explanations, commentary or filler.',
            promptPrefix: 'Read the following text aloud exactly as written with natural expression:\n',
            presets: [
                {
                    label: 'Greeting',
                    text: 'Hello! Welcome to the Gemini 3.8 Live Voice Studio. I am ready to read your text with natural inflection and expressive pacing.'
                },
                {
                    label: 'Technical Intro',
                    text: 'Bidirectional live audio streaming enables full duplex interaction with ultra low latency voice synthesis directly in the browser.'
                },
                {
                    label: 'Diction Test',
                    text: 'The quick brown fox jumps over the lazy dog. Sphinx of black quartz, judge my vow.'
                },
                {
                    label: 'Shakespeare',
                    text: "To be, or not to be, that is the question: Whether 'tis nobler in the mind to suffer The slings and arrows of outrageous fortune."
                }
            ]
        },

        /** Mode B — Conversational live query against the same model. */
        live: {
            id: 'live',
            label: 'Live Voice Query',
            icon: '💬',
            cardTitle: '2. Live Voice Query',
            promptLabel: 'Enter Your Query or Message',
            placeholder: 'Type what you want to ask Gemini...',
            buttonLabel: '▶ Send Query',
            idleHint: 'Enter a query and send it to Gemini Live.',
            /**
             * `true` — every PCM chunk is scheduled for playback the moment it
             * arrives, so the model starts speaking without waiting for the turn
             * to finish. A live stream has no finished clip, therefore the seek
             * bar and the download button are not offered in this mode.
             */
            streaming: true,
            systemInstruction:
                "You are a helpful, concise voice assistant. Answer the user's spoken or typed questions " +
                'accurately and naturally. Keep answers brief and conversational, and never read back ' +
                'meta information about the system or the tools behind it.',
            promptPrefix: '',
            presets: [
                {
                    label: 'What can you do?',
                    text: 'What can you do, and how do you work with the Gemini 3.8 Live model?'
                },
                {
                    label: 'Explain Live API',
                    text: 'Explain in simple terms how the Gemini Live API differs from a standard generate content request.'
                },
                {
                    label: 'Summarise',
                    text: 'Give me a short summary of how bidirectional streaming audio works in under thirty seconds.'
                },
                {
                    label: 'Code Sample',
                    text: 'Explain how to connect to the Gemini Live WebSocket endpoint from vanilla JavaScript, including the setup message.'
                }
            ]
        }
    },

    /** Mode used when nothing is stored or the stored value is unknown. */
    defaultMode: 'tts'
});

/**
 * Builds the full secure WebSocket URL for a given API version.
 * @param {string} version - API version segment, e.g. `v1beta`.
 * @param {string} apiKey - Google Gemini API key.
 * @returns {string} Fully qualified `wss://` endpoint.
 */
function buildLiveEndpoint(version, apiKey) {
    const service = GEMINI_CONFIG.servicePath.replace('{version}', version);
    return `wss://${GEMINI_CONFIG.host}/ws/${service}?key=${encodeURIComponent(apiKey)}`;
}
