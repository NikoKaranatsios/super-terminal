// Creation is parsed again in a fresh, tool-disabled model invocation. No global
// draft, history, project notes, memory or agent output enters this input.
export const OWNER_CREATION=new Set(['create_project','start_work_session','add_work_project']);
export function ownerIntentInput(prompt,{environment='local',workSessionId=''}={}) {
  return {mode:'owner-intent',userMessage:prompt,selectedEnvironment:environment,selectedWorkSessionId:workSessionId,
    instruction:'Derive only create_project, start_work_session or add_work_project actions explicitly requested by this direct owner message. Use only this message and the selected environment/session identity. Do not infer missing names, topics or locations from any other context. If necessary ask one concise clarification with actions=[]. Use selectedWorkSessionId for this/current session and only as a destination or explicit carry-forward source. No reads, launches, tools, memory or assessments. Other requested work uses a separate internal project dispatch; the owner conversation stays global.',memory:'',conversation:[],snapshot:{},actionResults:[]};
}
export function validateOwnerCreation(action,workSessionId='') {
  if(!OWNER_CREATION.has(action.type))throw new Error('The clean creation step may only create project/session metadata.');
  if(action.projectId||action.taskId||action.goalId||action.teamId||action.scope||action.members?.length)throw new Error('Creation cannot import an existing project, task or team context.');
  if(action.type==='create_project' && (action.target||action.workSessionId))throw new Error('A new project cannot target an existing record.');
  if(action.type==='start_work_session' && (action.workSessionId || (action.target && action.target!==workSessionId)))throw new Error('Carry-forward must use the explicitly selected working session.');
  if(action.type==='add_work_project' && (!workSessionId || (action.target && action.target!==workSessionId) || (action.workSessionId && action.workSessionId!==workSessionId) || !(action.target || action.workSessionId)))throw new Error('Choose the working session before adding a topic.');
  return true;
}
