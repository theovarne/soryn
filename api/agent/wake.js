export default async function handler(req,res) {
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='GET') return res.status(405).json({error:'method not allowed'});
  return res.status(410).json({error:'server wake disabled',runtime:'local',persistenceMode:'local'});
}
