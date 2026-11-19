// Filesystem/provider reads live outside the service event loop. The parent can
// discard this process on a deadline without losing PTYs or application state.
import fs from 'node:fs';
import path from 'node:path';
import {History,readRecords} from './history.mjs';
import {completion} from './activity.mjs';
import {scanTmux,externalTerminals,terminalTty} from './discovery.mjs';
import {classifyProjects} from './project-classification.mjs';
const history=new History();let cachedExternal,externalAt=0;
const operations={
  'history-index':async input=>({rows:await history.all(input.force),warnings:history.warnings}),
  'history-transcript':input=>history.transcript(input.id,input.cursor),
  'history-markers':input=>input.rows.map(({file,...row})=>{try{const log=row.provider==='grok'?path.join(path.dirname(file),'events.jsonl'):file;if(!log||fs.statSync(log).mtimeMs<(input.since || 0))return row;return {...row,completion:completion(row.provider,readRecords(log,256*1024))};}catch{return row;}}),
  'classify':input=>classifyProjects(input.state,input.inventory,input.options),
  'local-discovery':async()=>{
    const [own,defaults]=await Promise.all([scanTmux(),scanTmux(null)]);const warnings=[];let external;
    try{const rows=Date.now()-externalAt<7000&&cachedExternal?cachedExternal:await externalTerminals([],{strict:true,onWarning:message=>warnings.push(message)});if(!warnings.length){cachedExternal=rows;externalAt=Date.now();}external={rows,healthy:!warnings.length,warnings};}
    catch(error){external={rows:[],healthy:false,warnings:[error.message]};}
    const excluded=new Set([...own.rows,...defaults.rows].map(row=>terminalTty(row.tty)));
    for(const scan of [own,defaults])scan.rows=scan.rows.map(pane=>{
      const process=external.rows.find(row=>terminalTty(row.tty)===terminalTty(pane.tty));
      return process?{...pane,runtime:process.runtime,files:process.files,resumeId:process.resumeId,pid:process.pid,startedAt:process.startedAt}:pane;
    });
    external.rows=external.rows.filter(row=>!excluded.has(terminalTty(row.tty)));
    return {own,defaults,external};
  }
};
process.on('message',async({id,operation,input})=>{try{if(!operations[operation])throw new Error('Unknown reader operation.');const result=await operations[operation](input || {});if(process.connected)process.send({id,result});}catch(error){if(process.connected)process.send({id,error:error.message});}});
process.on('disconnect',()=>process.exit(0));
