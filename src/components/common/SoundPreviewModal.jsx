import React from 'react';
import { Volume2, VolumeX, Play, X, Sliders, Sparkles, Bell, Trophy, ShieldAlert, CheckCircle, XCircle, Clock } from 'lucide-react';
import { useSoundStore } from '../../stores/soundStore';
import { soundManager } from '../../utils/soundManager';

export default function SoundPreviewModal() {
  const { soundEnabled, sfxVolume, isSoundModalOpen, toggleSound, setVolume, closeSoundModal } = useSoundStore();

  if (!isSoundModalOpen) return null;

  const soundCatalog = [
    {
      id: 'match_alert',
      nameAr: 'تنبيه استدعاء للمباراة',
      nameEn: 'Tournament Match Alert',
      desc: 'صوت تنبيه عند استدعائك للعب مباراتك في شجرة البطولة',
      icon: Bell,
      color: 'text-amber-400 bg-amber-500/10 border-amber-500/30',
      play: () => soundManager.playMatchAlert(),
    },
    {
      id: 'stage_start',
      nameAr: 'بداية مرحلة جديدة',
      nameEn: 'New Stage / Round Start',
      desc: 'صوت حماسي عند الانقال لمرحلة ربع/نصف النهائي أو النهائي',
      icon: Sparkles,
      color: 'text-cyan-400 bg-cyan-500/10 border-cyan-500/30',
      play: () => soundManager.playStageStart(),
    },
    {
      id: 'correct',
      nameAr: 'إجابة صحيحة',
      nameEn: 'Correct Answer Chime',
      desc: 'صوت احتفالي ناعم عند اختيار الإجابة الصحيحة',
      icon: CheckCircle,
      color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30',
      play: () => soundManager.playCorrect(),
    },
    {
      id: 'wrong',
      nameAr: 'إجابة خاطئة',
      nameEn: 'Wrong Answer Buzz',
      desc: 'نغمة تنبيه منخفضة عند الإجابة الخاطئة',
      icon: XCircle,
      color: 'text-rose-400 bg-rose-500/10 border-rose-500/30',
      play: () => soundManager.playWrong(),
    },
    {
      id: 'victory',
      nameAr: 'نغمة الفوز والتتويج',
      nameEn: 'Victory Champion Fanfare',
      desc: 'موسيقى تتويج بطل البطولة أو فائز الدويل',
      icon: Trophy,
      color: 'text-yellow-400 bg-yellow-500/10 border-yellow-500/30',
      play: () => soundManager.playVictory(),
    },
    {
      id: 'defeat',
      nameAr: 'نغمة الخسارة / المغادرة',
      nameEn: 'Defeat / Game Over',
      desc: 'صوت عند الإقصاء أو خسارة الدويل',
      icon: ShieldAlert,
      color: 'text-purple-400 bg-purple-500/10 border-purple-500/30',
      play: () => soundManager.playDefeat(),
    },
    {
      id: 'tick',
      nameAr: 'تكتكة الثواني الأخيرة',
      nameEn: 'Urgent Countdown Tick',
      desc: 'تكتكة سريعة في آخر 5 ثوانٍ من السؤال',
      icon: Clock,
      color: 'text-blue-400 bg-blue-500/10 border-blue-500/30',
      play: () => soundManager.playTick(),
    },
  ];

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fade-in"
      dir="rtl"
    >
      <div className="relative w-full max-w-2xl bg-gray-900/95 border border-primary/30 rounded-2xl shadow-2xl shadow-primary/20 overflow-hidden flex flex-col max-h-[90vh]">
        
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800 bg-gray-900/80">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-primary/10 border border-primary/30 text-primary">
              <Sliders className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">معاينة المؤثرات الصوتية (SFX Preview)</h2>
              <p className="text-xs text-gray-400">استمع لجميع المؤثرات الصوتية واضبط مستوى الصوت</p>
            </div>
          </div>
          <button
            onClick={closeSoundModal}
            className="p-2 rounded-xl text-gray-400 hover:text-white hover:bg-gray-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Global Sound Control Controls */}
        <div className="p-6 bg-gray-800/40 border-b border-gray-800 flex flex-col sm:flex-row items-center justify-between gap-4">
          
          {/* Mute Toggle */}
          <div className="flex items-center gap-3 w-full sm:w-auto">
            <button
              onClick={() => {
                toggleSound();
                soundManager.playButtonClick();
              }}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-xl border text-sm font-semibold transition-all duration-200 ${
                soundEnabled 
                  ? 'bg-primary/20 border-primary/40 text-primary hover:bg-primary/30 shadow-lg shadow-primary/10' 
                  : 'bg-rose-500/20 border-rose-500/40 text-rose-400 hover:bg-rose-500/30'
              }`}
            >
              {soundEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
              <span>{soundEnabled ? 'المؤثرات الصوتية مفعلة' : 'المؤثرات مكتومة'}</span>
            </button>
          </div>

          {/* Volume Slider */}
          <div className="flex items-center gap-3 w-full sm:w-64 bg-gray-900/60 px-4 py-2 rounded-xl border border-gray-700/50">
            <Volume2 className="w-4 h-4 text-gray-400 shrink-0" />
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={sfxVolume}
              onChange={(e) => setVolume(parseFloat(e.target.value))}
              disabled={!soundEnabled}
              className="w-full accent-primary cursor-pointer disabled:opacity-40"
            />
            <span className="text-xs font-mono text-gray-300 w-9 text-left shrink-0">
              {Math.round(sfxVolume * 100)}%
            </span>
          </div>
        </div>

        {/* Sound Catalog Grid */}
        <div className="p-6 overflow-y-auto space-y-3 custom-scrollbar">
          <p className="text-xs font-medium text-gray-400 mb-2">اضغط على أي زر تجربة للاستماع للمؤثر المخصص:</p>
          
          {soundCatalog.map((sound) => {
            const Icon = sound.icon;
            return (
              <div 
                key={sound.id}
                className="flex items-center justify-between p-3.5 bg-gray-800/50 hover:bg-gray-800/80 border border-gray-700/50 rounded-xl transition-all group"
              >
                <div className="flex items-center gap-3">
                  <div className={`p-2.5 rounded-lg border ${sound.color}`}>
                    <Icon className="w-4 h-4" />
                  </div>
                  <div>
                    <h4 className="text-sm font-semibold text-white group-hover:text-primary transition-colors">
                      {sound.nameAr}
                    </h4>
                    <p className="text-xs text-gray-400">{sound.desc}</p>
                  </div>
                </div>

                <button
                  onClick={() => {
                    sound.play();
                  }}
                  disabled={!soundEnabled}
                  className="flex items-center gap-1.5 px-3.5 py-2 bg-primary/10 hover:bg-primary/20 text-primary border border-primary/30 rounded-lg text-xs font-semibold active:scale-95 transition-all disabled:opacity-40 disabled:pointer-events-none"
                >
                  <Play className="w-3.5 h-3.5 fill-current" />
                  <span>تجربة الصوت</span>
                </button>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-gray-900/90 border-t border-gray-800 flex justify-end">
          <button
            onClick={closeSoundModal}
            className="px-5 py-2 bg-primary text-gray-950 hover:bg-primary/90 rounded-xl font-bold text-sm transition-all shadow-lg shadow-primary/20 active:scale-95"
          >
            تم / إغلاق
          </button>
        </div>

      </div>
    </div>
  );
}
