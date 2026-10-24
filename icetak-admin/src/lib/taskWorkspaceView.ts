// Task Workspace presentation only; provider definitions and other views keep
// their own ordering. Unknown future statuses follow the configured groups.
const statusOrder=[
 'cake topper - printing','ready stock','print alamat','edible image -printing',
 'wafer - printing','design edible image','wafer paper','review',
 'design editing -topper','new custom','acrylic','prospect',
 'edible print ready stock','lain2',
] as const;
const normalize=(status:string)=>(status||'').trim().toLowerCase().replace(/[–—]/g,'-').replace(/\s*-\s*/g,'-').replace(/\s+/g,' ');
const ranks=new Map<string,number>(statusOrder.map((status,index)=>[normalize(status),index]));
function rank(status:string){const value=normalize(status);return value==='complete'||value==='closed'?statusOrder.length+1:ranks.get(value)??statusOrder.length;}
export function compareTaskWorkspaceStatus(a:string,b:string){return rank(a)-rank(b)||normalize(a).localeCompare(normalize(b));}
export function taskWhatsAppUrl(phone:string|null|undefined){
 let digits=(phone||'').replace(/\D/g,'');
 if(digits.startsWith('00'))digits=digits.slice(2);
 else if(digits.startsWith('0'))digits='60'+digits.slice(1);
 return /^[1-9]\d{6,14}$/.test(digits)?'whatsapp://send?phone='+digits:'';
}
