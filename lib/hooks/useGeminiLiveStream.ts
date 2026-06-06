/**
 * React Hook for Gemini Live API Audio Streaming
 * Manages bidirectional audio streaming for real-time voice chat
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { AudioInputHandler } from '../gemini/audio-input';
import { AudioOutputHandler } from '../gemini/audio-output';
import { GeminiWebSocket } from '../gemini/websocket';

export interface UseGeminiLiveStreamConfig {
  apiKey: string;
  systemPrompt?: string;
  model?: string;
  onTranscript?: (text: string) => void;
  onResponse?: (text: string) => void;
  onError?: (error: Error) => void;
  onStreamStart?: () => void;
  onStreamEnd?: () => void;
}

export interface GeminiLiveStreamState {
  isConnected: boolean;
  isStreaming: boolean;
  isSpeaking: boolean;
  error: string | null;
}

export function useGeminiLiveStream(config: UseGeminiLiveStreamConfig) {
  const [state, setState] = useState<GeminiLiveStreamState>({
    isConnected: false,
    isStreaming: false,
    isSpeaking: false,
    error: null,
  });

  const audioInputRef = useRef<AudioInputHandler | null>(null);
  const audioOutputRef = useRef<AudioOutputHandler | null>(null);
  const websocketRef = useRef<GeminiWebSocket | null>(null);
  const currentTranscriptRef = useRef<string>('');
  const currentResponseRef = useRef<string>('');

  /**
   * Initialize audio output
   */
  const initializeAudioOutput = useCallback(async () => {
    if (!audioOutputRef.current) {
      audioOutputRef.current = new AudioOutputHandler();
      await audioOutputRef.current.initialize();

      // Set up playback callbacks
      audioOutputRef.current.setOnPlaybackStart(() => {
        setState(prev => ({ ...prev, isSpeaking: true }));
      });

      audioOutputRef.current.setOnPlaybackEnd(() => {
        setState(prev => ({ ...prev, isSpeaking: false }));
      });
    }
  }, []);

  /**
   * Start streaming session
   */
  const startStream = useCallback(async () => {
    try {
      setState(prev => ({ ...prev, error: null }));

      // Validate API key
      if (!config.apiKey) {
        throw new Error('Gemini API key is required');
      }

      // Initialize audio output first
      await initializeAudioOutput();

      // Create and connect WebSocket
      websocketRef.current = new GeminiWebSocket({
        apiKey: config.apiKey,
        model: config.model,
        systemPrompt: config.systemPrompt,
        responseModalities: ['AUDIO'],
      });

      await websocketRef.current.connect({
        onOpen: () => {
          console.log('🎙️ Gemini Live stream opened');
          setState(prev => ({ ...prev, isConnected: true }));
        },
        onClose: () => {
          console.log('🎙️ Gemini Live stream closed');
          setState(prev => ({ 
            ...prev, 
            isConnected: false, 
            isStreaming: false 
          }));
        },
        onError: (error) => {
          console.error('🎙️ Gemini Live stream error:', error);
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          setState(prev => ({ ...prev, error: errorMessage }));
          if (config.onError) {
            config.onError(new Error(errorMessage));
          }
        },
        onSetupComplete: async () => {
          console.log('🎙️ Setup complete, starting audio capture');
          
          // Start audio input
          audioInputRef.current = new AudioInputHandler();
          await audioInputRef.current.start((pcmData) => {
            // Send audio chunks to WebSocket
            if (websocketRef.current?.isReady()) {
              websocketRef.current.sendAudioChunk(pcmData);
            }
          });

          setState(prev => ({ ...prev, isStreaming: true }));
          if (config.onStreamStart) {
            config.onStreamStart();
          }
        },
        onAudioData: async (base64Audio) => {
          // Play back audio from Gemini
          if (audioOutputRef.current) {
            await audioOutputRef.current.addChunk(base64Audio);
          }
        },
        onTextData: (text) => {
          // Handle text transcription/response
          currentResponseRef.current += text;
          if (config.onResponse) {
            config.onResponse(text);
          }
        },
        onTurnComplete: () => {
          console.log('🎙️ Turn complete');
          
          // Finalize response
          if (currentResponseRef.current && config.onResponse) {
            config.onResponse(currentResponseRef.current);
            currentResponseRef.current = '';
          }
        },
      });
    } catch (error) {
      console.error('Failed to start stream:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to start stream';
      setState(prev => ({ ...prev, error: errorMessage }));
      if (config.onError) {
        config.onError(error instanceof Error ? error : new Error(errorMessage));
      }
    }
  }, [config, initializeAudioOutput]);

  /**
   * Stop streaming session
   */
  const stopStream = useCallback(() => {
    console.log('🎙️ Stopping Gemini Live stream');

    // Stop audio input
    if (audioInputRef.current) {
      audioInputRef.current.stop();
      audioInputRef.current = null;
    }

    // Stop audio output
    if (audioOutputRef.current) {
      audioOutputRef.current.stop();
    }

    // Disconnect WebSocket
    if (websocketRef.current) {
      websocketRef.current.disconnect();
      websocketRef.current = null;
    }

    setState({
      isConnected: false,
      isStreaming: false,
      isSpeaking: false,
      error: null,
    });

    if (config.onStreamEnd) {
      config.onStreamEnd();
    }
  }, [config]);

  /**
   * Send a text message (alternative to audio)
   */
  const sendText = useCallback((text: string) => {
    if (websocketRef.current?.isReady()) {
      websocketRef.current.sendText(text);
      if (config.onTranscript) {
        config.onTranscript(text);
      }
    } else {
      console.warn('WebSocket not ready to send text');
    }
  }, [config]);

  /**
   * Toggle streaming on/off
   */
  const toggleStream = useCallback(() => {
    if (state.isStreaming) {
      stopStream();
    } else {
      startStream();
    }
  }, [state.isStreaming, startStream, stopStream]);

  /**
   * Resume audio context (for browser autoplay policy)
   */
  const resumeAudio = useCallback(async () => {
    if (audioOutputRef.current) {
      await audioOutputRef.current.resume();
    }
  }, []);

  /**
   * Clean up on unmount
   */
  useEffect(() => {
    return () => {
      stopStream();
      if (audioOutputRef.current) {
        audioOutputRef.current.dispose();
        audioOutputRef.current = null;
      }
    };
  }, [stopStream]);

  return {
    // State
    ...state,

    // Actions
    startStream,
    stopStream,
    toggleStream,
    sendText,
    resumeAudio,
  };
}
