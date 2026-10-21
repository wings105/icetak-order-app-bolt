import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import {createTaskClickUpHandler} from './handler.ts';
Deno.serve(createTaskClickUpHandler({url:Deno.env.get('SUPABASE_URL')||'',key:Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||''}));
