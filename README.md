# Gemini Live Voice Studio

A high-performance, modular web application for real-time speech synthesis and interactive voice queries powered by Google's Gemini Multimodal Live API (`gemini-3.8-live`).

## Features

- **Unified Shared Configuration**: Single configuration driving both Text-to-Speech (TTS) and Live Voice Query workflows on the `gemini-3.8-live` model.
- **Dual Mode Operation**:
  - **Text-to-Speech (TTS)**: Buffered audio generation with full transport controls (Play, Pause, Stop, interactive seek bar, and `.wav` download).
  - **Live Voice Query**: Real-time streaming voice assistant mode where audio chunks play back immediately as they arrive, without waiting for turn completion. Seek bar and download options are automatically hidden for stream efficiency.
- **Resilient Connection**: Automatic `v1beta` to `v1alpha` WebSocket endpoint fallback with connection state verification.
- **Interactive UI**: Live transcript display, frequency visualizer canvas, preset chips, dark/light theme toggle, and diagnostic log export.
- **Keyboard Shortcuts**: `Ctrl + Enter` to send prompt; `Spacebar` to toggle play/pause or live stream state.

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
