import React from 'react';
import { Moon, Sun } from 'lucide-react';

/**
 * ModeToggle - premium UI component to switch between Code and Documentation query modes.
 *
 * Props:
 *   mode: current mode string ('code' | 'doc')
 *   onChange: callback receiving the new mode
 */
export default function ModeToggle({ mode = 'code', onChange }) {
  const isDoc = mode === 'doc';
  const handleToggle = (newMode) => {
    if (newMode !== mode && typeof onChange === 'function') {
      onChange(newMode);
    }
  };

  return (
    <div className="flex items-center gap-2 p-1 bg-gradient-to-r from-indigo-500/20 via-purple-500/10 to-pink-500/20 rounded-xl shadow-lg backdrop-blur-sm">
      <button
        type="button"
        onClick={() => handleToggle('code')}
        className={`px-3 py-1 rounded transition-colors flex items-center gap-1 ${!isDoc ? 'bg-indigo-600 text-white' : 'bg-white/10 text-indigo-300'} min-w-[44px] min-h-[44px] focus:outline-none focus:ring-2 focus:ring-indigo-500`}
        aria-pressed={!isDoc}
      >
        <Sun size={16} className="stroke-current" />
        <span className="font-medium">Code</span>
      </button>
      <button
        type="button"
        onClick={() => handleToggle('doc')}
        className={`px-3 py-1 rounded transition-colors flex items-center gap-1 ${isDoc ? 'bg-indigo-600 text-white' : 'bg-white/10 text-indigo-300'} `}
        aria-pressed={isDoc}
      >
        <Moon size={16} className="stroke-current" />
        <span className="font-medium">Docs</span>
      </button>
    </div>
  );
}
