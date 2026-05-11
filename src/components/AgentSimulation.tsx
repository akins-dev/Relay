'use client';
import { useEffect, useRef, useState } from 'react';
import { BRAND } from '@/lib/brand';

// ── Single continuous story ───────────────────────────────────────────────────
// No tabs. No user interaction required. Plays on loop.
// delay = ms after the previous beat before this one appears.

const STORY = [
  { type: 'comment',  text: '// AGENTS.md — your runtime tool connection',            delay: 0    },
  { type: 'comment',  text: `You have access to ${BRAND.name}. Query before assuming.`,   delay: 500  },
  { type: 'comment',  text: 'GET /api/servers/search?q={intent}',                   delay: 300  },
  { type: 'gap',      text: '',                                                       delay: 500  },

  { type: 'agent',    text: '▸  "charge the user $49 for their Pro plan"',          delay: 600  },
  { type: 'gap',      text: '',                                                       delay: 200  },

  { type: 'query',    text: '→  search("payments charge subscription")',             delay: 700  },
  { type: 'result',   text: '←  stripe-payments',                                   delay: 900  },
  { type: 'result',   text: '   trust: 97 · latency: 42ms · source: official',      delay: 200  },
  { type: 'result',   text: '   tools: charge_card, create_subscription, +4',       delay: 200  },
  { type: 'gap',      text: '',                                                       delay: 300  },

  { type: 'scan',     text: '→  security scan...',                                  delay: 500  },
  { type: 'scan',     text: '   L1 static scan       ✓  no injection patterns',    delay: 500  },
  { type: 'scan',     text: '   L3 schema pinning    ✓  hash matches published',   delay: 400  },
  { type: 'scan',     text: '   S-14 CVE scan        ✓  no known vulnerabilities', delay: 400  },
  { type: 'scan',     text: '   trust: 97/100  →  approved for invocation',        delay: 400  },
  { type: 'gap',      text: '',                                                       delay: 300  },

  { type: 'result',   text: '←  inputSchema for charge_card:',                      delay: 600  },
  { type: 'result',   text: '   required: [amount, currency, customer_id]',         delay: 200  },
  { type: 'gap',      text: '',                                                       delay: 300  },

  { type: 'policy',   text: '→  policy check: charge_card  →  allowed ✓',          delay: 500  },
  { type: 'policy',   text: '   (delete_*, destroy_*, drop_*  →  blocked)',         delay: 200  },
  { type: 'gap',      text: '',                                                       delay: 300  },

  { type: 'call',     text: '→  charge_card({',                                     delay: 700  },
  { type: 'call',     text: '     amount: 4900, currency: "usd",',                 delay: 150  },
  { type: 'call',     text: '     customer_id: "cus_NffrFeUfNV2Hib"',             delay: 150  },
  { type: 'call',     text: '   })',                                                 delay: 150  },
  { type: 'gap',      text: '',                                                       delay: 200  },

  { type: 'scan',     text: '→  L4 DLP scan on args            ✓  no credentials', delay: 500  },
  { type: 'scan',     text: '   S-12 shell injection check     ✓  clean',          delay: 300  },
  { type: 'gap',      text: '',                                                       delay: 200  },

  { type: 'response', text: '←  upstream: 200 OK · 44ms',                          delay: 800  },
  { type: 'scan',     text: '→  response DLP + PII scan        ✓  clean',          delay: 400  },
  { type: 'gap',      text: '',                                                       delay: 300  },

  { type: 'success',  text: '✓  ch_3Qx9Av2eZvKYlo2C8tznkpu',                       delay: 600  },
  { type: 'success',  text: '   $49.00 charged · audit trail written',              delay: 200  },
  { type: 'success',  text: '   agent never saw the Stripe key',                    delay: 200  },
];

const COLORS: Record<string, string> = {
  comment:  '#71717a', // zinc-500
  gap:      'transparent',
  agent:    '#ffffff', // white
  query:    '#d4d4d8', // zinc-300
  result:   '#a1a1aa', // zinc-400
  scan:     '#4ade80', // green-400
  policy:   '#e879f9', // fuchsia-400
  call:     '#ffffff', // white
  response: '#a1a1aa', // zinc-400
  success:  '#4ade80', // green-400
};

export function AgentSimulation() {
  const [visible, setVisible] = useState<number[]>([]);
  const [cursor, setCursor]   = useState(true);
  const scrollRef             = useRef<HTMLDivElement>(null);
  const timersRef             = useRef<ReturnType<typeof setTimeout>[]>([]);

  function clearAll() { timersRef.current.forEach(clearTimeout); timersRef.current = []; }

  function play() {
    clearAll();
    setVisible([]);
    let elapsed = 0;
    STORY.forEach((beat, i) => {
      elapsed += beat.delay;
      const t = setTimeout(() => {
        setVisible(v => [...v, i]);
        if (scrollRef.current) {
          scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
      }, elapsed);
      timersRef.current.push(t);
    });
    // Restart loop after story ends + 3s pause
    const restart = setTimeout(play, elapsed + 3000);
    timersRef.current.push(restart);
  }

  useEffect(() => {
    const start = setTimeout(play, 400);
    const blink = setInterval(() => setCursor(c => !c), 530);
    return () => { clearAll(); clearTimeout(start); clearInterval(blink); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex flex-col overflow-hidden rounded-[16px] border border-[rgba(255,255,255,0.15)] bg-black font-mono shadow-2xl">
      {/* Chrome bar */}
      <div className="flex items-center gap-2 border-b border-[rgba(255,255,255,0.08)] bg-[#0a0a0a] px-5 py-3.5">
        <div className="flex gap-1.5">
          <div className="h-2.5 w-2.5 rounded-full bg-[rgba(255,255,255,0.2)]" />
          <div className="h-2.5 w-2.5 rounded-full bg-[rgba(255,255,255,0.2)]" />
          <div className="h-2.5 w-2.5 rounded-full bg-[rgba(255,255,255,0.2)]" />
        </div>
        <span className="ml-3 text-[11px] font-medium tracking-wide text-[#52525b]">agent-runtime · {BRAND.name} · live</span>
        <div className="ml-auto flex items-center gap-2">
          <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#4ade80]" />
          <span className="text-[10px] font-bold uppercase tracking-wider text-[#4ade80]">connected</span>
        </div>
      </div>

      {/* Output */}
      <div
        ref={scrollRef}
        className="h-[360px] overflow-y-auto px-6 py-5 text-[12.5px] leading-[1.9] scroll-smooth"
        style={{ scrollbarWidth: 'none' }}
      >
        {STORY.map((beat, i) => {
          const vis = visible.includes(i);
          if (beat.type === 'gap') return <div key={i} className="h-1.5" style={{ opacity: vis ? 1 : 0 }} />;
          return (
            <div key={i} style={{
              opacity:    vis ? 1 : 0,
              transform:  vis ? 'translateY(0)' : 'translateY(4px)',
              transition: 'opacity 0.3s cubic-bezier(0.16, 1, 0.3, 1), transform 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
              color:      COLORS[beat.type] || '#ffffff',
              fontWeight: beat.type === 'success' || beat.type === 'agent' ? 600 : 400,
            }}>
              {beat.text}
            </div>
          );
        })}
        <span className="text-white transition-opacity duration-75" style={{ opacity: cursor ? 1 : 0 }}>▋</span>
      </div>

      {/* Footer */}
      <div className="flex flex-wrap gap-5 border-t border-[rgba(255,255,255,0.06)] bg-[#0a0a0a] px-5 py-3">
        {[
          ['15 security layers', '#4ade80'],
          ['DLP on every call',  '#4ade80'],
          ['audit trail',        '#4ade80'],
          ['free forever',       '#a1a1aa'],
        ].map(([label, color]) => (
          <span key={label} className="text-[10px] font-bold uppercase tracking-widest" style={{ color }}>{`✓ ${label}`}</span>
        ))}
      </div>
    </div>
  );
}
