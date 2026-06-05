'use client';

import { MessageSquare } from 'lucide-react';
import { GlassCard } from '@/components/ui/GlassCard';

export function AgentChat() {
  return (
    <div className="flex items-center justify-center h-64">
      <GlassCard accent="cyan" padding="p-8" className="text-center max-w-sm">
        <MessageSquare size={32} className="text-ncyan mx-auto mb-3" />
        <div className="font-orbitron text-[12px] text-ncyan tracking-[2px] mb-2">AGENT CHAT</div>
        <div className="text-[10px] text-dimtext leading-relaxed">
          Chat with Jarvis agents via Telegram<br />
          <span className="text-ncyan">@JarvisLoveraBot</span>
        </div>
      </GlassCard>
    </div>
  );
}
