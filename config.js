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
    modelLabel: 'Ustad Live',

    /** storage key used to persist the Gemini API key in localStorage. */
    apiKeyStorageKey: 'gemini_live_api_key',

    /** storage key used to persist the selected theme. */
    themeStorageKey: 'gemini_live_theme',

    /** storage key used to persist the last selected workflow mode. */
    modeStorageKey: 'gemini_live_mode',

    /** storage key used to persist max response tokens setting. */
    maxTokensStorageKey: 'gemini_live_max_tokens',

    /** Default max output tokens for responses (~1 min duration default). */
    defaultMaxOutputTokens: 2040,

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
            placeholder: 'Type the text you want Ustad to read aloud...',
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
                    text: 'Hello! Welcome to the Ustad Live Voice Studio. I am ready to read your text with natural inflection and expressive pacing.'
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
            placeholder: 'Type what you want to ask Ustad...',
            buttonLabel: '▶ Send Query',
            idleHint: 'Enter a query and send it to Ustad Live.',
            /**
             * `true` — every PCM chunk is scheduled for playback the moment it
             * arrives, so the model starts speaking without waiting for the turn
             * to finish. A live stream has no finished clip, therefore the seek
             * bar and the download button are not offered in this mode.
             */
            streaming: true,
            systemInstruction:
                "You are Ustad (also respectfully called Ustad Ji), an intelligent, helpful, and concise conversational AI voice assistant. " +
                "Always identify yourself as Ustad or Ustad Ji whenever asked about your name, identity, or role. " +
                "When asked in Hindi, Urdu, or Hinglish (e.g., 'Tumhara naam kya hai?', 'Aapka naam kya hai?', 'Kaun ho tum?'), respond naturally in Hindi/Hinglish (e.g., 'Mera naam Ustad hai.', 'Mera naam Ustad Ji hai.', 'Main Ustad hoon, aapka AI assistant.'). " +
                "When asked in English (e.g., 'What is your name?', 'Who are you?'), respond in English (e.g., 'My name is Ustad.', 'I am Ustad, your AI assistant.'). " +
                "Answer the user's spoken or typed questions accurately and naturally. Keep answers brief and conversational, and never read back " +
                "meta information about the system or the tools behind it.",
            promptPrefix: '',
            presets: [
                {
                    label: 'Tumhara naam kya hai?',
                    text: 'Tumhara naam kya hai aur tum kya kar sakte ho?'
                },
                {
                    label: 'Who are you?',
                    text: 'Who are you, and what can you help me with?'
                },
                {
                    label: 'Aapka naam kya hai?',
                    text: 'Aapka naam kya hai?'
                },
                {
                    label: 'Summarise',
                    text: 'Give me a short summary of how bidirectional streaming audio works in under thirty seconds.'
                }
            ]
        },

        /** Mode C — Full Duplex Real-Time Voice-to-Voice AI Chatbot. */
        voiceChat: {
            id: 'voiceChat',
            label: 'Real-Time Voice Bot',
            icon: '🎙️',
            cardTitle: '2. Real-Time Voice Bot (Ustad Live)',
            promptLabel: 'Live Spoken Dialogue',
            placeholder: 'Speak directly into your microphone naturally...',
            buttonLabel: '🎙️ Start Conversation',
            idleHint: 'Click "Start Conversation" and speak naturally to Ustad.',
            streaming: true,
            systemInstruction:
                "You are Ustad (also respectfully referred to as Ustad Ji), an engaging, friendly, and ultra-responsive real-time conversational AI assistant. " +
                "Your name is Ustad. Whenever the user asks about your name, identity, or who you are in any language (such as 'Tumhara naam kya hai?', 'Aapka naam kya hai?', 'Who are you?', 'What is your name?', 'Kaun ho tum?'), always proudly, respectfully, and consistently identify yourself as Ustad (or Ustad Ji) " +
                "(examples: 'Mera naam Ustad hai.', 'Mera naam Ustad Ji hai.', 'My name is Ustad.', 'Main Ustad hoon, aapka AI assistant.'). " +
                "You converse with the user in natural, spoken dialogue. Keep your answers concise, direct, " +
                "and conversational (typically 1 to 3 sentences, unless asked for more), as if having a real phone or voice call. " +
                "You have deep context awareness: remember previous questions and topics discussed earlier in this session, " +
                "and handle follow-up questions smoothly. " +
                "You are fully multilingual: immediately understand and respond in the exact language the user speaks " +
                "(such as English, Hindi, Hinglish, Spanish, French, German, Mandarin, Japanese, Arabic, and any other language), " +
                "and seamlessly switch languages if the user switches. " +
                "If interrupted, stop speaking immediately and listen attentively. " +
                "Never output markdown formatting, bullet points, asterisks, or system meta-text, since your output is spoken directly aloud.",
            promptPrefix: '',
            presets: [
                {
                    label: 'Tumhara naam kya hai?',
                    text: 'Tumhara naam kya hai?'
                },
                {
                    label: 'Say Hello',
                    text: 'Hello Ustad! Introduce yourself briefly and tell me what we can talk about.'
                },
                {
                    label: 'Aapka naam kya hai?',
                    text: 'Aapka naam kya hai?'
                },
                {
                    label: 'Science Trivia',
                    text: 'Ask me a fun, intriguing science trivia question and wait for my answer.'
                }
            ]
        }
    },

    /** Real-time voice-to-voice bidirectional streaming parameters. */
    voiceChatConfig: {
        micSampleRate: 16000,
        chunkDurationMs: 100,
        vadThreshold: 0.05,
        vadDebounceMs: 150
    },

    /** Mode used when nothing is stored or the stored value is unknown. */
    defaultMode: 'voiceChat'
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
