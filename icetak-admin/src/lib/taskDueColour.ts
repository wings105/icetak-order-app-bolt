const day=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kuala_Lumpur',year:'numeric',month:'2-digit',day:'2-digit'});
export function taskDueClass(value:string|null|undefined,now=Date.now()){
 if(!value)return '';const date=Date.parse(value);if(!Number.isFinite(date))return '';
 const due=day.format(date),today=day.format(now);return due<today?'tw-overdue':due===today?'tw-today':'';
}
