'use client';

import { useEffect, useState } from 'react';
import { ShieldAlert, ShieldCheck, Box, Network, Server, Lock } from 'lucide-react';

const NODES = [
  { id: 'agent',    label: 'Agent',        icon: Network,    desc: 'Initiator' },
  { id: 'l1',       label: 'Static Scan',  icon: Box,        desc: 'Schema & Hash' },
  { id: 'dlp_req',  label: 'DLP Request',  icon: ShieldAlert, desc: 'Args Check' },
  { id: 'policy',   label: 'Policy Check', icon: Lock,       desc: 'RBAC' },
  { id: 'upstream', label: 'Tool Host',    icon: Server,     desc: 'Remote Server' },
  { id: 'dlp_res',  label: 'DLP Response', icon: ShieldCheck, desc: 'PII Check' },
];

export function SecurityTimelineSimulation() {
  const [activeNode, setActiveNode] = useState(0);

  useEffect(() => {
    let current = 0;
    const interval = setInterval(() => {
      current = (current + 1) % (NODES.length + 2);
      setActiveNode(current < NODES.length ? current : -1);
    }, 1200);
    return () => clearInterval(interval);
  }, []);

  const progressPct =
    activeNode >= 0 ? (activeNode / (NODES.length - 1)) * 100 : 0;

  return (
    <div className="w-full max-w-5xl mx-auto px-4 py-10">

      {/* ── Desktop: horizontal row ─────────────────────────────────────── */}
      <div className="hidden sm:flex items-center justify-between relative">

        {/* Background track */}
        <div className="absolute left-[4%] right-[4%] top-7 h-px bg-white/5 z-0" />

        {/* Animated fill */}
        <div
          className="absolute left-[4%] top-7 h-px bg-[#4ade80] z-0 transition-all duration-1000 ease-in-out"
          style={{
            width: activeNode >= 0 ? `${progressPct * 0.92}%` : '0%',
            opacity: activeNode >= 0 ? 1 : 0,
          }}
        />

        {NODES.map((node, index) => {
          const isActive = index === activeNode;
          const isPast   = activeNode > index && activeNode !== -1;
          const Icon     = node.icon;

          return (
            <div key={node.id} className="relative z-10 flex flex-col items-center w-20">
              {/* Circle */}
              <div
                className={[
                  'flex h-14 w-14 items-center justify-center rounded-full border-2 transition-all duration-300 shrink-0',
                  isActive
                    ? 'bg-white border-white text-black shadow-[0_0_24px_rgba(255,255,255,0.4)] scale-110'
                    : isPast
                    ? 'bg-[#0a0a0a] border-[#4ade80] text-[#4ade80]'
                    : 'bg-[#0a0a0a] border-white/10 text-[#a1a1aa]',
                ].join(' ')}
              >
                <Icon className="h-6 w-6 transition-colors duration-300" />
              </div>

              {/* Ping */}
              {isActive && (
                <div className="absolute top-0 h-14 w-14 animate-ping rounded-full border border-white opacity-30 pointer-events-none" />
              )}

              {/* Label */}
              <div className="mt-4 text-center w-24 -ml-2">
                <div className={`text-[13px] font-medium tracking-tight transition-colors duration-300 leading-tight ${isActive || isPast ? 'text-white' : 'text-[#a1a1aa]'}`}>
                  {node.label}
                </div>
                {node.desc && (
                  <div className={`text-[10px] font-mono uppercase tracking-widest mt-1 transition-colors duration-300 ${isActive ? 'text-white/50' : 'text-[#3f3f46]'}`}>
                    {node.desc}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Mobile: vertical stack ──────────────────────────────────────── */}
      <div className="flex sm:hidden flex-col gap-0 relative">

        {/* Vertical track */}
        <div className="absolute left-7 top-7 bottom-7 w-px bg-white/5 z-0" />

        {/* Animated fill — height based on progress */}
        <div
          className="absolute left-7 top-7 w-px bg-[#4ade80] z-0 transition-all duration-1000 ease-in-out"
          style={{
            height: activeNode >= 0 ? `${progressPct * 0.86}%` : '0%',
            opacity: activeNode >= 0 ? 1 : 0,
          }}
        />

        {NODES.map((node, index) => {
          const isActive = index === activeNode;
          const isPast   = activeNode > index && activeNode !== -1;
          const Icon     = node.icon;

          return (
            <div key={node.id} className="relative z-10 flex items-center gap-4 py-3">
              {/* Circle */}
              <div
                className={[
                  'flex h-14 w-14 items-center justify-center rounded-full border-2 transition-all duration-300 shrink-0',
                  isActive
                    ? 'bg-white border-white text-black shadow-[0_0_24px_rgba(255,255,255,0.4)] scale-110'
                    : isPast
                    ? 'bg-[#0a0a0a] border-[#4ade80] text-[#4ade80]'
                    : 'bg-[#0a0a0a] border-white/10 text-[#a1a1aa]',
                ].join(' ')}
              >
                <Icon className="h-6 w-6 transition-colors duration-300" />
              </div>

              {/* Ping */}
              {isActive && (
                <div className="absolute left-0 top-3 h-14 w-14 animate-ping rounded-full border border-white opacity-30 pointer-events-none" />
              )}

              {/* Label */}
              <div>
                <div className={`text-[15px] font-medium tracking-tight transition-colors duration-300 ${isActive || isPast ? 'text-white' : 'text-[#a1a1aa]'}`}>
                  {node.label}
                </div>
                {node.desc && (
                  <div className={`text-[11px] font-mono uppercase tracking-widest mt-0.5 transition-colors duration-300 ${isActive ? 'text-white/50' : 'text-[#3f3f46]'}`}>
                    {node.desc}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

    </div>
  );
}
