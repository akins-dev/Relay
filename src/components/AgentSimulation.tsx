'use client';
import { useEffect, useRef, useState } from 'react';

// ── Single continuous story ───────────────────────────────────────────────────
// No tabs. No user interaction required. Plays on loop.
// delay = ms after the previous beat before this one appears.

const STORY = [
  { type: 'comment',  text: '// AGENTS.md — your entire MCP configuration',         delay: 0    },
  { type: 'comment',  text: 'You have access to openMCP. Query before assuming.',    delay: 500  },
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
  comment:  '#78716c',
  gap:      'transparent',
  agent:    '#d6cfc8',
  query:    '#c2440c',
  result:   '#4f8cc9',
  scan:     '#15803d',
  policy:   '#7c3aed',
  call:     '#c2440c',
  response: '#4f8cc9',
  success:  '#15803d',
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
  }, []);

  return (
    <div style={{
      background: '#1c1917',
      border: '1px solid #3c3330',
      borderRadius: '16px',
      overflow: 'hidden',
      boxShadow: '0 8px 40px rgba(28,22,18,0.12)',
      fontFamily: 'var(--mono)',
    }}>
      {/* Chrome bar */}
      <div style={{ display:'flex', alignItems:'center', gap:'6px', padding:'13px 18px', borderBottom:'1px solid #292524', background:'#141211' }}>
        {['#ef4444','#eab308','#22c55e'].map(col => (
          <div key={col} style={{ width:'10px', height:'10px', borderRadius:'50%', background:col, opacity:.75 }} />
        ))}
        <span style={{ marginLeft:'10px', fontSize:'11px', color:'#78716c' }}>agent-runtime · openmcp · live</span>
        <div style={{ marginLeft:'auto', display:'flex', alignItems:'center', gap:'5px' }}>
          <div style={{ width:'6px', height:'6px', borderRadius:'50%', background:'#c2440c', animation:'pulse 2s ease-in-out infinite' }} />
          <span style={{ fontSize:'10px', color:'#c2440c' }}>connected</span>
        </div>
      </div>

      {/* Output */}
      <div
        ref={scrollRef}
        style={{ padding:'20px 24px', height:'360px', overflowY:'auto', fontSize:'12.5px', lineHeight:1.9, scrollBehavior:'smooth' }}
      >
        {STORY.map((beat, i) => {
          const vis = visible.includes(i);
          if (beat.type === 'gap') return <div key={i} style={{ height:'6px', opacity: vis ? 1 : 0 }} />;
          return (
            <div key={i} style={{
              opacity:    vis ? 1 : 0,
              transform:  vis ? 'translateY(0)' : 'translateY(3px)',
              transition: 'opacity .25s ease, transform .25s ease',
              color:      COLORS[beat.type] || '#d6cfc8',
              fontWeight: beat.type === 'success' ? 600 : 400,
            }}>
              {beat.text}
            </div>
          );
        })}
        <span style={{ color:'#c2440c', opacity: cursor ? 1 : 0, transition:'opacity .08s' }}>▋</span>
      </div>

      {/* Footer */}
      <div style={{ padding:'10px 20px', borderTop:'1px solid #292524', background:'#141211', display:'flex', gap:'20px', flexWrap:'wrap' }}>
        {[
          ['15 security layers', '#15803d'],
          ['DLP on every call',  '#4f8cc9'],
          ['audit trail',        '#7c3aed'],
          ['free forever',       '#c2440c'],
        ].map(([label, color]) => (
          <span key={label} style={{ fontSize:'10px', color }}>{`✓ ${label}`}</span>
        ))}
      </div>
    </div>
  );
}
