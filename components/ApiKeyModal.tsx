import React, { useState } from 'react';

interface ApiKeyModalProps {
  show: boolean;
  onSave: (key: string) => void;
}

const ApiKeyModal: React.FC<ApiKeyModalProps> = ({ show, onSave }) => {
  const [inputValue, setInputValue] = useState('');

  if (!show) {
    return null;
  }

  const handleSave = () => {
    if (inputValue.trim()) {
      onSave(inputValue.trim());
    }
  };

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 transition-opacity duration-300" aria-modal="true" role="dialog">
      <div className="bg-gray-800 border border-gray-700 p-6 rounded-lg shadow-xl w-full max-w-md m-4 transform transition-all duration-300 scale-100">
        <h2 className="text-xl font-bold mb-2 text-white">Yêu cầu Google API Key</h2>
        <p className="text-gray-400 mb-4 text-sm">
          Vui lòng nhập API Key của Bà từ Google AI Studio để tiếp tục. Ứng dụng cần key này để có thể trò chuyện ạ.
        </p>
        <div className="mb-4">
          <label htmlFor="apiKey" className="block text-sm font-medium text-gray-300 mb-1">
            API Key
          </label>
          <input
            id="apiKey"
            type="password"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            className="w-full px-3 py-2 bg-gray-900 border border-gray-600 rounded-md text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition"
            placeholder="Dán API Key của Bà vào đây"
            autoFocus
          />
        </div>
        <a 
          href="https://aistudio.google.com/app/apikey" 
          target="_blank" 
          rel="noopener noreferrer"
          className="text-sm text-blue-400 hover:underline mb-4 block"
        >
          Lấy API Key từ Google AI Studio
        </a>
        <button
          onClick={handleSave}
          disabled={!inputValue.trim()}
          className="w-full bg-blue-600 text-white font-bold py-2 px-4 rounded-md hover:bg-blue-700 transition disabled:bg-gray-600 disabled:cursor-not-allowed"
        >
          Lưu và Bắt đầu
        </button>
      </div>
    </div>
  );
};

export default ApiKeyModal;
