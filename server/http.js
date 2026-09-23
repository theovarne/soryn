export function readOnly(req,res) {
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='GET') {res.status(405).json({error:'method not allowed'});return false;}
  return true;
}
export function unavailable(res) { return res.status(503).json({error:'server state unavailable'}); }
