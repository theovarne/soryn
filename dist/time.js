// Presentation only. Source timestamps remain ISO; browser display uses ET.
export const DISPLAY_TIME_ZONE = 'America/New_York';
const valid = value => value != null && value !== '' && Number.isFinite(new Date(value).getTime());
const format = (value, options) => valid(value) ? new Intl.DateTimeFormat('en-GB', {timeZone:DISPLAY_TIME_ZONE,...options}).format(new Date(value)) : '—';
export const formatEasternTime = value => valid(value) ? `${format(value,{hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'})} ET` : '—';
export const formatEasternDate = value => valid(value) ? `${format(value,{year:'numeric',month:'short',day:'2-digit'})} ET` : '—';
export const formatEasternDateTime = value => valid(value) ? `${format(value,{year:'numeric',month:'short',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'})} ET` : '—';
export function easternDateKey(value) {
  if(!valid(value))return null;
  const parts=new Intl.DateTimeFormat('en-US',{timeZone:DISPLAY_TIME_ZONE,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(value));
  return ['year','month','day'].map(type=>parts.find(p=>p.type===type).value).join('-');
}
export const isEasternToday = (value, now=Date.now()) => easternDateKey(value)!==null && easternDateKey(value)===easternDateKey(now);
export const easternHour = value => format(value,{hour:'2-digit',hourCycle:'h23'});
export const last24Hours = (now=Date.now()) => Array.from({length:24},(_,i)=>new Date(Math.floor(new Date(now).getTime()/3600000)*3600000-(23-i)*3600000));
export function formatEasternRelativeTime(value, now=Date.now()) {
  if(!valid(value))return '—';
  const seconds=Math.max(0,Math.floor((new Date(now)-new Date(value))/1000));
  return seconds<60?`${seconds}s`:seconds<3600?`${Math.floor(seconds/60)}m`:seconds<86400?`${Math.floor(seconds/3600)}h`:`${Math.floor(seconds/86400)}d`;
}
export function countdown(value, now=Date.now()) {
  if(!valid(value))return 'unavailable';
  const seconds=Math.max(0,Math.ceil((new Date(value)-new Date(now))/1000));
  return seconds?`${Math.floor(seconds/60)}m ${seconds%60}s`:'due - waiting while page is open';
}
