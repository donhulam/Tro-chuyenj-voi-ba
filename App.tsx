import React, { useState, useRef, useCallback } from 'react';
import {
  GoogleGenAI,
  LiveSession,
  LiveServerMessage,
  Modality,
  Blob,
} from '@google/genai';

import Header from './components/Header';
import ChatBody from './components/ChatBody';
import Footer from './components/Footer';
import { ChatMessage } from './types';

// Helper functions for audio encoding/decoding from guidelines
function decode(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

async function decodeAudioData(
  data: Uint8Array,
  ctx: AudioContext,
  sampleRate: number,
  numChannels: number,
): Promise<AudioBuffer> {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}

function encode(bytes: Uint8Array): string {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function createBlob(data: Float32Array): Blob {
  const l = data.length;
  const int16 = new Int16Array(l);
  for (let i = 0; i < l; i++) {
    int16[i] = data[i] * 32768;
  }
  return {
    data: encode(new Uint8Array(int16.buffer)),
    // Fix: The supported audio MIME type is 'audio/pcm'.
    mimeType: 'audio/pcm;rate=16000',
  };
}

const App: React.FC = () => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isRecording, setIsRecording] = useState(false);
  const [statusMessage, setStatusMessage] = useState('Bấm vào micro để bắt đầu');

  // Fix: Initialize the Gemini AI client instance. It must be initialized with an object containing the apiKey.
  const aiRef = useRef(new GoogleGenAI({ apiKey: process.env.API_KEY! }));
  const sessionPromiseRef = useRef<Promise<LiveSession> | null>(null);
  const inputAudioContextRef = useRef<AudioContext | null>(null);
  const outputAudioContextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);

  const nextStartTimeRef = useRef(0);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());

  const currentInputTranscriptionRef = useRef('');
  const currentOutputTranscriptionRef = useRef('');
  
  const stopEverything = useCallback(() => {
    // Stop audio playback
    sourcesRef.current.forEach((source) => source.stop());
    sourcesRef.current.clear();
    nextStartTimeRef.current = 0;
    
    // Stop microphone stream
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    // Disconnect script processor
    if (scriptProcessorRef.current) {
        scriptProcessorRef.current.disconnect();
        scriptProcessorRef.current.onaudioprocess = null;
        scriptProcessorRef.current = null;
    }

    // Close audio contexts
    if (inputAudioContextRef.current && inputAudioContextRef.current.state !== 'closed') {
      inputAudioContextRef.current.close();
      inputAudioContextRef.current = null;
    }
    if (outputAudioContextRef.current && outputAudioContextRef.current.state !== 'closed') {
      outputAudioContextRef.current.close();
      outputAudioContextRef.current = null;
    }

    // Close session
    if (sessionPromiseRef.current) {
      sessionPromiseRef.current.then((session) => {
        session.close();
      });
      sessionPromiseRef.current = null;
    }

    setIsRecording(false);
    setStatusMessage('Bấm vào micro để bắt đầu');
  }, []);


  const startSession = useCallback(async () => {
    const ai = aiRef.current;
    if (!ai) {
        setStatusMessage('AI client not initialized.');
        return;
    }
    
    setStatusMessage('Đang khởi tạo...');
    
    inputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
    outputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
    
    try {
        streamRef.current = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (error) {
        console.error('Error getting user media:', error);
        setStatusMessage('Không thể truy cập micro.');
        stopEverything();
        return;
    }

    sessionPromiseRef.current = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-09-2025',
        callbacks: {
            onopen: () => {
                setStatusMessage('Đang lắng nghe...');
                
                const source = inputAudioContextRef.current!.createMediaStreamSource(streamRef.current!);
                const scriptProcessor = inputAudioContextRef.current!.createScriptProcessor(4096, 1, 1);
                scriptProcessorRef.current = scriptProcessor;

                scriptProcessor.onaudioprocess = (audioProcessingEvent) => {
                    const inputData = audioProcessingEvent.inputBuffer.getChannelData(0);
                    const pcmBlob = createBlob(inputData);
                    sessionPromiseRef.current?.then((session) => {
                        session.sendRealtimeInput({ media: pcmBlob });
                    });
                };
                source.connect(scriptProcessor);
                scriptProcessor.connect(inputAudioContextRef.current!.destination);
            },
            onmessage: async (message: LiveServerMessage) => {
                const outputAudioContext = outputAudioContextRef.current;
                if (!outputAudioContext) return;

                if (message.serverContent?.outputTranscription) {
                    const text = message.serverContent.outputTranscription.text;
                    currentOutputTranscriptionRef.current += text;
                } else if (message.serverContent?.inputTranscription) {
                    const text = message.serverContent.inputTranscription.text;
                    currentInputTranscriptionRef.current += text;
                }

                if (message.serverContent?.turnComplete) {
                    const fullInputTranscription = currentInputTranscriptionRef.current.trim();
                    const fullOutputTranscription = currentOutputTranscriptionRef.current.trim();
                    
                    setMessages(prev => {
                        const newMessages = [...prev];
                        if (fullInputTranscription) {
                            newMessages.push({ sender: 'user', text: fullInputTranscription });
                        }
                        if (fullOutputTranscription) {
                            newMessages.push({ sender: 'ai', text: fullOutputTranscription });
                        }
                        return newMessages;
                    });

                    currentInputTranscriptionRef.current = '';
                    currentOutputTranscriptionRef.current = '';
                }

                const base64EncodedAudioString = message.serverContent?.modelTurn?.parts[0]?.inlineData.data;
                if (base64EncodedAudioString) {
                    nextStartTimeRef.current = Math.max(
                        nextStartTimeRef.current,
                        outputAudioContext.currentTime,
                    );
                    const audioBuffer = await decodeAudioData(
                        decode(base64EncodedAudioString),
                        outputAudioContext,
                        24000,
                        1,
                    );
                    const source = outputAudioContext.createBufferSource();
                    source.buffer = audioBuffer;
                    source.connect(outputAudioContext.destination);
                    source.addEventListener('ended', () => {
                        sourcesRef.current.delete(source);
                    });

                    source.start(nextStartTimeRef.current);
                    nextStartTimeRef.current = nextStartTimeRef.current + audioBuffer.duration;
                    sourcesRef.current.add(source);
                }

                const interrupted = message.serverContent?.interrupted;
                if (interrupted) {
                    sourcesRef.current.forEach((source) => source.stop());
                    sourcesRef.current.clear();
                    nextStartTimeRef.current = 0;
                }
            },
            onerror: (e: ErrorEvent) => {
                console.error('Session error:', e);
                setStatusMessage('Đã xảy ra lỗi. Vui lòng thử lại.');
                stopEverything();
            },
            onclose: () => {
                setStatusMessage('Phiên đã kết thúc. Bấm để bắt đầu lại.');
                stopEverything();
            },
        },
        config: {
            responseModalities: [Modality.AUDIO],
            outputAudioTranscription: {},
            inputAudioTranscription: {},
        },
    });

    setIsRecording(true);
  }, [stopEverything]);

  const handleToggleRecording = () => {
    if (isRecording) {
      stopEverything();
    } else {
      startSession();
    }
  };

  return (
    <div className="bg-gray-800 text-white h-screen flex flex-col font-sans">
      <Header />
      <ChatBody messages={messages} />
      <Footer
        isRecording={isRecording}
        statusMessage={statusMessage}
        onToggleRecording={handleToggleRecording}
      />
    </div>
  );
};

export default App;
