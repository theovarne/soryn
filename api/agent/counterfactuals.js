import { readOnly } from '../../server/http.js';

export default async function handler(req,res) {
  if(!readOnly(req,res)) return;
  return res.status(200).json({items:[],summary:{evaluated:0,missedUpside:0,avoidedDownside:0},persistenceMode:'local',sharedCounterfactuals:false});
}
