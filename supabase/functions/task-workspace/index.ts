import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import {createTaskWorkspaceHandler} from './handler.ts';
Deno.serve(createTaskWorkspaceHandler({url:Deno.env.get('SUPABASE_URL')||'',key:Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||''}));
