'use client';

import React, { useEffect, useState, useRef } from 'react';
import { cn } from '@/lib/cn';
import { Sparkles, Terminal, Network, Shield, Webhook, ArrowRight, BrainCircuit } from 'lucide-react';

export function HeroOrbital() {
  const [mounted, setMounted] = useState(false);
  const [step, setStep] = useState(0); // 0 = idle, 1-4 = active steps, 5 = completed
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => setMounted(true), []);

  const THOUGHTS = [
    { text: "Waiting for intent...", activeCards: [] },
    { text: "I need a weather API. Searching Agentrail registry...", activeCards: ['discovery'] },
    { text: "Found 'weather-mcp' (Trust Score: 92). Verifying policy...", activeCards: ['discovery', 'policy'] },
    { text: "Invoking 'get_weather' through secure proxy...", activeCards: ['discovery', 'policy', 'proxy'] },
    { text: "Proxy passed. Execution complete. Weather is 68°F and sunny.", activeCards: ['discovery', 'policy', 'proxy', 'execution'] }
  ];

  const startSimulation = () => {
    if (step > 0 && step < 5) return; // Prevent restart while running
    setStep(1);
    
    let currentStep = 1;
    timerRef.current = setInterval(() => {
      currentStep++;
      setStep(currentStep);
      
      if (currentStep >= 4) {
        if (timerRef.current) clearInterval(timerRef.current);
        // Reset after a long delay
        setTimeout(() => setStep(0), 10000);
      }
    }, 2500); // 4 seconds per step
  };

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const isCardActive = (id: string) => step > 0 && THOUGHTS[step].activeCards.includes(id);

  return (
    <div className="relative w-full max-w-[1000px] aspect-square sm:aspect-video mx-auto flex items-center justify-center pt-24 sm:pt-0">
      
      {/* Floating Prompt Window (Moved to Top Center) */}
      <div className="absolute -top-4 sm:-top-8 left-1/2 -translate-x-1/2 w-[90%] sm:w-[450px] z-30 pointer-events-auto">
        <div className="anim-float w-full">
          <div className="rounded-full border border-white/15 bg-brand-ink/95 backdrop-blur-2xl p-2 shadow-[0_20px_40px_rgba(0,0,0,0.5)] flex items-center gap-2 sm:gap-3">
             <div className="w-8 h-8 rounded-full bg-brand-rail/20 flex shrink-0 items-center justify-center ml-1">
               <Sparkles className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-brand-signal" />
             </div>
             <div className="flex-1 text-[13px] sm:text-[14px] text-white/90 font-medium tracking-wide">
               <span className="opacity-50 mr-1 sm:mr-2">Ask:</span> What is the current weather in San Francisco?
             </div>
             <button 
               onClick={startSimulation}
               className={cn(
                 "h-8 w-8 sm:h-9 sm:w-9 rounded-full bg-white flex shrink-0 items-center justify-center transition-all mr-1",
                 step > 0 && step < 5 ? "opacity-50 scale-95" : "hover:scale-105 hover:bg-brand-mist"
               )}
             >
               <ArrowRight className="w-4 h-4 text-brand-ink" />
             </button>
          </div>
        </div>
      </div>

      {/* Background Deep Glow */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[300px] sm:w-[500px] h-[300px] sm:h-[500px] bg-brand-rail opacity-15 sm:opacity-10 blur-[80px] sm:blur-[120px] rounded-full pointer-events-none transition-all duration-1000" />

      {/* Connection Lines (SVG) */}
      <svg className="absolute inset-0 w-full h-full pointer-events-none hidden sm:block" viewBox="0 0 1000 562" preserveAspectRatio="xMidYMid slice" style={{ opacity: mounted ? 1 : 0, transition: 'opacity 1s' }}>         <defs>
           <linearGradient id="line-grad-left" x1="100%" y1="50%" x2="0%" y2="50%">
             <stop offset="0%" stopColor="#2563EB" stopOpacity="0.8" />
             <stop offset="50%" stopColor="#2563EB" stopOpacity="0.1" />
             <stop offset="100%" stopColor="#06B6D4" stopOpacity="0.8" />
           </linearGradient>
           <linearGradient id="line-grad-right" x1="0%" y1="50%" x2="100%" y2="50%">
             <stop offset="0%" stopColor="#2563EB" stopOpacity="0.8" />
             <stop offset="50%" stopColor="#2563EB" stopOpacity="0.1" />
             <stop offset="100%" stopColor="#06B6D4" stopOpacity="0.8" />
           </linearGradient>
           <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
             <feGaussianBlur stdDeviation="4" result="coloredBlur"/>
             <feMerge>
               <feMergeNode in="coloredBlur"/>
               <feMergeNode in="SourceGraphic"/>
             </feMerge>
           </filter>
         </defs>

         {/* Left Top Connection - Discovery */}
         <g className={cn("transition-all duration-1000", step >= 1 ? "opacity-100" : "opacity-0")}>
           <path d="M 500 281 C 380 281, 380 140, 274 140" fill="none" stroke="url(#line-grad-left)" strokeWidth="2" filter="url(#glow)" />
           <path d="M 500 281 C 380 281, 380 140, 274 140" fill="none" stroke="#ffffff" strokeWidth="1.5" className="anim-flow" filter="url(#glow)" />
           <path d="M 500 281 C 410 260, 350 120, 274 140" fill="none" stroke="url(#line-grad-left)" strokeWidth="1" opacity="0.6" />
           <path d="M 500 281 C 350 300, 410 160, 274 140" fill="none" stroke="url(#line-grad-left)" strokeWidth="1" opacity="0.4" />
           <circle cx="274" cy="140" r="5" fill="#ffffff" filter="url(#glow)" className="animate-[pulse_2s_infinite]" />
           <circle cx="274" cy="140" r="2.5" fill="#ffffff" />
         </g>

         {/* Left Bottom Connection - Policy */}
         <g className={cn("transition-all duration-1000", step >= 2 ? "opacity-100" : "opacity-0")}>
           <path d="M 500 281 C 380 281, 380 421, 274 421" fill="none" stroke="url(#line-grad-left)" strokeWidth="2" filter="url(#glow)" />
           <path d="M 500 281 C 380 281, 380 421, 274 421" fill="none" stroke="#ffffff" strokeWidth="1.5" className="anim-flow" filter="url(#glow)" />
           <path d="M 500 281 C 410 300, 350 400, 274 421" fill="none" stroke="url(#line-grad-left)" strokeWidth="1" opacity="0.6" />
           <path d="M 500 281 C 350 260, 410 440, 274 421" fill="none" stroke="url(#line-grad-left)" strokeWidth="1" opacity="0.4" />
           <circle cx="274" cy="421" r="5" fill="#ffffff" filter="url(#glow)" className="animate-[pulse_2s_infinite]" />
           <circle cx="274" cy="421" r="2.5" fill="#ffffff" />
         </g>

         {/* Right Top Connection - Proxy */}
         <g className={cn("transition-all duration-1000", step >= 3 ? "opacity-100" : "opacity-0")}>
           <path d="M 500 281 C 620 281, 620 140, 726 140" fill="none" stroke="url(#line-grad-right)" strokeWidth="2" filter="url(#glow)" />
           <path d="M 500 281 C 620 281, 620 140, 726 140" fill="none" stroke="#ffffff" strokeWidth="1.5" className="anim-flow" filter="url(#glow)" />
           <path d="M 500 281 C 590 260, 650 120, 726 140" fill="none" stroke="url(#line-grad-right)" strokeWidth="1" opacity="0.6" />
           <path d="M 500 281 C 650 300, 590 160, 726 140" fill="none" stroke="url(#line-grad-right)" strokeWidth="1" opacity="0.4" />
           <circle cx="726" cy="140" r="5" fill="#ffffff" filter="url(#glow)" className="animate-[pulse_2s_infinite]" />
           <circle cx="726" cy="140" r="2.5" fill="#ffffff" />
         </g>

         {/* Right Bottom Connection - Audit */}
         <g className={cn("transition-all duration-1000", step >= 4 ? "opacity-100" : "opacity-0")}>
           <path d="M 500 281 C 620 281, 620 421, 726 421" fill="none" stroke="url(#line-grad-right)" strokeWidth="2" filter="url(#glow)" />
           <path d="M 500 281 C 620 281, 620 421, 726 421" fill="none" stroke="#ffffff" strokeWidth="1.5" className="anim-flow" filter="url(#glow)" />
           <path d="M 500 281 C 590 300, 650 400, 726 421" fill="none" stroke="url(#line-grad-right)" strokeWidth="1" opacity="0.6" />
           <path d="M 500 281 C 650 260, 590 440, 726 421" fill="none" stroke="url(#line-grad-right)" strokeWidth="1" opacity="0.4" />
           <circle cx="726" cy="421" r="5" fill="#ffffff" filter="url(#glow)" className="animate-[pulse_2s_infinite]" />
           <circle cx="726" cy="421" r="2.5" fill="#ffffff" />
         </g>
      </svg>

      {/* Central Interactive Orb */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-20">
        <div className="relative flex items-center justify-center w-28 h-28 sm:w-36 sm:h-36 transition-transform hover:scale-105">
           <div className={cn("absolute inset-0 rounded-full border border-brand-rail/30 mix-blend-screen backdrop-blur-sm shadow-[0_0_50px_rgba(37,99,235,0.4)] transition-all duration-1000", step > 0 ? "bg-brand-signal/20 scale-110" : "bg-brand-rail/10 anim-pulse")} />
           <div className={cn("absolute inset-4 sm:inset-5 rounded-full bg-gradient-to-tr mix-blend-screen transition-all duration-1000", step > 0 ? "from-brand-signal to-brand-rail shadow-[0_0_50px_rgba(6,182,212,0.8)] animate-[spin_2s_linear_infinite]" : "from-brand-rail to-brand-signal shadow-[0_0_30px_rgba(6,182,212,0.6)] animate-[spin_4s_linear_infinite]")} />
           <div className="absolute inset-6 sm:inset-8 rounded-full bg-brand-ink flex items-center justify-center z-10 border border-brand-signal/50 shadow-inner p-1">
             <div className="w-full h-full rounded-full border border-white/10 flex items-center justify-center bg-brand-bg relative overflow-hidden">
                 <Terminal className={cn("text-white w-5 h-5 sm:w-6 sm:h-6 transition-all duration-500", step > 0 ? "opacity-0 scale-50" : "anim-pulse")} />
                 <BrainCircuit className={cn("text-brand-signal w-5 h-5 sm:w-6 sm:h-6 absolute transition-all duration-500", step > 0 ? "opacity-100 scale-100" : "opacity-0 scale-150")} />
             </div>
           </div>
        </div>
      </div>

      {/* AI Thought Process Display (Below Orb) */}
      <div className="absolute top-[65%] left-1/2 -translate-x-1/2 w-[280px] sm:w-[340px] z-30 pointer-events-none">
        <div className={cn(
          "rounded-[12px] border border-white/10 bg-brand-ink/90 backdrop-blur-md p-3 shadow-2xl transition-all duration-500 transform",
          step > 0 ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"
        )}>
          <div className="flex items-start gap-2.5">
            <Sparkles className="w-4 h-4 text-brand-signal shrink-0 mt-0.5" />
            <div className="text-[12px] text-brand-steel leading-relaxed font-mono">
              {THOUGHTS[step].text}
            </div>
          </div>
        </div>
      </div>

      {/* Peripheral Cards */}
      <div className="absolute w-full h-full inset-0 z-10 pointer-events-none hidden sm:block">
        
        {/* Top Left: Discovery */}
        <div className={cn("absolute top-[25%] left-[5%] lg:left-[5%] -translate-y-1/2 w-56 transition-all duration-700 transform pointer-events-auto", isCardActive('discovery') ? "opacity-100 scale-100 hover:scale-105" : "opacity-30 scale-95 grayscale")}>
          <div className={cn("rounded-[16px] border bg-brand-panel/60 backdrop-blur-md p-4 shadow-2xl transition-colors duration-500", isCardActive('discovery') ? "border-brand-signal/50 shadow-[0_0_30px_rgba(37,99,235,0.2)]" : "border-white/10")}>
            <div className="flex items-center gap-3 mb-3">
              <div className="w-8 h-8 rounded-full bg-blue-500/10 flex items-center justify-center border border-blue-500/20">
                <Network className={cn("w-4 h-4", isCardActive('discovery') ? "text-blue-400" : "text-gray-500")} />
              </div>
              <span className="text-[13px] font-semibold text-white">Discovery</span>
            </div>
            <div className="text-[11px] text-brand-steel space-y-1.5 font-mono">
              <div className="flex items-center justify-between"><span className={cn(isCardActive('discovery') && "text-blue-400")}>Match</span> <span className="text-white">weather-mcp</span></div>
              <div className="flex items-center justify-between"><span className={cn(isCardActive('discovery') && "text-blue-400")}>Schema</span> <span className="text-white">v1.0.2</span></div>
            </div>
          </div>
        </div>

        {/* Bottom Left: Policy */}
        <div className={cn("absolute top-[75%] left-[5%] lg:left-[5%] -translate-y-1/2 w-56 transition-all duration-700 transform pointer-events-auto", isCardActive('policy') ? "opacity-100 scale-100 hover:scale-105" : "opacity-30 scale-95 grayscale")}>
          <div className={cn("rounded-[16px] border bg-brand-panel/60 backdrop-blur-md p-4 shadow-2xl transition-colors duration-500", isCardActive('policy') ? "border-green-500/50 shadow-[0_0_30px_rgba(34,197,94,0.15)]" : "border-white/10")}>
            <div className="flex items-center gap-3 mb-3">
              <div className="w-8 h-8 rounded-full bg-green-500/10 flex items-center justify-center border border-green-500/20">
                <Shield className={cn("w-4 h-4", isCardActive('policy') ? "text-green-400" : "text-gray-500")} />
              </div>
              <span className="text-[13px] font-semibold text-white">Trust & Policy</span>
            </div>
            <div className="w-full bg-white/5 rounded-full h-1.5 mb-2 overflow-hidden">
               <div className={cn("h-full transition-all duration-1000", isCardActive('policy') ? "bg-green-400 w-[92%]" : "bg-gray-600 w-[0%]")} />
            </div>
            <div className="text-[11px] text-brand-steel flex justify-between font-mono">
              <span>Score: 92</span>
              <span className={cn(isCardActive('policy') && "text-green-400")}>Verified ✅</span>
            </div>
          </div>
        </div>

        {/* Top Right: Proxy */}
        <div className={cn("absolute top-[25%] right-[5%] lg:right-[5%] -translate-y-1/2 w-56 transition-all duration-700 transform pointer-events-auto", isCardActive('proxy') ? "opacity-100 scale-100 hover:scale-105" : "opacity-30 scale-95 grayscale")}>
          <div className={cn("rounded-[16px] border bg-brand-panel/60 backdrop-blur-md p-4 shadow-2xl transition-colors duration-500", isCardActive('proxy') ? "border-orange-500/50 shadow-[0_0_30px_rgba(249,115,22,0.15)]" : "border-white/10")}>
            <div className="flex items-center gap-3 mb-3">
              <div className="w-8 h-8 rounded-full bg-orange-500/10 flex items-center justify-center border border-orange-500/20">
                <Webhook className={cn("w-4 h-4", isCardActive('proxy') ? "text-orange-400" : "text-gray-500")} />
              </div>
              <span className="text-[13px] font-semibold text-white">Secure Proxy</span>
            </div>
            <div className="text-[11px] text-brand-steel space-y-1.5 font-mono">
              <div className="flex items-center justify-between"><span>DLP Scan</span> <span className={cn(isCardActive('proxy') && "text-green-400")}>Pass</span></div>
              <div className="flex items-center justify-between"><span>Credentials</span> <span className={cn(isCardActive('proxy') && "text-orange-400")}>Injected</span></div>
            </div>
          </div>
        </div>

        {/* Bottom Right: Audit */}
        <div className={cn("absolute top-[75%] right-[5%] lg:right-[5%] -translate-y-1/2 w-56 transition-all duration-700 transform pointer-events-auto", isCardActive('execution') ? "opacity-100 scale-100 hover:scale-105" : "opacity-30 scale-95 grayscale")}>
          <div className={cn("rounded-[16px] border bg-brand-panel/60 backdrop-blur-md p-4 shadow-2xl transition-colors duration-500", isCardActive('execution') ? "border-cyan-500/50 shadow-[0_0_30px_rgba(6,182,212,0.2)]" : "border-white/10")}>
            <div className="flex items-center gap-3 mb-3">
              <div className="w-8 h-8 rounded-full bg-cyan-500/10 flex items-center justify-center border border-cyan-500/20">
                <Sparkles className={cn("w-4 h-4", isCardActive('execution') ? "text-cyan-400" : "text-gray-500")} />
              </div>
              <span className="text-[13px] font-semibold text-white">Execution</span>
            </div>
            <div className="text-[11px] text-brand-steel space-y-1.5 font-mono">
              <div className="flex items-center justify-between"><span>Latency</span> <span className="text-white">68ms</span></div>
              <div className="flex items-center justify-between"><span>Result</span> <span className={cn(isCardActive('execution') && "text-cyan-400")}>Success</span></div>
            </div>
          </div>
        </div>

      </div>

    </div>
  );
}
