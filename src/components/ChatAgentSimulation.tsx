'use client';
import { useEffect, useRef, useState } from 'react';
import { Bot, User, Zap } from 'lucide-react';
import { BRAND } from '@/lib/brand';

const STORY = [
  // ── Phase 1: User Prompt ──
  { time: 0,    target: 'chat', type: 'user', text: 'Transcribe the latest TikTok about Agentic AI.' },
  { time: 800,  target: 'chat', type: 'agent_thought', text: 'I need to find a tool to read and transcribe TikTok videos.' },
  { time: 1600, target: 'chat', type: 'agent_thought', text: `Checking agents.md... Found ${BRAND.name} discovery endpoint.` },
  
  // ── Phase 2: Search Tool ──
  { time: 2100, target: 'term', type: 'query', text: '→ search("tiktok transcribe")' },
  { time: 2500, target: 'term', type: 'result', text: '← tiktok-mcp' },
  { time: 2700, target: 'term', type: 'result', text: '  trust: 98/100 · latency: 32ms · source: verified' },
  { time: 2900, target: 'term', type: 'gap', text: '' },
  
  { time: 3300, target: 'term', type: 'scan', text: '→ security scan...' },
  { time: 3700, target: 'term', type: 'scan', text: '  L1 static scan       ✓ no injection patterns' },
  { time: 3900, target: 'term', type: 'scan', text: '  L3 schema pinning    ✓ hash matches published' },
  { time: 4100, target: 'term', type: 'gap', text: '' },

  { time: 4400, target: 'chat', type: 'agent_thought', text: `Found "transcribe_tiktok" tool. Invoking via ${BRAND.name}...` },

  // ── Phase 3: Invoke Tool ──
  { time: 4800, target: 'term', type: 'result', text: '← inputSchema for transcribe_tiktok: [topic]' },
  { time: 5400, target: 'term', type: 'policy', text: '→ policy check: transcribe_tiktok  → allowed ✓' },
  { time: 6000, target: 'term', type: 'call', text: '→ transcribe_tiktok({ topic: "Agentic AI" })' },
  
  { time: 6400, target: 'term', type: 'scan', text: '→ L4 DLP scan on args  ✓ no credentials found' },
  { time: 6600, target: 'term', type: 'gap', text: '' },

  { time: 7600, target: 'term', type: 'response', text: '← upstream: 200 OK · 1120ms' },
  { time: 8000, target: 'term', type: 'scan', text: '→ response DLP + PII scan ✓ clean' },
  { time: 8400, target: 'term', type: 'success', text: '✓ transcript delivered to agent' },

  // ── Phase 4: Chat Response ──
  { time: 8900, target: 'chat', type: 'agent', text: 'Here is the transcript of the latest TikTok on Agentic AI:\n\n"We are entering a new era where AI doesn\'t just chat—it takes action. Agentic workflows mean systems that plan, use tools, and correct their own errors..."' },
];

const COLORS: Record<string, string> = {
  comment:  '#71717a',
  gap:      'transparent',
  agent:    '#ffffff',
  query:    '#d4d4d8',
  result:   '#a1a1aa',
  scan:     '#4ade80',
  policy:   '#e879f9',
  call:     '#ffffff',
  response: '#a1a1aa',
  success:  '#4ade80',
};

export function ChatAgentSimulation() {
  const [visibleItems, setVisibleItems] = useState<{ idx: number, beat: any }[]>([]);
  const [cursor, setCursor] = useState(true);
  const termScrollRef = useRef<HTMLDivElement>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  function clearAll() {
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];
  }

  function play() {
    clearAll();
    setVisibleItems([]);
    
    let maxTime = 0;
    
    STORY.forEach((beat, i) => {
      maxTime = Math.max(maxTime, beat.time);
      const t = setTimeout(() => {
        setVisibleItems((prev) => [...prev, { idx: i, beat }]);
      }, beat.time);
      timersRef.current.push(t);
    });

    const restart = setTimeout(play, maxTime + 5000);
    timersRef.current.push(restart);
  }

  useEffect(() => {
    // Scroll handling when visibleItems changes
    if (termScrollRef.current) {
      termScrollRef.current.scrollTop = termScrollRef.current.scrollHeight;
    }
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [visibleItems]);

  useEffect(() => {
    const start = setTimeout(play, 500);
    const blink = setInterval(() => setCursor(c => !c), 530);
    return () => { clearAll(); clearTimeout(start); clearInterval(blink); };
  }, []);

  const visibleChat = visibleItems.filter(item => item.beat.target === 'chat');
  const visibleTerm = visibleItems.filter(item => item.beat.target === 'term');

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_1fr] gap-4 sm:gap-6 w-full max-w-7xl mx-auto items-stretch text-left">
      {/* ── Left Pane: AI Chat UI ── */}
      <div className="flex flex-col overflow-hidden rounded-[24px] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.02)] shadow-2xl h-[440px]">
        {/* Chat Chrome */}
        <div className="flex items-center gap-3 border-b border-[rgba(255,255,255,0.05)] bg-[rgba(255,255,255,0.02)] px-5 py-3.5">
          <div className="flex h-6 w-6 items-center justify-center rounded-md bg-white text-black">
            <Bot className="h-4 w-4" />
          </div>
          <span className="text-sm font-medium tracking-wide text-white">Assistant</span>
        </div>

        {/* Chat Messages */}
        <div
          ref={chatScrollRef}
          className="flex-1 overflow-y-auto p-5 space-y-5 scroll-smooth"
          style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
        >
          {visibleChat.map(({ idx, beat }) => {
            if (beat.type === 'user') {
              return (
                <div key={idx} className="flex gap-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
                  <div className="flex-shrink-0 flex h-8 w-8 items-center justify-center rounded-full bg-[rgba(255,255,255,0.1)] text-white">
                    <User className="h-4 w-4" />
                  </div>
                  <div className="pt-1.5 w-full text-[15px] leading-relaxed text-white">
                    {beat.text}
                  </div>
                </div>
              );
            }
            if (beat.type === 'agent_thought') {
              return (
                <div key={idx} className="flex gap-4 animate-in fade-in slide-in-from-bottom-2 duration-300 pl-[48px]">
                  <div className="flex items-start gap-2.5 text-[13px] font-mono text-[#a1a1aa] border-l-2 border-[rgba(255,255,255,0.1)] pl-4 py-1.5">
                    <Zap className="h-3.5 w-3.5 mt-0.5 text-yellow-500" />
                    <span>{beat.text}</span>
                  </div>
                </div>
              );
            }
            if (beat.type === 'agent') {
              return (
                <div key={idx} className="flex gap-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
                  <div className="flex-shrink-0 flex h-8 w-8 items-center justify-center rounded-full bg-white text-black">
                    <Bot className="h-4 w-4" />
                  </div>
                  <div className="pt-1.5 w-full text-[15px] leading-relaxed text-[#e4e4e7] whitespace-pre-wrap">
                    {beat.text}
                  </div>
                </div>
              );
            }
            return null;
          })}
        </div>
      </div>

      {/* ── Right Pane: {BRAND.name} Terminal ── */}
      <div className="flex flex-col overflow-hidden rounded-[24px] border border-[rgba(255,255,255,0.08)] bg-[#0a0a0a] font-mono shadow-[0_40px_100px_rgba(0,0,0,0.15)] h-[440px]">
        {/* Terminal Chrome */}
        <div className="flex justify-between items-center border-b border-[rgba(255,255,255,0.05)] bg-[rgba(255,255,255,0.02)] px-5 py-3.5">
          <div className="flex items-center gap-3">
             <div className="flex gap-1.5">
               <div className="h-2.5 w-2.5 rounded-full bg-[rgba(255,255,255,0.2)]" />
               <div className="h-2.5 w-2.5 rounded-full bg-[rgba(255,255,255,0.2)]" />
               <div className="h-2.5 w-2.5 rounded-full bg-[rgba(255,255,255,0.2)]" />
             </div>
             <span className="ml-3 text-[11px] font-medium tracking-wide text-[#52525b] uppercase">{BRAND.name} · runtime proxy</span>
          </div>
          <div className="flex items-center gap-2">
             <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#4ade80]" />
             <span className="text-[10px] font-bold uppercase tracking-wider text-[#4ade80]">governed tool run</span>
          </div>
        </div>

        {/* Terminal Output */}
        <div
          ref={termScrollRef}
          className="flex-1 overflow-y-auto px-6 py-5 text-[12.5px] leading-[1.9] scroll-smooth"
          style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
        >
          {visibleTerm.map(({ idx, beat }) => {
            if (beat.type === 'gap') {
              return <div key={idx} className="h-1.5 animate-in fade-in duration-300" />;
            }
            return (
              <div key={idx} className="animate-in fade-in slide-in-from-bottom-1 duration-300" style={{
                color: COLORS[beat.type] || '#ffffff',
                fontWeight: beat.type === 'success' || beat.type === 'call' ? 600 : 400,
              }}>
                {beat.text}
              </div>
            );
          })}
          <span className="text-white transition-opacity duration-75" style={{ opacity: cursor ? 1 : 0 }}>▋</span>
        </div>
      </div>
    </div>
  );
}
