// AudioWorklet processor for Voice Satellite voice capture
// Captures PCM samples from the microphone and posts them to the main thread
class VoiceCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
  }

  process(inputs) {
    const input = inputs[0];
    if (input && input[0]) {
      // Send the first channel's samples to the main thread
      this.port.postMessage(input[0].slice());
    }
    return true; // Keep the processor running
  }
}

registerProcessor('voice-capture-processor', VoiceCaptureProcessor);
