import { AGENT_WALLET, EXECUTION_MODE, PERSISTENCE_MODE } from '../../dist/config.js';
import { readOnly } from '../../server/http.js';
export default async function handler(req,res) {
  if(!readOnly(req,res)) return;
  return res.status(200).json({
    agent:'soryn',
    wallet:AGENT_WALLET,
    runtime:'local',
    persistenceMode:PERSISTENCE_MODE,
    executionMode:EXECUTION_MODE,
    sharedState:false,
    message:'agent state belongs to this browser localStorage'
  });
}
