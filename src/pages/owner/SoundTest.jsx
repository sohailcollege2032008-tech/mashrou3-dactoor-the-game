import React, { useState } from 'react';
import { Volume2, VolumeX, Play, Sliders, Sparkles, Bell, Trophy, ShieldAlert, CheckCircle, XCircle, Clock, ArrowLeft, RefreshCw } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { soundManager } from '../../utils/soundManager';
import { useSoundStore } from '../../stores/soundStore';

export default function SoundTest() {
  const navigate = useNavigate();
  const { soundEnabled, sfxVolume, toggleSound, setVolume } = useSoundStore();
  const [activePlaying, setActivePlaying] = useState(null);

  const soundCatalog = [
    {
      id: 'match_alert',
      nameAr: 'تنبيه استدعاء للمباراة (Match Alert)',
      nameEn: 'Match Call Notification',
      desc: 'نغمة تنبيه 3 نغمات متصاعدة عند جاهزية المباراة واستدعاء اللاعب',
      icon: Bell,
      color: 'text-amber-400 bg-amber-500/10 border-amber-500/30 hover:border-amber-400',
      play: () => soundManager.playMatchAlert(),
    },
    {
      id: 'stage_start',
      nameAr: 'بداية مرحلة جديدة (Stage Start)',
      nameEn: 'Round / Stage Transition',
      desc: 'صوت حماسي عند الانقال لربع/نصف النهائي أو جولة جديدة',
      icon: Sparkles,
      color: 'text-cyan-400 bg-cyan-500/10 border-cyan-500/30 hover:border-cyan-400',
      play: () => soundManager.playStageStart(),
    },
    {
      id: 'correct',
      nameAr: 'إجابة صحيحة (Correct Answer)',
      nameEn: 'Arcade Double Ding',
      desc: 'صوت إجابة صحيحة (C6 -> E6)',
      icon: CheckCircle,
      color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30 hover:border-emerald-400',
      play: () => soundManager.playCorrect(),
    },
    {
      id: 'wrong',
      nameAr: 'إجابة خاطئة (Wrong Answer)',
      nameEn: 'Low Sawtooth Buzz',
      desc: 'نغمة خطأ منخفضة عند الإجابة الخاطئة',
      icon: XCircle,
      color: 'text-rose-400 bg-rose-500/10 border-rose-500/30 hover:border-rose-400',
      play: () => soundManager.playWrong(),
    },
    {
      id: 'victory',
      nameAr: 'نغمة الفوز والتتويج (Victory)',
      nameEn: 'Champion Fanfare',
      desc: 'موسيقى تتويج الفائز بالبطولة أو الدويل',
      icon: Trophy,
      color: 'text-yellow-400 bg-yellow-500/10 border-yellow-500/30 hover:border-yellow-400',
      play: () => soundManager.playVictory(),
    },
    {
      id: 'defeat',
      nameAr: 'نغمة الخسارة (Defeat / Game Over)',
      nameEn: 'Minor Descending Cadence',
      desc: 'صوت عند الإقصاء أو خسارة المبارارة',
      icon: ShieldAlert,
      color: 'text-purple-400 bg-purple-500/10 border-purple-500/30 hover:border-purple-400',
      play: () => soundManager.playDefeat(),
    },
    {
      id: 'tick',
      nameAr: 'تكتكة الثواني الأخيرة (Countdown Tick)',
      nameEn: 'Urgent Timer Tap',
      desc: 'تكتكة سريعة في آخر 5 ثوانٍ من الوقت',
      icon: Clock,
      color: 'text-blue-400 bg-blue-500/10 border-blue-500/30 hover:border-blue-400',
      play: () => soundManager.playTick(),
    },
    {
      id: 'button_click',
      nameAr: 'نقر زر UI (Button Click)',
      nameEn: 'UI Switch Click',
      desc: 'صوت خفيف عند الضغط على الأزرار',
      icon: RefreshCw,
      color: 'text-gray-300 bg-gray-700/30 border-gray-600/30 hover:border-gray-400',
      play: () => soundManager.playButtonClick(),
    },
  ];

  const handlePlaySound = (sound) => {
    setActivePlaying(sound.id);
    sound.play();
    setTimeout(() => setActivePlaying(null), 800);
  };

  return (
    <div 
      className="min-h-screen bg-gray-950 text-white p-4 sm:p-8 font-sans selection:bg-primary selection:text-black"
      dir="rtl"
    >
      <div className="max-w-4xl mx-auto space-y-6">
        
        {/* Top Header Navigation */}
        <div className="flex items-center justify-between border-b border-gray-800 pb-4">
          <button
            onClick={() => navigate('/')}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-gray-900 border border-gray-800 text-gray-300 hover:text-white hover:border-gray-700 transition-colors text-sm font-semibold"
          >
            <ArrowLeft className="w-4 h-4 rotate-180" />
            <span>العودة للرئيسية</span>
          </button>

          <div className="flex items-center gap-3">
            <span className="px-3 py-1 bg-amber-500/10 border border-amber-500/30 text-amber-400 text-xs font-mono rounded-full">
              Standalone Admin Studio
            </span>
          </div>
        </div>

        {/* Hero Section */}
        <div className="bg-gradient-to-br from-gray-900 via-gray-900 to-gray-950 border border-gray-800 rounded-3xl p-6 sm:p-8 shadow-2xl relative overflow-hidden">
          <div className="absolute top-0 left-0 w-96 h-96 bg-primary/10 rounded-full blur-3xl pointer-events-none" />
          
          <div className="relative z-10 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6">
            <div>
              <div className="flex items-center gap-2 text-primary font-mono text-xs font-semibold mb-2">
                <Sliders className="w-4 h-4" />
                <span>MED ROYALE — SOUND EFFECTS LABORATORY</span>
              </div>
              <h1 className="text-2xl sm:text-3xl font-extrabold text-white">
                صفحة اختبار واستماع المؤثرات الصوتية 🎧
              </h1>
              <p className="text-sm text-gray-400 mt-2 max-w-xl leading-relaxed">
                هذه الصفحة مستقلة ومخصصة لك لاستماع جميع المؤثرات الصوتية واختبار نبرتها ومستوى الصوت، قبل اعتمادها رسمياً في البطولة والألعاب.
              </p>
            </div>

            {/* Master Volume Controls */}
            <div className="w-full sm:w-auto bg-gray-950/80 border border-gray-800 p-4 rounded-2xl flex flex-col gap-3 min-w-[240px]">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-gray-400">حالة الصوت:</span>
                <button
                  onClick={() => toggleSound()}
                  className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-bold transition-all ${
                    soundEnabled ? 'bg-primary/20 text-primary border border-primary/30' : 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                  }`}
                >
                  {soundEnabled ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
                  <span>{soundEnabled ? 'مفعل' : 'مكتوم'}</span>
                </button>
              </div>

              <div className="flex items-center gap-3">
                <Volume2 className="w-4 h-4 text-gray-400 shrink-0" />
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={sfxVolume}
                  onChange={(e) => setVolume(parseFloat(e.target.value))}
                  className="w-full accent-primary cursor-pointer"
                />
                <span className="text-xs font-mono text-gray-300 w-8 text-left font-bold">
                  {Math.round(sfxVolume * 100)}%
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Sound Catalog Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {soundCatalog.map((sound) => {
            const Icon = sound.icon;
            const isPlaying = activePlaying === sound.id;

            return (
              <div
                key={sound.id}
                className={`p-5 rounded-2xl bg-gray-900/80 border transition-all duration-200 flex flex-col justify-between gap-4 group ${
                  isPlaying ? 'border-primary ring-2 ring-primary/20 scale-[1.01]' : 'border-gray-800 hover:border-gray-700'
                }`}
              >
                <div className="flex items-start gap-4">
                  <div className={`p-3.5 rounded-xl border shrink-0 transition-transform ${sound.color} ${isPlaying ? 'scale-110' : ''}`}>
                    <Icon className="w-6 h-6" />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-white group-hover:text-primary transition-colors">
                      {sound.nameAr}
                    </h3>
                    <span className="text-xs font-mono text-gray-400 block mt-0.5">{sound.nameEn}</span>
                    <p className="text-xs text-gray-400 mt-2 leading-normal">{sound.desc}</p>
                  </div>
                </div>

                <div className="flex items-center justify-end border-t border-gray-800/60 pt-3">
                  <button
                    onClick={() => handlePlaySound(sound)}
                    className={`flex items-center gap-2 px-5 py-2.5 rounded-xl font-bold text-xs transition-all active:scale-95 shadow-md ${
                      isPlaying
                        ? 'bg-primary text-gray-950 shadow-primary/30'
                        : 'bg-gray-800 text-white hover:bg-primary/20 hover:text-primary hover:border-primary/40 border border-gray-700'
                    }`}
                  >
                    <Play className={`w-4 h-4 fill-current ${isPlaying ? 'animate-bounce' : ''}`} />
                    <span>{isPlaying ? 'جاري التشغيل…' : 'استمع للمؤثر (Play)'}</span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* Admin Instructions Footer */}
        <div className="p-5 rounded-2xl bg-blue-950/30 border border-blue-800/40 text-blue-300 text-xs leading-relaxed">
          <p className="font-bold mb-1">📌 ملاحظة Sohail:</p>
          <p>
            المؤثرات حالياً متواجدة على هذه الصفحة التجريبية فقط. عند الاستماع لجميع الأصوات واختيار الاعتماد النهائي، أخبرني بـ "تمام" وسأقوم بربطها بالمباريات والبطولة فوراً!
          </p>
        </div>

      </div>
    </div>
  );
}
