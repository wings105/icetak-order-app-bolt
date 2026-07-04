import type { SupabaseClient, RealtimeChannel } from '@supabase/supabase-js';

type RealtimeCallback = (payload: Record<string, unknown>) => void;

export class RealtimeManager {
  private channels = new Map<string, RealtimeChannel>();

  constructor(private readonly supabase: SupabaseClient) {}

  subscribe(channelName: string, table: string, callback: RealtimeCallback): RealtimeChannel {
    this.unsubscribe(channelName);

    const ch = this.supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table },
        (payload) => callback(payload as unknown as Record<string, unknown>),
      )
      .subscribe();

    this.channels.set(channelName, ch);
    return ch;
  }

  unsubscribe(channelName: string) {
    const ch = this.channels.get(channelName);
    if (ch) {
      this.supabase.removeChannel(ch);
      this.channels.delete(channelName);
    }
  }

  unsubscribeAll() {
    for (const name of this.channels.keys()) {
      this.unsubscribe(name);
    }
  }
}

export function createRealtimeManager(supabase: SupabaseClient) {
  return new RealtimeManager(supabase);
}
