import React from 'react';
import { Volume2, VolumeX, Sliders } from 'lucide-react';
import { useSoundStore } from '../../stores/soundStore';
import { soundManager } from '../../utils/soundManager';

export default function SoundToggle({ className = '', showPreviewBtn = true }) {
  const { soundEnabled, toggleSound, openSoundModal } = useSoundStore();

  return (
    <div className={`flex items-center gap-1.5 ${className}`}>
      {/* Quick Mute/Unmute Button */}
      <button
        onClick={() => {
          toggleSound();
          soundManager.playButtonClick();
        }}
        title={soundEnabled ? "كتم الصوت" : "تشغيل الصوت"}
        className={`p-2 rounded-xl border transition-all duration-200 active:scale-95 ${
          soundEnabled 
            ? 'bg-gray-800/80 border-gray-700 text-primary hover:bg-gray-700/80 hover:border-primary/40 shadow-sm' 
            : 'bg-rose-500/10 border-rose-500/30 text-rose-400 hover:bg-rose-500/20'
        }`}
      >
        {soundEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
      </button>

      {/* Sound Settings & Preview Button */}
      {showPreviewBtn && (
        <button
          onClick={() => {
            soundManager.playButtonClick();
            openSoundModal();
          }}
          title="معاينة وتجربة المؤثرات الصوتية"
          className="p-2 rounded-xl bg-gray-800/80 border border-gray-700 text-gray-300 hover:text-white hover:bg-gray-700/80 hover:border-primary/40 transition-all duration-200 active:scale-95"
        >
          <Sliders className="w-4 h-4 text-primary/80" />
        </button>
      )}
    </div>
  );
}
