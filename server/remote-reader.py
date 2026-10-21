"""Read-only Linux agent discovery and bounded provider history reader over SSH."""
import os, sys, json, sqlite3, glob, re, subprocess, datetime, time, pwd, stat
from pathlib import Path

def process_start_identity(pid, proc_root='/proc'):
    """Boot identity and kernel start ticks are stable across scans and PID reuse."""
    try:
        pid = int(pid)
        if pid <= 1: return None
        root = Path(proc_root)
        boot = (root/'sys/kernel/random/boot_id').read_text().strip()
        fields = (root/str(pid)/'stat').read_text().rsplit(')', 1)[1].split()
        ticks = fields[19]
        if not re.fullmatch(r'[0-9a-fA-F-]{36}', boot) or not ticks.isdigit(): return None
        return boot + ':' + ticks
    except (OSError, ValueError, IndexError): return None

def small_git_file(file, limit=4096):
    fd = None
    try:
        fd = os.open(file, os.O_RDONLY | os.O_NONBLOCK)
        metadata = os.fstat(fd)
        if not stat.S_ISREG(metadata.st_mode) or metadata.st_size > limit: return None
        data = os.read(fd, limit+1)
        return data.decode().strip() if len(data) <= limit else None
    except (OSError, UnicodeError): return None
    finally:
        if fd is not None: os.close(fd)

def repository_root(cwd):
    """Verify Git metadata without executing repository commands or configuration."""
    try:
        if not isinstance(cwd, str) or not os.path.isabs(cwd): return None
        current = Path(cwd).resolve(strict=True)
        if not current.is_dir(): return None
        for _ in range(64):
            git = current/'.git'
            if not git.is_dir():
                link = small_git_file(git)
                git = (current/link[8:].strip()).resolve() if link and link.startswith('gitdir: ') and not re.search(r'[\r\n\0]', link) else None
            if git:
                head = small_git_file(git/'HEAD', 512)
                if head and re.fullmatch(r'(ref: refs/[^\s\0]+|[0-9a-fA-F]{40}|[0-9a-fA-F]{64})', head):
                    common = small_git_file(git/'commondir')
                    if (git/'objects').is_dir() or (common and not re.search(r'[\r\n\0]', common) and (git/common/'objects').is_dir()): return str(current)
            if current.parent == current: break
            current = current.parent
    except (OSError, ValueError): pass
    return None

repository_cache = {}
def repository_metadata(cwd):
    if not isinstance(cwd, str): return dict(repository=None, repositoryVerified=False)
    if cwd not in repository_cache:
        root = repository_root(cwd)
        try: canonical = str(Path(cwd).resolve(strict=True)) if os.path.isabs(cwd) else None
        except (OSError, ValueError): canonical = None
        repository_cache[cwd] = dict(repository=root, repositoryVerified=bool(root), canonicalCwd=canonical)
    return repository_cache[cwd]

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

def completion(provider, file):
    if provider == 'grok': file = str(Path(file).parent/'events.jsonl')
    try:
        if os.stat(file).st_mtime < time.time()-86400: return None
    except OSError: return None
    latest = None
    for r in records(file, 262144):
        p = r.get('payload', {})
        done = (provider == 'codex' and r.get('type') == 'event_msg' and p.get('type') == 'task_complete') or (provider == 'claude' and r.get('type') == 'assistant' and not r.get('isSidechain') and not r.get('isApiErrorMessage') and r.get('message', {}).get('stop_reason') == 'end_turn') or (provider == 'grok' and r.get('type') == 'turn_ended' and r.get('outcome') in ('completed','success'))
        at = r.get('timestamp') or r.get('ts')
        if done and at: latest = dict(key=str(r.get('uuid') or p.get('turn_id') or at), at=at)
    return latest

def content(value):
    if isinstance(value, str): return value
    if isinstance(value, list): return '\n'.join(c.get('text', '') for c in value if c.get('type') in ('text','input_text','output_text'))
    return ''

def output_page(file, cursor=None, budget=262144):
    with open(file, 'rb') as f:
        size = os.fstat(f.fileno()).st_size
        end = size if cursor is None else int(cursor)
        if end < 0 or end > size: raise ValueError('Conversation changed. Reload recent output.')
        length = min(end, budget)
        while True:
            start = end-length
            f.seek(start); data = f.read(length)
            first = data.find(b'\n') if start else -1
            if not start or (first >= 0 and first < len(data)-1) or length >= 8388608: break
            length = min(end, length*2)
        skipped = start > 0 and (first < 0 or first == len(data)-1)
        offset = first+1 if start and first >= 0 and not skipped else 0
        rows = []
        position = start+offset
        if not skipped:
            for line in data[offset:].splitlines():
                record_offset = position
                position += len(line)+1
                try:
                    value = json.loads(line)
                    if isinstance(value,dict):
                        value['_outputOffset'] = record_offset
                        rows.append(value)
                except (ValueError, UnicodeError): pass
        return rows, (start+offset or None), dict(totalBytes=size, **{'from':start+offset}, to=end, skippedLargeRecord=skipped)

def output_events(provider, rows):
    out = []
    ordinal = 0
    def readable(value):
        return value if isinstance(value, str) else json.dumps(value, ensure_ascii=False, indent=2) if value is not None else ''
    def push(r, role, kind, value, name=None):
        nonlocal ordinal
        text = readable(value)
        if not text: return
        event = dict(role=role, kind=kind, text=text, timestamp=r.get('timestamp') or r.get('ts'))
        if name: event['name'] = name
        if '_outputOffset' in r:
            event['id'] = provider+':'+str(r['_outputOffset'])+':'+str(ordinal)
            ordinal += 1
        out.append(event)
    for r in rows:
        ordinal = 0
        p=r.get('payload',r)
        if provider=='codex':
            kind=p.get('type')
            if (r.get('type')=='response_item' and kind=='message') or kind in ('userMessage','agentMessage'):
                role=p.get('role') or ('user' if kind=='userMessage' else 'assistant')
                if role in ('user','assistant'): push(r,role,'commentary' if p.get('channel')=='commentary' else 'message',p.get('text') or content(p.get('content')))
            elif kind in ('function_call','custom_tool_call','tool_call'): push(r,'tool','tool_call',p.get('arguments',p.get('input')),p.get('name') or p.get('call_id'))
            elif kind in ('function_call_output','custom_tool_call_output','tool_result'): push(r,'tool','tool_result',p.get('output',p.get('content')),p.get('name') or p.get('call_id'))
            elif kind=='commandExecution':
                push(r,'tool','tool_call',p.get('command'),'command')
                push(r,'tool','tool_result',p.get('aggregatedOutput',p.get('output')),'command')
            elif kind=='fileChange': push(r,'tool','tool_result',p.get('changes'),'file changes')
        else:
            role=r.get('type',r.get('role'))
            if role not in ('user','assistant','tool') or r.get('isMeta'): continue
            blocks=r.get('message',{}).get('content',r.get('content'))
            if isinstance(blocks,list):
                for block in blocks:
                    kind=block.get('type')
                    if kind in ('text','input_text','output_text'): push(r,role,'message',block.get('text'))
                    if kind=='tool_use': push(r,'tool','tool_call',block.get('input'),block.get('name'))
                    if kind=='tool_result': push(r,'tool','tool_result',content(block.get('content')),block.get('tool_use_id'))
            else: push(r,role,'tool_result' if role=='tool' else 'message',blocks,r.get('name'))
            for call in r.get('tool_calls',r.get('message',{}).get('tool_calls',[])):
                push(r,'tool','tool_call',call.get('function',{}).get('arguments'),call.get('function',{}).get('name'))
    return out

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
        folder = cwd or str(Path.home())
        rows.append(dict(provider=provider, sessionId=sid, cwd=folder, title=re.sub(r'\s+', ' ', str(title or provider+' conversation'))[:180], updatedAt=updated, file=file, createdAt=created, **repository_metadata(folder)))
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
        data=subprocess.check_output(['tmux','list-panes','-a','-F','#{session_id}\t#{session_name}\t#{pane_current_path}\t#{pane_current_command}\t#{pane_id}\t#{pane_tty}\t#{pane_dead}\t#{pid}'],stderr=subprocess.DEVNULL,text=True,timeout=3)
        for line in data.splitlines():
            values=line.split('\t')
            if len(values)!=8: continue
            target,name,cwd,command,pane,tty,dead,server_pid=values
            panes.append(dict(target=target,title=name,cwd=cwd,command=command,pane=pane,tty=tty,dead=dead=='1',owner=owner,requiresSudo=bool(os.environ.get('SUDO_USER')),serverIdentity=process_start_identity(server_pid), **repository_metadata(cwd)))
    except (OSError,subprocess.SubprocessError,ValueError): pass
    processes=[]
    data=subprocess.check_output(['ps','-axo','pid=,ppid=,tty=,stat=,etimes=,comm='],text=True,timeout=3)
    for line in data.splitlines():
        values=line.split(None,5)
        if len(values)!=6: continue
        pid,ppid,tty,state,elapsed,command=values; provider=os.path.basename(command)
        if provider not in ('codex','claude','grok') or state.startswith('Z'): continue
        start_identity = process_start_identity(pid)
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
        if start_identity and start_identity != process_start_identity(pid): continue
        processes.append(dict(owner=processOwner,requiresSudo=bool(os.environ.get('SUDO_USER')),pid=int(pid),ppid=int(ppid),tty=tty,provider=provider,cwd=cwd,files=files,resumeId=resume,runtime='app-server' in args[1:],startedAt=iso(time.time()-int(elapsed)),processStartIdentity=start_identity,status='paused' if state.startswith('T') else 'external', **repository_metadata(cwd)))
    # Include the SSH caller's tmux server and servers owned by discovered agent users.
    if os.getuid()==0:
        owners=set(p.get('owner') for p in processes) | {os.environ.get('SUDO_USER')}
        for user in owners-{owner,None,''}:
            try:
                data=subprocess.check_output(['sudo','-n','-u',user,'tmux','list-panes','-a','-F','#{session_id}\t#{session_name}\t#{pane_current_path}\t#{pane_current_command}\t#{pane_id}\t#{pane_tty}\t#{pane_dead}\t#{pid}'],stderr=subprocess.DEVNULL,text=True,timeout=3)
                for line in data.splitlines():
                    values=line.split('\t')
                    if len(values)!=8: continue
                    target,name,cwd,command,pane,tty,dead,server_pid=values
                    panes.append(dict(target=target,title=name,cwd=cwd,command=command,pane=pane,tty=tty,dead=dead=='1',owner=user,requiresSudo=True,serverIdentity=process_start_identity(server_pid), **repository_metadata(cwd)))
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
    rows,cursor,coverage=output_page(session['file'],sys.argv[3] if len(sys.argv)>3 else None)
    print(json.dumps(dict(messages=messages(session['provider'],rows),events=output_events(session['provider'],rows),nextCursor=cursor,coverage=coverage)))
else:
    if sys.argv[1]=='index':
        result['history']=indexes(result['processes'])
        for row in result['history']: row['completion']=completion(row['provider'],row['file'])
    result['elevatedRead']=bool(os.environ.get('SUDO_USER'))
    print(json.dumps(result))
