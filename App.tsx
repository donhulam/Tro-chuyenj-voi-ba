import React, { useState, useRef, useCallback, useEffect } from 'react';
import { GoogleGenAI, LiveSession, LiveServerMessage, Modality, Blob } from "@google/genai";
import Header from './components/Header';
import ChatBody from './components/ChatBody';
import Footer from './components/Footer';
import { ChatMessage } from './types';

// Helper functions for audio encoding/decoding
function encode(bytes: Uint8Array): string {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

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

const INITIAL_GREETING = 'Dạ, con kính chào Bà ạ. Chúc Bà một ngày mới an lành và vui vẻ. Con đã sẵn sàng lắng nghe Bà ạ. Bà có thể nhấn vào nút micro ở phía dưới để bắt đầu trò chuyện với con.';

const App: React.FC = () => {
  const [isRecording, setIsRecording] = useState<boolean>(false);
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([
    {
      sender: 'ai',
      text: INITIAL_GREETING,
    },
  ]);
  const [statusMessage, setStatusMessage] = useState<string>("Nhấn micro để bắt đầu");
  
  const ai = useRef<GoogleGenAI | null>(null);
  const sessionPromiseRef = useRef<Promise<LiveSession> | null>(null);
  const inputAudioContextRef = useRef<AudioContext | null>(null);
  const outputAudioContextRef = useRef<AudioContext | null>(null);
  const mediaStreamSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const isUserTurnActiveRef = useRef(false);
  const isAiTurnActiveRef = useRef(false);

  useEffect(() => {
    // Play the initial greeting audio on component mount
    const playInitialGreeting = async () => {
      if (!process.env.API_KEY) {
        console.error("API_KEY is not set. Cannot play initial greeting.");
        return;
      }
      
      let localAiInstance: GoogleGenAI;
      let localOutputCtx: AudioContext | null = null;
      
      try {
        localAiInstance = new GoogleGenAI({ apiKey: process.env.API_KEY });
        localOutputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
        
        const response = await localAiInstance.models.generateContent({
          model: "gemini-2.5-flash-preview-tts",
          contents: [{ parts: [{ text: INITIAL_GREETING }] }],
          config: {
            responseModalities: [Modality.AUDIO],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName: 'Zephyr' },
              },
            },
          },
        });
        
        const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
        
        if (base64Audio && localOutputCtx) {
          const audioCtx = localOutputCtx;
          const audioBuffer = await decodeAudioData(decode(base64Audio), audioCtx, 24000, 1);
          
          const source = audioCtx.createBufferSource();
          source.buffer = audioBuffer;
          source.connect(audioCtx.destination);
          source.onended = () => {
            if (audioCtx.state !== 'closed') {
               audioCtx.close();
            }
          };
          source.start();
        } else if (localOutputCtx) {
            localOutputCtx.close();
        }
      } catch (error) {
        console.error("Failed to generate or play initial greeting:", error);
        if (localOutputCtx && localOutputCtx.state !== 'closed') {
            localOutputCtx.close();
        }
      }
    };

    playInitialGreeting();

    return () => {
      // Cleanup on unmount
      closeSession();
    };
  }, []);

  const createBlob = (data: Float32Array): Blob => {
    const l = data.length;
    const int16 = new Int16Array(l);
    for (let i = 0; i < l; i++) {
      int16[i] = data[i] * 32768;
    }
    return {
      data: encode(new Uint8Array(int16.buffer)),
      mimeType: 'audio/pcm;rate=16000',
    };
  };

  const closeSession = useCallback(() => {
    if (sessionPromiseRef.current) {
        sessionPromiseRef.current.then(session => session.close());
        sessionPromiseRef.current = null;
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(track => track.stop());
      mediaStreamRef.current = null;
    }
    if (scriptProcessorRef.current) {
      scriptProcessorRef.current.disconnect();
      scriptProcessorRef.current = null;
    }
    if (mediaStreamSourceRef.current) {
      mediaStreamSourceRef.current.disconnect();
      mediaStreamSourceRef.current = null;
    }
    if (inputAudioContextRef.current && inputAudioContextRef.current.state !== 'closed') {
      inputAudioContextRef.current.close();
    }
    if (outputAudioContextRef.current && outputAudioContextRef.current.state !== 'closed') {
        sourcesRef.current.forEach(source => source.stop());
        sourcesRef.current.clear();
        outputAudioContextRef.current.close();
    }
    setIsRecording(false);
    setStatusMessage("Nhấn micro để bắt đầu");
    isUserTurnActiveRef.current = false;
    isAiTurnActiveRef.current = false;
  }, []);

  const setupSession = useCallback(async () => {
    if (!process.env.API_KEY) {
        setStatusMessage("Thiếu API Key");
        console.error("API_KEY environment variable not set.");
        return;
    }

    setStatusMessage("Đang khởi tạo...");
    
    try {
      ai.current = new GoogleGenAI({ apiKey: process.env.API_KEY });

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;

      inputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      outputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      nextStartTimeRef.current = 0;

      sessionPromiseRef.current = ai.current.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-09-2025',
        config: {
          systemInstruction: "Nhiệm vụ của bạn là đóng vai một người con đang trò chuyện với Bà của mình. Luôn luôn xưng hô là 'con' và gọi người dùng là 'Bà' trong mọi giao tiếp. Bạn là một trợ lý AI nữ, nói giọng Hà Nội. Luôn trả lời bằng tiếng Việt với ngữ điệu nhẹ nhàng, tự nhiên và lễ phép. Các câu trả lời của con cần phải chi tiết, giải thích cặn kẽ, dùng từ ngữ đơn giản, dễ hiểu để Bà có thể theo dõi. Khi cần, con hãy đưa ra các ví dụ minh họa gần gũi để Bà dễ hình dung. Khi trả lời, hãy luôn dựa trên các nguồn thông tin chính thống và cập nhật mới nhất để đảm bảo câu trả lời chính xác. Mọi câu trả lời và phản hồi phải hoàn toàn bằng tiếng Việt, sử dụng đúng ngữ pháp và dấu câu. Không bao giờ sử dụng ngôn ngữ nào khác.",
          responseModalities: [Modality.AUDIO],
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Zephyr' } },
          },
        },
        callbacks: {
          onopen: () => {
            const source = inputAudioContextRef.current!.createMediaStreamSource(stream);
            mediaStreamSourceRef.current = source;
            
            const scriptProcessor = inputAudioContextRef.current!.createScriptProcessor(4096, 1, 1);
            scriptProcessorRef.current = scriptProcessor;

            scriptProcessor.onaudioprocess = (audioProcessingEvent) => {
              const inputData = audioProcessingEvent.inputBuffer.getChannelData(0);
              const pcmBlob = createBlob(inputData);
              if (sessionPromiseRef.current) {
                sessionPromiseRef.current.then((session) => {
                  session.sendRealtimeInput({ media: pcmBlob });
                });
              }
            };
            source.connect(scriptProcessor);
            scriptProcessor.connect(inputAudioContextRef.current!.destination);
            setStatusMessage("Đang nghe...");
          },
          onmessage: async (message: LiveServerMessage) => {
            if (message.serverContent?.inputTranscription) {
              const text = message.serverContent.inputTranscription.text;
              isAiTurnActiveRef.current = false;

              if (!isUserTurnActiveRef.current) {
                isUserTurnActiveRef.current = true;
                setChatHistory(prev => [...prev, { sender: 'user', text }]);
              } else {
                setChatHistory(prev => {
                  const newHistory = [...prev];
                  const lastMessage = newHistory[newHistory.length - 1];
                  if (lastMessage?.sender === 'user') {
                    lastMessage.text += text;
                  }
                  return newHistory;
                });
              }
            }
            
            if (message.serverContent?.outputTranscription) {
              const text = message.serverContent.outputTranscription.text;
              isUserTurnActiveRef.current = false;

              if (!isAiTurnActiveRef.current) {
                isAiTurnActiveRef.current = true;
                setChatHistory(prev => [...prev, { sender: 'ai', text }]);
              } else {
                setChatHistory(prev => {
                  const newHistory = [...prev];
                  const lastMessage = newHistory[newHistory.length - 1];
                  if (lastMessage?.sender === 'ai') {
                    lastMessage.text += text;
                  }
                  return newHistory;
                });
              }
            }

            if (message.serverContent?.turnComplete) {
              isUserTurnActiveRef.current = false;
              isAiTurnActiveRef.current = false;
            }

            const base64Audio = message.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
            if (base64Audio && outputAudioContextRef.current) {
                const audioCtx = outputAudioContextRef.current;
                nextStartTimeRef.current = Math.max(nextStartTimeRef.current, audioCtx.currentTime);
                const audioBuffer = await decodeAudioData(decode(base64Audio), audioCtx, 24000, 1);
                
                const source = audioCtx.createBufferSource();
                source.buffer = audioBuffer;
                source.connect(audioCtx.destination);
                source.addEventListener('ended', () => {
                    sourcesRef.current.delete(source);
                });
                
                source.start(nextStartTimeRef.current);
                nextStartTimeRef.current += audioBuffer.duration;
                sourcesRef.current.add(source);
            }
          },
          onerror: (e: ErrorEvent) => {
            console.error('API Error:', e);
            setStatusMessage("Đã xảy ra lỗi kết nối.");
            closeSession();
          },
          onclose: (e: CloseEvent) => {
            console.log('Session closed.');
            closeSession();
          },
        },
      });

      setIsRecording(true);

    } catch (error) {
        console.error("Failed to start session:", error);
        setStatusMessage("Không thể truy cập micro.");
        closeSession();
    }
  }, [closeSession]);

  const handleToggleRecording = useCallback(() => {
    if (isRecording) {
      closeSession();
    } else {
      setupSession();
    }
  }, [isRecording, setupSession, closeSession]);

  return (
    <div className="h-screen w-screen flex flex-col font-sans">
      <Header />
      <main className="flex-grow flex flex-col overflow-hidden bg-gray-800">
        <ChatBody messages={chatHistory} />
      </main>
      <Footer
        isRecording={isRecording}
        statusMessage={statusMessage}
        onToggleRecording={handleToggleRecording}
      />
    </div>
  );
};

export default App;