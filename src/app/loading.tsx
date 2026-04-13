export default function Loading() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-6">
      <div className="relative flex items-center justify-center w-48 h-20">
        <svg viewBox="0 0 120 40" className="w-full h-full overflow-visible">
          {/* Connection lines */}
          <line x1="20" y1="16" x2="60" y2="16" stroke="rgba(255,255,255,0.08)" strokeWidth="1.5" />
          <line x1="60" y1="16" x2="100" y2="16" stroke="rgba(255,255,255,0.08)" strokeWidth="1.5" />
          
          {/* Nodes */}
          <circle cx="20" cy="16" r="4" fill="rgba(255,255,255,0.15)" />
          
          <circle cx="60" cy="16" r="5" fill="transparent" stroke="rgba(255,255,255,0.3)" strokeWidth="1" strokeDasharray="3 3">
            <animateTransform attributeName="transform" type="rotate" from="0 60 16" to="360 60 16" dur="4s" repeatCount="indefinite" />
          </circle>
          <circle cx="60" cy="16" r="2.5" fill="#10B981" />

          <circle cx="100" cy="16" r="4" fill="rgba(255,255,255,0.15)" />

          {/* Labels */}
          <text x="20" y="32" fontSize="5" fill="#64748b" textAnchor="middle" fontFamily="monospace" letterSpacing="0.05em">AGENT</text>
          <text x="60" y="32" fontSize="5" fill="#64748b" textAnchor="middle" fontFamily="monospace" letterSpacing="0.05em">PROXY</text>
          <text x="100" y="32" fontSize="5" fill="#64748b" textAnchor="middle" fontFamily="monospace" letterSpacing="0.05em">SERVERS</text>

          {/* Request Packet (Cyan to Green meaning verified) */}
          <circle cx="20" cy="16" r="2" fill="#06B6D4">
             <animate attributeName="cx" values="20; 60; 60; 100; 100" keyTimes="0; 0.2; 0.35; 0.55; 1" dur="2.5s" repeatCount="indefinite" />
             <animate attributeName="opacity" values="1; 1; 1; 1; 0" keyTimes="0; 0.2; 0.35; 0.54; 1" dur="2.5s" repeatCount="indefinite" />
             <animate attributeName="fill" values="#06B6D4; #06B6D4; #10B981; #10B981; #10B981" keyTimes="0; 0.2; 0.35; 0.55; 1" dur="2.5s" repeatCount="indefinite" />
          </circle>
          
          {/* Response Packet (Green back to agent) */}
          <circle cx="100" cy="16" r="2" fill="#10B981" opacity="0">
             <animate attributeName="cx" values="100; 100; 100; 60; 60; 20" keyTimes="0; 0.54; 0.55; 0.75; 0.8; 1" dur="2.5s" repeatCount="indefinite" />
             <animate attributeName="opacity" values="0; 0; 1; 1; 1; 0" keyTimes="0; 0.54; 0.55; 0.75; 0.8; 1" dur="2.5s" repeatCount="indefinite" />
          </circle>

          {/* Security Scan Pulse at Proxy */}
          <circle cx="60" cy="16" r="5" fill="transparent" stroke="#10B981" strokeWidth="1" opacity="0">
             <animate attributeName="r" values="5; 5; 14; 5; 5" keyTimes="0; 0.2; 0.35; 0.351; 1" dur="2.5s" repeatCount="indefinite" />
             <animate attributeName="opacity" values="0; 0.8; 0; 0; 0" keyTimes="0; 0.2; 0.35; 0.351; 1" dur="2.5s" repeatCount="indefinite" />
          </circle>
        </svg>
      </div>
      <div className="font-mono text-[11px] uppercase tracking-[0.2em] text-[#06B6D4] animate-pulse drop-shadow-[0_0_10px_rgba(6,182,212,0.5)]">
        Discovering Runtime Context...
      </div>
    </div>
  );
}
