/**
 * Audio Output Handler for Gemini Live API
 * Manages queue-based playback of streaming audio chunks
 */

export interface AudioOutputConfig {
  sampleRate?: number;
  channelCount?: number;
}

export class AudioOutputHandler {
  private audioContext: AudioContext | null = null;
  private audioQueue: AudioBuffer[] = [];
  private isPlaying: boolean = false;
  private currentSource: AudioBufferSourceNode | null = null;
  private onPlaybackStart: (() => void) | null = null;
  private onPlaybackEnd: (() => void) | null = null;

  constructor(private config: AudioOutputConfig = {}) {
    this.config = {
      sampleRate: 24000, // Gemini typically outputs 24kHz audio
      channelCount: 1,
      ...config,
    };
  }

  /**
   * Initialize the audio output system
   */
  async initialize(): Promise<void> {
    try {
      this.audioContext = new AudioContext({
        sampleRate: this.config.sampleRate,
      });

      // Resume context if suspended (browser autoplay policy)
      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
      }

      console.log('🔊 Audio output initialized:', {
        sampleRate: this.audioContext.sampleRate,
        state: this.audioContext.state,
      });
    } catch (error) {
      console.error('Failed to initialize audio output:', error);
      throw error;
    }
  }

  /**
   * Add audio chunk to the playback queue
   */
  async addChunk(base64Data: string): Promise<void> {
    if (!this.audioContext) {
      console.warn('Audio context not initialized');
      return;
    }

    try {
      // Decode base64 to ArrayBuffer
      const audioData = base64ToArrayBuffer(base64Data);

      // Decode audio data to AudioBuffer
      const audioBuffer = await this.audioContext.decodeAudioData(audioData);

      // Add to queue
      this.audioQueue.push(audioBuffer);

      // Start playback if not already playing
      if (!this.isPlaying) {
        this.playNext();
      }
    } catch (error) {
      console.error('Failed to decode audio chunk:', error);
    }
  }

  /**
   * Play the next chunk in the queue
   */
  private playNext(): void {
    if (this.audioQueue.length === 0) {
      this.isPlaying = false;
      if (this.onPlaybackEnd) {
        this.onPlaybackEnd();
      }
      return;
    }

    if (!this.audioContext) {
      console.warn('Audio context not initialized');
      return;
    }

    this.isPlaying = true;

    // Get next buffer from queue
    const buffer = this.audioQueue.shift()!;

    // Create source node
    this.currentSource = this.audioContext.createBufferSource();
    this.currentSource.buffer = buffer;
    this.currentSource.connect(this.audioContext.destination);

    // Set up ended callback
    this.currentSource.onended = () => {
      this.playNext();
    };

    // Start playback
    this.currentSource.start(0);

    if (this.onPlaybackStart && this.audioQueue.length === 0) {
      this.onPlaybackStart();
    }
  }

  /**
   * Stop playback and clear the queue
   */
  stop(): void {
    // Stop current playback
    if (this.currentSource) {
      try {
        this.currentSource.stop();
        this.currentSource.disconnect();
      } catch (error) {
        // Ignore errors if already stopped
      }
      this.currentSource = null;
    }

    // Clear queue
    this.audioQueue = [];
    this.isPlaying = false;

    console.log('🔊 Audio output stopped');
  }

  /**
   * Clean up resources
   */
  dispose(): void {
    this.stop();

    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
  }

  /**
   * Set callback for when playback starts
   */
  setOnPlaybackStart(callback: () => void): void {
    this.onPlaybackStart = callback;
  }

  /**
   * Set callback for when playback ends
   */
  setOnPlaybackEnd(callback: () => void): void {
    this.onPlaybackEnd = callback;
  }

  /**
   * Get current playback state
   */
  getState(): { isPlaying: boolean; queueLength: number } {
    return {
      isPlaying: this.isPlaying,
      queueLength: this.audioQueue.length,
    };
  }

  /**
   * Resume audio context (needed for browser autoplay policies)
   */
  async resume(): Promise<void> {
    if (this.audioContext && this.audioContext.state === 'suspended') {
      await this.audioContext.resume();
    }
  }
}

/**
 * Convert base64 string to ArrayBuffer
 */
function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}

/**
 * Create a simple beep sound for testing
 */
export async function createTestBeep(
  audioContext: AudioContext,
  frequency: number = 440,
  duration: number = 0.2
): Promise<AudioBuffer> {
  const sampleRate = audioContext.sampleRate;
  const numSamples = sampleRate * duration;
  const buffer = audioContext.createBuffer(1, numSamples, sampleRate);
  const channelData = buffer.getChannelData(0);

  for (let i = 0; i < numSamples; i++) {
    channelData[i] = Math.sin(2 * Math.PI * frequency * (i / sampleRate));
  }

  return buffer;
}
