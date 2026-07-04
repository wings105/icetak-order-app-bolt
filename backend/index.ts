import express from 'express';
import cors from 'cors';
import { createClient } from '@supabase/supabase-js';
import { paymentRouter } from './payment-routes';
import { shipmentRouter } from './shipment-routes';
import { setupRealtimeSubscribers } from './realtime-subscribers';

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT ?? 3001;

const supabaseUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.VITE_SUPABASE_ANON_KEY ?? '';

export const supabase = createClient(supabaseUrl, supabaseKey);

app.use('/api/payments', paymentRouter);
app.use('/api/shipments', shipmentRouter);

app.get('/health', (_req, res) => res.json({ ok: true }));

setupRealtimeSubscribers(supabase);

app.listen(PORT, () => {
  console.log(`[backend] listening on port ${PORT}`);
});
