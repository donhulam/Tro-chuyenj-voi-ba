import React, { useState, useRef, useCallback, useEffect } from 'react';
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
import ApiKeyModal from './components/ApiKeyModal';
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
    mimeType: 'audio/pcm;rate=16000',
  };
}

const App: React.FC = () => {
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [showApiKeyModal, setShowApiKeyModal] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isRecording, setIsRecording] = useState(false);
  const [statusMessage, setStatusMessage] = useState('Đang chờ API Key...');

  const aiRef = useRef<GoogleGenAI | null>(null);
  const sessionPromiseRef = useRef<Promise<LiveSession> | null>(null);
  const inputAudioContextRef = useRef<AudioContext | null>(null);
  const outputAudioContextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);

  const nextStartTimeRef = useRef(0);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());

  useEffect(() => {
    const savedKey = localStorage.getItem('google-api-key');
    if (savedKey) {
      setApiKey(savedKey);
      setStatusMessage('Bấm vào micro để bắt đầu');
    } else {
      setShowApiKeyModal(true);
    }
  }, []);

  useEffect(() => {
    if (apiKey) {
      try {
        aiRef.current = new GoogleGenAI({ apiKey });
      } catch (error) {
        console.error("Lỗi khởi tạo GoogleGenAI:", error);
        setStatusMessage('API Key không hợp lệ.');
        setApiKey(null);
        localStorage.removeItem('google-api-key');
        setShowApiKeyModal(true);
      }
    }
  }, [apiKey]);

  const handleSaveApiKey = (key: string) => {
    const trimmedKey = key.trim();
    if (trimmedKey) {
      setApiKey(trimmedKey);
      localStorage.setItem('google-api-key', trimmedKey);
      setShowApiKeyModal(false);
      setStatusMessage('Bấm vào micro để bắt đầu');
    }
  };
  
  const stopEverything = useCallback(() => {
    sourcesRef.current.forEach((source) => source.stop());
    sourcesRef.current.clear();
    nextStartTimeRef.current = 0;
    
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    if (scriptProcessorRef.current) {
        scriptProcessorRef.current.disconnect();
        scriptProcessorRef.current.onaudioprocess = null;
        scriptProcessorRef.current = null;
    }

    if (inputAudioContextRef.current && inputAudioContextRef.current.state !== 'closed') {
      inputAudioContextRef.current.close().catch(console.error);
      inputAudioContextRef.current = null;
    }
    if (outputAudioContextRef.current && outputAudioContextRef.current.state !== 'closed') {
      outputAudioContextRef.current.close().catch(console.error);
      outputAudioContextRef.current = null;
    }

    if (sessionPromiseRef.current) {
      sessionPromiseRef.current.then((session) => {
        session.close();
      }).catch(console.error);
      sessionPromiseRef.current = null;
    }

    setIsRecording(false);
    if (apiKey) {
        setStatusMessage('Bấm vào micro để bắt đầu');
    } else {
        setStatusMessage('Đang chờ API Key...');
    }
  }, [apiKey]);

  const startSession = useCallback(async () => {
    const ai = aiRef.current;
    if (!ai) {
        setStatusMessage('Chưa có API Key. Vui lòng nhập key.');
        setShowApiKeyModal(true);
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
                
                // Real-time text transcription
                if (message.serverContent?.outputTranscription) {
                    const text = message.serverContent.outputTranscription.text;
                    setMessages(prev => {
                        const lastMessage = prev[prev.length - 1];
                        if (lastMessage?.sender === 'ai') {
                            const updatedMessages = [...prev];
                            updatedMessages[updatedMessages.length - 1] = {
                                ...lastMessage,
                                text: lastMessage.text + text,
                            };
                            return updatedMessages;
                        }
                        return [...prev, { sender: 'ai', text: text }];
                    });
                } else if (message.serverContent?.inputTranscription) {
                    const text = message.serverContent.inputTranscription.text;
                    setMessages(prev => {
                        const lastMessage = prev[prev.length - 1];
                        if (lastMessage?.sender === 'user') {
                            const updatedMessages = [...prev];
                            updatedMessages[updatedMessages.length - 1] = {
                                ...lastMessage,
                                text: lastMessage.text + text,
                            };
                            return updatedMessages;
                        }
                        return [...prev, { sender: 'user', text: text }];
                    });
                }


                const base64EncodedAudioString = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
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
                // Do not call stopEverything() here to avoid infinite loops on close
                setIsRecording(false);
                setStatusMessage('Phiên đã kết thúc.');
            },
        },
        config: {
            responseModalities: [Modality.AUDIO],
            outputAudioTranscription: {},
            inputAudioTranscription: {},
            systemInstruction: 'Trong mọi giao tiếp, bạn phải gọi người dùng là "Bà" và xưng là "con". Hãy luôn giữ thái độ lễ phép, kính trọng và thân mật. Bạn phải luôn trả lời bằng tiếng Việt, với ngữ điệu và giọng nói của một người phụ nữ trẻ Hà Nội. Câu trả lời của con cần phải chi tiết, cặn kẽ nhưng dễ hiểu, sử dụng từ ngữ đơn giản. Khi cần, hãy đưa ra ví dụ minh họa hoặc bằng chứng phù hợp với ngữ cảnh để Bà dễ hình dung. Hãy luôn nói chuyện một cách chậm rãi, rõ ràng và kiên nhẫn.',
            speechConfig: {
                voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Zephyr' } },
            },
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
      <ApiKeyModal show={showApiKeyModal} onSave={handleSaveApiKey} />
      <Header />
      <ChatBody messages={messages} />
      <Footer
        isRecording={isRecording}
        statusMessage={statusMessage}
        onToggleRecording={handleToggleRecording}
        disabled={!apiKey}
      />
    </div>
  );
};

export default App;