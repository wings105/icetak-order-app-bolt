import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import {createTaskStationHandler} from './handler.ts';
Deno.serve(createTaskStationHandler({url:Deno.env.get('SUPABASE_URL')||'',key:Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||''}));
