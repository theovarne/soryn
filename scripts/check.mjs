import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
function check(dir) {
  for(const entry of readdirSync(dir,{withFileTypes:true})) {
    const path=`${dir}/${entry.name}`;
    if(entry.isDirectory())check(path);
    else if(/\.(m?js)$/.test(path)){const result=spawnSync(process.execPath,['--check',path],{stdio:'inherit'});if(result.status)process.exit(result.status);}
  }
}
for(const dir of ['api','server','dist','scripts','tests'])check(dir);
console.log('all JavaScript syntax checks passed');
