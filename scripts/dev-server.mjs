import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import publicData from '../api/agent.js';
import state from '../api/agent/state.js';
import records from '../api/agent/records.js';
import latest from '../api/snapshots/latest.js';
import history from '../api/snapshots/history.js';
import wake from '../api/agent/wake.js';
import cycles from '../api/agent/cycles.js';
import paper from '../api/agent/paper.js';
import memory from '../api/agent/memory.js';
import counterfactuals from '../api/agent/counterfactuals.js';
process.env.EXECUTION_MODE ||= 'simulation';
process.env.PERSISTENCE_MODE ||= 'local';
const root=resolve('dist');
const handlers={'/api/agent':publicData,'/api/agent/state':state,'/api/agent/records':records,'/api/snapshots/latest':latest,
  '/api/snapshots/history':history,'/api/agent/cycles':cycles,'/api/agent/paper':paper,'/api/agent/memory':memory,
  '/api/agent/counterfactuals':counterfactuals,'/api/agent/wake':wake};
const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost');
  res.status=n=>{res.statusCode=n;return res;};res.json=v=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(v));};req.query=Object.fromEntries(url.searchParams);
  try {
    if(handlers[url.pathname])return await handlers[url.pathname](req,res);
    let file=resolve(root,'.'+decodeURIComponent(url.pathname));
    if(file!==root&&!file.startsWith(root+'\\'))return res.status(403).end();
    if((await stat(file)).isDirectory())file=resolve(file,'index.html');
    res.setHeader('Content-Type',({'.js':'application/javascript','.css':'text/css','.html':'text/html','.png':'image/png'})[extname(file)]||'application/octet-stream');
    res.end(await readFile(file));
  } catch {res.status(404).end('not found');}
});
server.listen(4193,'127.0.0.1',()=>console.log('SORYN read-only preview at http://127.0.0.1:4193'));
