# Gemini Live Voice Studio

A high-performance, modular web application for real-time speech synthesis and interactive voice queries powered by Google's Gemini Multimodal Live API (`gemini-3.8-live`).

## Features

- **Unified Shared Configuration**: Single configuration driving Real-Time Voice Bot, Text-to-Speech (TTS), and Live Voice Query workflows on the `gemini-3.8-live` model.
- **Three Mode Operation**:
  - **Real-Time Voice Bot (Voice-to-Voice)**: True bidirectional full-duplex live conversation. Users speak directly through their microphone, and Gemini 3.8 Live responds in spoken audio in real time. Features client and server barge-in interruptions, natural turn-taking, multilingual auto-adaptation, live captions, reactive 3D voice orb, and mute/interrupt controls.
  - **Text-to-Speech (TTS)**: Buffered audio generation with full transport controls (Play, Pause, Stop, interactive seek bar, and `.wav` download).
  - **Live Voice Query**: Real-time streaming voice assistant mode where audio chunks play back immediately as they arrive, without waiting for turn completion.
- **Natural Interruptions (Barge-In)**: Speak over the AI at any time; playback cuts off instantly and seamlessly transitions back to listening.
- **Live Captions & Dialogue**: Real-time dual turn-taking transcription displaying both user speech and AI responses.
- **Dynamic Reactive Voice Orb**: Procedural canvas visualization that shifts colors and ripples dynamically to microphone speech and AI output audio.
- **Resilient Connection**: Automatic `v1beta` to `v1alpha` WebSocket endpoint fallback with connection state verification.
- **Interactive UI**: Live transcript display, frequency visualizer canvas, preset chips, dark/light theme toggle, and diagnostic log export.
- **Keyboard Shortcuts**: `Ctrl + Enter` to start conversation or send prompt; `Spacebar` or `M` to toggle mute; `Escape` to interrupt AI speech.

---

## Project Structure

```text
├── index.html        # Main markup & layout skeleton
├── style.css         # Modern CSS styles, variables & themes
├── config.js         # Shared Gemini configuration & mode definitions
└── app.js            # Core application logic, Web Audio engine, & WebSocket handler
```

---

## Getting Started

1. Clone the repository:
   ```bash
   git clone https://github.com/Xaid0796/lively.git
   cd lively
   ```
2. Open [`index.html`](index.html:1) in any modern web browser or serve via a local static file server (e.g., Live Server, `npx serve`).
3. Enter your Google Gemini API Key and start interacting!
