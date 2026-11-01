import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import {createAcrylicActionsHandler} from './handler.ts';
Deno.serve(createAcrylicActionsHandler({url:Deno.env.get('SUPABASE_URL')||'',key:Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||''}));

