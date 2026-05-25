import React from 'react';
import './ModeToggle.css';

export default function ModeToggle({ mode, setMode }) {
  return (
    <div className="mode-toggle">
      <button
        type="button"
        className={mode === 'code' ? 'active' : ''}
        onClick={() => setMode('code')}
      >
        Code
      </button>
      <button
        type="button"
        className={mode === 'doc' ? 'active' : ''}
        onClick={() => setMode('doc')}
      >
        Docs
      </button>
    </div>
  );
}
