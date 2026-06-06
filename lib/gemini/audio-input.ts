/**
 * Audio Input Handler for Gemini Live API
 * Captures microphone input and converts to PCM format for WebSocket streaming
 */

export interface AudioInputConfig {
  sampleRate?: number;
  channelCount?: number;
  bufferSize?: number;
}

export class AudioInputHandler {
  private audioContext: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private processor: ScriptProcessorNode | null = null;
  private onAudioData: ((data: Float32Array) => void) | null = null;

  constructor(private config: AudioInputConfig = {}) {
    this.config = {
      sampleRate: 16000,
      channelCount: 1,
      bufferSize: 4096,
      ...config,
    };
  }

  /**
   * Initialize and start capturing audio from the microphone
   */
  async start(onAudioData: (data: Float32Array) => void): Promise<void> {
    try {
      // Request microphone access
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: this.config.sampleRate,
          channelCount: this.config.channelCount,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      // Create audio context with specified sample rate
      this.audioContext = new AudioContext({
        sampleRate: this.config.sampleRate,
      });

      // Create media stream source
      this.source = this.audioContext.createMediaStreamSource(this.mediaStream);

      // Create script processor for audio chunks
      this.processor = this.audioContext.createScriptProcessor(
        this.config.bufferSize,
        this.config.channelCount,
        this.config.channelCount
      );

      this.onAudioData = onAudioData;

      // Process audio chunks
      this.processor.onaudioprocess = (e: AudioProcessingEvent) => {
        const inputData = e.inputBuffer.getChannelData(0);
        if (this.onAudioData) {
          this.onAudioData(inputData);
        }
      };

      // Connect the audio pipeline
      this.source.connect(this.processor);
      this.processor.connect(this.audioContext.destination);

      console.log('🎤 Audio input started:', {
        sampleRate: this.audioContext.sampleRate,
        bufferSize: this.config.bufferSize,
      });
    } catch (error) {
      console.error('Failed to start audio input:', error);
      throw error;
    }
  }

  /**
   * Stop capturing audio and clean up resources
   */
  stop(): void {
    // Disconnect audio nodes
    if (this.processor) {
      this.processor.disconnect();
      this.processor.onaudioprocess = null;
      this.processor = null;
    }

    if (this.source) {
      this.source.disconnect();
      this.source = null;
    }

    // Stop media stream tracks
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach(track => track.stop());
      this.mediaStream = null;
    }

    // Close audio context
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }

    this.onAudioData = null;
    console.log('🎤 Audio input stopped');
  }

  /**
   * Check if currently capturing audio
   */
  isActive(): boolean {
    return this.mediaStream !== null && this.audioContext !== null;
  }
}

/**
 * Convert Float32Array PCM data to base64-encoded string
 */
export function pcmToBase64(pcmData: Float32Array): string {
  // Convert Float32 (-1 to 1) to Int16 PCM
  const int16Array = new Int16Array(pcmData.length);
  for (let i = 0; i < pcmData.length; i++) {
    const s = Math.max(-1, Math.min(1, pcmData[i]));
    int16Array[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }

  // Convert to base64
  const uint8Array = new Uint8Array(int16Array.buffer);
  let binary = '';
  for (let i = 0; i < uint8Array.length; i++) {
    binary += String.fromCharCode(uint8Array[i]);
  }
  return btoa(binary);
}

/**
 * Get available audio input devices
 */
export async function getAudioInputDevices(): Promise<MediaDeviceInfo[]> {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter(device => device.kind === 'audioinput');
  } catch (error) {
    console.error('Failed to enumerate audio devices:', error);
    return [];
  }
}
