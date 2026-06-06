/**
 * WebSocket Connection Manager for Gemini Live API
 * Handles bidirectional audio streaming communication
 */

import { pcmToBase64 } from './audio-input';

export interface GeminiWebSocketConfig {
  apiKey: string;
  model?: string;
  systemPrompt?: string;
  responseModalities?: string[];
  temperature?: number;
}

export interface GeminiMessage {
  setup?: {
    model: string;
    generationConfig?: {
      responseModalities?: string[];
      temperature?: number;
      topK?: number;
      topP?: number;
    };
    systemInstruction?: {
      parts: Array<{ text: string }>;
    };
  };
  realtimeInput?: {
    mediaChunks?: Array<{
      data: string;
      mimeType: string;
    }>;
  };
  clientContent?: {
    turns?: Array<{
      role: string;
      parts: Array<{ text: string }>;
    }>;
    turnComplete?: boolean;
  };
}

export interface GeminiServerContent {
  setupComplete?: boolean;
  serverContent?: {
    modelTurn?: {
      parts: Array<{
        text?: string;
        inlineData?: {
          mimeType: string;
          data: string;
        };
      }>;
    };
    turnComplete?: boolean;
  };
  toolCall?: any;
  toolCallCancellation?: any;
}

export type WebSocketEventHandler = {
  onOpen?: () => void;
  onClose?: (event: CloseEvent) => void;
  onError?: (error: Event) => void;
  onSetupComplete?: () => void;
  onAudioData?: (base64Audio: string) => void;
  onTextData?: (text: string) => void;
  onTurnComplete?: () => void;
};

export class GeminiWebSocket {
  private ws: WebSocket | null = null;
  private config: Required<GeminiWebSocketConfig>;
  private handlers: WebSocketEventHandler = {};
  private isSetupComplete: boolean = false;
  private messageQueue: GeminiMessage[] = [];

  constructor(config: GeminiWebSocketConfig) {
    this.config = {
      model: 'models/gemini-2.0-flash-exp',
      responseModalities: ['AUDIO'],
      temperature: 0.7,
      systemPrompt: '',
      ...config,
    };
  }

  /**
   * Connect to the Gemini Live API WebSocket
   */
  connect(handlers: WebSocketEventHandler = {}): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.handlers = handlers;

        // Construct WebSocket URL
        const wsUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${this.config.apiKey}`;

        console.log('🔌 Connecting to Gemini Live API...');
        this.ws = new WebSocket(wsUrl);

        // Set up event handlers
        this.ws.onopen = () => {
          console.log('✅ WebSocket connected');
          this.sendSetup();
          if (this.handlers.onOpen) {
            this.handlers.onOpen();
          }
          resolve();
        };

        this.ws.onmessage = (event) => {
          this.handleMessage(event);
        };

        this.ws.onerror = (error) => {
          console.error('❌ WebSocket error:', error);
          if (this.handlers.onError) {
            this.handlers.onError(error);
          }
          reject(error);
        };

        this.ws.onclose = (event) => {
          console.log('🔌 WebSocket closed:', event.code, event.reason);
          this.isSetupComplete = false;
          if (this.handlers.onClose) {
            this.handlers.onClose(event);
          }
        };
      } catch (error) {
        console.error('Failed to create WebSocket:', error);
        reject(error);
      }
    });
  }

  /**
   * Send setup message to configure the session
   */
  private sendSetup(): void {
    const setupMessage: GeminiMessage = {
      setup: {
        model: this.config.model,
        generationConfig: {
          responseModalities: this.config.responseModalities,
          temperature: this.config.temperature,
          topK: 40,
          topP: 0.95,
        },
      },
    };

    // Add system prompt if provided
    if (this.config.systemPrompt) {
      setupMessage.setup!.systemInstruction = {
        parts: [{ text: this.config.systemPrompt }],
      };
    }

    this.send(setupMessage);
    console.log('📤 Setup message sent:', setupMessage);
  }

  /**
   * Handle incoming WebSocket messages
   */
  private handleMessage(event: MessageEvent): void {
    try {
      const data: GeminiServerContent = JSON.parse(event.data);

      // Handle setup complete
      if (data.setupComplete) {
        console.log('✅ Setup complete');
        this.isSetupComplete = true;
        if (this.handlers.onSetupComplete) {
          this.handlers.onSetupComplete();
        }
        // Process any queued messages
        this.processMessageQueue();
        return;
      }

      // Handle server content
      if (data.serverContent?.modelTurn?.parts) {
        const parts = data.serverContent.modelTurn.parts;

        for (const part of parts) {
          // Handle audio data
          if (part.inlineData?.mimeType?.startsWith('audio/') && part.inlineData.data) {
            if (this.handlers.onAudioData) {
              this.handlers.onAudioData(part.inlineData.data);
            }
          }

          // Handle text data
          if (part.text) {
            if (this.handlers.onTextData) {
              this.handlers.onTextData(part.text);
            }
          }
        }
      }

      // Handle turn complete
      if (data.serverContent?.turnComplete) {
        console.log('✅ Turn complete');
        if (this.handlers.onTurnComplete) {
          this.handlers.onTurnComplete();
        }
      }
    } catch (error) {
      console.error('Failed to parse WebSocket message:', error);
    }
  }

  /**
   * Send audio chunk to the API
   */
  sendAudioChunk(pcmData: Float32Array): void {
    const base64Data = pcmToBase64(pcmData);

    const message: GeminiMessage = {
      realtimeInput: {
        mediaChunks: [
          {
            data: base64Data,
            mimeType: 'audio/pcm;rate=16000',
          },
        ],
      },
    };

    this.send(message);
  }

  /**
   * Send text message to the API
   */
  sendText(text: string, turnComplete: boolean = true): void {
    const message: GeminiMessage = {
      clientContent: {
        turns: [
          {
            role: 'user',
            parts: [{ text }],
          },
        ],
        turnComplete,
      },
    };

    this.send(message);
  }

  /**
   * Mark user turn as complete
   */
  sendTurnComplete(): void {
    const message: GeminiMessage = {
      clientContent: {
        turnComplete: true,
      },
    };

    this.send(message);
  }

  /**
   * Send message through WebSocket
   */
  private send(message: GeminiMessage): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn('WebSocket not ready, queueing message');
      this.messageQueue.push(message);
      return;
    }

    // For non-setup messages, wait until setup is complete
    if (!message.setup && !this.isSetupComplete) {
      this.messageQueue.push(message);
      return;
    }

    try {
      this.ws.send(JSON.stringify(message));
    } catch (error) {
      console.error('Failed to send message:', error);
    }
  }

  /**
   * Process queued messages
   */
  private processMessageQueue(): void {
    while (this.messageQueue.length > 0) {
      const message = this.messageQueue.shift()!;
      this.send(message);
    }
  }

  /**
   * Close the WebSocket connection
   */
  disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.isSetupComplete = false;
    this.messageQueue = [];
  }

  /**
   * Check if WebSocket is connected
   */
  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  /**
   * Check if setup is complete
   */
  isReady(): boolean {
    return this.isConnected() && this.isSetupComplete;
  }
}
