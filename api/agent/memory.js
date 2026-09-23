import { readOnly } from '../../server/http.js';

export default async function handler(req,res) {
  if(!readOnly(req,res)) return;
  return res.status(200).json({days:[],persistenceMode:'local',sharedMemory:false});
}
