import React, { useRef, useEffect } from 'react';
import { ChatMessage } from '../types';
import AiIcon from './icons/AiIcon';
import UserIcon from './icons/UserIcon';

interface ChatBodyProps {
  messages: ChatMessage[];
}

const ChatBody: React.FC<ChatBodyProps> = ({ messages }) => {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  return (
    <div ref={scrollRef} className="flex-grow p-4 space-y-4 overflow-y-auto">
      {messages.map((msg, index) => (
        <div key={index} className={`flex items-end gap-2 ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}>
          {msg.sender === 'ai' && (
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-teal-400 to-blue-500 flex items-center justify-center text-white shrink-0 p-1.5">
              <AiIcon className="w-full h-full" />
            </div>
          )}
          <div className={`max-w-xs md:max-w-md lg:max-w-lg px-4 py-2 rounded-2xl ${
              msg.sender === 'user'
                ? 'bg-blue-600 text-white rounded-br-none'
                : 'bg-gray-700 text-gray-200 rounded-bl-none'
            }`}
          >
            <p className="text-sm break-words">{msg.text}</p>
          </div>
           {msg.sender === 'user' && (
            <div className="w-8 h-8 rounded-full bg-gray-600 flex items-center justify-center text-gray-300 shrink-0 p-1.5">
               <UserIcon className="w-full h-full" />
            </div>
          )}
        </div>
      ))}
    </div>
  );
};

export default ChatBody;
