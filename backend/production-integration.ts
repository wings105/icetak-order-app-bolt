import type { SupabaseClient } from '@supabase/supabase-js';

export interface ClickUpTask {
  id: string;
  status: string;
  name: string;
}

export async function syncProductionComponent(
  supabase: SupabaseClient,
  componentId: string,
  clickupTask: ClickUpTask,
) {
  const { error } = await supabase
    .from('production_components')
    .update({
      clickup_task_id: clickupTask.id,
      clickup_status: clickupTask.status,
      last_synced_at: new Date().toISOString(),
    })
    .eq('id', componentId);

  if (error) throw new Error(`Failed to sync component ${componentId}: ${error.message}`);
}

export async function updateComponentReviewStatus(
  supabase: SupabaseClient,
  componentId: string,
  reviewStatus: 'pending' | 'approved' | 'rejected',
  previewUrl?: string,
) {
  const updates: Record<string, unknown> = { review_status: reviewStatus };
  if (previewUrl) updates.preview_url = previewUrl;

  const { error } = await supabase
    .from('production_components')
    .update(updates)
    .eq('id', componentId);

  if (error) throw new Error(`Failed to update review status: ${error.message}`);
}

export async function fetchPendingProductionComponents(supabase: SupabaseClient) {
  const { data, error } = await supabase
    .from('production_components')
    .select('*, orders(order_no, status)')
    .is('clickup_task_id', null)
    .order('created_at', { ascending: true });

  if (error) throw new Error(`Failed to fetch pending components: ${error.message}`);
  return data ?? [];
}
