export interface QueueSlot { day:number; time:string; category?:string }
export function validateQueueSlots(value:unknown):QueueSlot[]{
 if(!Array.isArray(value)||value.length>50)throw new Error("Supply at most 50 weekly slots.");
 const seen=new Set<string>();
 return value.map(v=>{if(!v||!Number.isInteger(v.day)||v.day<0||v.day>6||typeof v.time!=="string"||!/^([01]\d|2[0-3]):[0-5]\d$/.test(v.time))throw new Error("Slots need day 0–6 (Sunday–Saturday) and HH:mm.");const key=`${v.day}-${v.time}`;if(seen.has(key))throw new Error("Duplicate weekly slot.");seen.add(key);return{day:v.day,time:v.time,category:typeof v.category==="string"?v.category.slice(0,80):""};});
}
export function upcomingQueueSlots(slots:QueueSlot[],timezone:string,after:Date,count=100):Array<{scheduledAt:string;category:string}>{
 const formatter=new Intl.DateTimeFormat("en-CA",{timeZone:timezone,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"});
 const parts=(date:Date)=>Object.fromEntries(formatter.formatToParts(date).map(p=>[p.type,p.value]));
 const first=parts(after);const base=Date.UTC(Number(first.year),Number(first.month)-1,Number(first.day));const result:Array<{scheduledAt:string;category:string}>=[];
 for(let day=0;day<90&&result.length<count;day++){
  const date=new Date(base+day*86400000);const dateKey=date.toISOString().slice(0,10);
  for(const slot of slots.filter(s=>s.day===date.getUTCDay()).sort((a,b)=>a.time.localeCompare(b.time))){
   const wall=Date.parse(`${dateKey}T${slot.time}:00Z`);const options:number[]=[];
   // Offset search handles half/quarter-hour zones and daylight-saving gaps/folds.
   for(let offset=-14*60;offset<=14*60;offset+=15){const utc=wall-offset*60000;const p=parts(new Date(utc));if(`${p.year}-${p.month}-${p.day}`===dateKey&&`${p.hour}:${p.minute}`===slot.time&&utc>after.getTime())options.push(utc);}
   if(options.length)result.push({scheduledAt:new Date(Math.min(...options)).toISOString(),category:slot.category??""});
  }
 }
 return result.sort((a,b)=>a.scheduledAt.localeCompare(b.scheduledAt)).slice(0,count);
}
