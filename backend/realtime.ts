import { removeSubscriptionsByConnection } from './realtime-subscribers';
export const realtime=async(event:any)=>{let msg:any={};try{msg=JSON.parse(event.body||'{}')}catch{}if(msg.type==='system.disconnected'&&msg.payload?.connection_id)await removeSubscriptionsByConnection(msg.payload.connection_id);return {statusCode:200}};
