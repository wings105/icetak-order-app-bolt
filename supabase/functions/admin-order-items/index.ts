import { createAdminOrderItemsHandler } from './handler.ts';
Deno.serve(createAdminOrderItemsHandler({
  url: Deno.env.get('SUPABASE_URL') || '',
  key: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '',
}));
