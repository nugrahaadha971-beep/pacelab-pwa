import { useEffect, useState } from 'react';

const STATUS_MESSAGES = [
  'Membaca data lari & detak jantung...',
  'Mengecek kondisi beban tubuh...',
  'Menyusun saran pelatih AI...',
] as const;

const BAR_DELAYS = ['0ms', '140ms', '280ms', '420ms', '560ms'] as const;

export default function AiLoader() {
  const [msgIdx, setMsgIdx] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => {
      setMsgIdx((prev) => (prev + 1) % STATUS_MESSAGES.length);
    }, 1800);
    return () => window.clearInterval(id);
  }, []);

  return (
    <div
      role="status"
      aria-live="polite"
      className="sport-subcard space-y-3 p-3.5"
    >
      <div className="flex items-center gap-3">
        <div className="flex h-6 items-center gap-1" aria-hidden="true">
          {BAR_DELAYS.map((delay, idx) => (
            <span
              key={idx}
              className="h-5 w-1 origin-bottom rounded-full bg-[#BEF264]"
              style={{
                animation: 'pacelab-wave 1s ease-in-out infinite',
                animationDelay: delay,
              }}
            />
          ))}
        </div>
        <span className="text-xs font-semibold text-zinc-200">
          {STATUS_MESSAGES[msgIdx]}
        </span>
      </div>

      <div className="space-y-2" aria-hidden="true">
        <div
          className="h-2.5 w-full rounded-full"
          style={{
            background: 'linear-gradient(90deg, #18181D 25%, rgba(190, 242, 100, 0.16) 50%, #18181D 75%)',
            backgroundSize: '200% 100%',
            animation: 'pacelab-shimmer 1.6s linear infinite',
          }}
        />
        <div
          className="h-2.5 w-3/4 rounded-full"
          style={{
            background: 'linear-gradient(90deg, #18181D 25%, rgba(56, 189, 248, 0.16) 50%, #18181D 75%)',
            backgroundSize: '200% 100%',
            animation: 'pacelab-shimmer 1.6s linear infinite',
          }}
        />
      </div>
    </div>
  );
}
