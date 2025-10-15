import React from 'react';
import MicrophoneIcon from './icons/MicrophoneIcon';

interface FooterProps {
  isRecording: boolean;
  statusMessage: string;
  onToggleRecording: () => void;
  disabled?: boolean;
}

const Footer: React.FC<FooterProps> = ({ isRecording, statusMessage, onToggleRecording, disabled }) => {
  return (
    <footer className="p-4 border-t border-gray-700 flex flex-col items-center justify-center gap-3">
      <button
        onClick={onToggleRecording}
        disabled={disabled}
        className={`relative w-16 h-16 rounded-full flex items-center justify-center transition-all duration-300 transform 
          ${isRecording ? 'bg-red-500' : 'bg-blue-600'}
          ${!disabled ? 'hover:scale-105 active:scale-95 scale-100' : ''}
          disabled:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed
        `}
        aria-label={isRecording ? 'Dừng ghi âm' : 'Bắt đầu ghi âm'}
      >
        {isRecording && (
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
        )}
        <MicrophoneIcon className="w-8 h-8 text-white" />
      </button>
      <p className="text-sm text-gray-400 h-5">{statusMessage}</p>
    </footer>
  );
};

export default Footer;
