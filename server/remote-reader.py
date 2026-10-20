"""Read-only Linux agent discovery and bounded provider history reader over SSH."""
import os, sys, json, sqlite3, glob, re, subprocess, datetime, time, pwd
from pathlib import Path

def records(file, limit=131072):
    try:
        with open(file, 'rb') as f:
            size = os.fstat(f.fileno()).st_size
            if size <= limit: parts = [f.read()]
            else:
                first = f.read(limit // 4).split(b'\n')[:-1]
                f.seek(-limit * 3 // 4, 2)
                parts = [b'\n'.join(first), b'\n'.join(f.read().split(b'\n')[1:])]
        out = []
        for part in parts:
            for line in part.splitlines():
                try: out.append(json.loads(line))
                except (ValueError, UnicodeError): pass
        return out
    except OSError: return []

def iso(value):
    return datetime.datetime.fromtimestamp(value, datetime.timezone.utc).isoformat()

def content(value):
    if isinstance(value, str): return value
    if isinstance(value, list): return '\n'.join(c.get('text', '') for c in value if c.get('type') in ('text','input_text','output_text'))
    return ''

def messages(provider, rows):
    out = []
    for r in rows:
        p = r.get('payload', r)
        role, text = None, ''
        if provider == 'codex':
            if r.get('type') == 'response_item' and p.get('type') == 'message': role, text = p.get('role'), content(p.get('content'))
            if r.get('type') == 'event_msg' and p.get('type') in ('user_message','agent_message'): role, text = ('user' if p['type'] == 'user_message' else 'assistant'), p.get('message','')
        elif not r.get('isMeta'):
            role, text = r.get('type', r.get('role')), content(r.get('message', {}).get('content', r.get('content')))
        if role not in ('user','assistant') or not text: continue
        query = re.search(r'<user_query>([\s\S]*?)</user_query>', text)
        if query: text = query.group(1).strip()
        if text.startswith(('<', '# AGENTS', '# Instructions')): continue
        if out and out[-1]['role'] == role and out[-1]['text'] == text[:20000]: continue
        out.append(dict(role=role, text=text[:20000], timestamp=r.get('timestamp')))
    return out[-100:]

def index(base=None):
    base = base or str(Path.home())
    rows = []
    def add(provider, sid, cwd, title, updated, file, created=None):
        rows.append(dict(provider=provider, sessionId=sid, cwd=cwd or str(Path.home()), title=re.sub(r'\s+', ' ', str(title or provider+' conversation'))[:180], updatedAt=updated, file=file, createdAt=created))
    codex = str(Path(base)/'.codex')
    dbs = sorted(glob.glob(codex+'/state_*.sqlite'), key=lambda p: int(re.search(r'state_(\d+)', p)[1]), reverse=True)
    try:
        if dbs:
            db = sqlite3.connect('file:'+dbs[0]+'?mode=ro', uri=True, timeout=2)
            for sid,cwd,title,updated,file,created in db.execute('SELECT id,cwd,title,updated_at,rollout_path,created_at FROM threads WHERE archived=0 ORDER BY updated_at DESC LIMIT 2000'):
                add('codex',sid,cwd,title,iso(updated),file,iso(created))
            db.close()
    except (sqlite3.Error, OSError): pass
    if not rows:
        for file in glob.glob(codex+'/sessions/**/*.jsonl', recursive=True):
            rs = records(file,65536); meta = next((r.get('payload',{}) for r in rs if r.get('type')=='session_meta'),{})
            if meta.get('id'): add('codex',meta['id'],meta.get('cwd'),next((m['text'] for m in messages('codex',rs) if m['role']=='user'),None),iso(os.stat(file).st_mtime),file)
    claude = str(Path(base)/'.claude')
    for file in glob.glob(claude+'/projects/*/*.jsonl'):
        if Path(file).name.startswith('agent-'): continue
        rs = records(file); meta = next((r for r in rs if r.get('cwd')),None)
        if not meta: continue
        title = next((r.get('customTitle') or r.get('summary') for r in reversed(rs) if r.get('type') in ('custom-title','summary')),None)
        title = title or next((m['text'] for m in messages('claude',rs) if m['role']=='user'),None)
        add('claude',meta.get('sessionId',Path(file).stem),meta['cwd'],title,iso(os.stat(file).st_mtime),file,next((r.get('timestamp') for r in rs if r.get('timestamp')),None))
    grok = str(Path(base)/'.grok')
    for file in glob.glob(grok+'/sessions/*/*/summary.json'):
        try:
            meta=json.load(open(file)); info=meta['info']
            add('grok',info['id'],info.get('cwd'),meta.get('generated_title') or meta.get('session_summary'),meta.get('updated_at') or iso(os.stat(file).st_mtime),str(Path(file).parent/'chat_history.jsonl'))
        except (OSError,ValueError,KeyError): pass
    return rows

def discover():
    panes=[]
    owner=pwd.getpwuid(os.getuid()).pw_name
    try:
        data=subprocess.check_output(['tmux','list-panes','-a','-F','#{session_id}\t#{session_name}\t#{pane_current_path}\t#{pane_current_command}\t#{pane_id}\t#{pane_tty}\t#{pane_dead}'],stderr=subprocess.DEVNULL,text=True,timeout=3)
        for line in data.splitlines():
            target,name,cwd,command,pane,tty,dead=line.split('\t')
            panes.append(dict(target=target,title=name,cwd=cwd,command=command,pane=pane,tty=tty,dead=dead=='1',owner=owner,requiresSudo=bool(os.environ.get('SUDO_USER'))))
    except (OSError,subprocess.SubprocessError,ValueError): pass
    processes=[]
    data=subprocess.check_output(['ps','-axo','pid=,ppid=,tty=,stat=,etimes=,comm='],text=True,timeout=3)
    for line in data.splitlines():
        values=line.split(None,5)
        if len(values)!=6: continue
        pid,ppid,tty,state,elapsed,command=values; provider=os.path.basename(command)
        if provider not in ('codex','claude','grok') or state.startswith('Z'): continue
        try:
            args=Path('/proc/'+pid+'/cmdline').read_bytes().decode(errors='replace').split('\0')
            if 'mcp-server' in args[1:]: continue
            cwd=os.readlink('/proc/'+pid+'/cwd')
        except OSError: cwd=''; args=[]
        files=[]
        for fd in glob.glob('/proc/'+pid+'/fd/*'):
            try:
                name=os.readlink(fd)
                if name.endswith('.jsonl'): files.append(name)
            except OSError: pass
        resume=next((a for a in args[1:] if re.fullmatch(r'[0-9a-fA-F-]{36}',a)),None)
        try: processOwner=pwd.getpwuid(os.stat('/proc/'+pid).st_uid).pw_name
        except (OSError,KeyError): processOwner=''
        processes.append(dict(owner=processOwner,requiresSudo=bool(os.environ.get('SUDO_USER')),pid=int(pid),ppid=int(ppid),tty=tty,provider=provider,cwd=cwd,files=files,resumeId=resume,runtime='app-server' in args[1:],startedAt=iso(time.time()-int(elapsed)),status='paused' if state.startswith('T') else 'external'))
    # Include the SSH caller's tmux server and servers owned by discovered agent users.
    if os.getuid()==0:
        owners=set(p.get('owner') for p in processes) | {os.environ.get('SUDO_USER')}
        for user in owners-{owner,None,''}:
            try:
                data=subprocess.check_output(['sudo','-n','-u',user,'tmux','list-panes','-a','-F','#{session_id}\t#{session_name}\t#{pane_current_path}\t#{pane_current_command}\t#{pane_id}\t#{pane_tty}\t#{pane_dead}'],stderr=subprocess.DEVNULL,text=True,timeout=3)
                for line in data.splitlines():
                    target,name,cwd,command,pane,tty,dead=line.split('\t')
                    panes.append(dict(target=target,title=name,cwd=cwd,command=command,pane=pane,tty=tty,dead=dead=='1',owner=user,requiresSudo=True))
            except (OSError,subprocess.SubprocessError,ValueError): pass
    return dict(panes=panes,processes=processes)

def indexes(processes):
    homes={str(Path.home())}
    caller=os.environ.get('SUDO_USER')
    for user in set([p.get('owner') for p in processes]+([caller] if caller else [])):
        try: homes.add(pwd.getpwnam(user).pw_dir)
        except (KeyError,TypeError): pass
    rows=[]
    for base in sorted(homes):
        for row in index(base):
            row['owner']=next((p.pw_name for p in pwd.getpwall() if p.pw_dir==base),'')
            rows.append(row)
    return rows

result=discover()
if sys.argv[1]=='transcript':
    session=next((r for r in indexes(result['processes']) if r['provider']+':'+r['sessionId']==sys.argv[2]),None)
    if not session: raise RuntimeError('Conversation no longer exists on this host.')
    print(json.dumps(dict(messages=messages(session['provider'],records(session['file'],2*1024*1024)))))
else:
    if sys.argv[1]=='index': result['history']=indexes(result['processes'])
    result['elevatedRead']=bool(os.environ.get('SUDO_USER'))
    print(json.dumps(result))
