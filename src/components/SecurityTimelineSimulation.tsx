'use client';
import { useEffect, useState } from 'react';
import { ShieldAlert, ShieldCheck, Box, Network, SendToBack, Server, Lock } from 'lucide-react';

const NODES = [
  { id: 'agent', label: 'Agent', icon: Network },
  { id: 'l1', label: 'Static Scan', icon: Box, desc: 'Schema & Hash' },
  { id: 'dlp_req', label: 'DLP Request', icon: ShieldAlert, desc: 'Args Check' },
  { id: 'policy', label: 'Policy Check', icon: Lock, desc: 'RBAC' },
  { id: 'upstream', label: 'Tool Host', icon: Server, desc: 'Remote Server' },
  { id: 'dlp_res', label: 'DLP Response', icon: ShieldCheck, desc: 'PII Check' },
];

export function SecurityTimelineSimulation() {
  const [activeNode, setActiveNode] = useState(0);

  useEffect(() => {
    let current = 0;
    const interval = setInterval(() => {
      current = (current + 1) % (NODES.length + 2); // +2 for pause at the end
      if (current < NODES.length) {
        setActiveNode(current);
      } else {
        setActiveNode(-1); // Reset state visually
      }
    }, 1200);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="w-full max-w-5xl mx-auto overflow-x-auto py-10 px-4">
      <div className="min-w-[800px] flex items-center justify-between relative">
        {/* Background connector line */}
        <div className="absolute left-[5%] right-[5%] top-1/2 h-0.5 -translate-y-1/2 bg-[rgba(255,255,255,0.05)] z-0" />
        
        {/* Animated active line */}
        <div 
          className="absolute left-[5%] top-1/2 h-0.5 -translate-y-1/2 bg-[#4ade80] z-0 transition-all duration-1000 ease-in-out"
          style={{ 
            width: activeNode >= 0 ? `${(activeNode / (NODES.length - 1)) * 90}%` : '0%',
            opacity: activeNode >= 0 ? 1 : 0
          }}
        />

        {NODES.map((node, index) => {
          const isActive = index === activeNode;
          const isPast = activeNode > index;
          const isPending = activeNode !== -1 && activeNode < index;
          
          let colorClass = 'text-[#a1a1aa] bg-[#0a0a0a] border-[rgba(255,255,255,0.1)]'; // default
          let iconColor = 'text-[#a1a1aa]';
          
          if (isActive) {
            colorClass = 'text-black bg-white border-white shadow-[0_0_20px_rgba(255,255,255,0.4)] scale-110';
            iconColor = 'text-black';
          } else if (isPast) {
            colorClass = 'text-[#4ade80] bg-[#0a0a0a] border-[#4ade80]';
            iconColor = 'text-[#4ade80]';
          }

          const Icon = node.icon;

          return (
            <div key={node.id} className="relative z-10 flex flex-col items-center">
              {/* Node Circle */}
              <div 
                className={`flex h-14 w-14 items-center justify-center rounded-full border-2 transition-all duration-300 ${colorClass}`}
              >
                <Icon className={`h-6 w-6 transition-colors duration-300 ${iconColor}`} />
              </div>
              
              {/* Node Labels */}
              <div className="mt-4 text-center absolute top-16 w-32 -left-9">
                <div className={`text-sm font-medium tracking-tight transition-colors duration-300 ${isActive || isPast ? 'text-white' : 'text-[#a1a1aa]'}`}>
                  {node.label}
                </div>
                {node.desc && (
                  <div className={`text-[11px] font-mono uppercase tracking-widest mt-1 transition-colors duration-300 ${isActive ? 'text-[#a1a1aa]' : 'text-[#52525b]'}`}>
                    {node.desc}
                  </div>
                )}
              </div>
              
              {/* Ping Animation for Active */}
              {isActive && (
                <div className="absolute inset-x-auto top-0 h-14 w-14 animate-ping rounded-full border border-white opacity-40 z-[-1]" />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
