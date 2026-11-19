#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { z } from 'zod';
import { platformCall, validateConfig } from './mcp-client.mjs';
import { workflowRules, workflows } from './mcp-workflows.mjs';
import { fileURLToPath } from 'node:url';

export function createMcpServer(configPath, call = payload=>platformCall(configPath,payload)) {
  const server = new McpServer({name:'super-terminal',version:'1.0.0'},{instructions:workflowRules});
  const key=z.string().trim().min(1).max(160), id=z.string().trim().min(1).max(200);
  const note=z.string().max(2000);
  function tool(name,description,schema,make,{readOnly=false,idempotent=true,destructive=false}={}) {
    server.registerTool(name,{description,inputSchema:z.object(schema).strict(),annotations:{readOnlyHint:readOnly,idempotentHint:idempotent,destructiveHint:destructive,openWorldHint:false}},async args=>{
      try { const result=await call(make(args));if(name==='st_browser'&&typeof result.image==='string'){const {image,...metadata}=result;return {content:[{type:'text',text:JSON.stringify(metadata)},{type:'image',data:image,mimeType:'image/png'}],structuredContent:metadata};}return {content:[{type:'text',text:JSON.stringify(result)}],structuredContent:result}; }
      catch(error){const result=error.delivery || {error:error.message};return {isError:true,content:[{type:'text',text:JSON.stringify(result)}]};}
    });
  }
  tool('st_context','Read your assignment and scoped context before work or after reassignment.',{},()=>({command:'context'}));
  tool('st_peers','List peers allowed by explicit team membership.',{},()=>({command:'peers'}),{readOnly:true});
  tool('st_graph','Read a bounded graph of your tasks, team peers and ownership; reports remain claims.',{},()=>({command:'graph'}),{readOnly:true});
  tool('st_conductor','Check Conductor availability and your sent messages. Coordinate from this terminal via st_send; this does not grant owner authority or start a model call.',{},()=>({command:'conductor'}),{readOnly:true});
  tool('st_tasks','List assigned-scope tasks and current revisions.',{},()=>({command:'tasks'}),{readOnly:true});
  tool('st_request_helper','Request a managed helper within the owner-enabled team allowance. Inherits this project, team, runtime and permissions. Reuse requestId to inspect a pending or completed launch; never create duplicate requests after an interruption.',{requestId:key,role:z.string().trim().min(1).max(100),task:z.string().trim().min(1).max(6000),provider:z.enum(['codex','claude','grok','shell']).optional()},a=>({command:'delegate',...a}));
  tool('st_browser','Use your own browser. Container teams run it inside their runtime. Screenshots return image data; other commands return accessible page content.',{action:z.enum(['open','snapshot','click','fill','press','scroll','screenshot','close']),url:z.string().max(4000).optional(),selector:z.string().max(2000).optional(),text:z.string().max(12000).optional(),key:z.string().max(100).optional()},a=>({command:'browser',...a}),{idempotent:false});
  tool('st_inbox','Fetch messages, including fetched but unacknowledged messages. Fetch is not acceptance.',{},()=>({command:'inbox',includeUnacknowledged:true}));
  tool('st_ack','Acknowledge one message after reading and understanding it. Does not complete a task.',{messageId:id},a=>({command:'ack',...a}));
  tool('st_heartbeat','Record contact only. Does not attest process state or task progress.',{},()=>({command:'heartbeat'}));
  tool('st_send','Durably send to coordinator or an explicit team peer. Reuse eventId for retries; queued is not accepted.',{to:id,message:z.string().trim().min(1).max(12000),eventId:key},a=>({command:'send',...a}));
  tool('st_create_task','Record authorized work in your scope. Reuse clientKey; creating a task grants no execution authority.',{title:z.string().trim().min(1).max(800),notes:z.string().max(6000).optional(),clientKey:key},a=>({command:'task',operation:'create',...a}));
  tool('st_report','Durably report progress with actor-attributed evidence. Use a new eventId per update, same ID for retries.',{
    taskId:id,eventId:key,status:z.enum(['todo','doing','blocked','done','stopped']),summary:z.string().trim().min(1).max(6000),
    blocker:note.optional(),nextStep:note.optional(),expectedRevision:z.number().int().positive(),
    evidence:z.array(z.string().trim().min(1).max(2000)).max(12).optional()
  },({summary,...a})=>{if(a.status==='done'&&!a.evidence?.length)throw new Error('Include verification evidence before reporting done.');if(a.status==='blocked'&&!a.blocker?.trim())throw new Error('Include the specific blocker.');return {command:'task',operation:'report',notes:summary,...a};});
  tool('st_pending','Inspect durable pending operations before retrying or discarding.',{},()=>({command:'pending'}),{readOnly:true});
  tool('st_flush','Retry queued operations with their original event IDs and assignment. Stops on the first rejection.',{},()=>({command:'flush'}));
  tool('st_discard','Explicitly abandon an obsolete LOCAL queued event after inspecting it. Does not undo a server result.',{eventId:key},a=>({command:'discard',...a}),{destructive:true,idempotent:false});
  for(const [name,workflow] of Object.entries(workflows)) server.registerPrompt(name,{title:workflow.title,description:workflow.description},async()=>({description:workflow.description,messages:[{role:'user',content:{type:'text',text:workflowRules+'\n\n'+workflow.text}}]}));
  server.registerResource('coordination-workflows','st://workflows',{mimeType:'text/markdown',description:'Local start, checkpoint, blocker and handoff workflows.'},async uri=>({contents:[{uri:uri.href,mimeType:'text/markdown',text:workflowRules+'\n\n'+Object.entries(workflows).map(([name,w])=>`## ${name}\n\n${w.text}`).join('\n\n')}]}));
  return server;
}

if (process.argv[1]===fileURLToPath(import.meta.url)) {
  try {
    const config=process.env.SUPER_TERMINAL_AGENT_CONFIG;
    validateConfig(config);
    serveStdio(()=>createMcpServer(config));
  } catch(error) { console.error('Super Terminal MCP: '+error.message);process.exitCode=1; }
}
