import React from 'react';

const Header: React.FC = () => {
  return (
    <header className="bg-gray-900/50 backdrop-blur-sm border-b border-gray-700 p-4 text-center sticky top-0 z-10">
      <h1 className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-teal-300">
        TRÒ CHUYỆN HÀNG NGÀY
      </h1>
    </header>
  );
};

export default Header;